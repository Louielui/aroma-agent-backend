'use strict'

/**
 * agentClaimGate.test.js — P1-C1c. The Agent Bridge lane's durable claim, the one-lane
 * invariant, and the approvalId → Run link.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHAT WAS ACTUALLY BROKEN. Before this tranche the Agent lane had no claim at all.
 * An approved execution was handed to the runner with nothing on disk saying it had
 * been attempted — so a second attempt could not be refused, and after a restart a Run
 * that HAD executed was marked 「never started」. Develop and Worker each had a claim
 * for exactly these reasons; the Agent lane simply never got one.
 *
 * ⛔ AND THE CLAIM MUST BE DURABLE BEFORE ANYTHING RUNS. A claim written after the
 * spawn would answer the wrong question: the window this protects is precisely the one
 * where the process dies between deciding to run and knowing what happened.
 *
 * Deterministic: injected persistence + injected resultEvidence. ZERO real worker,
 * ZERO spawn, ZERO paid call.
 *
 *   Run: node --test src/run/agentClaimGate.test.js
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createRunStore, AGENT_EXECUTOR } = require('./store')

function tmpFile () { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-aclaim-')); return path.join(d, 'aroma-runs.json') }
const INPUT = (o = {}) => ({ task: 't', targetProject: 'backend', capabilityId: 'Develop', version: 1, ...o })
const FACTS = (o = {}) => ({ approvalId: 'appr_a1', workOrderHash: 'h1', ...o })
const stages = (store, id, stage) => store.getRun(id).timeline.filter(e => e.stage === stage).length

/**
 * A Run with no lane claim — the realistic Agent case (AGENT on, DEVELOP/WORKER off).
 *
 * ⛔ IT CARRIES ITS approvalId FROM CREATION, because that is what production does:
 * confirmService writes the approval identity onto the Run before anything claims it.
 * Under RULING 1 a claim may only open a lane on a Run that HAS an approval identity,
 * and must name that same one — so a helper that minted approval-less Runs was
 * modelling a shape the confirm seam never produces.
 */
function unclaimedRun (opts = {}) {
  const store = createRunStore({
    dispatcher: async () => {},
    authorizeDispatch: () => false,
    persistence: opts.persistence || tmpFile(),
    resultEvidence: opts.resultEvidence
  })
  const id = store.startRun(INPUT({ approvalId: 'appr_a1', ...(opts.input || {}) }))
  return { store, id }
}

/* ═══ the claim itself ═════════════════════════════════════════════════════ */

test('*** first agent claim → AGENT_CLAIMED written once, other lanes untouched ***', () => {
  const { store, id } = unclaimedRun()
  assert.equal(store.claimAgent(id, FACTS()).status, 'dispatched')
  assert.equal(stages(store, id, 'AGENT_CLAIMED'), 1)
  assert.equal(stages(store, id, 'DISPATCH_CLAIMED'), 0, 'the Agent track is distinct from Develop')
  assert.equal(stages(store, id, 'WORKER_CLAIMED'), 0, 'and distinct from the sandbox worker')
})

test('*** the claim carries the approval it belongs to — an unlinked claim is not evidence ***', () => {
  const { store, id } = unclaimedRun({ input: { approvalId: 'appr_zz' } })
  store.claimAgent(id, FACTS({ approvalId: 'appr_zz', workOrderHash: 'hash_zz' }))
  const claim = store.getRun(id).timeline.find(e => e.stage === 'AGENT_CLAIMED')
  assert.equal(claim.facts.approvalId, 'appr_zz')
  assert.equal(claim.facts.workOrderHash, 'hash_zz')
  assert.equal(claim.facts.executor, AGENT_EXECUTOR)
})

test('*** ⛔ RULING 1 AT THE GATE: A CLAIM NAMING A DIFFERENT APPROVAL IS NOT WRITTEN ***', () => {
  // The Run belongs to appr_a1. A claim quoting someone else's approval must not
  // open a lane on it — the Run model refuses the append and the gate fails closed,
  // so `dispatched` is never returned and the runner is never reached.
  const { store, id } = unclaimedRun()
  const out = store.claimAgent(id, FACTS({ approvalId: 'appr_someone_else' }))
  assert.notEqual(out.status, 'dispatched', '⛔ a foreign-approval claim obtained the execution right')
  assert.equal(stages(store, id, 'AGENT_CLAIMED'), 0, 'and nothing was written to the timeline')
})

