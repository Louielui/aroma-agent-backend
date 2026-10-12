'use strict'

/**
 * openClawLedgerCoordinator.test.js — EXCLUSION PROVEN ACROSS REAL PROCESSES.
 *
 * Two objects in one process cannot prove cross-process mutual exclusion: they share a heap and
 * could be excluding each other with a variable. So the contention, release-ordering, crash and
 * callback-throw proofs all spawn REAL child node processes against one disposable data
 * directory, and every child is started with an argv array — never a shell string.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-x4b4c1-'))
process.env.AROMA_DATA_DIR = DATA_DIR

const test = require('node:test')
const assert = require('node:assert')

const CO = require('../agent/openClawLedgerCoordinator')
const { createOpenClawLedgerCoordinator, LEDGER_SCOPE } = CO
const Q = require('../agent/openClawQuarantine')

/**
 * ⛔ THE COMPOSITION ROOT IS EXERCISED FROM CHILD PROCESSES, ON PURPOSE.
 *
 * openClawComposition.test.js asserts that NOTHING under src/ requires the composition root
 * except its own test — that is the property keeping the whole subsystem unreachable. Importing
 * it here would break that assertion, and widening it is not in this gate's scope. So the
 * integration proof runs the real composition, with the real coordinator injected, inside child
 * processes driven from a script generated in a disposable directory. The invariant stays
 * literally true, and the proof is if anything stronger: it is a separate process.
 */

const LOCK = path.join(DATA_DIR, 'openclaw-ledgers-v1.lock')
const OWNER = path.join(LOCK, 'owner.json')
const COORD_MODULE = path.join(__dirname, 'openClawLedgerCoordinator.js').replace(/\\/g, '/')

const exists = (p) => { try { fs.statSync(p); return true } catch (e) { return false } }
/** Remove ONLY the exact lock this test suite created, and only after verifying the path. */
function clearLock () {
  assert.strictEqual(path.dirname(LOCK), DATA_DIR, 'the lock must live in the disposable data dir')
  assert.ok(/[\\/]openclaw-ledgers-v1\.lock$/.test(LOCK))
  try { fs.unlinkSync(OWNER) } catch (e) {}
  try { fs.rmdirSync(LOCK) } catch (e) {}
}
test.beforeEach(() => clearLock())

/* ══════════════ child-process plumbing ══════════════ */

const CHILD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-x4b4c1-children-'))
/** Write a child script into the disposable directory. No repo fixture, no shell script. */
function childScript (name, body) {
  const p = path.join(CHILD_DIR, name)
  fs.writeFileSync(p, body, 'utf8')
  return p
}
/** Start a child with an argv ARRAY: no shell, no interpolation. */
function startChild (script, args) {
  return spawn(process.execPath, [script].concat(args || []), {
    env: Object.assign({}, process.env, { AROMA_DATA_DIR: DATA_DIR }),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  })
}
function runChildSync (script, args) {
  const r = spawnSync(process.execPath, [script].concat(args || []), {
    env: Object.assign({}, process.env, { AROMA_DATA_DIR: DATA_DIR }),
    encoding: 'utf8',
    shell: false
  })
  return { status: r.status, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() }
}
const waitExit = (child) => new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * A contender: waits for a barrier file, then makes ONE attempt and reports what happened.
 * argv: [outFile, barrierFile, holdMs]
 */
const CONTENDER = childScript('contender.js', `
'use strict'
const fs = require('fs')
const { createOpenClawLedgerCoordinator, LEDGER_SCOPE } = require(${JSON.stringify(COORD_MODULE)})
const [outFile, barrier, holdMs] = process.argv.slice(2)
const deadline = Date.now() + 20000
while (!fs.existsSync(barrier)) { if (Date.now() > deadline) break }
const c = createOpenClawLedgerCoordinator()
let entered = 0
let result
try {
  c.runExclusive(LEDGER_SCOPE, () => {
    entered += 1
    const end = Date.now() + Number(holdMs)
    while (Date.now() < end) {}
  })
  result = 'ENTERED'
} catch (e) {
  result = 'REFUSED'
}
fs.writeFileSync(outFile, JSON.stringify({ result, entered }), 'utf8')
`)

/** Acquires, reports, then blocks forever so the parent can kill it mid-section. */
const HOLDER = childScript('holder.js', `
'use strict'
const fs = require('fs')
const { createOpenClawLedgerCoordinator, LEDGER_SCOPE } = require(${JSON.stringify(COORD_MODULE)})
const [marker] = process.argv.slice(2)
const c = createOpenClawLedgerCoordinator()
c.runExclusive(LEDGER_SCOPE, () => {
  fs.writeFileSync(marker, 'entered', 'utf8')
  const end = Date.now() + 600000
  while (Date.now() < end) {}
})
`)

/**
 * Acquires, reports, waits for a RELEASE barrier, then returns from the section normally so the
 * coordinator releases the lock itself. argv: [marker, releaseBarrier]
 */
