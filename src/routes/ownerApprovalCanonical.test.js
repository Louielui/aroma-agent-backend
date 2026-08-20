'use strict'

/**
 * ownerApprovalCanonical.test.js — P1-C1c. What the Owner's result surface is allowed
 * to treat as the truth.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE FAULT. This route read ownerApprovalStore — two in-memory Maps — and nothing
 * else. Those Maps are emptied by a restart, so an execution that had genuinely
 * finished came back as 「no_result」: not "we lost the details", but a flat statement
 * that nothing had run. The durable proof was on disk the whole time and no read
 * surface looked at it.
 *
 * ⛔ AND THE CACHE MUST NEVER OUTVOTE THE LEDGER. A stale or partial memory record
 * cannot be allowed to contradict a terminal the Run already recorded — in either
 * direction. That is what "canonical" has to mean, or there are still two ledgers.
 *
 * Deterministic: the real router + the real result view, with injected stores. ZERO
 * execution, ZERO runner, ZERO paid call.
 *
 *   Run: node --test src/routes/ownerApprovalCanonical.test.js
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { createOwnerApprovalRouter } = require('./ownerApprovalRouter')
const { buildAgentResultView, phaseLabel } = require('../agent/agentResultView')

const APPROVAL = 'appr_canon1'
const FACTS = { allowedFiles: ['src/foo.js'], timeoutSec: 60, costCapUsd: 1, allowedTestCommand: null, branch: 'agent/x' }

/** A memory store that has been EMPTIED — exactly what a restart leaves behind. */
const emptyStore = () => ({
  getResult: () => ({ ok: false, reason: 'no_result' }),
  getPhases: () => [],
  getExecution: () => ({ ok: false }),
  validSession: () => false
})

/** A memory store still holding a live result. */
const storeWith = (result, over = {}) => Object.assign({
  getResult: () => ({ ok: true, record: { result, facts: FACTS, startedAt: 1000, finishedAt: 2000, durationMs: 1000 } }),
  getPhases: () => [{ phase: 'running', at: 1000 }],
  getExecution: () => ({ ok: true, record: { facts: FACTS, startedAt: 1000 } }),
  validSession: () => false
}, over)