test('*** ⛔ AND A RUN WITH NO APPROVAL IDENTITY CANNOT BE AGENT-CLAIMED AT ALL ***', () => {
  const store = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => false, persistence: tmpFile() })
  const id = store.startRun(INPUT()) // no approvalId — a Develop-shaped Run
  assert.equal(store.getRun(id).approvalId, null)
  const out = store.claimAgent(id, FACTS())
  assert.notEqual(out.status, 'dispatched')
  assert.equal(stages(store, id, 'AGENT_CLAIMED'), 0)
})

test('*** a claim that cannot name its approval or its order is REFUSED, not written ***', () => {
  for (const bad of [{}, { approvalId: 'appr_a1' }, { workOrderHash: 'h1' }, { approvalId: '', workOrderHash: 'h1' }]) {
    const { store, id } = unclaimedRun()
    assert.equal(store.claimAgent(id, bad).status, 'needs_review', JSON.stringify(bad))
    assert.equal(stages(store, id, 'AGENT_CLAIMED'), 0, 'nothing was written')
  }
})

test('*** double claim → one dispatched, one already_dispatched; the claim is IMMUTABLE ***', () => {
  const { store, id } = unclaimedRun()
  assert.equal(store.claimAgent(id, FACTS()).status, 'dispatched')
  assert.equal(store.claimAgent(id, FACTS()).status, 'already_dispatched')
  assert.equal(stages(store, id, 'AGENT_CLAIMED'), 1, 'never re-written, never duplicated')
})

test('*** the claim survives a RESTART and still refuses a second attempt ***', () => {
  const file = tmpFile()
  const { store: s1, id } = unclaimedRun({ persistence: file })
  assert.equal(s1.claimAgent(id, FACTS()).status, 'dispatched')
  const s2 = createRunStore({ dispatcher: async () => {}, persistence: file })
  assert.equal(s2.claimAgent(id, FACTS()).status, 'already_dispatched')
  assert.equal(stages(s2, id, 'AGENT_CLAIMED'), 1)
})

test('*** ⛔ FLUSH FAILURE IS FAIL-CLOSED — dispatch_claim_failed, and the caller must not run ***', () => {
  // The whole point of the claim is that it is on disk BEFORE anything executes. If it
  // could not be written, proceeding would be exactly the unrecorded attempt this
  // stage exists to abolish.
  //
  // ⛔ THE RUN'S IDENTITY IS DELIBERATELY VALID HERE. This test's whole value is that
  //    the ONLY thing wrong is the disk: if the approval identity were also wrong the
  //    claim would be refused earlier as needs_review, and this would silently stop
  //    testing persistence failure at all.
  const save = (data) => { if (JSON.stringify(data).includes('AGENT_CLAIMED')) throw new Error('disk full') }
  const load = () => ({ order: [], runs: {} })
  const store = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => false, persistence: { load, save } })
  const id = store.startRun(INPUT({ approvalId: 'appr_a1' }))
  assert.equal(store.getRun(id).approvalId, 'appr_a1', 'identity is sound — only the disk is broken')
  assert.equal(store.claimAgent(id, FACTS()).status, 'dispatch_claim_failed')
})

test('*** an unknown run is needs_review, never a fresh claim ***', () => {
  const { store } = unclaimedRun()
  assert.equal(store.claimAgent('run_nope', FACTS()).status, 'needs_review')
})

test('*** a durable terminal result → already_completed, and no claim is written ***', () => {
  const { store, id } = unclaimedRun({ resultEvidence: () => ({ kind: 'ok' }) })
  assert.equal(store.claimAgent(id, FACTS()).status, 'already_completed')
  assert.equal(stages(store, id, 'AGENT_CLAIMED'), 0)
})

test('*** corrupt evidence is needs_review — never guessed into a claim ***', () => {
  const { store, id } = unclaimedRun({ resultEvidence: () => { throw new Error('unreadable') } })
  assert.equal(store.claimAgent(id, FACTS()).status, 'needs_review')
  assert.equal(stages(store, id, 'AGENT_CLAIMED'), 0)
})

/* ═══ the one-lane invariant ═══════════════════════════════════════════════ */

