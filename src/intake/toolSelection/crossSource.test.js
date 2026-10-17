'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { randomUUID } = require('node:crypto')
const { fixture, read, MODEL } = require('../../../scripts/u2/fixture.cjs')
const { createSelectionTaskRunner } = require('./taskRunner')
const { createStore } = require('../../browserRead/store'), { createBrowserRead } = require('../../browserRead/service'), { createUnifiedIntake } = require('../unifiedIntake')
function setup({ multiple = false, missing = false, unavailable = false, partial = false, beforeRead, onEvent, proposal, sharing = true } = {}) {
  process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'u3c-truth-'))
  delete require.cache[require.resolve('../../store/store')]; const tasks = require('../../store/store')
  const f = fixture({ beforeRead, unavailable: unavailable ? ['aroma_system'] : [], complete: async (prompt, options) => {
    const response = options.invocationPhase === 'cross_source_handoff' ? proposal || { id: 'aroma.invoices.search', evidence: { field: 'content', value: 'INV-29' } }
      : options.invocationPhase === 'clarification' ? { choice: 2 }
        : options.invocationPhase === 'result_synthesis' ? { claims: [] }
          : options.invocationPhase === 'evidence_review' ? { reviews: [] }
            : { ...read('drive.company_files.search', { query: 'supplier quotation' }), dependency: { from: 0, id: 'drive.company_files.get', result: 'sourceId' } }
    return { model: MODEL, billing: 'chatgpt-subscription', text: JSON.stringify(response) }
  } })
  f.context.synthesisSharing = sharing; f.model.billing = 'chatgpt-subscription'
  f.rows['drive.company_files'] = [{ id: 'fixture_quote', title: 'Supplier quotation', text: 'Supplier quotation index.', fields: { contentState: 'metadata_only' } }]
  f.detailRows['drive.company_files'] = [{ id: 'fixture_quote', title: 'Supplier quotation Q-17', text: 'Quotation Q-17 mentions INV-29. Quotation total CAD 120.00. Tax basis and transaction relationship are not established.', fields: { contentState: 'text' } }]
  f.rows['aroma.invoices'] = missing ? [] : [{ id: 'fixture_invoice_one', title: 'Invoice INV-29', text: 'Invoice INV-29: stored total CAD 126.00; tax basis and payment status not supplied.', fields: { invoiceNumber: 'INV-29', total: '126.00', currency: 'CAD' } }]
  if (multiple) f.rows['aroma.invoices'].push({ ...f.rows['aroma.invoices'][0], id: 'fixture_invoice_two', title: 'Invoice INV-29 second record' })
  const bindings = f.bindings.map(b => ({ ...b, async read(...args) { const out = await b.read(...args); if (partial && b.descriptor.source === 'aroma_system') { out.pack.coverage.complete = false; out.pack.coverage.truncated = true } return out } }))
  const reads = createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'u3c-reads-'))), intake = createUnifiedIntake({ store: tasks, reads, enabled: () => true })
  const runner = createSelectionTaskRunner({ bindings, authorize: f.authorize, evidenceMode: 'synthetic_fixture', synthesizeResults: true, dependentReads: true, clarificationEnabled: true, crossSourceEnabled: true })
  const decorated = { ...runner, run(a) { return runner.run({ ...a, onEvent(e) { a.onEvent(e); onEvent?.(e, f) } }) } }
  const restart = () => createBrowserRead({ store: reads, selection: () => ({ model: MODEL, effort: 'high' }), provider: () => f.model, taskRunner: decorated, unifiedIntake: intake })
  const browser = restart(), start = { version: 1, operation: 'start', clientSubmissionId: randomUUID(), message: 'Find supplier quotation in Drive, investigate relevant Aroma invoices, and report what both sources establish.', conversationId: f.context.conversationId, taskRef: null, expectedRevision: null, contextRefs: [] }
  const view = id => intake.view(id, { principal: 'owner', surface: 'main' })
  const reply = v => ({ version: 1, operation: 'clarification_response', clientSubmissionId: randomUUID(), conversationId: f.context.conversationId, taskRef: v.taskId, expectedRevision: v.revision, clarificationId: v.clarification.id, response: '請用第二筆；這不是交易關聯確認。' })
  return { ...f, tasks, reads, intake, runner, browser, restart, start, view, reply }
}
test('U3-C uses one evidence-derived handoff, four tracked reads and one original Task/Goal', async () => {
  const f = setup(), r = await f.browser.handleMain(f.start)
  assert.equal(r.state, 'completed'); assert.equal(f.calls.length, 4)
  assert.deepEqual(f.calls.map(c => c.operation), ['search', 'get', 'search', 'get'])
  assert.deepEqual(f.calls[2].input, { query: 'INV-29' }); assert.deepEqual(f.calls[3].input, { sourceId: 'fixture_invoice_one' })
  assert.equal(r.timeline.filter(e => e.stage === 'u2_read_started').length, 4)
  assert.equal(r.result.taskEvidence.execution.handoff.transactionRelationship, 'not_established')
  assert.match(r.result.text, /未建立|not established/)
  assert.notEqual(f.view(r.unifiedTask.taskId).goalStatus, 'GOAL_COMPLETED')
  const n = f.calls.length; await f.browser.handleMain(f.start); assert.equal(f.calls.length, n)
})
test('U3-C persists Source B ambiguity, resumes through U3-B with one freshness read and no handoff replay', async () => {
  const f = setup({ multiple: true }), first = await f.browser.handleMain(f.start), v = f.view(first.unifiedTask.taskId)
  assert.equal(v.executionState, 'WAITING_CLARIFICATION'); assert.equal(f.calls.length, 3)
  const taskBefore = structuredClone(f.tasks.getTask(v.taskId)), b = f.reply(v)
  const r = await f.browser.handleMain(b), after = f.view(v.taskId)
  assert.equal(r.state, 'completed'); assert.equal(after.executionState, 'CLARIFICATION_COMPLETED')
  assert.equal(f.calls.length, 5); assert.deepEqual(f.calls.at(-1).input, { sourceId: 'fixture_invoice_two' })
  assert.deepEqual(f.tasks.getTask(v.taskId).ownerGoal, taskBefore.ownerGoal)
  assert.equal(r.result.taskEvidence.execution.packs[0].source, 'drive')
  await f.browser.handleMain(b); assert.equal(f.calls.length, 5)
})
test('U3-C waiting candidates cannot enter synthesis or become an inferred conflict before Owner selection', async () => {
  const f = setup({ multiple: true }), first = await f.browser.handleMain(f.start)
  assert.equal(f.view(first.unifiedTask.taskId).executionState, 'WAITING_CLARIFICATION')
  assert.equal(f.prompts.filter(p => p.phase === 'result_synthesis').length, 0)
  assert.equal(first.result.taskEvidence.synthesis, null)
  assert.doesNotMatch(first.result.text, /126|128|conflict|衝突/)
})
for (const option of ['missing', 'unavailable', 'partial']) test('U3-C preserves Source A with honest Source B ' + option, async () => {
  const f = setup({ [option]: true }), r = await f.browser.handleMain(f.start)
  assert.equal(r.state, 'completed'); assert.equal(f.calls.length, 3)
  assert.equal(r.result.taskEvidence.execution.handoff.transactionRelationship, 'not_established')
  assert.notEqual(r.result.taskEvidence.execution.status, 'read_completed')
  assert.match(r.result.text, /未建立|not established/)
})
for (const proposal of [
  { id: 'aroma.invoices.search', evidence: { field: 'content', value: 'invented-invoice' } },
  { id: 'aroma.invoices.get', evidence: { field: 'content', value: 'INV-29' } },
  { id: 'drive.company_files.search', evidence: { field: 'content', value: 'INV-29' } },
  { id: 'gmail.send', evidence: { field: 'content', value: 'INV-29' } },
  { id: 'aroma.invoices.search', evidence: { field: 'content', value: 'INV-29' }, sourceId: 'stolen' }
]) test('U3-C rejects ungrounded query, invented identity or unauthorized handoff contract ' + JSON.stringify(proposal), async () => {
  const f = setup({ proposal }), r = await f.browser.handleMain(f.start)
  assert.equal(r.state, 'failed'); assert.equal(f.calls.length, 2)
})
for (const source of ['drive', 'aroma_system']) test('U3-C revocation of either source blocks the next read: ' + source, async () => {
  const f = setup({ onEvent(e, f) { if (e.stage === 'u3_cross_source_selected') f.versions[source]++ } })
  const r = await f.browser.handleMain(f.start); assert.equal(r.state, 'failed'); assert.equal(f.calls.length, 2)
})
test('U3-C cancellation at handoff cannot create an untracked Source B call', async () => {
  let f
  f = setup({ onEvent(e) { if (e.stage === 'u3_cross_source_selected') { const r = f.reads.all().find(r => r.state === 'processing'); f.browser.cancelMain(r.id) } } })
  const r = await f.browser.handleMain(f.start); assert.equal(r.state, 'cancelled'); assert.equal(f.calls.length, 2)
})
test('U3-C source-content sharing is required before a handoff prompt', async () => {
  const f = setup({ sharing: false }), r = await f.browser.handleMain(f.start)
  assert.equal(r.state, 'failed'); assert.equal(f.prompts.filter(p => p.phase === 'cross_source_handoff').length, 0)
})
test('U3-C changed Source B candidate and restart remain fail-closed without repeating Source A', async () => {
  const f = setup({ multiple: true }), r = await f.browser.handleMain(f.start), v = f.view(r.unifiedTask.taskId)
  assert.equal(v.executionState, 'WAITING_CLARIFICATION'); const again = f.restart(); assert.equal(f.calls.length, 3)
  f.rows['aroma.invoices'][1].text += ' Changed.'
  await again.handleMain(f.reply(v)); assert.equal(f.calls.length, 4)
  assert.equal(f.view(v.taskId).executionState, 'CLARIFICATION_FAILED')
})
module.exports = { setup }

