'use strict'

/**
 * unavailableIsNotEvidence.test.js — a read that did not happen produces no evidence.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DEFECT.
 *
 * The assembly site read:
 *
 *     evidenceSets.push(got.evidence || describeRead(got.entry.source, null, [], …))
 *
 * An UNAVAILABLE read deliberately carries no `got.evidence`, so it fell through to the
 * synthesiser — and `describeRead`'s default shape declares `trust: 'live'`. One failed read
 * therefore became three contradictory things at once:
 *
 *     perSource      trust = unavailable
 *     observation    [readKey] UNAVAILABLE: …
 *     EvidenceSet    trust = live, shownCount = 0
 *
 * That is not a cosmetic inconsistency. `renderScopeLine` only renders LIVE evidence, so the
 * model could be handed a SCOPE line for data that was never retrieved; and evidenceIndex and
 * claimBinding both consume EvidenceSets, so a failed read could enter the truth layer as
 * something a claim may bind to.
 *
 * ── THE THREE STATES, KEPT APART ─────────────────────────────────────────────
 *   LIVE         evidence exists — INCLUDING a live read that matched zero rows
 *   UNAVAILABLE  attempted, and NO evidence exists
 *   ABSENT       never attempted (notAsked) — no perSource row either
 *
 * ⛔ THE FIX MUST NOT BE 「drop zero-row reads」. A live zero-row read is evidence OF AN EMPTY
 * RESULT and keeps its EvidenceSet, its readKey and its SCOPE identity. TEST B is that fence.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildReadContext } = require('./readContext')
const { processIntake } = require('../intake/intakeService')
const { verifyClaimBindings, BINDING } = require('../intake/claimBinding')

const NOW = '2026-08-08T21:41:45.000Z'
const REPL = 'aroma_system.replenishment'
const PURC = 'aroma_system.purchasing'

const PLAN_ROW = {
  sourceId: '7', title: 'Napa Cabbage', entityType: 'order_suggestion',
  content: 'id=7 · name=Napa Cabbage · live_qty=0.000 · par_level=75.000',
  fields: { id: '7', name: 'Napa Cabbage', live_qty: '0.000', par_level: '75.000' }
}

/** rows | 'empty' | 'throw' per adapter method. */
function connectorFor (byMethod) {
  const reads = []
  return {
    reads,
    connector: {
      async read (source, method) {
        reads.push({ source, method })
        const spec = byMethod[method]
        if (spec === 'throw' || spec === undefined) throw new Error('upstream refused the connection')
        const rows = spec === 'empty' ? [] : [Object.assign({ source, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }, PLAN_ROW)]
        return {
          asOf: NOW, source, count: rows.length, results: rows,
          evidence: {
            source, endpoint: method, entityType: rows.length ? rows[0].entityType : 'unknown',
            rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {},
            matchingTotal: rows.length, shownCount: rows.length, sourceTotal: null,
            queryScope: { field: null, window: null, declaredBy: 'reader' },
            completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live',
            provenance: 'Aroma System ' + method
          }
        }
      }
    }
  }
}

/* ═══ TEST A — A DIRECT UNAVAILABLE READ ══════════════════════════════════ */