test('*** ⛔ A RUN DEVELOP ALREADY CLAIMED IS NOT AVAILABLE TO THE AGENT LANE ***', () => {
  const store = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => true, persistence: tmpFile() })
  const id = store.startRun(INPUT())
  assert.equal(stages(store, id, 'DISPATCH_CLAIMED'), 1, 'Develop took it')
  assert.equal(store.claimAgent(id, FACTS()).status, 'needs_review')
  assert.equal(stages(store, id, 'AGENT_CLAIMED'), 0, 'no second lane claim was written')
})

test('*** ⛔ AND A RUN THE WORKER CLAIMED IS NOT AVAILABLE EITHER ***', () => {
  const { store, id } = unclaimedRun()
  assert.equal(store.claimWorker(id).status, 'dispatched')
  assert.equal(store.claimAgent(id, FACTS()).status, 'needs_review')
  assert.equal(stages(store, id, 'AGENT_CLAIMED'), 0)
})

test('*** the invariant is SYMMETRIC — an agent-claimed Run refuses Develop and Worker ***', () => {
  for (const other of ['claimDispatch', 'claimWorker']) {
    const { store, id } = unclaimedRun()
    assert.equal(store.claimAgent(id, FACTS()).status, 'dispatched')
    const g = other === 'claimDispatch' ? store.claimDispatch(id) : store.claimWorker(id)
    assert.equal(g.status, 'needs_review', other + ' must not talk over an agent claim')
    assert.equal(stages(store, id, other === 'claimDispatch' ? 'DISPATCH_CLAIMED' : 'WORKER_CLAIMED'), 0)
  }
})

test('*** no lane is ranked above another — drift is needs_review, not a winner ***', () => {
  // Both refusals are the SAME status. If either had been given priority, one of these
  // would have come back 'dispatched' and a second executor would have started work on
  // a Run another lane may already be running.
  const { store: a, id: ia } = unclaimedRun()
  a.claimAgent(ia, FACTS())
  const { store: b, id: ib } = unclaimedRun()
  b.claimWorker(ib)
  assert.equal(a.claimWorker(ia).status, 'needs_review')
  assert.equal(b.claimAgent(ib, FACTS()).status, 'needs_review')
})

/* ═══ the durable approvalId link ══════════════════════════════════════════ */

test('*** the Run carries approvalId FROM CREATION, before any claim exists ***', () => {
  const { store, id } = unclaimedRun({ input: { approvalId: 'appr_born' } })
  const r = store.getRun(id)
  assert.equal(r.approvalId, 'appr_born')
  assert.equal(stages(store, id, 'AGENT_CLAIMED'), 0,
    '⛔ the link must NOT depend on the claim — the crash window is between them')
})

test('*** approvalId survives a restart on the durable record ***', () => {
  const file = tmpFile()
  const { id } = unclaimedRun({ persistence: file, input: { approvalId: 'appr_dur' } })
  const s2 = createRunStore({ dispatcher: async () => {}, persistence: file })
  assert.equal(s2.getRun(id).approvalId, 'appr_dur')
})

test('*** a Run created without one has approvalId null — absent, never invented ***', () => {
  // Built directly, NOT via unclaimedRun(): that helper models the agent-lane shape
  // and always supplies an approval identity. This is the Develop/Worker shape.
  const store = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => false, persistence: tmpFile() })
  const id = store.startRun(INPUT())
  assert.equal(store.getRun(id).approvalId, null)
})

test('*** a LEGACY pre-C1c Run on disk rehydrates with approvalId null and is not rewritten ***', () => {
  const legacy = {
    id: 'run_legacy1',
    owner: 'louie',
    workspace: 'default',
    conversationId: null,
    goal: null,
    task: 't',
    intent: null,
    targetProject: 'backend',
    capabilityId: 'Develop',
    version: 1,
    timeline: [{ stage: 'TASK_CREATED', at: '2026-07-01T00:00:00.000Z', facts: {} }],
    createdAt: '2026-07-01T00:00:00.000Z'
    // note: no approvalId key at all — exactly what the four historical Runs look like
  }
  const load = () => ({ order: ['run_legacy1'], runs: { run_legacy1: legacy } })
  const store = createRunStore({ dispatcher: async () => {}, persistence: { load, save: () => {} } })
  assert.equal(store.getRun('run_legacy1').approvalId, null)
})

/* ═══ findByApprovalId ═════════════════════════════════════════════════════ */