const HOLDER_BARRIER = childScript('holder-barrier.js', `
'use strict'
const fs = require('fs')
const { createOpenClawLedgerCoordinator, LEDGER_SCOPE } = require(${JSON.stringify(COORD_MODULE)})
const [marker, release] = process.argv.slice(2)
const c = createOpenClawLedgerCoordinator()
c.runExclusive(LEDGER_SCOPE, () => {
  fs.writeFileSync(marker, 'entered', 'utf8')
  const deadline = Date.now() + 60000
  while (!fs.existsSync(release)) { if (Date.now() > deadline) throw new Error('release barrier never arrived') }
})
`)

/** One attempt, no barrier: prints ENTERED or REFUSED. */
const ONESHOT = childScript('oneshot.js', `
'use strict'
const { createOpenClawLedgerCoordinator, LEDGER_SCOPE } = require(${JSON.stringify(COORD_MODULE)})
const c = createOpenClawLedgerCoordinator()
let entered = 0
try {
  c.runExclusive(LEDGER_SCOPE, () => { entered += 1 })
  console.log('ENTERED:' + entered)
} catch (e) {
  console.log('REFUSED:' + entered)
}
`)

/** Throws inside the section, then reports whether a later acquisition works. */
const THROWER = childScript('thrower.js', `
'use strict'
const { createOpenClawLedgerCoordinator, LEDGER_SCOPE } = require(${JSON.stringify(COORD_MODULE)})
const c = createOpenClawLedgerCoordinator()
let rethrown = 'NONE'
try {
  c.runExclusive(LEDGER_SCOPE, () => { throw null })
} catch (e) {
  rethrown = (e === null) ? 'null-verbatim' : 'other'
}
let second = 'REFUSED'
try { c.runExclusive(LEDGER_SCOPE, () => {}); second = 'ENTERED' } catch (e) {}
console.log(rethrown + ':' + second)
`)

/* ══════════════ C — construction and facade ══════════════ */

test('C1. ⛔ importing and constructing take no lock and touch nothing', () => {
  const before = exists(LOCK)
  delete require.cache[require.resolve('../agent/openClawLedgerCoordinator')]
  const fresh = require('../agent/openClawLedgerCoordinator')
  assert.strictEqual(typeof fresh.createOpenClawLedgerCoordinator, 'function')
  const c = fresh.createOpenClawLedgerCoordinator()
  assert.strictEqual(exists(LOCK), before, 'construction must not create the lock')
  assert.ok(c)
  const src = fs.readFileSync(path.join(__dirname, 'openClawLedgerCoordinator.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert.ok(!/^const \w+ = createOpenClawLedgerCoordinator/m.test(code), 'no module-level singleton')
})

test('C2. ⛔ the facade is frozen, exposes only runExclusive, and leaks no fs/path/token authority', () => {
  const c = createOpenClawLedgerCoordinator()
  assert.deepStrictEqual(Object.keys(c), ['runExclusive'])
  assert.ok(Object.isFrozen(c))
  for (const k of ['fs', 'path', 'token', 'lockPath', 'dir', 'releaseOwned', 'ownerPath']) {
    assert.strictEqual(c[k], undefined, k + ' must not be reachable')
  }
})

test('C3. ⛔ no store, filesystem root or lock path can be injected', () => {
  const c = createOpenClawLedgerCoordinator({ dir: 'C:/elsewhere', lockPath: 'C:/elsewhere/x', fsImpl: {} })
  c.runExclusive(LEDGER_SCOPE, () => {})
  const src = fs.readFileSync(path.join(__dirname, 'openClawLedgerCoordinator.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert.ok(!/deps\.|options\.|opts\./.test(code), 'the factory reads no caller options at all')
  assert.match(code, /resolveDataDir\(\)/, 'the directory comes from the one resolver')
})

/* ══════════════ S — scope and callback validation ══════════════ */

test('S1. ⛔ every scope but the one is refused BEFORE any lock or callback', () => {
  const c = createOpenClawLedgerCoordinator()
  const revocable = Proxy.revocable({}, {})
  revocable.revoke()
  const hostile = [
    ['null', null], ['undefined', undefined], ['empty', ''],
    ['wrong', 'openclaw-ledgers-v2'], ['traversal', '../../etc'],
    ['absolute', 'C:/Windows/Temp'], ['with a slash', 'openclaw-ledgers-v1/../x'],
    ['a number', 1], ['a symbol', Symbol('openclaw-ledgers-v1')],
    ['a throwing toString', { toString () { throw new Error('boom') } }],
    ['a String object', new String(LEDGER_SCOPE)], // eslint-disable-line no-new-wrappers
    ['a get-trap Proxy', new Proxy({}, { get () { throw new Error('trap') } })],
    ['a revoked Proxy', revocable.proxy]
  ]
  for (const [label, scope] of hostile) {
    let ran = 0
    assert.throws(() => c.runExclusive(scope, () => { ran += 1 }), /unknown ledger coordination scope/, label)
    assert.strictEqual(ran, 0, label + ': the callback must not run')
    assert.strictEqual(exists(LOCK), false, label + ': no lock was created')
  }
})

test('S2. ⛔ a non-function callback is refused before any lock', () => {
  const c = createOpenClawLedgerCoordinator()
  for (const bad of [null, undefined, 'fn', 42, {}, [], Symbol('f')]) {
    assert.throws(() => c.runExclusive(LEDGER_SCOPE, bad), /the critical section must be a function/)
    assert.strictEqual(exists(LOCK), false)
  }
})

/* ══════════════ L — acquisition, release, busy ══════════════ */

test('L1. the happy path: exactly one call, value returned verbatim, lock released', () => {
  const c = createOpenClawLedgerCoordinator()
  let calls = 0
  const sentinel = { a: 1 }
  const out = c.runExclusive(LEDGER_SCOPE, () => { calls += 1; assert.ok(exists(OWNER), 'the owner record exists inside the section'); return sentinel })
  assert.strictEqual(calls, 1)
  assert.strictEqual(out, sentinel, 'the value is returned by identity')
  assert.strictEqual(exists(LOCK), false, 'the lock is gone afterwards')
  // and the next acquisition works
  assert.strictEqual(c.runExclusive(LEDGER_SCOPE, () => 'again'), 'again')
})

test('L2. ⛔ BUSY: the callback never runs, and the existing lock is neither touched nor removed', () => {
  const c = createOpenClawLedgerCoordinator()
  fs.mkdirSync(LOCK)
  fs.writeFileSync(OWNER, JSON.stringify({ format: 'openclaw-ledger-lock/1', scope: LEDGER_SCOPE, token: 'x'.repeat(64), pid: 999999, createdAt: 'then' }), 'utf8')
  const beforeOwner = fs.readFileSync(OWNER, 'utf8')
  let calls = 0
  assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => { calls += 1 }), /locked by another holder/)
  assert.strictEqual(calls, 0)
  assert.strictEqual(exists(LOCK), true, 'the other holder keeps its lock')
  assert.strictEqual(fs.readFileSync(OWNER, 'utf8'), beforeOwner, 'and its record is untouched')
})

test('L3. ⛔ NO automatic stale reclaim: an ancient lock with a dead pid is still refused', () => {
  const c = createOpenClawLedgerCoordinator()
  fs.mkdirSync(LOCK)
  fs.writeFileSync(OWNER, JSON.stringify({
    format: 'openclaw-ledger-lock/1', scope: LEDGER_SCOPE, token: 'y'.repeat(64),
    pid: 999999, createdAt: '1999-01-01T00:00:00.000Z'
  }), 'utf8')
  let calls = 0
  assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => { calls += 1 }), /locked by another holder/)
  assert.strictEqual(calls, 0)
  assert.strictEqual(exists(LOCK), true, 'age and a dead pid never authorise reclaiming')
})

