'use strict'

/**
 * atomicStore.test.js — the truth store must not lose what it was given.
 *
 * ── THE EVIDENCE ─────────────────────────────────────────────────────────────
 * llm_usage measured 29 → 125 → 32 in one day. A monotonically appending array cannot
 * shrink, so records were destroyed. Two defects, and the second is the one that erases:
 *
 *   A. save() used writeFileSync, which TRUNCATES THEN WRITES. A reader in another process
 *      can read the file mid-write and get a partial document.
 *   B. load() caught the resulting JSON.parse error and RETURNED AN EMPTY STORE. The caller
 *      then pushed its one record and saved, making the erasure permanent — as well-formed
 *      JSON that passes every backup gate.
 *
 * A drop of 93 records at once is not a lost update. It is B, triggered by A.
 *
 * ── WHY THESE TESTS SPAWN REAL PROCESSES ─────────────────────────────────────
 * Node's JS is single-threaded and this store is entirely *Sync, so a load→mutate→save
 * sequence CANNOT be interleaved inside one process. The race only exists BETWEEN
 * processes — which is exactly what `node --test` creates, one child per test file, and
 * what put the fixture rows in the Owner's real data directory.
 *
 * So an in-process "simulated concurrency" test would pass against the broken code and
 * prove nothing. Every defect this week that survived a green suite did so because the test
 * took a shortcut the real path does not. These use child processes and real files.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync, spawn } = require('node:child_process')

const STORE = path.resolve(__dirname, 'store.js').replace(/\\/g, '/')

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-store-'))
}
const truthFile = (dir) => path.join(dir, 'aroma-truth.json')

/** Run node with an inline script, in its own process, against `dir`. */
function runChild (dir, code, { wait = true } = {}) {
  const args = ['-e', code]
  const opts = { env: Object.assign({}, process.env, { AROMA_DATA_DIR: dir }), encoding: 'utf8' }
  return wait ? spawnSync(process.execPath, args, opts) : spawn(process.execPath, args, opts)
}

/**
 * Spawn a child AND capture its exit and stdout immediately.
 *
 * Attaching `.on('close')` later is a trap this file already fell into: a short-lived child
 * closes before the listener exists, the event is missed, and the await hangs forever. The
 * promise is created in the same tick as the spawn so the event cannot be missed.
 */
function startChild (dir, code) {
  const child = runChild(dir, code, { wait: false })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  const done = new Promise((resolve) => child.on('close', (codeOut) => resolve(codeOut)))
  return { child, done, stdout: () => out }
}

const APPEND_N = (n) => `
  const store = require('${STORE}')
  for (let i = 0; i < ${n}; i++) store.recordLLMUsage({ model: 'm', totalTokens: 1, latencyMs: 1 })
`

/* ═══ 1. CONCURRENT APPENDS — the measurement that started this ═══════════════ */

test('*** N real processes appending M records each lose nothing ***', async () => {
  const dir = tmpDir()
  const N = 6
  const M = 25
  const kids = []
  for (let i = 0; i < N; i++) kids.push(startChild(dir, APPEND_N(M)))
  const codes = await Promise.all(kids.map((k) => k.done))

  assert.deepEqual(codes, new Array(N).fill(0), 'every writer must exit cleanly')
  const db = JSON.parse(fs.readFileSync(truthFile(dir), 'utf8'))
  assert.equal(db.llm_usage.length, N * M,
    `THE LIVE FAILURE: expected ${N * M} records, found ${db.llm_usage.length}`)
})

/* ═══ 2. THE ERASURE ITSELF ══════════════════════════════════════════════════ */

test('*** a reader never observes an empty or partial store while a writer runs ***', async () => {
  const dir = tmpDir()
  // Seed a store with content worth losing.
  runChild(dir, APPEND_N(40))
  const seeded = JSON.parse(fs.readFileSync(truthFile(dir), 'utf8')).llm_usage.length
  assert.equal(seeded, 40)

  // One process writes continuously; another reads continuously and reports the LOWEST
  // count it ever saw. Under the old code a torn read yields the empty default.
  const writer = startChild(dir, APPEND_N(60))
  const reader = startChild(dir, `
    const store = require('${STORE}')
    let min = Infinity
    const until = Date.now() + 2000
    while (Date.now() < until) {
      try { min = Math.min(min, store.usageSummary().request_count) }
      catch (_) { /* a THROW is acceptable - inventing an empty store is not */ }
    }
    process.stdout.write(String(min))
  `)

  await reader.done
  await writer.done

  const lowest = Number(reader.stdout())
  assert.ok(lowest >= seeded,
    `a reader saw only ${lowest} records where ${seeded} were already committed — the store was momentarily empty`)
})

