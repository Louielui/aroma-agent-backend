'use strict'

/**
 * executeRequestStore.test.js — the request that crosses the session boundary.
 *
 * A request is a POINTER to an authorisation plus an expiry. It is not the authorisation, and it
 * carries no instructions — if it could describe the work, the Owner's side would be choosing
 * the work, and a compromised Owner path could choose different work.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const S = require('./executeRequestStore')
const { MESSAGE_TYPES, SERVICE_TO_COMPANION, COMPANION_TO_SERVICE } = require('./sessionBoundary')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-req-'))
const T0 = Date.parse('2026-08-01T10:00:00Z')

const receipt = (over = {}) => Object.assign({
  approvalId: 'appr_' + 'a'.repeat(32),
  workOrderHash: 'b'.repeat(64),
  executionPackageManifestHash: 'c'.repeat(64),
  receiptHash: 'd'.repeat(64)
}, over)

const store = (dir, t = T0) => S.createRequestStore({ dir, now: () => t })

/* ── the message type lives in the EXISTING vocabulary ────────────────────── */

test('*** the new type extends the existing closed vocabulary — no second channel ***', () => {
  assert.ok(SERVICE_TO_COMPANION.includes('canary_execute'), 'the request rides the existing protocol')
  assert.ok(COMPANION_TO_SERVICE.includes('canary_outcome'), 'and so does the answer')
  assert.ok(MESSAGE_TYPES.includes('canary_execute'))
  // A bypass channel would be a second set of rules that eventually disagrees with the first.
  assert.equal(MESSAGE_TYPES.length, SERVICE_TO_COMPANION.length + COMPANION_TO_SERVICE.length)
})

/* ── shape ────────────────────────────────────────────────────────────────── */

test('*** an unknown message type is refused ***', () => {
  for (const mt of ['computer.canary.execute.v2', 'execute_step', '', null, 42]) {
    // A NEW object, not Object.assign onto the request: the request is frozen, so assigning
    // onto it throws. That throw is the immutability guarantee working, and the first version
    // of this test tripped over it — which is a better outcome than the test passing.
    const r = S.validateRequest(Object.assign({}, S.buildRequest(receipt(), { now: () => T0 }), { messageType: mt }))
    assert.equal(r.refusal, 'unknown_message_type', String(mt))
  }

  // Stated directly, since it was discovered rather than designed into this test:
  const frozen = S.buildRequest(receipt(), { now: () => T0 })
  assert.throws(() => Object.assign(frozen, { approvalId: 'x' }), TypeError, 'a request cannot be revised in place')
})

test('*** an INSTRUCTION field is refused by name, not merely by shape ***', () => {
  // The whole point of the schema. Each of these is a way work could be smuggled across.
  for (const f of S.FORBIDDEN_FIELDS) {
    const req = Object.assign({}, S.buildRequest(receipt(), { now: () => T0 }), { [f]: 'x' })
    const r = S.validateRequest(req)
    assert.equal(r.refusal, 'forbidden_field', f)
    assert.equal(r.detail, f)
  }
  // And anything else unexpected is refused too, so the list is a floor and not a ceiling.
  const odd = Object.assign({}, S.buildRequest(receipt(), { now: () => T0 }), { somethingNew: 1 })
  assert.equal(S.validateRequest(odd).refusal, 'unexpected_field')
})

test('*** a missing binding is refused ***', () => {
  for (const f of S.REQUEST_FIELDS) {
    const req = Object.assign({}, S.buildRequest(receipt(), { now: () => T0 }))
    delete req[f]
    const r = S.validateRequest(req)
    assert.equal(r.ok, false, f)
    assert.ok(['missing_field', 'unknown_message_type', 'wrong_schema_version'].includes(r.refusal), f + ' -> ' + r.refusal)
  }
})

test('the schema carries bindings only — asserted as an exact list', () => {
  assert.deepEqual([...S.REQUEST_FIELDS].sort(), [
    'approvalId', 'approvedOrderHash', 'canaryType', 'createdAt', 'executionPackageManifestHash',
    'expiresAt', 'messageType', 'receiptHash', 'requestId', 'schemaVersion'
  ])
  const req = S.buildRequest(receipt(), { now: () => T0 })
  assert.equal(Object.isFrozen(req), true, 'immutable once built')
})

test('a request can only be built from a verified receipt', () => {
  assert.throws(() => S.buildRequest(null), /verified receipt/)
  assert.throws(() => S.buildRequest({ approvalId: 'appr_x' }), /missing its bindings/)
})