test('*** findByApprovalId: exactly one match returns that Run ***', () => {
  const { store, id } = unclaimedRun({ input: { approvalId: 'appr_one' } })
  const got = store.findByApprovalId('appr_one')
  assert.equal(got.ok, true)
  assert.equal(got.run.id, id)
})

test('*** findByApprovalId: no match is not_found — never a nearby Run ***', () => {
  const { store } = unclaimedRun({ input: { approvalId: 'appr_one' } })
  assert.deepEqual(store.findByApprovalId('appr_other'), { ok: false, reason: 'not_found' })
})

test('*** findByApprovalId: a legacy Run with no link is never matched ***', () => {
  const { store } = unclaimedRun()
  assert.equal(store.findByApprovalId('appr_anything').ok, false)
  // and a blank lookup cannot match the null field
  assert.equal(store.findByApprovalId('').reason, 'invalid')
  assert.equal(store.findByApprovalId(null).reason, 'invalid')
})

test('*** ⛔ TWO RUNS FOR ONE APPROVAL IS INCONSISTENT — never resolved first-win ***', () => {
  const store = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => false, persistence: tmpFile() })
  store.startRun(INPUT({ approvalId: 'appr_dup' }))
  store.startRun(INPUT({ approvalId: 'appr_dup' }))
  const got = store.findByApprovalId('appr_dup')
  assert.equal(got.ok, false)
  assert.equal(got.reason, 'inconsistent')
  assert.equal(got.count, 2)
})

/* ═══ the narrow milestone seam ════════════════════════════════════════════ */

test('*** appendAgentStage writes only agent-lane stages — never COMPLETED or APPLYING ***', () => {
  const { store, id } = unclaimedRun()
  store.claimAgent(id, FACTS())
  assert.equal(store.appendAgentStage(id, 'AGENT_SELECTED', { agentId: AGENT_EXECUTOR, approvalId: 'appr_a1' }).ok, true)
  for (const forbidden of ['COMPLETED', 'APPLYING', 'DISPATCH_CLAIMED', 'WORKER_CLAIMED', 'AGENT_CLAIMED', 'PENDING_APPROVAL']) {
    const out = store.appendAgentStage(id, forbidden, { backupRef: 'b', approvedBy: 'louie' })
    assert.equal(out.ok, false, forbidden + ' must not be reachable through this seam')
    assert.equal(out.reason, 'stage_not_allowed')
  }
})

test('*** a milestone that cannot be recorded returns a reason instead of throwing ***', () => {
  const { store, id } = unclaimedRun()
  assert.equal(store.appendAgentStage('run_unknown', 'AGENT_RUNNING', {}).ok, false)
  // A terminal Run refuses further appends; the seam reports it rather than exploding
  // in the middle of the runner's promise chain.
  store.claimAgent(id, FACTS())
  store.appendAgentStage(id, 'AGENT_FINISHED', { ok: true, approvalId: 'appr_a1' })
  store.appendAgentStage(id, 'SUCCEEDED', { executor: AGENT_EXECUTOR, approvalId: 'appr_a1' })
  const after = store.appendAgentStage(id, 'AGENT_RUNNING', { approvalId: 'appr_a1' })
  assert.equal(after.ok, false)
  assert.equal(after.reason, 'append_failed')
})

/* ═══ P1-C1c CLAIM STATUS TRUTH — WHY A REFUSAL SAYS WHAT IT SAYS ══════════
 *
 * ⛔ THE DEFECT. RULING 1 made run.js refuse a claim whose approval identity is not
 * this Run's — by THROWING. The throw landed in claimAgent's persistence catch, so a
 * claim quoting someone else's approval was reported as `dispatch_claim_failed`:
 * literally "the durable write failed". Nothing had been written and nothing was
 * wrong with the disk. The Owner would have been sent to look at storage while the
 * real problem was corrupted execution evidence.
 *
 * ⛔ AND THE TWO MUST STAY APART. `needs_review` means the evidence is inconsistent —
 * a human decides. `dispatch_claim_failed` means a valid claim could not be made
 * durable — the machine is sick. Collapsing either into the other loses the only
 * information that tells the Owner which of those two days he is having, so the
 * persistence case is pinned just as hard as the identity case.
 *
 * run.js remains the enforcer throughout: the store classifies, it does not authorise.
 */

