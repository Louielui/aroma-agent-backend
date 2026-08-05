'use strict'

/**
 * approvalEventsWired.test.js — the durable trail is only durable if something writes to it.
 *
 * store.recordApprovalEvent exists and is tested. This asserts the approval surface actually
 * CALLS it — a durable store nothing writes to is the same as no store, and it would look
 * healthy in every unit test of the store itself.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROUTER = fs.readFileSync(path.join(__dirname, 'ownerApprovalRouter.js'), 'utf8')
const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')

/* ═══ 1. EVERY OUTCOME REACHES THE DURABLE RECORD ════════════════════════ */

test('*** the audit sink is the durable store, not only the in-memory array ***', () => {
  assert.ok(/recordApprovalEvent/.test(APP), 'app.js never calls the durable writer')
  const at = APP.indexOf('const approvalAudit = (entry)')
  const body = APP.slice(at, at + 4000)
  assert.ok(/recordApprovalEvent/.test(body), 'approvalAudit still only pushes to memory: ' + body.slice(0, 300))
})

test('*** sealed, rejected, approved and refused are all emitted ***', () => {
  // The four the surface can actually reach today. `refused` is the one with no other record
  // anywhere in the system, so its absence would be invisible.
  for (const outcome of ["'sealed'", "'rejected'", "'refused'"]) {
    assert.ok(ROUTER.includes('outcome: ' + outcome), 'not emitted: ' + outcome)
  }
  assert.ok(/outcome: out\.agentHandedOff \? 'approved'/.test(ROUTER), 'the approve outcome is not emitted')
})

test('*** the work order hash travels with the decision ***', () => {
  // The Owner asked for who, when, and which work order. `who` and `when` the writer supplies;
  // the hash has to come from the route, and it was never in the old audit line at all.
  // Anchored on the audit call itself rather than on a slice window — my first version
  // guessed where the route ended and measured the wrong text.
  assert.ok(/outcome: out\.agentHandedOff[^\n]*workOrderHash: recomputed/.test(ROUTER),
    'the approve path does not pass the recomputed hash to the audit record')
  assert.ok(/outcome: 'rejected'[^\n]*workOrderHash:/.test(ROUTER),
    'the reject path does not pass a hash')
})

/* ═══ 2. IT CANNOT TAKE THE TURN DOWN ════════════════════════════════════ */

test('*** a failed audit write never breaks the approval itself ***', () => {
  // The trail must not become a new way for an approval to fail. The write is wrapped, and
  // a failure is reported to the console rather than thrown at the Owner mid-decision.
  const at = APP.indexOf('const approvalAudit = (entry)')
  const body = APP.slice(at, at + 4000)
  assert.ok(/try\s*\{/.test(body) && /catch/.test(body), 'the durable write is not wrapped')
})

test('the in-memory array is kept — it is what /approvalAuditLog serves', () => {
  // Not a replacement: the array answers "what happened just now" cheaply, the store answers
  // "what happened ever". Removing the array would break the existing read surface.
  assert.ok(/approvalAuditLog\.push/.test(APP), 'the in-memory log was removed')
  assert.ok(/app\.locals\.approvalAuditLog/.test(APP), 'the read surface lost its source')
})

/* ═══ 3. THE CAP IS GONE FROM THE DURABLE SIDE ═══════════════════════════ */

test('*** no 500-entry cap on the durable trail ***', () => {
  // The array may still cap — it is a convenience buffer. The STORE must not, and the store
  // is now where the record lives.
  const store = fs.readFileSync(path.join(__dirname, '..', 'store', 'store.js'), 'utf8')
  const at = store.indexOf('function recordApprovalEvent')
  const body = store.slice(at, store.indexOf('\nfunction ', at + 10))
  assert.equal(/shift\(\)|slice\(-|splice\(/.test(body), false, 'the durable writer discards: ' + body)
})
