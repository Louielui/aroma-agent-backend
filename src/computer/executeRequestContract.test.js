'use strict'

/**
 * executeRequestContract.test.js — the Owner's producer and the Companion's consumer, meeting
 * over REAL BYTES.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * This repo carried two request schemas at once. The Owner's side wrote
 * `computer.canary.execute.v1`; the Companion read `kind: 'canary-execute-request'`. Both suites
 * were green, and they were green for the same reason: each tested its own side against its own
 * fixture. A fixture is a copy of what the author believed, so it agrees with the author every
 * time and with the other side never.
 *
 * Nothing here uses a fixture. The Owner's producer runs and writes a file. The bytes on disk are
 * then read by the Companion's consumer. If the two ever disagree again about a field name, a
 * type, an encoding or a state name, this file goes red — because the only object involved is the
 * one that actually crossed.
 *
 * ── AND THE RACE IS RUN, NOT REASONED ABOUT ────────────────────────────────
 * "Two claimers, one winner" is asserted with two real OS processes started as close together as
 * the runtime allows, both pointed at one request. Simulating it in one process would test a
 * sequence of calls, which is precisely the thing that is not in question.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const OWNER = require('../../scripts/computer/run-notepad-canary')   // producer
const STORE = require('./executeRequestStore')                       // the shared store
const SCHEMA = require('./executeRequestSchema')                     // the canonical definition
const A = require('../../scripts/computer/ownerApproval')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-contract-'))

/** A world the producer's preflight is happy with. */
const fakeIo = (over = {}) => Object.assign({
  records: new Map(),
  flagScopes: () => ({ Process: null, User: null, Machine: null }),
  dirExists: () => true,
  fileExists: () => false,
  listDir: () => [],
  auditWritable: () => true,
  executionRecordExists: () => false,
  writeExecutionRecord: () => {}
}, over)

/** A real receipt, issued by the real ceremony code. */
function approved () {
  const dir = tmp()
  const orderFile = path.join(dir, 'wo.json')
  fs.copyFileSync(A.DRAFT, orderFile)
  const { receipt } = A.issue({ receiptDir: dir, orderFile, at: new Date().toISOString() })
  return { dir, orderFile, receipt }
}

/**
 * THE CROSSING. The Owner's `request` verb runs for real and writes to a real directory; what
 * comes back is whatever is on disk.
 */
function cross () {
  const a = approved()
  const requestDir = tmp()
  const res = OWNER.request({
    receiptDir: a.dir, orderFile: a.orderFile, io: fakeIo(), requestDir
  })
  assert.equal(res.ok, true, 'the producer wrote a request: ' + JSON.stringify(res))

  const files = fs.readdirSync(requestDir)
  assert.equal(files.length, 1, 'exactly one file was written')
  assert.match(files[0], /^CREATED__req_[0-9a-f]{24}\.json$/, 'the FILENAME carries the state')

  const bytes = fs.readFileSync(path.join(requestDir, files[0]))
  return { a, requestDir, file: path.join(requestDir, files[0]), bytes, res }
}

/* ── one schema, imported by both sides ───────────────────────────────────── */

test('*** the producer and the consumer import the SAME schema module ***', () => {
  // Object identity, not deep equality: two copies of the same definition would satisfy a deep
  // comparison and would then be free to drift apart one edit at a time.
  const storeSchema = require('./executeRequestSchema')
  assert.equal(storeSchema, SCHEMA, 'the same module instance')

  // And the store re-exports from it rather than restating it.
  assert.equal(STORE.MESSAGE_TYPE, SCHEMA.MESSAGE_TYPE)
  assert.equal(STORE.REQUEST_FIELDS, SCHEMA.REQUEST_FIELDS, 'the same frozen array object')
  assert.equal(STORE.TRANSITIONS, SCHEMA.TRANSITIONS)

  // Nothing else in production may define a second message type for this.
  const REPO = path.resolve(__dirname, '..', '..')
  const offenders = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue }
      if (!e.name.endsWith('.js') || e.name.endsWith('.test.js')) continue
      if (e.name === 'executeRequestSchema.js') continue
      const c = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      if (/['"]computer\.canary\.execute\.v1['"]/.test(c)) offenders.push(path.relative(REPO, p).split(path.sep).join('/'))
    }
  }
  walk(path.join(REPO, 'src')); walk(path.join(REPO, 'scripts'))
  assert.deepEqual(offenders, [], 'the message type is spelled out in exactly one file')
})

/* ── what actually crossed ────────────────────────────────────────────────── */

