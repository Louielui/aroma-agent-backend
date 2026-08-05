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