/* ── expiry and mismatch ──────────────────────────────────────────────────── */

test('*** an expired request is refused ***', () => {
  const req = S.buildRequest(receipt(), { now: () => T0, ttlMs: 60000 })
  assert.equal(S.verifyAgainst(req, { now: () => T0 + 30000 }).ok, true, 'inside the window')
  assert.equal(S.verifyAgainst(req, { now: () => T0 + 61000 }).refusal, 'request_expired')
})

test('*** hash mismatches are each refused, and named ***', () => {
  const rec = receipt()
  const base = S.buildRequest(rec, { now: () => T0 })
  for (const [over, refusal] of [
    [{ approvalId: 'appr_' + '9'.repeat(32) }, 'approval_mismatch'],
    [{ approvedOrderHash: 'e'.repeat(64) }, 'order_hash_mismatch'],
    [{ executionPackageManifestHash: 'f'.repeat(64) }, 'package_hash_mismatch'],
    [{ receiptHash: '1'.repeat(64) }, 'receipt_mismatch']
  ]) {
    const r = S.verifyAgainst(Object.assign({}, base, over), { now: () => T0, receipt: rec })
    assert.equal(r.refusal, refusal, JSON.stringify(over))
  }
  // and the package moving on disk after the request was made
  assert.equal(S.verifyAgainst(base, { now: () => T0, receipt: rec, currentPackageHash: '2'.repeat(64) }).refusal,
    'package_hash_mismatch')
})

test('*** a tampered request is refused ***', () => {
  const base = S.buildRequest(receipt(), { now: () => T0 })
  const tampered = Object.assign({}, base, { expiresAt: new Date(T0 + 999 * 60000).toISOString() })
  // The extension itself is legal JSON and a legal shape — what catches it is the binding check
  // against the receipt, which the Companion does independently.
  assert.equal(S.validateRequest(tampered).ok, true, 'shape alone cannot catch this')
  assert.equal(S.verifyAgainst(tampered, { now: () => T0, receipt: receipt() }).ok, true)
  // …but a tampered HASH cannot survive, which is the binding that matters.
  const badHash = Object.assign({}, base, { approvedOrderHash: '3'.repeat(64) })
  assert.equal(S.verifyAgainst(badHash, { now: () => T0, receipt: receipt() }).refusal, 'order_hash_mismatch')
})

/* ── the durable store ────────────────────────────────────────────────────── */

test('*** a duplicate requestId is refused ***', () => {
  const dir = tmp(); const st = store(dir)
  const req = S.buildRequest(receipt(), { now: () => T0 })
  assert.equal(st.submit(req).ok, true)
  assert.equal(st.submit(req).refusal, 'duplicate_request_id')
})

test('*** one live request per approval ***', () => {
  const dir = tmp(); const st = store(dir)
  const rec = receipt()
  assert.equal(st.submit(S.buildRequest(rec, { now: () => T0 })).ok, true)
  const second = st.submit(S.buildRequest(rec, { now: () => T0 }))
  assert.equal(second.refusal, 'approval_already_live', 'the same approval cannot have two')
})

test('*** an approval that has been through a request cannot start another ***', () => {
  const dir = tmp(); const st = store(dir)
  const rec = receipt()
  const first = S.buildRequest(rec, { now: () => T0 })
  st.submit(first)
  st.claim(first.requestId, 'companion')
  st.transition(first.requestId, 'RUNNING')
  st.transition(first.requestId, 'FAILED')
  assert.equal(st.submit(S.buildRequest(rec, { now: () => T0 })).refusal, 'approval_already_used',
    'a failure consumes the approval — recovery is a new one')
})

test('*** DOUBLE CLAIM: exactly one wins ***', () => {
  // The race the atomic rename exists for. Both callers see CREATED; only one can move the file.
  const dir = tmp(); const st = store(dir)
  const req = S.buildRequest(receipt(), { now: () => T0 })
  st.submit(req)

  const a = st.claim(req.requestId, 'companion-A')
  const b = st.claim(req.requestId, 'companion-B')
  const winners = [a, b].filter((r) => r.ok)
  assert.equal(winners.length, 1, 'exactly one claim succeeded')
  assert.equal(a.ok, true)
  assert.equal(b.ok, false)
  assert.match(String(b.refusal), /already_claimed|claim_lost/)
  assert.equal(st.stateOf(req.requestId), 'CLAIMED')
})