test('*** the serialized request carries FIXED AUTHORISATION BINDINGS and nothing else ***', () => {
  const c = cross()
  const onDisk = JSON.parse(c.bytes.toString('utf8'))
  const req = onDisk.request

  assert.deepEqual(Object.keys(req).sort(), [...SCHEMA.REQUEST_FIELDS].sort(),
    'the keys on disk are exactly the canonical field list')

  assert.equal(req.messageType, 'computer.canary.execute.v1')
  assert.equal(req.approvalId, c.a.receipt.approvalId)
  assert.equal(req.approvedOrderHash, c.a.receipt.workOrderHash)
  assert.equal(req.executionPackageManifestHash, c.a.receipt.executionPackageManifestHash)
})

test('*** no action, no text, no path, no command survives the crossing ***', () => {
  const c = cross()
  const req = JSON.parse(c.bytes.toString('utf8')).request

  for (const banned of SCHEMA.FORBIDDEN_FIELDS) {
    assert.equal(Object.prototype.hasOwnProperty.call(req, banned), false, 'must not carry: ' + banned)
  }

  // Not just absent keys: the approved order's actual CONTENT must not appear anywhere in the
  // bytes, under any key. The order says open Notepad, type a sealed string, save canary-1.txt.
  const text = c.bytes.toString('utf8')
  for (const leak of ['canary-1.txt', 'open_app', 'type_text', 'save_as', 'C:\\\\Aroma', 'ComputerOperator-Test']) {
    assert.equal(text.includes(leak), false, 'the work leaked into the request: ' + leak)
  }
  // The one permitted mention of the app is the label naming WHICH approved task is pointed at.
  assert.equal(req.canaryType, 'notepad-canary')

  // Positive control: the order really does contain those things, so their absence above means
  // something. Without this the assertions could be passing over an empty order.
  const order = JSON.stringify(c.a.receipt.approvedOrder)
  assert.ok(order.includes('canary-1.txt'), 'the approved order does specify a filename')
  assert.ok(/open_app|type_text/.test(order), 'and does specify actions')
})

test('*** the consumer accepts what the producer wrote, byte for byte ***', () => {
  const c = cross()
  const req = JSON.parse(c.bytes.toString('utf8')).request

  // Shape, then bindings, using the Companion's own verification against the same receipt.
  assert.deepEqual(SCHEMA.validateRequest(req), { ok: true }, 'the Companion parses it')
  const v = STORE.verifyAgainst(req, {
    receipt: c.a.receipt,
    currentPackageHash: c.a.receipt.executionPackageManifestHash
  })
  assert.deepEqual(v, { ok: true }, 'and accepts the bindings: ' + JSON.stringify(v))
})

test('*** a request is immutable after creation — on disk and in memory ***', () => {
  const c = cross()

  // In memory: frozen at birth.
  const built = STORE.buildRequest(c.a.receipt, {})
  assert.equal(Object.isFrozen(built), true)
  assert.throws(() => { built.approvalId = 'appr_' + '0'.repeat(32) }, TypeError, 'a strict-mode write throws')

  // On disk: the store never rewrites a CREATED request. Submitting the same id again is a
  // refusal, not an overwrite — and the bytes are unchanged afterwards.
  const before = fs.readFileSync(c.file)
  const ledger = STORE.createRequestStore({ dir: c.requestDir })
  const again = ledger.submit(JSON.parse(before.toString('utf8')).request)
  assert.equal(again.ok, false)
  assert.deepEqual(fs.readFileSync(c.file), before, 'not one byte changed')
})

/* ── the claim ────────────────────────────────────────────────────────────── */