test('U3-C Source B waiting cancellation and concurrent responses retain a single detail budget', async () => {
  const f = setup({ multiple: true }), r = await f.browser.handleMain(f.start), v = f.view(r.unifiedTask.taskId), b = f.reply(v)
  await Promise.allSettled([f.browser.handleMain(b), f.browser.handleMain(b), f.browser.handleMain({ ...b, clientSubmissionId: randomUUID() })])
  assert.equal(f.calls.length, 5); assert.equal(f.calls.filter(c => c.source === 'aroma_system' && c.operation === 'get').length, 1)
  const g = setup({ multiple: true }), waiting = await g.browser.handleMain(g.start), w = g.view(waiting.unifiedTask.taskId)
  g.intake.cancelClarification(w.taskId, w.revision, w.attemptId, { principal: 'owner', surface: 'main' })
  await assert.rejects(g.browser.handleMain(g.reply(w))); assert.equal(g.calls.length, 3)
})
test('U3-C Source A revocation during Source B freshness prevents dependent detail', async () => {
  let f
  f = setup({ multiple: true, beforeRead({ source, operation, versions }) { if (source === 'aroma_system' && operation === 'search' && f.calls.length === 4) versions.drive++ } })
  const r = await f.browser.handleMain(f.start), v = f.view(r.unifiedTask.taskId)
  await f.browser.handleMain(f.reply(v)); assert.equal(f.calls.length, 4)
  assert.equal(f.view(v.taskId).executionState, 'CLARIFICATION_FAILED')
})
test('U3-C byte restoration cannot clear a damaged origin receipt or create a continuation read', async () => {
  const f = setup({ multiple: true }), r = await f.browser.handleMain(f.start), v = f.view(r.unifiedTask.taskId), original = f.reads.get(r.id)
  const corrupt = structuredClone(original); corrupt.result.taskEvidence.execution.packs[1].content[0].content += 'tampered'; f.reads.save(corrupt)
  f.restart(); assert.equal(f.view(v.taskId).executionState, 'CLARIFICATION_RECONCILIATION_REQUIRED')
  f.reads.save(original); await assert.rejects(f.browser.handleMain(f.reply(v))); assert.equal(f.calls.length, 3)
})
test('U3-C typed evidence handoff also works from Aroma to Drive without a supplier-specific route', async () => {
  const { createSelection } = require('./selection')
  const f = fixture({ complete: async (p, o) => ({ model: MODEL, billing: 'chatgpt-subscription', text: JSON.stringify(o.invocationPhase === 'cross_source_handoff'
    ? { id: 'drive.company_files.search', evidence: { field: 'content', value: 'POLICY-7' } }
    : { ...read('aroma.invoices.search', { query: 'invoice' }), dependency: { from: 0, id: 'aroma.invoices.get', result: 'sourceId' } }) }) })
  f.context.synthesisSharing = true; f.model.billing = 'chatgpt-subscription'
  f.rows['aroma.invoices'][0].text = 'Invoice references POLICY-7 for context. No relationship asserted.'
  f.rows['drive.company_files'][0].text = 'POLICY-7 handling guide.'
  const s = createSelection({ bindings: f.bindings, authorize: f.authorize, model: f.model, record: f.record, dependentReads: true, crossSourceEnabled: true })
  const selection = await s.select('Read the invoice and find its referenced guide.'), execution = await s.execute(selection), handoff = await s.handoff('Find the referenced guide.', selection, execution)
  assert.equal(handoff.execution.status, 'read_completed'); assert.equal(f.calls.length, 4)
  assert.deepEqual(f.calls[2].input, { query: 'POLICY-7' })
  await assert.rejects(s.handoff('again', selection, execution)); assert.equal(f.calls.length, 4)
})
test('U3-C source revocation during synthesis suppresses the answer after four reads', async () => {
  const f = setup(), complete = f.model.complete
  f.model.complete = async (prompt, options) => { const out = await complete(prompt, options); if (options.invocationPhase === 'result_synthesis') f.versions.aroma_system++; return out }
  const r = await f.browser.handleMain(f.start)
  assert.equal(r.state, 'failed'); assert.equal(f.calls.length, 4); assert.equal(r.result, undefined)
})
test('U3-C requires an actual unmodified selector execution, never a serialized evidence token', async () => {
  const { createSelection } = require('./selection')
  const f = fixture({ proposal: { ...read('drive.company_files.search', { query: 'tea' }), dependency: { from: 0, id: 'drive.company_files.get', result: 'sourceId' } } })
  f.context.synthesisSharing = true
  const s = createSelection({ bindings: f.bindings, authorize: f.authorize, model: f.model, record: f.record, dependentReads: true, crossSourceEnabled: true })
  const selection = await s.select('Find tea and investigate another source'), execution = await s.execute(selection)
  await assert.rejects(s.handoff('same goal', selection, structuredClone(execution)), /cross_source_not_authorized/)
  execution.packs[1].content[0].content += 'tampered'
  await assert.rejects(s.handoff('same goal', selection, execution), /cross_source_not_authorized/)
  assert.equal(f.calls.length, 2)
})