test('*** ⛔ A CLAIM NAMING ANOTHER APPROVAL IS needs_review, NOT dispatch_claim_failed ***', () => {
  const { store, id } = unclaimedRun() // run.approvalId = appr_a1
  const out = store.claimAgent(id, FACTS({ approvalId: 'appr_wrong' }))
  assert.equal(out.status, 'needs_review')
  assert.notEqual(out.status, 'dispatch_claim_failed', '⛔ inconsistent evidence reported as a disk failure')
  assert.equal(stages(store, id, 'AGENT_CLAIMED'), 0, 'nothing appended')
})

test('*** a Run with no approval identity cannot be claimed — needs_review ***', () => {
  const store = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => false, persistence: tmpFile() })
  const id = store.startRun(INPUT())
  const out = store.claimAgent(id, FACTS())
  assert.equal(out.status, 'needs_review')
  assert.equal(stages(store, id, 'AGENT_CLAIMED'), 0)
})

test('*** a claim missing approvalId or workOrderHash is needs_review ***', () => {
  for (const bad of [{ workOrderHash: 'h1' }, { approvalId: 'appr_a1' }, {}]) {
    const { store, id } = unclaimedRun()
    assert.equal(store.claimAgent(id, bad).status, 'needs_review', JSON.stringify(bad))
    assert.equal(stages(store, id, 'AGENT_CLAIMED'), 0)
  }
})

test('*** ⛔ THE STORE MUST NOT TRIM A NEAR-MISS INTO A MATCH ***', () => {
  // The gate normalises what it WRITES; using those normalised copies to decide
  // equality would smuggle back exactly the trim-into-equality RULING 1 forbids.
  for (const near of [' appr_a1', 'appr_a1 ', 'APPR_A1', 'Appr_A1', 'appr_a']) {
    const { store, id } = unclaimedRun()
    assert.equal(store.claimAgent(id, FACTS({ approvalId: near })).status, 'needs_review',
      '⛔ accepted a near-miss approvalId: ' + JSON.stringify(near))
    assert.equal(stages(store, id, 'AGENT_CLAIMED'), 0)
  }
})

test('*** ⛔ AND A GENUINE PERSISTENCE FAILURE IS STILL dispatch_claim_failed ***', () => {
  // The load-bearing counterpart: this proves the fix did not simply rename every
  // refusal to needs_review. Identity sound, shape sound, no prior claim — only the
  // durable write is broken.
  const save = (data) => { if (JSON.stringify(data).includes('AGENT_CLAIMED')) throw new Error('disk full') }
  const store = createRunStore({
    dispatcher: async () => {},
    authorizeDispatch: () => false,
    persistence: { load: () => ({ order: [], runs: {} }), save }
  })
  const id = store.startRun(INPUT({ approvalId: 'appr_a1' }))
  const out = store.claimAgent(id, FACTS())
  assert.equal(out.status, 'dispatch_claim_failed')
  assert.notEqual(out.status, 'needs_review', '⛔ a sick disk was reported as inconsistent evidence')
})

test('*** the two refusals remain distinguishable from one another ***', () => {
  const identity = (() => { const { store, id } = unclaimedRun(); return store.claimAgent(id, FACTS({ approvalId: 'appr_x' })).status })()
  const persistence = (() => {
    const save = (d) => { if (JSON.stringify(d).includes('AGENT_CLAIMED')) throw new Error('disk full') }
    const store = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => false, persistence: { load: () => ({ order: [], runs: {} }), save } })
    return store.claimAgent(store.startRun(INPUT({ approvalId: 'appr_a1' })), FACTS()).status
  })()
  assert.notEqual(identity, persistence, '⛔ the whole point of this fix is that these are different answers')
  assert.equal(identity, 'needs_review')
  assert.equal(persistence, 'dispatch_claim_failed')
})

test('*** run.js still refuses independently — the store check did not replace it ***', () => {
  // Defence in depth: bypassing the store and appending straight to the model must
  // still be refused, so the preflight is a classifier and not the only guard.
  const runModel = require('./run')
  const r = runModel.createRun({ owner: 'louie', approvalId: 'appr_a1' })
  assert.throws(() => runModel.appendStage(r.id, 'AGENT_CLAIMED', { approvalId: 'appr_other', workOrderHash: 'h' }),
    /not this run/, '⛔ run.js stopped enforcing because store.js checks first')
})