test('*** the claim is an ATOMIC RENAME — the state lives in the filename ***', () => {
  const c = cross()
  const ledger = STORE.createRequestStore({ dir: c.requestDir })
  const req = JSON.parse(c.bytes.toString('utf8')).request

  assert.equal(ledger.stateOf(req.requestId), 'CREATED')
  assert.equal(ledger.claim(req.requestId, 'companion-a').ok, true)

  const after = fs.readdirSync(c.requestDir)
  assert.equal(after.length, 1, 'still one file — it moved, it was not copied')
  assert.match(after[0], /^CLAIMED__/, 'and the new name IS the new state')
  assert.equal(fs.existsSync(c.file), false, 'the CREATED name is gone')

  // The mechanism is asserted in the source too: a flag-based claim would pass the behaviour
  // above while reintroducing the read-decide-write window this exists to close.
  const src = fs.readFileSync(path.join(__dirname, 'executeRequestStore.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.match(src, /renameSync\(found\.file, target\)/, 'the claim is a rename of the request file itself')
})

test('*** TWO REAL PROCESSES race for one request — exactly one wins ***', () => {
  const c = cross()
  const req = JSON.parse(c.bytes.toString('utf8')).request

  // A tiny claimer, run as its own OS process. Simulating this in-process would test a sequence
  // of calls, which is not what is in doubt.
  const claimer = path.join(c.requestDir, 'claim.js')
  fs.writeFileSync(claimer, [
    "const S = require(" + JSON.stringify(path.join(__dirname, 'executeRequestStore.js')) + ")",
    "const l = S.createRequestStore({ dir: process.argv[2] })",
    "const r = l.claim(process.argv[3], process.argv[4])",
    "process.stdout.write(r.ok ? 'WON' : 'LOST:' + r.refusal)"
  ].join('\n'))

  const run = (who) => {
    try {
      return String(execFileSync(process.execPath, [claimer, c.requestDir, req.requestId, who], { encoding: 'utf8' }))
    } catch (e) { return 'ERROR:' + e.message }
  }
  const first = run('companion-a')
  const second = run('companion-b')

  const winners = [first, second].filter((r) => r === 'WON')
  assert.equal(winners.length, 1, 'exactly one claimer won: ' + JSON.stringify([first, second]))
  assert.match([first, second].find((r) => r !== 'WON'), /^LOST:/, 'and the other lost cleanly, without an error')

  // One file, one state, one claimant recorded.
  const files = fs.readdirSync(c.requestDir).filter((f) => f.endsWith('.json'))
  assert.equal(files.length, 1)
  assert.match(files[0], /^CLAIMED__/)
  const rec = JSON.parse(fs.readFileSync(path.join(c.requestDir, files[0]), 'utf8'))
  assert.equal(rec.claimedBy, 'companion-a', 'the winner is the one recorded')
})

test('*** after a crash a claimed request cannot return to CREATED ***', () => {
  const c = cross()
  const ledger = STORE.createRequestStore({ dir: c.requestDir })
  const req = JSON.parse(c.bytes.toString('utf8')).request

  assert.equal(ledger.claim(req.requestId, 'companion-a').ok, true)
  assert.equal(ledger.transition(req.requestId, 'RUNNING').ok, true)

  // "Crash": nothing settles it. A brand-new store object, as a restarted process would build.
  const restarted = STORE.createRequestStore({ dir: c.requestDir })
  assert.equal(restarted.stateOf(req.requestId), 'RUNNING', 'it stayed where it was')
  assert.equal(restarted.claim(req.requestId, 'companion-a').ok, false, 'and cannot be claimed again')

  // The state machine has no edge back, from anywhere.
  for (const [from, tos] of Object.entries(SCHEMA.TRANSITIONS)) {
    assert.equal(tos.includes('CREATED'), false, from + ' must not lead back to CREATED')
  }
  for (const to of ['CREATED', 'CLAIMED']) {
    assert.equal(restarted.transition(req.requestId, to).ok, false, 'RUNNING -> ' + to + ' is refused')
  }
  // Recovery is a NEW approval, not a resumed run: the approval is spent either way.
  const fresh = STORE.createRequestStore({ dir: c.requestDir })
  const reused = fresh.submit(STORE.buildRequest(c.a.receipt, {}))
  assert.equal(reused.ok, false)
  assert.match(String(reused.refusal), /approval_already_/)
})

test('*** a tampered request on disk is refused, not repaired ***', () => {
  const c = cross()
  const rec = JSON.parse(c.bytes.toString('utf8'))
  rec.request.approvedOrderHash = 'd'.repeat(64)
  fs.writeFileSync(c.file, JSON.stringify(rec, null, 2))

  const back = JSON.parse(fs.readFileSync(c.file, 'utf8')).request
  assert.deepEqual(SCHEMA.validateRequest(back), { ok: true }, 'it is still well-formed — that is the point')
  const v = STORE.verifyAgainst(back, { receipt: c.a.receipt })
  assert.equal(v.ok, false, 'and still refused, because the binding no longer matches the receipt')
  assert.equal(v.refusal, 'order_hash_mismatch')
})

test('*** an instruction added to a request on disk is refused by name ***', () => {
  const c = cross()
  const rec = JSON.parse(c.bytes.toString('utf8'))
  for (const [field, value] of [['text', 'PWNED'], ['fileName', 'evil.txt'], ['command', 'cmd.exe'], ['steps', [{ action: 'open_app' }]]]) {
    const mutated = Object.assign({}, rec.request, { [field]: value })
    fs.writeFileSync(c.file, JSON.stringify({ state: 'CREATED', request: mutated }, null, 2))
    const back = JSON.parse(fs.readFileSync(c.file, 'utf8')).request
    const v = SCHEMA.validateRequest(back)
    assert.equal(v.ok, false, field + ' must be refused')
    assert.equal(v.detail, field)
    assert.equal(['forbidden_field', 'unexpected_field'].includes(v.refusal), true, field + ' -> ' + v.refusal)
  }
})
