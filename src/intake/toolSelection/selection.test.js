'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { fixture, read } = require('../../../scripts/u2/fixture.cjs')
const { createSelection } = require('./selection')

for (const [id, args, source] of [
  ['aroma.invoices.list', {}, 'aroma_system'], ['aroma.order_planning.search', { query: 'tea' }, 'aroma_system'],
  ['calendar.owner_events.list', { window: 'this_week' }, 'calendar'], ['drive.company_files.search', { query: 'tea' }, 'drive']
]) test('contract integration dispatches ' + id + ' through existing gateway', async () => {
  const f = fixture({ proposal: read(id, args) }), s = await f.selector.select('Read requested fixture data')
  assert.equal(s.status, 'read_tool_needed'); assert.equal(s.grantsAuthority, false); assert.equal(f.calls.length, 0)
  const result = await f.selector.execute(s)
  assert.equal(result.status, 'read_completed'); assert.equal(result.goalCompleted, false)
  assert.equal(result.packs[0].source, source); assert.equal(result.packs[0].contentPolicy, 'data_only')
  assert.equal(result.packs[0].coverage.provenance, 'synthetic_disposable_fixture')
  assert.equal(f.audit.length, 2); assert.equal(f.events.at(-1).stage, 'u2_execution_recorded')
  assert.equal(f.prompts.length, 1); assert.equal(f.connector.hasWriteMethod(), false)
})

test('flat combination is bounded and source-grounded; no replan from injected source data', async () => {
  const f = fixture({ proposal: { ...read('drive.company_files.search', { query: 'tea' }), tools: [
    ...read('drive.company_files.search', { query: 'tea' }).tools, ...read('calendar.owner_events.list').tools, ...read('aroma.invoices.list').tools] } })
  const result = await f.selector.execute(await f.selector.select('Read three fixture sources'))
  assert.equal(result.packs.length, 3); assert.equal(f.prompts.length, 1)
  assert(result.packs[0].content[0].content.includes('UNTRUSTED DOCUMENT'))
  assert(!JSON.stringify(f.prompts).includes('UNTRUSTED DOCUMENT'))
  assert.deepEqual(f.calls.map(c => c.source), ['drive', 'calendar', 'aroma_system'])
})

for (const [kind, capability, status] of [
  ['answer', null, 'no_tool_needed'], ['clarify', null, 'ambiguous_goal'], ['unsupported', null, 'unsupported_operation'],
  ['capability', 'calendar.write', 'unsupported_operation'], ['capability', 'gmail.send', 'unsupported_operation'],
  ['capability', 'gmail.read', 'tool_unavailable'], ['capability', 'work_order.dispatch', 'approval_required']
]) test('non-read classification ' + kind + '/' + capability + ' never executes', async () => {
  const f = fixture({ proposal: { kind, capability, outcome: 'contract fixture', tools: [] } }), s = await f.selector.select('Fixture goal')
  assert.equal(s.status, status); assert.equal(s.grantsAuthority, false)
  await assert.rejects(f.selector.execute(s), /selection_not_executable/)
  assert.equal(f.calls.length, 0)
  if (status === 'approval_required') assert.equal(s.approvalCreated, false)
})

for (const proposal of [
  { ...read('aroma.invoices.list'), approved: true }, read('gmail.send'), read('aroma.invoices.get', {}),
  read('calendar.owner_events.list', { window: 'next_month' }), read('drive.company_files.search', { query: 'x', rootId: 'elsewhere' }),
  read('drive.company_files.get', { fileId: '../secret' }), read('aroma.invoices.list', { role: 'owner' }),
  { ...read('aroma.invoices.list'), tools: Array(4).fill(read('aroma.invoices.list').tools[0]) },
  { ...read('aroma.invoices.list'), tools: Array(2).fill(read('aroma.invoices.list').tools[0]) },
  { kind: 'answer', outcome: 'already sent', capability: null, tools: read('aroma.invoices.list').tools }
]) test('invalid model contract rejected: ' + JSON.stringify(proposal), async () => {
  const f = fixture({ proposal }); await assert.rejects(f.selector.select('Fixture goal'))
  assert.equal(f.calls.length, 0)
})