test('*** load() on an unreadable file THROWS — it never reports "empty" ***', () => {
  const dir = tmpDir()
  fs.writeFileSync(truthFile(dir), '{ "llm_usage": [1,2,3')   // a torn write, frozen in place
  const r = runChild(dir, `
    const store = require('${STORE}')
    try { store.listDecisions(); process.stdout.write('RETURNED') }
    catch (e) { process.stdout.write('THREW') }
  `)
  assert.equal(r.stdout.trim(), 'THREW',
    'THE AMPLIFIER: returning an empty store here is what made a torn read permanent')
})

test('an ABSENT file is still legitimately empty — first run must work', () => {
  const dir = tmpDir()
  const r = runChild(dir, `
    const store = require('${STORE}')
    process.stdout.write(JSON.stringify(store.listDecisions()))
  `)
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), '[]', 'missing and unreadable are different answers')
})

/* ═══ 3. CRASH DURING WRITE ══════════════════════════════════════════════════ */

// NOT A RELIABLE RED, and said so rather than dressed up: whether SIGKILL lands INSIDE a
// write is timing-dependent, so the old code can pass this by luck. It is kept because it
// pins the invariant atomic rename guarantees unconditionally — the live file is never a
// partial document and no temp file is left masquerading as the store.
test('killing a writer mid-write leaves a complete, valid file', async () => {
  const dir = tmpDir()
  runChild(dir, APPEND_N(200))          // a file big enough that a write takes real time
  const before = fs.readFileSync(truthFile(dir), 'utf8')

  const kid = startChild(dir, APPEND_N(600))
  await new Promise((r) => setTimeout(r, 300))
  kid.child.kill('SIGKILL')
  await kid.done

  const after = fs.readFileSync(truthFile(dir), 'utf8')
  assert.doesNotThrow(() => JSON.parse(after), 'the live file must never be a partial document')
  const db = JSON.parse(after)
  assert.ok(db.llm_usage.length >= JSON.parse(before).llm_usage.length, 'a crash may not lose committed records')

  // A KILLED PROCESS CANNOT CLEAN UP AFTER ITSELF, and pretending otherwise was my error:
  // a temp file may well survive the kill. What matters is that it is not, and can never
  // become, the live store — it carries a pid and a random suffix and nothing reads it.
  // Debris is swept by the next successful write, which the next test pins.
  const live = fs.readdirSync(dir).filter((f) => f === 'aroma-truth.json')
  assert.deepEqual(live, ['aroma-truth.json'], 'the live file is present and is the only thing read')
})

test('*** crash debris is swept by the next successful write ***', () => {
  const dir = tmpDir()
  runChild(dir, APPEND_N(1))
  const stray = path.join(dir, 'aroma-truth.json.tmp-999999-deadbeef')
  fs.writeFileSync(stray, '{ partial')
  fs.utimesSync(stray, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3)) // an hour old
  runChild(dir, APPEND_N(1))
  assert.equal(fs.existsSync(stray), false, 'old temp files do not accumulate forever')
  assert.equal(JSON.parse(fs.readFileSync(truthFile(dir), 'utf8')).llm_usage.length, 2)
})

/* ═══ 4. THE LOCK, AND ITS DEATH ═════════════════════════════════════════════ */

