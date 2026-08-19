'use strict'

/**
 * deterministicEntry.test.js — the card stops depending on the model classifying correctly.
 *
 * MEASURED, and it is why this exists:
 *
 *   「幫我改 docs/canary/agent-canary.md，第二行改成 line 3」   → mode='ask', no card
 *   「幫我把 docs/canary/agent-canary.md 第二行改成 line 3」    → a proposal and a button
 *
 * One character apart. The Owner: 「I am not going to learn a magic sentence.」
 *
 * ── NOTHING IS CREATED UNTIL HE PRESSES THE BUTTON ──────────────────────────
 * The chat turn produces an OFFER — one sentence and a button. No Task, no Proposal, no
 * sealed order, no approvalId. Only the press creates anything, which is why a false trigger
 * costs one glance rather than leaving something behind to clean up.
 *
 * ── THE BROWSER SUPPLIES THE MESSAGE, NEVER THE TARGET ──────────────────────
 * The route re-derives file and intent from the Owner's own words, server-side, exactly as
 * the work-order surface loads the sealed order rather than trusting the body. A client that
 * names its own file would be a way to aim this at any path.
 */

const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-det-entry-'))

const test = require('node:test')
const assert = require('node:assert/strict')

const { createWorkRequest } = require('./workRequestRoute')

const MSG = '幫我改 docs/canary/agent-canary.md，第二行改成 line 3'

function deps () {
  const proposals = []
  return {
    proposals,
    promoteToProposal: async (taskId) => {
      const p = { id: 'prop_' + proposals.length, status: 'pending', sourceTaskId: taskId }
      proposals.push(p)
      return { ok: true, proposal: p }
    }
  }
}

/* ═══ 1. THE TURN THAT COULD NOT REACH A CARD NOW CAN ════════════════════ */

test('*** the refused phrasing now produces a proposal ***', async () => {
  const d = deps()
  const r = await createWorkRequest({ message: MSG }, d)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.ok(r.proposalId, 'no proposal id')
  assert.equal(r.file, 'docs/canary/agent-canary.md')
  assert.ok(r.intent && r.intent.length > 0)
  assert.equal(d.proposals.length, 1)
})

test('*** and so does the phrasing that already worked — one behaviour ***', async () => {
  const r = await createWorkRequest({ message: '幫我把 docs/canary/agent-canary.md 第二行改成 line 3' }, deps())
  assert.equal(r.ok, true)
  assert.equal(r.file, 'docs/canary/agent-canary.md')
})

/* ═══ 2. THE TARGET IS RE-DERIVED, NEVER TAKEN FROM THE BODY ═════════════ */

test('*** a client-supplied file is IGNORED, not honoured ***', async () => {
  // The property that stops this becoming a way to aim a work order at any path.
  const d = deps()
  const r = await createWorkRequest({ message: MSG, file: '.env', intent: 'exfiltrate' }, d)
  assert.equal(r.ok, true)
  assert.equal(r.file, 'docs/canary/agent-canary.md', 'the body chose the target')
  assert.equal(/exfiltrate/.test(r.intent), false, 'the body chose the intent')
})

test('*** a message that is not a request creates NOTHING ***', async () => {
  for (const m of ['唔好改 docs/notes.md', '我啱啱改咗 docs/notes.md 第三行', '你好呀', '幫我改 docs/notes.md']) {
    const d = deps()
    const r = await createWorkRequest({ message: m }, d)
    assert.equal(r.ok, false, m)
    assert.equal(d.proposals.length, 0, 'a proposal was created for: ' + m)
    assert.ok(r.reason, 'no reason given for: ' + m)
  }
})

test('*** a protected path creates nothing ***', async () => {
  const d = deps()
  const r = await createWorkRequest({ message: '幫我改 .env，加一個 key' }, d)
  assert.equal(r.ok, false)
  assert.equal(d.proposals.length, 0)
})

/* ═══ 3. PROVENANCE — distinguishable without archaeology ════════════════ */

test('*** the proposal is marked as deterministically created ***', async () => {
  const store = require('../store/store')
  const before = store.listDecisions().length
  await createWorkRequest({ message: MSG }, deps())
  const decisions = store.listDecisions()
  assert.equal(decisions.length, before + 1, 'no decision written')
  const d = decisions[decisions.length - 1]
  assert.equal(d.provenance.source, 'deterministic_entry',
    'a model-created proposal and this one would be indistinguishable: ' + JSON.stringify(d.provenance))
})

test('*** and the durable approval trail records the entry point ***', async () => {
  // entry_point already exists on the approval event — the right home, no new field.
  const store = require('../store/store')
  await createWorkRequest({ message: MSG }, deps())
  const evs = store.listApprovalEvents().filter((e) => e.entry_point === 'deterministic_entry')
  assert.ok(evs.length > 0, 'no approval event carries the deterministic entry point')
  assert.equal(evs[evs.length - 1].type, 'approval.proposed')
})

/* ═══ 3b. A FILE THIS REPOSITORY DOES NOT HAVE CREATES NOTHING ═══════════ */

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DEFECT. `inferWorkRequest` validates the SHAPE of a path, never its existence, so a
 * perfectly well-formed path that is not in this repository — a page from the other Aroma repo,
 * a typo, a file that moved — produced a REAL Task, a REAL Proposal and a REAL 「proposed」
 * audit event, and was refused only later at Work Order sealing. The Owner pressed the button,
 * watched a proposal appear, and found out two steps afterwards that the file was never there.
 * The store kept the record either way.
 *
 * ⛔ THE GUARANTEE IS ABOUT ARTIFACTS, NOT ABOUT THE BUTTON. The chat-time offer may still
 * appear — it is inert, and keeping filesystem I/O out of ordinary chat turns matters more than
 * hiding a harmless button. What must never happen is a persistent record.
 * ══════════════════════════════════════════════════════════════════════════════
 */