test('unadvertised source cannot be selected even with known valid tool ID', async () => {
  const f = fixture({ proposal: read('drive.company_files.list') }); f.context.sources = ['calendar']
  const s = await f.selector.select('Read Drive'); assert.equal(s.status, 'denied')
  assert(f.prompts[0].prompt.tools.every(t => t.source === 'calendar'))
  await assert.rejects(f.selector.execute(s)); assert.equal(f.calls.length, 0)
})

for (const mutate of [c => { c.actor.role = 'native_service' }, c => { c.providerSharing = false }, c => { c.actor.id = '' }]) {
  test('host authentication/sharing required before model or tools', async () => {
    const f = fixture(); mutate(f.context); await assert.rejects(f.selector.select('Read invoices'), /not_authorized/)
    assert.equal(f.prompts.length, 0); assert.equal(f.calls.length, 0)
  })
}
test('policy-sensitive request denied before model', async () => {
  const f = fixture(), s = await f.selector.select('Read banking secrets')
  assert.equal(s.status, 'denied'); assert.equal(f.prompts.length, 0); assert.equal(f.calls.length, 0)
})
for (const mutate of [f => { f.context.surface = 'chrome' }, f => { f.context.conversationId = 'other' }, f => { f.context.actor.id = 'other' }, f => { f.versions.drive++ }, f => { f.context.sources = [] }]) {
  test('selected work requires unchanged host principal, surface, conversation and authorization', async () => {
    const f = fixture(), s = await f.selector.select('Read invoices'); mutate(f)
    await assert.rejects(f.selector.execute(s), /scope_changed/); assert.equal(f.calls.length, 0)
  })
}
test('copy, tamper and replay cannot substitute or multiply execution', async () => {
  const f = fixture(), s = await f.selector.select('Read invoices')
  await assert.rejects(f.selector.execute(structuredClone(s)), /not_executable/)
  s.tools = read('drive.company_files.list').tools
  const results = await Promise.allSettled([f.selector.execute(s), f.selector.execute(s)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].resource, 'aroma.invoices')
})
test('lease revocation during a read discards data, no followup', async () => {
  const f = fixture({ beforeRead: ({ versions }) => { versions.drive++ } }), s = await f.selector.select('Read invoices')
  await assert.rejects(f.selector.execute(s), /scope_changed|source_access_changed/)
  assert.equal(f.calls.length, 1); assert(!f.events.some(e => e.stage === 'u2_execution_recorded'))
})
test('unavailable source is honest and never retried', async () => {
  const f = fixture({ unavailable: ['aroma_system'] }), s = await f.selector.select('Read invoices')
  const result = await f.selector.execute(s); assert.equal(result.status, 'tool_unavailable')
  assert.equal(f.calls.length, 1); assert.equal(result.packs[0].content, null)
})
test('capture failure classified unavailable before any read', async () => {
  const f = fixture(); f.versions.aroma_system++
  const s = await f.selector.select('Read invoices'); assert.equal(s.status, 'tool_unavailable'); assert.equal(f.calls.length, 0)
})
test('partial coverage remains partial; no Owner-goal completion', async () => {
  const f = fixture({ partial: true }), result = await f.selector.execute(await f.selector.select('Read invoices'))
  assert.equal(result.packs[0].coverage.complete, false); assert.equal(result.goalCompleted, false)
})
test('audit failure blocks before source dispatch', async () => {
  const f = fixture({ record: e => { if (e.stage === 'u2_read_started') throw Error('audit_failed') } }), s = await f.selector.select('Read invoices')
  await assert.rejects(f.selector.execute(s), /audit_failed/); assert.equal(f.calls.length, 0)
})
test('cancellation before selection or after model response prevents execution', async () => {
  const f = fixture(), controller = new AbortController()
  const selector = createSelection({ bindings: f.bindings, authorize: f.authorize, record: f.record, signal: controller.signal,
    model: { async complete() { controller.abort(); return { text: JSON.stringify(read('aroma.invoices.list')) } } } })
  await assert.rejects(selector.select('Read invoices'), /cancelled/)
  await assert.rejects(selector.select('Read invoices'), /cancelled/); assert.equal(f.calls.length, 0)
})