test('L4. ⛔ the callback throws: the value is rethrown VERBATIM and the lock is released', () => {
  const c = createOpenClawLedgerCoordinator()
  const revocable = Proxy.revocable({}, {})
  revocable.revoke()
  const values = [null, undefined, 'a string', 42, new Error('ordinary'), revocable.proxy]
  for (const v of values) {
    clearLock()
    let caught
    let threw = false
    try { c.runExclusive(LEDGER_SCOPE, () => { throw v }) } catch (e) { threw = true; caught = e }
    assert.ok(threw, 'it must throw')
    assert.strictEqual(caught, v, 'the thrown value is rethrown by identity, not wrapped')
    assert.strictEqual(exists(LOCK), false, 'the lock was still released')
    assert.strictEqual(c.runExclusive(LEDGER_SCOPE, () => 'next'), 'next', 'and the next acquisition works')
  }
})

test('L5. ⛔ a thenable answer fails closed AND RETAINS THE LOCK', () => {
  /**
   * ⛔ THE EARLIER VERSION OF THIS TEST ASSERTED THE OPPOSITE, AND IT WAS WRONG.
   * It required the lock to be released on a thenable answer. That is exactly the defect: the
   * async work is still running, so releasing hands the ledgers to another process mid-flight.
   * Exclusion, not the wording of the outcome, was what broke. A1 and A2 prove the corrected
   * behaviour in depth; this keeps the shape check next to the other L cases.
   */
  const c = createOpenClawLedgerCoordinator()
  for (const thenable of [Promise.resolve(1), { then () {} }, (function f () { f.then = () => {}; return f })()]) {
    clearLock()
    assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => thenable), /answered asynchronously/)
    assert.strictEqual(exists(LOCK), true, '⛔ the lock is deliberately retained while the work may still run')
    assert.strictEqual(exists(OWNER), true)
  }
  clearLock()
})

/* ══════════════ O — ownership ══════════════ */