test('*** a lock held by a DEAD process is broken, not waited on forever ***', () => {
  const dir = tmpDir()
  fs.mkdirSync(dir, { recursive: true })
  // PID 999999 is not running. A naive lock would wedge the store permanently.
  fs.writeFileSync(truthFile(dir) + '.lock', JSON.stringify({ pid: 999999, at: Date.now() }))
  const started = Date.now()
  const r = runChild(dir, APPEND_N(1))
  assert.equal(r.status, 0, 'a dead holder must not block a live writer: ' + (r.stderr || ''))
  assert.ok(Date.now() - started < 15000, 'and it must not take the full stale window to notice')
  assert.equal(JSON.parse(fs.readFileSync(truthFile(dir), 'utf8')).llm_usage.length, 1)
})

test('*** a write that cannot be serialised THROWS rather than clobbering ***', async () => {
  const dir = tmpDir()
  runChild(dir, APPEND_N(5))
  // A LIVE holder: this process. The lock names our own pid, so it is not stale.
  fs.writeFileSync(truthFile(dir) + '.lock', JSON.stringify({ pid: process.pid, at: Date.now() }))
  try {
    const r = runChild(dir, APPEND_N(1))
    assert.notEqual(r.status, 0, 'it must fail loudly, not write anyway')
    assert.equal(JSON.parse(fs.readFileSync(truthFile(dir), 'utf8')).llm_usage.length, 5,
      'and the existing records must be untouched')
  } finally {
    fs.unlinkSync(truthFile(dir) + '.lock')
  }
})

/* ═══ 5. THE ASYMMETRY — metering vs a Decision ══════════════════════════════ */

test('*** a metering failure is fail-open; a Decision failure is NOT ***', () => {
  const dir = tmpDir()
  fs.mkdirSync(dir, { recursive: true })
  const lock = truthFile(dir) + '.lock'
  // The lock must stay HELD for the whole child run, so the stale window has to exceed it.
  // My first version used the defaults, so two 5s timeouts pushed the lock past the 10s
  // stale window and the child correctly reclaimed it — the code was right and the test
  // was wrong. Short timeout, long stale window: fast AND deterministic.
  const env = { AROMA_STORE_LOCK_TIMEOUT_MS: '200', AROMA_STORE_LOCK_STALE_MS: '600000' }
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }))
  try {
    const hubPath = path.resolve(__dirname, '../utils/hubClient.js').replace(/\\/g, '/')
    const r = spawnSync(process.execPath, ['-e', `
      const hub = require('${hubPath}')
      ;(async () => {
        const usage = await hub.recordLLMUsage({ model: 'm' })
        const persist = await hub.persistIntake({ understanding: 'u', decision: { statement: 's' }, tasks: [] })
        process.stdout.write(JSON.stringify({
          usageOk: usage.ok,
          persistOk: persist.ok,
          persistDurable: persist.durable,
          durableOnPersist: 'durable' in persist,
          durableOnUsage: 'durable' in usage
        }))
      })()
    `], { env: Object.assign({}, process.env, env, { AROMA_DATA_DIR: dir }), encoding: 'utf8' })

    // stdout also carries the [AROMA-HUB] lines the failure paths emit, which is the point
    // of them — so take the payload line, not the whole stream.
    const payload = (r.stdout || '').split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop()
    const out = JSON.parse(payload || '{}')
    // A lost accounting row is a gap. A lost Decision is the thing this system exists for.
    assert.equal(out.usageOk, false, 'metering reports failure')
    assert.equal(out.persistOk, false, 'and so does the Decision path')
    assert.equal(out.persistDurable, false, 'but the Decision path must say DURABILITY failed, explicitly')
    assert.equal(out.durableOnPersist, true, '`durable` is present on the Decision path')
    assert.equal(out.durableOnUsage, false, 'and absent on the metering path — the asymmetry is explicit, not incidental')
  } finally {
    try { fs.unlinkSync(lock) } catch (_) {}
  }
})

test('*** a failed persist never lets the model\'s own decision text stand in for a stored one ***', () => {
  // The reply used to fall back to `distilled.decision` when `stored` was null, so a turn
  // whose Decision was never written looked, to the Owner, exactly like one that was.
  const src = fs.readFileSync(path.resolve(__dirname, '../intake/intakeService.js'), 'utf8')
  assert.equal(/decision:\s*stored\s*\?\s*stored\.decision\s*:\s*distilled\.decision/.test(src), false,
    'a Decision that was not persisted may not be reported as the Decision')
})
