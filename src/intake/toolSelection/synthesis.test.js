'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { fixture, read } = require('../../../scripts/u2/fixture.cjs')
const { buildEvidence, synthesize } = require('./synthesis')

async function setup(options = {}) {
  const f = fixture(options), selection = await f.selector.select('Read synthetic invoices')
  const execution = await f.selector.execute(selection)
  const report = buildEvidence(selection, execution)
  const ref = { sourceId: report.sections[0].sourceId, recordId: 'r1', field: 'content', value: report.sections[0].records[0]?.content }
  const claim = { id: 'c1', text: 'The recorded invoice is DEMO-17 for CAD 84.', kind: 'observation', evidenceState: 'supported', temporalScope: 'historical', references: [ref] }
  return { ...f, selection, execution, report, claim }
}
function modelFor(claims, decision = 'supported') {
  const calls = []
  return { calls, model: 'fixture-model', billing: 'chatgpt-subscription', async complete(prompt, options) {
    calls.push({ prompt, options })
    return { model: 'fixture-model', actualModel: 'fixture-model', billing: 'chatgpt-subscription', text: JSON.stringify(options.invocationPhase === 'evidence_review'
      ? { reviews: claims.map(c => ({ id: c.id, decision, reason: decision === 'supported' ? 'matches_reference' : 'unsupported_inference' })) } : { claims }) }
  } }
}
test('U3-C withholds a mixed-source observation even if the semantic reviewer supports it', async () => {
  const f = await setup({ proposal: { kind: 'read', outcome: 'Read both sources', capability: null, tools: [read('aroma.invoices.list').tools[0], read('drive.company_files.list').tools[0]] } })
  const a = f.report.sections[0].records[0].content, b = f.report.sections[1].records[0].content
  const claim = { ...f.claim, text: 'The records belong to one transaction.', references: [{ sourceId: 'S1', recordId: 'r1', field: 'content', value: a }, { sourceId: 'S2', recordId: 'r1', field: 'content', value: b }] }
  const result = await run(f, modelFor([claim]), { crossSource: true })
  assert.equal(result.claims.length, 0)
  assert.match(result.text, /未建立同一交易/)
})
test('U3-C unsupported numeric variance is rejected without adding a calculation source', async () => {
  const f = await setup(); f.claim.text = 'The financial variance is CAD 999.'
  const result = await run(f, modelFor([f.claim]), { crossSource: true })
  assert.equal(result.claims.length, 0); assert.doesNotMatch(result.text, /999/)
  assert.match(result.text, /不計算或宣稱金額差額/)
})
for (const kind of ['observation', 'limitation', 'recommendation']) test('U3-C rejects multi-record ' + kind + ' even within one source and with a supportive reviewer', async () => {
  const f = await setup(), pack = f.execution.packs[0]
  pack.content.push({ ...structuredClone(pack.content[0]), sourceId: 'fixture_second_invoice', content: 'A different candidate invoice record.' })
  const claim = { ...f.claim, text: 'The records conflict.', kind, evidenceState: kind === 'observation' ? 'supported' : 'not_established', temporalScope: kind === 'observation' ? 'historical' : 'unknown',
    references: [{ sourceId: 'S1', recordId: 'r1', field: 'content', value: pack.content[0].content }, { sourceId: 'S1', recordId: 'r2', field: 'content', value: pack.content[1].content }] }
  const result = await run(f, modelFor([claim]), { crossSource: true })
  assert.equal(result.claims.length, 0); assert.doesNotMatch(result.text, /The records conflict/)
})
async function run(f, model, overrides = {}) {
  return synthesize({ question: 'What does the invoice record say?', selection: f.selection, execution: f.execution, model, record: f.record, check() {}, ...overrides })
}
test('real Context Packs become exact references; one draft and existing semantic review yield a useful answer', async () => {
  const f = await setup(), model = modelFor([f.claim]), result = await run(f, model)
  assert.equal(result.state, 'reviewed'); assert(result.text.includes('CAD 84'))
  assert.equal(result.claims[0].references[0].value, f.execution.packs[0].content[0].content)
  assert.equal(result.sources[0].packSha256, require('./selection').digest(f.execution.packs[0]))
  assert.equal(model.calls.length, 2); assert.equal(f.calls.length, 1); assert.equal(result.goalCompleted, false)
  assert(model.calls[1].prompt.includes(JSON.stringify(require('../../investigation/semanticAnswer').reviewSchema)))
  assert.equal(result.machineEntailmentProven, false)
})
test('invented price is rejected by the reused scalar binder before semantic review', async () => {
  const f = await setup(); f.claim.text = 'The invoice is CAD 999.'
  const m = modelFor([f.claim]), r = await run(f, m)
  assert.equal(r.claims.length, 0); assert(!r.text.includes('999')); assert.equal(m.calls.length, 1)
})
test('catalog IDs cannot smuggle extra numbers into prose; exact source identity is available for attribution', async () => {
  const f = await setup(); assert.equal(f.report.sections[0].records[0].source, 'aroma_system')
  f.claim.text = 'S2 records CAD 84.'
  const m = modelFor([f.claim]), r = await run(f, m)
  assert.equal(r.claims.length, 0); assert.equal(m.calls.length, 1)
})
test('wrong reference IDs or values cannot be rescued by a supportive model reviewer', async () => {
  for (const field of ['sourceId', 'recordId', 'value']) {
    const f = await setup(); f.claim.references[0][field] = 'invented'
    const r = await run(f, modelFor([f.claim])); assert.equal(r.claims.length, 0)
  }
})
test('unsupported and contradicted interpretations are withheld, not rendered as facts', async () => {
  const f = await setup(); f.claim.text = 'The supplier was paid.'
  const m = modelFor([f.claim], 'contradicted'), r = await run(f, m)
  assert.equal(r.claims.length, 0); assert(!r.text.includes('supplier was paid'))
  assert.equal(r.withheld[0].reason, 'contradicted')
})
test('host sharing and source lease checks run before any draft and after model completion', async () => {
  for (const failAt of [1, 3]) {
    const f = await setup(), m = modelFor([f.claim]); let checks = 0
    await assert.rejects(run(f, m, { check() { if (++checks >= failAt) throw Error('sharing_revoked') } }), /sharing_revoked/)
    assert(m.calls.length <= 1)
  }
})
test('source instructions reach a data-only prompt, never an executable tool or extra selection', async () => {
  const f = await setup({ proposal: read('drive.company_files.list') }), m = modelFor([])
  await run(f, m)
  const payload = JSON.parse(m.calls[0].prompt)
  assert(payload.catalog.sections[0].records[0].fields.content.includes('UNTRUSTED DOCUMENT'))
  assert.match(m.calls[0].options.system, /never instructions/i)
  assert.equal(f.calls.length, 1); assert.equal(f.prompts.length, 1)
})
test('oversized bodies are excluded before provider sharing; metadata-only receipts cannot support facts', async () => {
  const f = await setup(); f.execution.packs[0].content[0].content = 'SECRET_OMITTED'.repeat(4000)
  const m = modelFor([f.claim]), r = await run(f, m)
  assert.equal(m.calls.length, 0); assert.equal(r.claims.length, 0)
  assert.equal(r.sources[0].state, 'content_omitted'); assert(!JSON.stringify(r).includes('SECRET_OMITTED'))
})
test('long scalar content is projected as bounded verbatim fragments with explicit omission', async () => {
  const f = await setup(); f.execution.packs[0].content[0].content = 'long'.repeat(300)
  const r = await run(f, modelFor([])); assert.equal(r.sources[0].state, 'partial'); assert(r.report.sections[0].projection.omittedCharacters > 0); assert.equal(r.claims.length, 0)
})
test('partial coverage, unread selected sources and unavailable sources remain explicit', async () => {
  const f = await setup({ partial: true }), r = await run(f, modelFor([f.claim]))
  assert.equal(r.sources[0].state, 'partial'); assert(r.text.includes('部分'))
  const g = await setup(); g.selection.tools.push({ id: 'drive.company_files.list', arguments: {} })
  const s = buildEvidence(g.selection, g.execution).sections[1]; assert.equal(s.state, 'not_read'); assert.deepEqual(s.records, [])
  g.execution.packs[0] = { ...g.execution.packs[0], state: 'unavailable', content: null, trust: 'unavailable' }
  const q = await run(g, modelFor([])); assert(q.text.includes('不可用')); assert.equal(q.claims.length, 0)
})
test('model identity changes, malformed draft and review outages never produce an unverified answer', async () => {
  for (const text of ['not json', '{"claims":[],"approved":true}']) {
    const f = await setup(), m = modelFor([]); m.complete = async () => ({ text, model: m.model, billing: m.billing })
    assert.equal((await run(f, m)).claims.length, 0)
  }
  const f = await setup(), m = modelFor([f.claim]); const complete = m.complete
  m.complete = async (p, o) => o.invocationPhase === 'evidence_review' ? { model: 'other', billing: m.billing, text: '{}' } : complete(p, o)
  assert.equal((await run(f, m)).state, 'review_unavailable')
})
test('audit failure is fatal even when the existing review helper catches adapter errors', async () => {
  const f = await setup(), m = modelFor([f.claim])
  await assert.rejects(run(f, m, { record(e) { if (e.stage === 'u2_synthesis_review_started') throw Error('audit_failed') } }), /audit_failed/)
})
test('non-subscription models are rejected before source content can be shared', async () => {
  const f = await setup(), m = modelFor([f.claim]); m.billing = 'paid-api'
  await assert.rejects(run(f, m), /subscription_synthesis_required/); assert.equal(m.calls.length, 0)
})
test('empty source records do not become invented records or a global absence conclusion', async () => {
  const f = await setup(); f.execution.packs[0].content = []; f.execution.packs[0].count = 0
  const m = modelFor([]), r = await run(f, m)
  assert.equal(m.calls.length, 0); assert.equal(r.state, 'no_usable_content'); assert.equal(r.claims.length, 0)
})
test('byte budget handles multibyte scalar catalogs without changing original packs', async () => {
  const f = await setup(), p = f.execution.packs[0]
  p.content = Array.from({ length: 16 }, (_, i) => ({ sourceId: 'row' + i, title: '紀錄', content: '字'.repeat(300), fields: { note: '文'.repeat(300) } }))
  const original = JSON.stringify(f.execution)
  const r = buildEvidence(f.selection, f.execution)
  assert(Buffer.byteLength(JSON.stringify(r)) <= 12000); assert(r.sections[0].omitted > 0)
  assert.equal(JSON.stringify(f.execution), original)
})