test('O1. the owner record is created exclusively inside the new lock, with a real token and no secret', () => {
  const c = createOpenClawLedgerCoordinator()
  let seen
  c.runExclusive(LEDGER_SCOPE, () => { seen = JSON.parse(fs.readFileSync(OWNER, 'utf8')) })
  assert.strictEqual(seen.format, 'openclaw-ledger-lock/1')
  assert.strictEqual(seen.scope, LEDGER_SCOPE)
  assert.match(seen.token, /^[0-9a-f]{64}$/, 'an unpredictable 32-byte token')
  assert.strictEqual(seen.pid, process.pid)
  assert.match(seen.createdAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.deepStrictEqual(Object.keys(seen).sort(), ['createdAt', 'format', 'pid', 'scope', 'token'])
  // two acquisitions never share a token
  let a, b
  c.runExclusive(LEDGER_SCOPE, () => { a = JSON.parse(fs.readFileSync(OWNER, 'utf8')).token })
  c.runExclusive(LEDGER_SCOPE, () => { b = JSON.parse(fs.readFileSync(OWNER, 'utf8')).token })
  assert.notStrictEqual(a, b)
})

test('O2. ⛔ TAMPERED OWNERSHIP: release refuses, the lock STAYS, and the system stays fail closed', () => {
  const c = createOpenClawLedgerCoordinator()
  const cases = [
    ['a different token', () => fs.writeFileSync(OWNER, JSON.stringify({ format: 'openclaw-ledger-lock/1', scope: LEDGER_SCOPE, token: 'z'.repeat(64), pid: 1, createdAt: 'x' }), 'utf8')],
    ['a missing record', () => fs.unlinkSync(OWNER)],
    ['a malformed record', () => fs.writeFileSync(OWNER, '{ not json', 'utf8')],
    ['a short token', () => fs.writeFileSync(OWNER, JSON.stringify({ format: 'openclaw-ledger-lock/1', scope: LEDGER_SCOPE, token: 'ab', pid: 1, createdAt: 'x' }), 'utf8')],
    ['a wrong format', () => fs.writeFileSync(OWNER, JSON.stringify({ format: 'other/9', scope: LEDGER_SCOPE, token: 'z'.repeat(64), pid: 1, createdAt: 'x' }), 'utf8')],
    ['an array record', () => fs.writeFileSync(OWNER, '[]', 'utf8')]
  ]
  for (const [label, tamper] of cases) {
    clearLock()
    assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => { tamper() }),
      /(the lock was NOT removed)/, label)
    assert.strictEqual(exists(LOCK), true, label + ': ⛔ the lock must be left in place')
    // and the system is fail closed from here: the next attempt is refused
    let ran = 0
    assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => { ran += 1 }), /locked by another holder/, label)
    assert.strictEqual(ran, 0, label)
  }
  clearLock()
})

test('O3. ⛔ a failed owner-record write refuses BEFORE the callback and leaves no lock behind', () => {
  const c = createOpenClawLedgerCoordinator()
  // make owner.json impossible to create by pre-creating the lock dir with a DIRECTORY there
  fs.mkdirSync(LOCK)
  fs.mkdirSync(OWNER)
  let ran = 0
  // the lock already exists, so this is the busy path; prove the callback still never runs
  assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => { ran += 1 }), /locked by another holder/)
  assert.strictEqual(ran, 0)
  fs.rmdirSync(OWNER); fs.rmdirSync(LOCK)
})

/* ══════════════ X — real cross-process proof ══════════════ */

test('X1. ⛔ CROSS-PROCESS CONTENTION: over several rounds, exactly one child enters each time', async () => {
  const ROUNDS = 3
  const N = 4
  for (let round = 0; round < ROUNDS; round++) {
    clearLock()
    const barrier = path.join(CHILD_DIR, 'barrier-' + round)
    try { fs.unlinkSync(barrier) } catch (e) {}
    const outs = []
    const kids = []
    for (let i = 0; i < N; i++) {
      const out = path.join(CHILD_DIR, 'r' + round + '-c' + i + '.json')
      try { fs.unlinkSync(out) } catch (e) {}
      outs.push(out)
      kids.push(startChild(CONTENDER, [out, barrier, '250']))
    }
    await sleep(700)             // let every child reach the barrier
    fs.writeFileSync(barrier, 'go', 'utf8')
    await Promise.all(kids.map(waitExit))

    const results = outs.map((o) => JSON.parse(fs.readFileSync(o, 'utf8')))
    const entered = results.filter((r) => r.result === 'ENTERED')
    const refused = results.filter((r) => r.result === 'REFUSED')
    assert.strictEqual(entered.length, 1, 'round ' + round + ': exactly one child entered, got ' + JSON.stringify(results))
    assert.strictEqual(refused.length, N - 1, 'round ' + round)
    for (const r of refused) assert.strictEqual(r.entered, 0, 'round ' + round + ': a refused child never ran its callback')
    assert.strictEqual(entered[0].entered, 1, 'round ' + round + ': the winner ran exactly once')
    assert.strictEqual(exists(LOCK), false, 'round ' + round + ': the winner released')
  }
})