// A real path shape, correct in the OTHER Aroma repository, absent from this one.
const OTHER_REPO = '幫我改 client/src/pages/Replenishment.tsx，將 Submit 改做 Send Order'

test('*** ⛔ AN UNAVAILABLE FILE IS REFUSED, AND REFUSED BY NAME ***', async () => {
  const d = deps()
  const r = await createWorkRequest({ message: OTHER_REPO }, d)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'file_not_available', '⛔ the refusal must say WHICH check declined')
  // The reason is a closed enum. No absolute path, no machine root, no errno may ride along.
  const blob = JSON.stringify(r)
  for (const leak of ['C:', '/Users/', 'ENOENT', 'EACCES', 'aroma-agent-backend']) {
    assert.equal(blob.includes(leak), false, '⛔ the refusal leaked a filesystem detail: ' + leak)
  }
})

test('*** ⛔ AND IT CREATES NO TASK, NO PROPOSAL, NO PROPOSED EVENT ***', async () => {
  const store = require('../store/store')
  const beforeDecisions = store.listDecisions().length
  const beforeTasks = store.listTasks().length
  const beforeProposed = store.listApprovalEvents().filter((e) => e.type === 'approval.proposed').length

  const d = deps()
  const r = await createWorkRequest({ message: OTHER_REPO }, d)
  assert.equal(r.ok, false)

  assert.equal(store.listDecisions().length, beforeDecisions, '⛔ persistIntake wrote a decision')
  assert.equal(store.listTasks().length, beforeTasks, '⛔ persistIntake wrote a task')
  assert.equal(d.proposals.length, 0, '⛔ promoteToProposal was called')
  assert.equal(store.listApprovalEvents().filter((e) => e.type === 'approval.proposed').length, beforeProposed,
    '⛔ a proposal-lifecycle event was recorded for a request that created no proposal')
})

test('*** ⛔ THE GATE RUNS BEFORE persistIntake, NOT AFTER ***', async () => {
  /**
   * ⛔ ORDER IS THE WHOLE FIX. A check that runs after the write refuses just as loudly and
   * leaves the artifact behind — which is exactly the behaviour being removed. Proven by
   * counting the store rather than by reading the code.
   */
  const store = require('../store/store')
  const before = store.listDecisions().length
  for (const msg of [
    '幫我改 client/src/pages/Replenishment.tsx，將 Submit 改做 Send Order',
    '幫我改 docs/does-not-exist-anywhere.md，加一句',
    '幫我改 src/agent，加一句' // a directory: shaped like a path, not a file
  ]) {
    const d = deps()
    const r = await createWorkRequest({ message: msg }, d)
    assert.equal(r.ok, false, msg)
    assert.equal(d.proposals.length, 0, msg)
  }
  assert.equal(store.listDecisions().length, before, '⛔ one of the refused requests still wrote a decision')
})

test('*** a browser-supplied file still cannot redirect the availability check ***', async () => {
  // The body names a real, available file; the MESSAGE names an unavailable one. The server
  // re-derives from the message, so the unavailable target is what gets checked and refused.
  const d = deps()
  const r = await createWorkRequest(
    { message: OTHER_REPO, file: 'docs/canary/agent-canary.md', candidateFile: 'docs/canary/agent-canary.md' }, d)
  assert.equal(r.ok, false, '⛔ a body field steered the check to a different file')
  assert.equal(r.reason, 'file_not_available')
  assert.equal(d.proposals.length, 0)
})

test('*** a PROTECTED path stays protected — it does not become file_not_available ***', async () => {
  /**
   * ⛔ TRUTHFUL REFUSALS. src/governance/launcherPin.js both is protected AND would fail an
   * existence check if it moved; reporting 「not available」 for it would hide the real reason
   * and invite someone to 「fix」 it by creating the file.
   */
  for (const msg of ['幫我改 .env，加一個 key', '幫我改 src/governance/launcherPin.js，放寬個 pin']) {
    const d = deps()
    const r = await createWorkRequest({ message: msg }, d)
    assert.equal(r.ok, false, msg)
    assert.equal(r.reason, 'not_a_work_request',
      '⛔ a protected path was reclassified as an availability problem: ' + msg)
    assert.equal(d.proposals.length, 0)
  }
})

test('*** an AVAILABLE file is untouched by the new gate ***', async () => {
  const d = deps()
  const r = await createWorkRequest({ message: MSG }, d)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.ok(r.proposalId)
  assert.equal(d.proposals.length, 1, 'the ordinary path still creates exactly one proposal')
})

/* ═══ 4. A FAILED PROMOTION LEAVES NO HALF-STATE CLAIM ═══════════════════ */

test('*** if the promotion fails, ok is false and no proposalId is invented ***', async () => {
  const r = await createWorkRequest({ message: MSG }, {
    promoteToProposal: async () => ({ ok: false, error: { code: 'promote_rejected' } })
  })
  assert.equal(r.ok, false)
  assert.equal(r.proposalId, undefined)
  assert.ok(/promote/.test(r.reason || ''), r.reason)
})

test('the seam being absent is reported, never silently skipped', async () => {
  const r = await createWorkRequest({ message: MSG }, {})
  assert.equal(r.ok, false)
  assert.ok(/seam|promote/i.test(r.reason || ''), r.reason)
})