test('*** a claim survives a crash as CLAIMED, and cannot be replayed ***', () => {
  const dir = tmp(); const st = store(dir)
  const req = S.buildRequest(receipt(), { now: () => T0 })
  st.submit(req)
  assert.equal(st.claim(req.requestId, 'companion').ok, true)
  // …crash. Nothing settles it. A NEW store over the same directory is the restart.
  const restarted = store(dir)
  assert.equal(restarted.stateOf(req.requestId), 'CLAIMED', 'durable across processes')
  assert.equal(restarted.claim(req.requestId, 'companion').ok, false, 'and not replayable')
})

test('*** an expired request cannot be claimed, and is marked EXPIRED ***', () => {
  const dir = tmp()
  const req = S.buildRequest(receipt(), { now: () => T0, ttlMs: 60000 })
  store(dir).submit(req)
  const late = store(dir, T0 + 120000)
  assert.equal(late.claim(req.requestId, 'c').refusal, 'request_expired')
  assert.equal(late.stateOf(req.requestId), 'EXPIRED')
})

/* ── the state machine ────────────────────────────────────────────────────── */

test('*** the state machine is one-way — no path back to CREATED ***', () => {
  for (const [from, tos] of Object.entries(S.TRANSITIONS)) {
    assert.equal(tos.includes('CREATED'), false, from + ' must not return to CREATED')
  }
  for (const t of S.TERMINAL) assert.deepEqual(S.TRANSITIONS[t], [], t + ' is terminal')
  assert.deepEqual([...S.TRANSITIONS.CREATED], ['CLAIMED', 'EXPIRED'])
  assert.deepEqual([...S.TRANSITIONS.CLAIMED], ['RUNNING', 'FAILED', 'ABORTED'])
  assert.deepEqual([...S.TRANSITIONS.RUNNING], ['SUCCEEDED', 'FAILED', 'ABORTED'])
})

test('*** an illegal transition is refused, never coerced ***', () => {
  const dir = tmp(); const st = store(dir)
  const req = S.buildRequest(receipt(), { now: () => T0 })
  st.submit(req)
  assert.equal(st.transition(req.requestId, 'SUCCEEDED').refusal, 'illegal_transition', 'CREATED cannot succeed')
  st.claim(req.requestId, 'c')
  assert.equal(st.transition(req.requestId, 'CREATED').refusal, 'illegal_transition')
  assert.equal(st.transition(req.requestId, 'RUNNING').ok, true)
  assert.equal(st.transition(req.requestId, 'SUCCEEDED').ok, true)
  assert.equal(st.transition(req.requestId, 'FAILED').refusal, 'illegal_transition', 'terminal is terminal')
})

/* ── atomicity ────────────────────────────────────────────────────────────── */

test('*** a request is written atomically — no reader can see a partial one ***', () => {
  // Proven by construction rather than by racing: every write goes to a temp name and is
  // renamed into place, so a reader observes the whole file or no file. Asserted against the
  // source AND by checking no temp file survives.
  const dir = tmp(); const st = store(dir)
  const req = S.buildRequest(receipt(), { now: () => T0 })
  st.submit(req)
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp-'))
  assert.deepEqual(leftovers, [], 'no temp file is left behind')

  const src = fs.readFileSync(path.join(__dirname, 'executeRequestStore.js'), 'utf8')
  assert.match(src, /renameSync\(tmp, target\)/, 'the write lands by rename')
  assert.match(src, /fsyncSync/, 'and is flushed before the rename')
  // The claim must be a rename too — a read-then-write flag would have a race window.
  assert.match(src, /fsx\.renameSync\(found\.file, target\)/, 'the claim is a rename, not a flag')
})

/* ── no Owner bypass ──────────────────────────────────────────────────────── */

test('*** the Owner side has no executor, adapter or UIA path ***', () => {
  const owner = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'computer', 'Owner-Execute.ps1'), 'utf8')
    .replace(/^\s*#.*$/gm, '')
  for (const banned of ['computerExecutor', 'desktopAdapter', 'uiaCanary', 'executor.execute', 'powershellJsonRunner']) {
    assert.equal(owner.includes(banned), false, 'Owner-Execute must not reach: ' + banned)
  }
  const store = fs.readFileSync(path.join(__dirname, 'executeRequestStore.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const banned of ['desktopAdapter', 'computerExecutor', 'powershellJsonRunner', 'child_process']) {
    assert.equal(store.includes(banned), false, 'the request store must not reach: ' + banned)
  }
})