test('X2. ⛔ NATURAL RELEASE ORDERING: the holder itself releases, and only then can anyone else enter', async () => {
  /**
   * ⛔ NO SIGKILL AND NO clearLock() ANYWHERE IN THIS TEST.
   * An earlier version killed the holder and deleted the lock by hand, which proved only that a
   * process can enter after somebody removes the lock. That is the crash case (X3), not release
   * ordering. Here the holder returns from its section normally, exits 0, and the lock must
   * disappear because THE HOLDER released it.
   */
  clearLock()
  const marker = path.join(CHILD_DIR, 'x2.entered')
  const release = path.join(CHILD_DIR, 'x2.release')
  for (const f of [marker, release]) { try { fs.unlinkSync(f) } catch (e) {} }

  const holder = startChild(HOLDER_BARRIER, [marker, release])
  const deadline = Date.now() + 20000
  while (!exists(marker) && Date.now() < deadline) await sleep(25)
  assert.ok(exists(marker), 'the holder entered its section')
  assert.ok(exists(LOCK), 'the lock is held')
  assert.ok(exists(OWNER), 'and so is its ownership record')

  // ⛔ while the holder is still inside, nobody else gets in — twice, to be sure
  for (const attempt of ['first', 'second']) {
    const blocked = runChildSync(ONESHOT, [])
    assert.strictEqual(blocked.out, 'REFUSED:0', attempt + ': a second process is refused and never enters')
    assert.ok(exists(LOCK), attempt + ': and it did not remove the holder lock')
    assert.ok(exists(OWNER), attempt + ': nor the holder ownership record')
  }

  // now let the holder finish naturally
  fs.writeFileSync(release, 'go', 'utf8')
  const { code, signal } = await waitExit(holder)
  assert.strictEqual(signal, null, 'the holder was NOT killed')
  assert.strictEqual(code, 0, 'the holder returned from its section and exited cleanly')

  // ⛔ the lock is gone because the HOLDER released it — this test never touched it
  assert.strictEqual(exists(LOCK), false, 'the holder released its own lock')
  assert.strictEqual(exists(OWNER), false)

  const after = runChildSync(ONESHOT, [])
  assert.strictEqual(after.out, 'ENTERED:1', 'and only now can the next process enter')
})

test('X3. ⛔ CRASH ORPHAN: a killed holder leaves the lock, and nothing reclaims it automatically', async () => {
  clearLock()
  const marker = path.join(CHILD_DIR, 'crash.marker')
  try { fs.unlinkSync(marker) } catch (e) {}
  const holder = startChild(HOLDER, [marker])
  const deadline = Date.now() + 20000
  while (!exists(marker) && Date.now() < deadline) await sleep(25)
  assert.ok(exists(marker), 'the holder entered')

  holder.kill('SIGKILL')
  const { signal, code } = await waitExit(holder)
  assert.ok(signal === 'SIGKILL' || code !== 0, 'the holder really died mid-section')

  // ⛔ the lock survives the death of its owner
  assert.strictEqual(exists(LOCK), true, 'the orphaned lock is still there')
  assert.strictEqual(exists(OWNER), true, 'and so is its ownership record')

  // ⛔ and no replacement process reclaims it, now or after waiting
  for (const label of ['immediately', 'after a pause']) {
    const replacement = runChildSync(ONESHOT, [])
    assert.strictEqual(replacement.out, 'REFUSED:0', label + ': the replacement must fail closed')
    assert.strictEqual(exists(LOCK), true, label + ': the orphan is not removed')
    await sleep(300)
  }
  // in-process too
  const c = createOpenClawLedgerCoordinator()
  let ran = 0
  assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => { ran += 1 }), /locked by another holder/)
  assert.strictEqual(ran, 0)

  // this suite created this exact orphan, and only now removes it, by exact verified path
  clearLock()
  assert.strictEqual(exists(LOCK), false)
})

test('X4. ⛔ a child whose callback throws still releases, and the next process can enter', () => {
  clearLock()
  const r = runChildSync(THROWER, [])
  assert.strictEqual(r.out, 'null-verbatim:ENTERED',
    'the thrown null came back verbatim and the lock was released for the second acquisition')
  assert.strictEqual(exists(LOCK), false)
})

/* ══════════════ I — integration with the real composition root, via child processes ══════════════ */

const COMP_MODULE = path.join(__dirname, 'openClawComposition.js').replace(/\\/g, '/')
const Q_FILE = path.join(DATA_DIR, 'openclaw-quarantine.json')
const I_FILE = path.join(DATA_DIR, 'openclaw-instances.json')
const APPROVAL = 'appr_c1'
const cleanLedgers = () => { for (const f of [Q_FILE, I_FILE]) { try { fs.unlinkSync(f) } catch (e) {} } }
const seedQ = (fields) => fs.writeFileSync(Q_FILE, JSON.stringify({ [APPROVAL]: Object.assign({ approvalId: APPROVAL, updatedAt: 'then' }, fields) }, null, 2), 'utf8')

/**
 * Drives the REAL composition with the REAL coordinator. argv: [mode]
 *   status | abort | abort-release-fail
 * Prints one JSON line so the parent can assert on the outcome.
 */