async function withRouter ({ store, canonical }, fn) {
  const app = express()
  app.use(express.json())
  app.use(createOwnerApprovalRouter({
    store,
    buildAgentResultView,
    phaseLabel,
    confirmService: { confirmProposalAction: () => { throw new Error('not used') }, sealedHashOf: () => 'h' },
    proposeWorkOrder: () => { throw new Error('not used') },
    buildApprovalView: () => ({}),
    sealedHashOf: () => 'h',
    resolveCanonicalRun: canonical
  }))
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  try {
    const port = server.address().port
    const get = async (id) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/owner/results/${id}`)
      return { status: res.status, json: await res.json() }
    }
    await fn({ get })
  } finally { await new Promise((resolve) => server.close(resolve)) }
}

const CANON = (status, runId = 'run_c1') => () => ({ ok: true, runId, status })
const NO_CANON = () => ({ ok: false, reason: 'not_found' })

/* ═══ the restart case — the measured fault ════════════════════════════════ */

test('*** ⛔ AFTER A RESTART A FINISHED EXECUTION IS NOT REPORTED AS no_result ***', async () => {
  // Memory is gone. The durable Run says it succeeded. That is an answer.
  await withRouter({ store: emptyStore(), canonical: CANON('succeeded') }, async ({ get }) => {
    const r = await get(APPROVAL)
    assert.equal(r.status, 200, '⛔ 404 here is the exact bug: "nothing ran" about something that ran')
    assert.equal(r.json.status, 'done')
    assert.equal(r.json.canonicalStatus, 'succeeded')
    assert.equal(r.json.runId, 'run_c1')
    assert.equal(r.json.finished, true, 'a settled attempt must stop the poll loop')
  })
})

test('*** a restarted FAILED execution is reported as failed, not as absent ***', async () => {
  await withRouter({ store: emptyStore(), canonical: CANON('failed') }, async ({ get }) => {
    const r = await get(APPROVAL)
    assert.equal(r.status, 200)
    assert.equal(r.json.status, 'failed')
    assert.equal(r.json.finished, true)
  })
})

test('*** a restarted INTERRUPTED attempt is neither done, nor failed, nor pending ***', async () => {
  await withRouter({ store: emptyStore(), canonical: CANON('interrupted') }, async ({ get }) => {
    const r = await get(APPROVAL)
    assert.equal(r.status, 200)
    assert.equal(r.json.status, 'interrupted')
    for (const lie of ['done', 'failed', 'pending']) {
      assert.notEqual(r.json.status, lie, '⛔ ' + lie + ' would be a specific false claim about an unknown outcome')
    }
    assert.ok(typeof r.json.headline === 'string' && r.json.headline.length > 0, 'it still says something honest')
  })
})

test('*** an in-flight Run reports progress even with an empty cache ***', async () => {
  for (const s of ['agent_claimed', 'agent_selected', 'running', 'agent_finished']) {
    await withRouter({ store: emptyStore(), canonical: CANON(s) }, async ({ get }) => {
      const r = await get(APPROVAL)
      assert.equal(r.json.status, 'running', s + ' projects as in-progress')
      assert.equal(r.json.finished, false)
    })
  }
})

/* ═══ the cache may not outvote the ledger ═════════════════════════════════ */

test('*** ⛔ A CACHED SUCCESS CANNOT OVERRIDE A TERMINAL RUN FAILURE ***', async () => {
  await withRouter({ store: storeWith({ ok: true, output: { filesChanged: [] } }), canonical: CANON('failed') }, async ({ get }) => {
    const r = await get(APPROVAL)
    assert.equal(r.json.status, 'failed', '⛔ the memory cache decided the lifecycle')
    assert.equal(r.json.canonicalStatus, 'failed')
  })
})

test('*** ⛔ A CACHED FAILURE CANNOT OVERRIDE A TERMINAL RUN SUCCESS ***', async () => {
  await withRouter({ store: storeWith({ ok: false, error: 'boom', output: {} }), canonical: CANON('succeeded') }, async ({ get }) => {
    const r = await get(APPROVAL)
    assert.equal(r.json.status, 'done')
    assert.equal(r.json.canonicalStatus, 'succeeded')
  })
})

test('*** the canonical status does NOT flatten a failure the cache described precisely ***', async () => {
  // 'refused' and 'timeout' are KINDS of failure. Replacing them with the vaguer word
  // would lose detail the Owner needs while claiming no more truth.
  await withRouter({ store: storeWith({ ok: false, error: 'refuse: out of scope', output: { risks: [] } }), canonical: CANON('failed') }, async ({ get }) => {
    assert.equal((await get(APPROVAL)).json.status, 'refused')
  })
  await withRouter({ store: storeWith({ ok: false, error: 'x', output: { risks: ['timeout'] } }), canonical: CANON('failed') }, async ({ get }) => {
    assert.equal((await get(APPROVAL)).json.status, 'timeout')
  })
})

test('*** enrichment still comes from the cache when it agrees ***', async () => {
  await withRouter({ store: storeWith({ ok: true, output: { filesChanged: ['src/foo.js'], exit: 0 } }), canonical: CANON('succeeded') }, async ({ get }) => {
    const r = await get(APPROVAL)
    assert.equal(r.json.status, 'done')
    assert.equal(r.json.elapsedMs, 1000, 'the measured duration survives')
    assert.ok(r.json.lines.join('\n').includes('src/foo.js'), 'the rich detail is still shown')
  })
})

/* ═══ legacy and inert Runs ════════════════════════════════════════════════ */

test('*** a pre-C1c approval with no Run link keeps the existing no_result answer ***', async () => {
  await withRouter({ store: emptyStore(), canonical: NO_CANON }, async ({ get }) => {
    const r = await get('appr_c793ed1b') // the real historical, unlinked approval
    assert.equal(r.status, 404)
    assert.equal(r.json.error, 'no_result')
  })
})

test('*** a pre-C1c approval whose LIVE result still exists is unchanged ***', async () => {
  await withRouter({ store: storeWith({ ok: true, output: { filesChanged: [] } }), canonical: NO_CANON }, async ({ get }) => {
    const r = await get('appr_c793ed1b')
    assert.equal(r.status, 200)
    assert.equal(r.json.status, 'done', 'backward compatible while the process lives')
    assert.equal(r.json.canonicalStatus, null, 'and it does not pretend a Run link exists')
    assert.equal(r.json.runId, null)
  })
})

test('*** ⛔ A RUN NOTHING EVER CLAIMED IS NOT AN ANSWER ***', async () => {
  // Every confirm creates a Run, including confirms that can never execute (bridge off).
  // Reporting those as 「pending」 would promise an execution that is not coming.
  for (const inert of ['created', 'pending', 'retry_pending']) {
    await withRouter({ store: emptyStore(), canonical: CANON(inert) }, async ({ get }) => {
      const r = await get(APPROVAL)
      assert.equal(r.status, 404, inert + ' must not masquerade as an in-flight execution')
      assert.equal(r.json.canonicalStatus, undefined)
    })
  }
})

test('*** an inconsistent link (two Runs for one approval) fails closed ***', async () => {
  await withRouter({ store: emptyStore(), canonical: () => ({ ok: false, reason: 'inconsistent', count: 2 }) }, async ({ get }) => {
    const r = await get(APPROVAL)
    assert.equal(r.status, 404, '⛔ one arbitrary half of a contradiction must not be served as the answer')
  })
})

test('*** a lookup that throws never takes the route down ***', async () => {
  await withRouter({ store: storeWith({ ok: true, output: {} }), canonical: () => { throw new Error('store exploded') } }, async ({ get }) => {
    const r = await get(APPROVAL)
    assert.equal(r.status, 200, 'the cached answer still renders')
    assert.equal(r.json.canonicalStatus, null)
  })
})

/* ═══ the route is still read-only and still bound ═════════════════════════ */

test('*** reading a result changes nothing and resolves the Run at most once per read ***', async () => {
  let lookups = 0
  const canonical = () => { lookups++; return { ok: true, runId: 'run_c1', status: 'succeeded' } }
  await withRouter({ store: emptyStore(), canonical }, async ({ get }) => {
    const a = await get(APPROVAL)
    const b = await get(APPROVAL)
    assert.deepEqual(a.json, b.json, 'reading twice gives the same answer')
    assert.equal(lookups, 2, 'one resolution per read, and no writes anywhere')
  })
})