test('*** A — an UNAVAILABLE read produces NO EvidenceSet and NO scope line ***', async () => {
  const c = connectorFor({ listPurchaseOrders: 'throw' })
  const rc = await buildReadContext({
    connector: c.connector, message: '睇下採購單', sources: ['aroma_system'],
    operation: PURC, now: NOW, env: {}
  })

  // The failed state is KEPT — this fix hides nothing.
  assert.equal(rc.perSource.length, 1, 'the attempt is still on the record')
  assert.equal(rc.perSource[0].trust, 'unavailable')
  assert.equal(rc.perSource[0].readKey, PURC, 'and it keeps its read identity')
  assert.ok(/UNAVAILABLE/.test(rc.block), 'the model is still told the read failed')

  // ⛔ AND IT PRODUCES NO EVIDENCE AT ALL.
  assert.deepEqual(rc.evidenceSets, [],
    '⛔ THE DEFECT: describeRead() synthesised a trust:live EvidenceSet for a read that never happened')
  assert.equal(/SCOPE \[/.test(rc.block), false,
    '⛔ and renderScopeLine turned that fake evidence into a SCOPE line for data never retrieved')
  // Scoped to the rendered LINE: the safety header quotes the phrase 'read OK' when it
  // explains the two outcomes, so a bare substring test matches the header, not a read.
  assert.equal(rc.block.includes(`[${PURC}] read OK`), false, 'a failed read is never described as a successful empty one')
  assert.equal(/ref=/.test(rc.block), false, 'and it owns no row reference')
})

/* ═══ TEST B — LIVE ZERO ROWS IS STILL EVIDENCE ═══════════════════════════ */

test('*** B — a LIVE read matching zero rows keeps its EvidenceSet and SCOPE ***', async () => {
  const c = connectorFor({ listInvoices: 'empty' })
  const rc = await buildReadContext({
    connector: c.connector, message: '睇下發票', sources: ['aroma_system'],
    operation: 'aroma_system.invoices', now: NOW, env: {}
  })

  assert.equal(rc.perSource.length, 1)
  assert.equal(rc.perSource[0].trust, 'live', 'the read SUCCEEDED; the table is simply empty')
  assert.equal(rc.evidenceSets.length, 1, '⛔ THE FENCE: do not fix the defect by discarding empty reads')
  assert.equal(rc.evidenceSets[0].trust, 'live')
  assert.equal(rc.evidenceSets[0].readKey, 'aroma_system.invoices')
  assert.ok(/SCOPE \[aroma_system\.invoices\]/.test(rc.block), 'it keeps its own scope identity')
  assert.ok(/read OK/.test(rc.block), 'and says plainly that nothing matched')
  assert.equal(/ref=/.test(rc.block), false, 'with no fabricated row ref')
})

/* ═══ TEST H — ONE STATE, ONE STORY ══════════════════════════════════════ */

test('*** H — the rendered block never tells two stories about one read ***', async () => {
  const c = connectorFor({ listPurchaseOrders: 'throw' })
  const rc = await buildReadContext({
    connector: c.connector, message: '睇下採購單', sources: ['aroma_system'],
    operation: PURC, now: NOW, env: {}
  })
  const block = String(rc.block)
  assert.ok(block.includes(`[${PURC}] UNAVAILABLE`), 'it says the read failed')
  assert.equal(block.includes(`SCOPE [${PURC}]`), false, 'and never also claims a successful scope')
  assert.equal(block.includes(`[${PURC}] read OK`), false, 'and never also claims an empty success')
})

/* ═══ THE PIPELINE-LEVEL PROOFS ═══════════════════════════════════════════ */

function scriptedAdapter (label, envelopes) {
  const calls = []
  return {
    label,
    calls,
    async complete (prompt, opts = {}) {
      calls.push({
        prompt: String(prompt),
        schemaName: opts.responseFormat ? opts.responseFormat.name : null,
        hasAnswerPlan: !!(opts.responseFormat && opts.responseFormat.schema && opts.responseFormat.schema.properties && opts.responseFormat.schema.properties.answerPlan)
      })
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error(label + ' called more times than scripted: ' + calls.length)
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: label, latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}
const READ = (capability) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: { capability }, answerPlan: null })
const FINAL = (plan) => ({ intent: 'question', mode: 'chat', reply: '睇咗。', nextRead: null, answerPlan: plan })

const FLAGS = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off' }
async function withEnv (over, fn) {
  const all = Object.assign({}, FLAGS, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}
async function withPlanLog (fn) {
  const captured = []
  const original = console.log
  console.log = (...args) => { if (args[0] === '[AROMA-ANSWER-PLAN]') { try { captured.push(JSON.parse(args[1])) } catch (_) {} } }
  try { return { result: await fn(), captured } } finally { console.log = original }
}

const BROAD = '根據而家嘅資料，幫我判斷今日有咩需要我優先處理。'
const run = (msg, adapter, deps) => processIntake(msg, adapter, [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
})

/* ═══ TEST C — LIVE A → UNAVAILABLE B → FINAL ════════════════════════════ */

test('*** C — a failed second read cannot become evidence, and does not cancel the first ***', async () => {
  await withEnv({}, async () => {
    const c = connectorFor({ listOrderPlanning: 'rows', listPurchaseOrders: 'throw' })
    const PLAN = {
      directAnswer: '有一項要補貨。', answerClaims: null, unanswerable: false, citesEvidence: true,
      sections: [{ heading: '要跟進', items: [{ sourceId: `${REPL}#7`, title: 'Napa Cabbage', facts: [{ field: '現有', value: '0.000' }] }] }],
      limitations: [], followUp: null
    }
    const a = scriptedAdapter('claude', [READ(REPL), READ(PURC), FINAL(PLAN)])
    const { captured } = await withPlanLog(() => run(BROAD, a, { connector: c.connector, sources: ['aroma_system'] }))

    // Truth Closure stays active — read A really was live.
    assert.equal(a.calls[1].hasAnswerPlan, true, 'step 2 grounds on the live read')
    assert.equal(a.calls[2].hasAnswerPlan, true, 'and so does the final call')
    assert.equal(captured[0].droppedItems, 0, 'A survives B failing')
    assert.equal(captured[0].keptItemCount, 1)

    // The failed read is visible, and contributes nothing the model may cite.
    const finalPrompt = a.calls[2].prompt
    assert.ok(finalPrompt.includes(`[${PURC}] UNAVAILABLE`), 'B is reported as failed')
    assert.equal(finalPrompt.includes(`SCOPE [${PURC}]`), false, '⛔ and gets no scope line')
    assert.ok(finalPrompt.includes(`SCOPE [${REPL}]`), 'while A keeps its own')
    // ⛔ COUNTED, NOT JUST NAME-CHECKED. The synthetic EvidenceSet carried no readKey, so its
    // fake scope line rendered as `SCOPE [aroma_system]` — mislabelled rather than absent, and
    // a name check alone would have walked straight past it. Exactly one read succeeded, so
    // exactly one SCOPE line may exist.
    assert.equal((finalPrompt.match(/SCOPE \[/g) || []).length, 1,
      'one live read, one scope line — a failed read may not add a second under any label')
    assert.equal(finalPrompt.includes(`ref=${PURC}#`), false, 'B owns no row refs')

    // No automatic retry of a failed operation.
    assert.equal(c.reads.filter((r) => r.method === 'listPurchaseOrders').length, 1, 'exactly one attempt')
  })
})

/* ═══ TEST D — UNAVAILABLE ONLY DOES NOT OPEN TRUTH CLOSURE ══════════════ */

test('*** D — the only read failing leaves Truth Closure shut ***', async () => {
  await withEnv({}, async () => {
    const c = connectorFor({ listPurchaseOrders: 'throw' })
    const a = scriptedAdapter('claude', [READ(PURC), FINAL(null)])
    await run(BROAD, a, { connector: c.connector, sources: ['aroma_system'] })
    assert.equal(a.calls[1].hasAnswerPlan, false,
      'a read that produced no evidence may not demand an evidence-shaped answer')
    assert.equal(a.calls[1].schemaName, 'distill_with_read_decision')
    assert.equal(a.calls[1].prompt.includes(`SCOPE [${PURC}]`), false, 'and no fake scope reached the model')
  })
})

/* ═══ TEST E — THE AUTOMATIC PATH BEHAVES IDENTICALLY ════════════════════ */

test('*** E — an AUTOMATIC read that fails also produces no EvidenceSet ***', async () => {
  await withEnv({}, async () => {
    const c = connectorFor({ listInventory: 'throw' })
    const routes = []
    const original = console.log
    console.log = (...args) => { if (args[0] === '[AROMA-TURN-ROUTE]') { try { routes.push(JSON.parse(args[1])) } catch (_) {} } }
    let a
    try {
      a = scriptedAdapter('claude', [FINAL(null)])
      await run('而家倉存入面有咩？', a, { connector: c.connector, sources: ['aroma_system'] })
    } finally { console.log = original }

    const prompt = a.calls[0].prompt
    assert.ok(prompt.includes('[aroma_system] UNAVAILABLE'), 'the failure is reported')
    assert.equal(prompt.includes('SCOPE [aroma_system]'), false, '⛔ and no synthetic live scope appears')
    assert.equal(prompt.includes('[aroma_system] read OK'), false, 'nor a zero-result line for a read that failed')
    assert.equal(a.calls[0].hasAnswerPlan, false, 'a failed read cannot force an Answer Plan')
    for (const r of routes) {
      assert.equal((r.sourcesRead || []).includes('aroma_system'), false,
        'telemetry must not report a failed read as live')
    }
  })
})

/* ═══ TEST F — MULTI-OPERATION IDENTITY IS UNCHANGED ═════════════════════ */

test('*** F — two LIVE operations still keep both EvidenceSets and both readKeys ***', async () => {
  const live = connectorFor({ listOrderPlanning: 'rows', listPurchaseOrders: 'rows' })
  const a = await buildReadContext({ connector: live.connector, message: 'x', sources: ['aroma_system'], operation: REPL, now: NOW, env: {} })
  const b = await buildReadContext({ connector: live.connector, message: 'x', sources: ['aroma_system'], operation: PURC, now: NOW, env: {} })
  assert.equal(a.evidenceSets.length, 1)
  assert.equal(b.evidenceSets.length, 1)
  assert.equal(a.evidenceSets[0].readKey, REPL)
  assert.equal(b.evidenceSets[0].readKey, PURC)
  assert.ok(a.block.includes(`ref=${REPL}#7`))
  assert.ok(b.block.includes(`ref=${PURC}#7`))
})

/* ═══ TEST G — A FAILED READ IS NOT BINDABLE ═════════════════════════════ */

test('*** G — absence from evidenceSets IS the representation; the claim fails closed ***', async () => {
  const c = connectorFor({ listOrderPlanning: 'rows', listPurchaseOrders: 'throw' })
  // Assembled exactly as the pipeline does: one buildReadContext per model-directed read.
  const a = await buildReadContext({ connector: c.connector, message: 'x', sources: ['aroma_system'], operation: REPL, now: NOW, env: {} })
  const b = await buildReadContext({ connector: c.connector, message: 'x', sources: ['aroma_system'], operation: PURC, now: NOW, env: {} })

  const evidenceSets = [...a.evidenceSets, ...b.evidenceSets]
  const itemsBySource = [...a.itemsBySource, ...b.itemsBySource].filter((g) => g.items.length)
  assert.equal(evidenceSets.length, 1, 'only the live read contributes evidence')
  assert.equal(evidenceSets[0].readKey, REPL)

  for (const kind of ['row_local', 'set_scoped', 'source_wide']) {
    const out = verifyClaimBindings([{
      text: 'x', claimKind: kind, evidenceSources: [PURC],
      sourceIds: kind === 'row_local' ? [`${PURC}#7`] : [],
      scope: kind === 'set_scoped' ? { field: null, window: null } : null
    }], { evidenceSets, itemsBySource })
    assert.equal(out[0].binding, BINDING.UNVERIFIED, `${kind} may not bind to a read that failed`)
  }
  // ⛔ NO SYNTHETIC UNAVAILABLE EvidenceSet WAS CREATED just to have something to reject.
  assert.equal(evidenceSets.some((e) => e.readKey === PURC), false)
})