const INTEGRATION = childScript('integration.js', `
'use strict'
const fs = require('fs')
const { createOpenClawComposition } = require(${JSON.stringify(COMP_MODULE)})
const { createOpenClawLedgerCoordinator } = require(${JSON.stringify(COORD_MODULE)})
const [mode] = process.argv.slice(2)
const APPROVAL = ${JSON.stringify(APPROVAL)}
const OWNER = ${JSON.stringify(path.join(DATA_DIR, 'openclaw-ledgers-v1.lock', 'owner.json').replace(/\\\\/g, '/'))}
const Q_FILE = ${JSON.stringify(path.join(DATA_DIR, 'openclaw-quarantine.json').replace(/\\\\/g, '/'))}
const c = createOpenClawComposition({
  run: () => ({ status: 1, stdout: '', stderr: '' }),
  ledgerCoordinator: createOpenClawLedgerCoordinator()
})
let out
if (mode === 'status') {
  out = { capabilities: { hasCoordinator: c.capabilities.hasCoordinator }, result: c.status(APPROVAL) }
} else if (mode === 'abort') {
  out = { result: c.abortPrepared(APPROVAL) }
} else if (mode === 'abort-release-fail') {
  // the abort succeeds; then the ownership record is replaced from inside the ledger write, so
  // release cannot prove ownership and must report rather than delete
  const realWrite = fs.writeFileSync
  let armed = true
  fs.writeFileSync = function (p, d, o) {
    const r = realWrite.call(fs, p, d, o)
    if (armed && typeof p === 'string' && p.endsWith('openclaw-quarantine.json')) {
      armed = false
      try { realWrite.call(fs, OWNER, JSON.stringify({ format: 'openclaw-ledger-lock/1', scope: 'openclaw-ledgers-v1', token: 'q'.repeat(64), pid: 1, createdAt: 'x' }), 'utf8') } catch (e) {}
    }
    return r
  }
  try { out = { result: c.abortPrepared(APPROVAL) } } finally { fs.writeFileSync = realWrite }
} else {
  out = { error: 'unknown mode' }
}
console.log(JSON.stringify(out))
`)

const integration = (mode) => {
  const r = runChildSync(INTEGRATION, [mode])
  assert.strictEqual(r.status, 0, mode + ': the child exited cleanly; stderr=' + r.err)
  return JSON.parse(r.out)
}

test('I1. the production coordinator drives the real composition: status() reads inside the section', () => {
  clearLock(); cleanLedgers()
  seedQ({ state: Q.STATES.PREPARED })
  const { capabilities, result } = integration('status')
  assert.strictEqual(capabilities.hasCoordinator, true)
  assert.strictEqual(result.ok, true, JSON.stringify(result))
  assert.strictEqual(result.quarantineState, Q.STATES.PREPARED)
  assert.strictEqual(result.crossLedgerConsistency, 'COORDINATED')
  assert.strictEqual(exists(LOCK), false, 'the lock was released afterwards')
})

test('I2. ⛔ with the lock BUSY, status() fails closed and the section never begins', () => {
  clearLock(); cleanLedgers()
  seedQ({ state: Q.STATES.PREPARED })
  fs.mkdirSync(LOCK)
  const { result } = integration('status')
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.outcome, 'refused-coordinator-failed', JSON.stringify(result))
  assert.strictEqual(result.effects, 'none', 'the section never began, so zero effect is the truth')
  assert.strictEqual(exists(LOCK), true, 'the other holder keeps its lock')
  clearLock()
})

test('I3. ⛔ with the lock BUSY, a mutation writes NOTHING to either ledger', () => {
  clearLock(); cleanLedgers()
  seedQ({ state: Q.STATES.PREPARED })
  const before = fs.readFileSync(Q_FILE, 'utf8')
  fs.mkdirSync(LOCK)
  const { result } = integration('abort')
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.outcome, 'refused-coordinator-failed')
  assert.strictEqual(result.effects, 'none')
  assert.strictEqual(fs.readFileSync(Q_FILE, 'utf8'), before, 'the quarantine ledger is untouched')
  assert.strictEqual(exists(I_FILE), false, 'and no instance ledger was created')
  clearLock()
})

test('I4. ⛔ a RELEASE failure after a completed section is after-operation, NOT a zero-effect refusal', () => {
  clearLock(); cleanLedgers()
  seedQ({ state: Q.STATES.PREPARED })
  const { result } = integration('abort-release-fail')
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.outcome, 'coordinator-failed-after-operation', JSON.stringify(result))
  assert.notStrictEqual(result.effects, 'none', '⛔ the abort really happened; this is not a refusal')
  assert.strictEqual(result.innerCompleted, true)
  assert.strictEqual(result.innerOutcome.outcome, 'pre-execution-aborted', 'the durable outcome is preserved')
  // the durable write stands, and was not rolled back
  assert.strictEqual(JSON.parse(fs.readFileSync(Q_FILE, 'utf8'))[APPROVAL].state, Q.STATES.PRE_EXECUTION_ABORTED)
  // ⛔ and the lock was deliberately NOT removed, so the system stays fail closed
  assert.strictEqual(exists(LOCK), true)
  clearLock()
})

