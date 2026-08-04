'use strict'

/**
 * conversationStoreAtomic.test.js — the conversation store gets what the truth store got.
 *
 * ── WHY THIS FILE EXISTS AT ALL ──────────────────────────────────────────────
 * ac77ae1 fixed a class of bug in src/store/store.js: writeFileSync truncates then writes,
 * so a reader can see a partial document, and a read path that answers "empty"/"absent" to
 * an unreadable file turns a transient error into permanent, invisible loss.
 *
 * IT FIXED ONE FILE. src/store/conversationStore.js sat beside it with the SAME defect —
 * plain writeFileSync, and `get()` doing `catch (_) { return null }` so an unreadable file
 * is reported as "no such conversation". The route then answers 404, the sidebar shows a
 * blank pane, and nothing anywhere says a read failed.
 *
 * That is the lesson worth more than the fix: "fixed" without a stated scope is how a
 * defect survives next door to its own remedy.
 *
 * ── NO LOCK HERE, DELIBERATELY ───────────────────────────────────────────────
 * The truth store needed one because many processes write it. Conversations have exactly
 * one writer — the live server — appends are synchronous within that process, and tests
 * inject the inert store. Symmetry with the file next door is not a reason to add one.
 *
 * Real child processes, because that is where the last two lock defects were caught and a
 * simulated race would have found neither.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync, spawn } = require('node:child_process')

const MOD = path.resolve(__dirname, 'conversationStore.js').replace(/\\/g, '/')
const ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-conv-'))
const fileFor = (dir) => path.join(dir, 'conversations', ID + '.json')

function child (dir, code, { wait = true } = {}) {
  const args = ['-e', `const { createConversationStore } = require('${MOD}')
    const store = createConversationStore({ dataDir: ${JSON.stringify(dir)} })
    ${code}`]
  return wait ? spawnSync(process.execPath, args, { encoding: 'utf8' })
    : spawn(process.execPath, args)
}

/** Spawn and capture exit + stdout in the same tick — a late listener misses 'close'. */
function start (dir, code) {
  const c = child(dir, code, { wait: false })
  let out = ''
  c.stdout.on('data', (d) => { out += d })
  return { proc: c, done: new Promise((r) => c.on('close', r)), stdout: () => out }
}

const APPEND = (n) => `for (let i = 0; i < ${n}; i++) store.appendTurn({ id: '${ID}', userText: 'q' + i, replyText: 'a' + i })`

/* ═══ the torn read — the one that blanks the pane ═══════════════════════════ */

test('*** a reader never sees "no such conversation" while a writer is appending ***', async () => {
  const dir = tmpDir()
  child(dir, APPEND(20))
  assert.ok(fs.existsSync(fileFor(dir)), 'seeded')

  const writer = start(dir, APPEND(120))
  const reader = start(dir, `
    let nulls = 0, threw = 0, reads = 0
    const until = Date.now() + 2000
    while (Date.now() < until) {
      reads++
      try { if (store.get('${ID}') === null) nulls++ } catch (_) { threw++ }
    }
    process.stdout.write(JSON.stringify({ nulls, threw, reads }))
  `)

  await reader.done
  await writer.done

  const r = JSON.parse(reader.stdout() || '{}')
  assert.ok(r.reads > 0, 'the reader actually ran')
  // A THROW is an acceptable answer to a bad read. Reporting "it does not exist" is not:
  // that is what the route turns into a 404 and the sidebar into a permanently blank pane.
  assert.equal(r.nulls, 0,
    `a conversation that exists was reported absent ${r.nulls} time(s) out of ${r.reads} reads`)
})

test('*** an UNREADABLE conversation throws — it is not "not found" ***', () => {
  const dir = tmpDir()
  fs.mkdirSync(path.join(dir, 'conversations'), { recursive: true })
  fs.writeFileSync(fileFor(dir), '{ "messages": [1,2')   // a torn write, frozen
  const r = child(dir, `
    try { const c = store.get('${ID}'); process.stdout.write(c === null ? 'NULL' : 'RETURNED') }
    catch (_) { process.stdout.write('THREW') }
  `)
  assert.equal(r.stdout.trim(), 'THREW', 'unreadable and absent are different answers')
})

test('an ABSENT conversation is still null — genuinely not there', () => {
  const dir = tmpDir()
  const r = child(dir, `process.stdout.write(String(store.get('${ID}')))`)
  assert.equal(r.stdout.trim(), 'null')
})

test('list() still skips a corrupt file rather than hiding every other conversation', () => {
  const dir = tmpDir()
  child(dir, APPEND(1))
  fs.writeFileSync(path.join(dir, 'conversations', 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff.json'), '{ broken')
  const r = child(dir, `process.stdout.write(String(store.list().length))`)
  // A directory scan is not a specific request: one unreadable entry must not blank the
  // whole sidebar. get() is where "I cannot read it" must be loud.
  assert.equal(r.stdout.trim(), '1')
})

/* ═══ crash and debris ══════════════════════════════════════════════════════ */

test('killing a writer mid-append leaves a complete, valid conversation', async () => {
  const dir = tmpDir()
  child(dir, APPEND(150))
  const before = JSON.parse(fs.readFileSync(fileFor(dir), 'utf8')).messages.length

  const kid = start(dir, APPEND(600))
  await new Promise((r) => setTimeout(r, 300))
  kid.proc.kill('SIGKILL')
  await kid.done

  const raw = fs.readFileSync(fileFor(dir), 'utf8')
  assert.doesNotThrow(() => JSON.parse(raw), 'the live file is never a partial document')
  assert.ok(JSON.parse(raw).messages.length >= before, 'a crash may not lose committed turns')
})

test('*** a normal append leaves no temp debris ***', () => {
  const dir = tmpDir()
  child(dir, APPEND(3))
  const strays = fs.readdirSync(path.join(dir, 'conversations')).filter((f) => f.includes('.tmp-'))
  assert.deepEqual(strays, [], 'the writer cleans up after itself when it is not killed')
  assert.equal(JSON.parse(fs.readFileSync(fileFor(dir), 'utf8')).messages.length, 6)
})
