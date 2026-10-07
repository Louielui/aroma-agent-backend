'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
const { createEnquirySubscriptionWorker } = require('./enquirySubscriptionWorker')
function fixture (t, output) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'enquiry-subscription-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const content = 'enabled = false\n', sha256 = crypto.createHash('sha256').update(content).digest('hex')
  fs.writeFileSync(path.join(cwd, 'settings.txt'), content)
  const calls = []
  const args = { cwd, source: { ok: true, revision: 'a'.repeat(40), files: [{ path: 'settings.txt', sha256 }] }, selection: { model: 'claude-opus-5-5', effort: 'medium' }, timeoutMs: 1000,
    adapterFactory: selection => ({ complete: async (prompt, options) => { calls.push({ selection, prompt: JSON.parse(prompt), options }); return { text: JSON.stringify(output), actualModel: selection.model, billing: 'subscription' } } }) }
  return { args, calls, cwd }
}
const result = () => ({ answer: 'The setting is disabled; spending is not established.', citations: [{ path: 'settings.txt', startLine: 1, endLine: 1, quote: 'enabled = false' }], notEstablished: ['No billing records supplied.'] })

test('the real subscription adapter accepts the enquiry response contract before the transport call', async t => {
  const f = fixture(t, result()), calls = []
  const { CodexSubscriptionAdapter } = require('../adapters/CodexSubscriptionAdapter')
  f.args.adapterFactory = selection => new CodexSubscriptionAdapter({ ...selection, request: async (route, input) => {
    calls.push({ route, input })
    return { model: selection.model, billing: 'claude-subscription', text: JSON.stringify(result()), stopReason: 'end_turn' }
  } })
  const out = await createEnquirySubscriptionWorker(f.args).dispatch({ goal: 'Check approved source' })
  assert.equal(calls.length, 1); assert.equal(calls[0].route, '/complete')
  assert.deepEqual(calls[0].input.schema.required, ['answer', 'citations', 'notEstablished'])
  assert.equal(out.diagnostics.billing, 'claude-subscription')
})
test('one subscription call receives only the approved snapshot and preserves unknown cost', async t => {
  const f = fixture(t, result()), worker = createEnquirySubscriptionWorker(f.args)
  const out = await worker.dispatch({ goal: 'Investigate cost', sessionId: 'fixed' })
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].selection.model, 'claude-opus-5-5')
  assert.deepEqual(f.calls[0].prompt.files.map(x => x.path), ['settings.txt'])
  assert.equal(f.calls[0].prompt.files[0].numberedText, '1: enabled = false\n2: ')
  assert.equal(out.costUsd, null); assert.equal(out.diagnostics.toolsEnabled, false)
  assert.equal(out.citations[0].status, 'CONFIRMED')
})
test('a citation to an existing but unapproved file is refused', async t => {
  const value = result(); value.citations[0].path = 'private.txt'
  const f = fixture(t, value); fs.writeFileSync(path.join(f.cwd, 'private.txt'), 'enabled = false\n')
  await assert.rejects(createEnquirySubscriptionWorker(f.args).dispatch({ goal: 'q' }), /citations/)
})
test('a mismatched quote cannot be delivered as a successful investigation', async t => {
  const value = result(); value.citations[0].quote = 'enabled = true'
  const f = fixture(t, value)
  await assert.rejects(createEnquirySubscriptionWorker(f.args).dispatch({ goal: 'q' }), err => {
    assert.match(err.message, /citations/)
    assert.deepEqual(err.diagnostics.unverifiedPayload, value)
    assert.equal(err.diagnostics.citationChecks[0].status, 'QUOTE_MISMATCH')
    assert.equal(err.diagnostics.billing, 'subscription')
    return true
  })
  const { runEnquiry } = require('./enquiryRunner')
  const worker = createEnquirySubscriptionWorker(f.args)
  const saved = await runEnquiry({ question: 'q', worker: input => worker.dispatch(input), next: () => ({ done: false, goal: 'q' }), budgetUsd: 5, maxRounds: 1 })
  assert.equal(saved.report.outcome, 'FAILED')
  assert.equal(saved.turns[0].payload, null)
  assert.deepEqual(saved.turns[0].diagnostics.unverifiedPayload, value)
  assert.equal(saved.turns.length, 1)
})
test('changed snapshot is refused before consuming the subscription', async t => {
  const f = fixture(t, result()); fs.writeFileSync(path.join(f.cwd, 'settings.txt'), 'modified\n')
  assert.throws(() => createEnquirySubscriptionWorker(f.args), /source_changed/)
  assert.equal(f.calls.length, 0)
  const inaccessible = fixture(t, result()), worker = createEnquirySubscriptionWorker(inaccessible.args)
  t.mock.method(fs.realpathSync, 'native', () => { throw Object.assign(Error('denied'), { code: 'EACCES' }) })
  await assert.rejects(worker.dispatch({ goal: 'q' }), err => {
    assert.equal(err.message, 'enquiry_source_unverifiable')
    assert.equal(err.diagnostics.modelCalled, false)
    assert.equal(err.diagnostics.citationChecks[0].status, 'OUTSIDE_COPY')
    return true
  })
  assert.equal(inaccessible.calls.length, 0)
})

test('a source changed during the call cannot validate different evidence', async t => {
  const f = fixture(t, result()), factory = f.args.adapterFactory
  f.args.adapterFactory = selection => { const adapter = factory(selection); return { complete: async (...args) => { const value = await adapter.complete(...args); fs.writeFileSync(path.join(f.cwd, 'settings.txt'), 'enabled = true\n'); return value } } }
  await assert.rejects(createEnquirySubscriptionWorker(f.args).dispatch({ goal: 'q' }), /source_changed/)
  assert.equal(f.calls.length, 1)
})