test('I5. the composition production code needed no change to use this coordinator', () => {
  const src = fs.readFileSync(path.join(__dirname, 'openClawComposition.js'), 'utf8')
  assert.ok(!/openClawLedgerCoordinator/.test(src),
    'the composition must not import the coordinator: it is injected, and a later gate decides from where')
  assert.match(src, /runExclusive/, 'it consumes the same seam contract this module implements')
  // and this test file does not import the composition root either, so the B4b invariant holds
  const own = fs.readFileSync(path.join(__dirname, 'openClawLedgerCoordinator.test.js'), 'utf8')
  const code = own.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert.ok(!/require\([^)]*openClawComposition/.test(code),
    'the coordinator test must NOT require the composition root: the integration proof runs in child processes')
})

test('I6. ⛔ no result or error carries a secret, an environment dump or an ownership token', () => {
  clearLock()
  const c = createOpenClawLedgerCoordinator()
  let inner
  c.runExclusive(LEDGER_SCOPE, () => { inner = JSON.parse(fs.readFileSync(OWNER, 'utf8')).token })
  fs.mkdirSync(LOCK)
  let msg = ''
  try { c.runExclusive(LEDGER_SCOPE, () => {}) } catch (e) { msg = String(e.message) }
  assert.ok(!msg.includes(inner), 'no ownership token in the error')
  assert.ok(!msg.includes(DATA_DIR), 'no data directory path in the error')
  for (const k of ['AROMA_DATA_DIR', 'USERPROFILE', 'PATH=']) assert.ok(!msg.includes(k), 'no environment key in the error')
  clearLock()
})

test('S3. ⛔ DEFENCE IN DEPTH: even a traversal scope can never place a lock outside the data dir', () => {
  const c = createOpenClawLedgerCoordinator()
  const outside = path.join(os.tmpdir(), 'aroma-x4b4c1-outside-' + process.pid)
  try { fs.rmdirSync(outside) } catch (e) {}
  const traversals = [
    '../../aroma-x4b4c1-outside-' + process.pid,
    path.join(os.tmpdir(), 'aroma-x4b4c1-outside-' + process.pid),
    '..\\..\\aroma-x4b4c1-outside-' + process.pid,
    'openclaw-ledgers-v1/../../escape'
  ]
  for (const scope of traversals) {
    let ran = 0
    assert.throws(() => c.runExclusive(scope, () => { ran += 1 }), /unknown ledger coordination scope/, scope)
    assert.strictEqual(ran, 0, scope)
  }
  assert.strictEqual(exists(outside), false, '⛔ nothing was created outside the data directory')
  // and the only lock name the module can ever use is the fixed one
  const src = fs.readFileSync(path.join(__dirname, 'openClawLedgerCoordinator.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert.match(code, /path\.join\(dir, LOCK_DIRS\[scope\]\)/, 'the directory name comes from the frozen table')
  assert.ok(!/path\.join\([^)]*\+/.test(code), 'no path is built by concatenation')
  assert.ok(!/String\(scope\)/.test(code), 'the scope is never coerced into a path')
})

test('O4. ⛔ an owner-record write failure refuses BEFORE the callback and removes the lock we just made', () => {
  const c = createOpenClawLedgerCoordinator()
  const realOpen = fs.openSync
  let ran = 0
  let threw = false
  fs.openSync = function (p, flags, mode) {
    if (typeof p === 'string' && p.endsWith('owner.json')) {
      const err = new Error('injected owner-record failure')
      err.code = 'EACCES'
      throw err
    }
    return realOpen.apply(fs, arguments)
  }
  try {
    c.runExclusive(LEDGER_SCOPE, () => { ran += 1 })
  } catch (e) {
    threw = true
    assert.match(String(e.message), /ownership record could not be written/)
  } finally {
    fs.openSync = realOpen
  }
  assert.ok(threw, 'it must refuse')
  assert.strictEqual(ran, 0, '⛔ the callback must NOT run without a proven ownership record')
  assert.strictEqual(exists(LOCK), false, 'the lock we created but could not own was removed')
  // and the coordinator still works afterwards
  assert.strictEqual(c.runExclusive(LEDGER_SCOPE, () => 'ok'), 'ok')
})

test('O5. ⛔ an unexpected file inside the lock is never blown away: release refuses and the lock STAYS', () => {
  const c = createOpenClawLedgerCoordinator()
  const stray = path.join(LOCK, 'someone-elses-state.json')
  let threw = false
  try {
    c.runExclusive(LEDGER_SCOPE, () => {
      // something else put a file in our lock directory
      fs.writeFileSync(stray, 'not ours', 'utf8')
    })
  } catch (e) {
    threw = true
  }
  assert.ok(threw, 'release could not complete, and that is reported')
  // ⛔ removal is one exact file then one exact directory — never recursive
  assert.strictEqual(exists(LOCK), true, 'the lock directory survives')
  assert.strictEqual(exists(stray), true, '⛔ and the unexpected file was NOT deleted')
  // the system is fail closed from here
  let ran = 0
  assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => { ran += 1 }), /locked by another holder/)
  assert.strictEqual(ran, 0)
  // this suite created that stray file, and removes only it, by exact verified path
  assert.strictEqual(path.dirname(stray), LOCK)
  fs.unlinkSync(stray)
  clearLock()
})

/* ══════════════ A — an asynchronous answer must NEVER release the lock ══════════════ */

test('A1. ⛔ a callback that returns a PENDING promise keeps the lock: releasing it would end exclusion', async () => {
  clearLock()
  const c = createOpenClawLedgerCoordinator()
  let settle
  const pending = new Promise((resolve) => { settle = resolve })
  let stillRunning = true

  assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => {
    // work that is still in flight when the section "returns"
    pending.then(() => { stillRunning = false })
    return pending
  }), /answered asynchronously/)

  // ⛔ the work has not finished, so the lock MUST still be held
  assert.strictEqual(stillRunning, true, 'the async work is genuinely still pending')
  assert.strictEqual(exists(LOCK), true, '⛔ the lock was NOT released')
  assert.strictEqual(exists(OWNER), true, 'and neither was its ownership record')

  // ⛔ and no other acquisition can slip in while it is pending
  let ran = 0
  assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => { ran += 1 }), /locked by another holder/)
  assert.strictEqual(ran, 0)
  assert.strictEqual(runChildSync(ONESHOT, []).out, 'REFUSED:0', 'another PROCESS is refused too')

  // now let the async work finish
  settle()
  await pending
  assert.strictEqual(stillRunning, false)

  // ⛔ finishing does not reclaim anything: the orphan waits for a human recovery gate
  assert.strictEqual(exists(LOCK), true, 'the lock is still there after the promise settled')
  let ran2 = 0
  assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => { ran2 += 1 }), /locked by another holder/)
  assert.strictEqual(ran2, 0)
  assert.strictEqual(runChildSync(ONESHOT, []).out, 'REFUSED:0')

  clearLock() // this suite created this exact orphan and removes only it
})

test('A2. ⛔ every thenable shape keeps the lock, including a throwing .then getter', () => {
  const c = createOpenClawLedgerCoordinator()
  const shapes = [
    ['a resolved promise', () => Promise.resolve(1)],
    ['a bare thenable', () => ({ then () {} })],
    ['a thenable function', () => { const f = function () {}; f.then = () => {}; return f }],
    // an answer we cannot even inspect is treated as asynchronous, never as a synchronous value
    ['a throwing .then getter', () => ({ get then () { throw new Error('hostile then getter') } })],
    ['a get-trap Proxy', () => new Proxy({}, { get () { throw new Error('trap') } })]
  ]
  for (const [label, make] of shapes) {
    clearLock()
    let ran = 0
    assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => make()), /answered asynchronously/, label)
    assert.strictEqual(exists(LOCK), true, label + ': ⛔ the lock must be retained')
    assert.strictEqual(exists(OWNER), true, label + ': and the ownership record too')
    assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => { ran += 1 }), /locked by another holder/, label)
    assert.strictEqual(ran, 0, label)
  }
  clearLock()
})

/* ══════════════ R — a release failure outranks the callback's own failure ══════════════ */

test('R1. ⛔ callback TAMPERS then THROWS: the ownership failure is reported, not the thrown value', () => {
  clearLock()
  const c = createOpenClawLedgerCoordinator()
  let caught
  let threw = false
  try {
    c.runExclusive(LEDGER_SCOPE, () => {
      // steal our own lock's identity, then fail
      fs.writeFileSync(OWNER, JSON.stringify({
        format: 'openclaw-ledger-lock/1', scope: LEDGER_SCOPE, token: 'w'.repeat(64), pid: 1, createdAt: 'x'
      }), 'utf8')
      throw null
    })
  } catch (e) {
    threw = true
    caught = e
  }
  assert.ok(threw)
  // ⛔ NOT the thrown null: the more dangerous fact is that a lock is still held and unprovable
  assert.notStrictEqual(caught, null, 'the callback value must not mask the ownership failure')
  assert.match(String(caught && caught.message), /held by a different owner; the lock was NOT removed/)
  assert.strictEqual(exists(LOCK), true, 'the lock is retained')
  let ran = 0
  assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => { ran += 1 }), /locked by another holder/)
  assert.strictEqual(ran, 0)
  clearLock()
})

test('R2. a callback throw with a CLEAN release still rethrows the value verbatim', () => {
  const c = createOpenClawLedgerCoordinator()
  for (const v of [null, undefined, 'str', 7, new Error('x')]) {
    clearLock()
    let caught
    try { c.runExclusive(LEDGER_SCOPE, () => { throw v }) } catch (e) { caught = e }
    assert.strictEqual(caught, v, 'release succeeded, so the value is rethrown by identity')
    assert.strictEqual(exists(LOCK), false, 'and the lock really was released')
  }
})

test('R3. ⛔ a callback that only tampers (no throw) still reports the ownership failure', () => {
  clearLock()
  const c = createOpenClawLedgerCoordinator()
  assert.throws(() => c.runExclusive(LEDGER_SCOPE, () => {
    fs.unlinkSync(OWNER)
    return 'looks fine'
  }), /missing or unreadable; the lock was NOT removed/)
  assert.strictEqual(exists(LOCK), true)
  clearLock()
})
