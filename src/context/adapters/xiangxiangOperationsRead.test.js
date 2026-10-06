'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createXiangxiangOperationsReadAdapter, SECTIONS } = require('./xiangxiangOperationsRead')
const { createReadConnector } = require('../readConnector')
const { buildReadContext } = require('../readContext')
const { validatePlan } = require('../../intake/answerPlan')

function fixture (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-investigation-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const put = (name, value) => { const f = path.join(dir, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof value === 'string' ? value : JSON.stringify(value)) }
  put('model-center.json', { brain: { model: 'claude-sonnet', effort: 'medium' }, revision: 3 })
  put('aroma-truth.json', { llm_usage: [{ model: 'gpt-6.1-sol', at: '2026-10-01T10:00:00Z', estimated_tokens: 200 }], decisions: [] })
  put('project-work-runs/11111111-1111-4111-8111-111111111111.json', { id: '11111111-1111-4111-8111-111111111111', status: 'completed', createdAt: '2026-10-01T10:00:00Z', model: 'gpt-6.1-sol', secret: 'DO_NOT_EXPOSE', steps: [{ id: 'code', state: 'completed' }] })
  put('conversations/11111111-1111-4111-8111-111111111111.json', { id: '11111111-1111-4111-8111-111111111111', title: 'Credit usage', updatedAt: '2026-10-01T11:00:00Z', messages: [{ role: 'user', text: 'Why was credit consumed?' }, { role: 'assistant', text: 'An old hypothesis, not a bill.' }] })
  return { dir, put }
}

test('service-configured Owner roots provide automations and worker evidence independently of the service profile', async t => {
  const { dir, put } = fixture(t)
  put('owner-automations/fixture/automation.toml', 'name = "Owner scheduled investigation"\nstatus = "PAUSED"\nrrule = "FREQ=HOURLY"')
  put('owner-workers/project-runs/22222222-2222-4222-8222-222222222222.json', { status: 'completed', model: 'fixture-worker-model', updatedAt: '2026-10-06T15:00:00Z' })
  const a = createXiangxiangOperationsReadAdapter({ dataDir: dir, env: { XIANGXIANG_OPERATIONS_AUTOMATION_DIR: path.join(dir, 'owner-automations'), XIANGXIANG_OPERATIONS_WORKER_ROOT: path.join(dir, 'owner-workers') }, scheduler: async () => ({ state: 'NOT_INSTALLED' }) })
  const { results } = await a.methods.readInvestigation()
  assert.equal(results.find(r => r.fields.section === 'schedules').fields.records[1].name, 'Owner scheduled investigation')
  assert.ok(results.find(r => r.fields.section === 'work').fields.records.some(r => r.model === 'fixture-worker-model'))
})

test('nested operational facts survive the real answer guard while invented and cross-section values are rejected', async t => {
  const { dir, put } = fixture(t)
  put('automations/fixture/automation.toml', 'name = "Owner scheduled investigation"\nstatus = "PAUSED"\nrrule = "FREQ=HOURLY"')
  const { results } = await createXiangxiangOperationsReadAdapter({ dataDir: dir, automationDir: path.join(dir, 'automations'), scheduler: async () => ({ state: 'NOT_INSTALLED' }) }).methods.readInvestigation()
  const row = results.find(r => r.fields.section === 'schedules')
  const checked = validatePlan({ directAnswer: '', sections: [{ heading: '', items: [{ sourceId: row.sourceId, title: 'Ignored', facts: [{ field: 'Name', value: 'Owner scheduled investigation' }, { field: 'State', value: 'PAUSED' }, { field: 'Invented', value: 'Invented charge cause' }, { field: 'Wrong section', value: 'claude-sonnet' }] }] }], limitations: [], followUp: null }, { itemsBySource: [{ source: row.source, items: results }] })
  const item = checked.plan.sections[0].items[0]
  assert.equal(item.title, '排程與自動工作')
  assert.deepEqual(item.facts.map(f => f.value), ['Owner scheduled investigation', '已暫停'])
  assert.equal(checked.droppedFacts, 2)
})

test('local investigation continues across missing sources, distinguishes historic statements and billing, and preserves evidence', async t => {
  const { dir } = fixture(t)
  const seen = []
  const a = createXiangxiangOperationsReadAdapter({ dataDir: dir, env: { CHAT_BACKEND: 'codex-subscription', OPENAI_API_KEY: 'DO_NOT_EXPOSE' }, automationDir: path.join(dir, 'absent'), scheduler: async () => ({ state: 'DISABLED', lastRunAt: null }), clock: () => '2026-10-06T12:00:00Z', onProgress: e => seen.push(e) })
  const out = await a.methods.readInvestigation({ query: 'What kept consuming credit?' })
  assert.deepEqual(out.results.map(r => r.fields.section), SECTIONS)
  const rows = Object.fromEntries(out.results.map(r => [r.fields.section, r]))
  assert.equal(rows.billing.fields.state, 'unconnected')
  assert.equal(rows.billing.fields.evidenceState, 'not_established')
  assert.equal(rows.usage.fields.records[0].estimated_tokens, 200)
  assert.equal(rows.usage.fields.provesCharge, false)
  assert.equal(rows.history.fields.records[0].sourceId, '11111111-1111-4111-8111-111111111111')
  assert.equal(rows.history.fields.evidenceState, 'supported')
  assert.equal(rows.schedules.fields.records[0].state, 'DISABLED')
  assert.equal(rows.configuration.fields.records[0].model, 'claude-sonnet')
  assert.doesNotMatch(JSON.stringify(out), /DO_NOT_EXPOSE/)
  assert.equal(new Set(seen.map(e => e.section)).size, SECTIONS.length)
  for (const row of out.results) {
    assert.match(row.fields.sha256, /^[a-f0-9]{64}$/)
    assert.equal(row.retrievedAt, '2026-10-06T12:00:00Z')
    assert.ok(row.sourceId)
  }
})

test('corrupt, missing, empty and truncated records remain distinguishable; a section failure does not stop the others', async t => {
  const { dir, put } = fixture(t)
  put('aroma-truth.json', '{bad')
  const a = createXiangxiangOperationsReadAdapter({ dataDir: dir, automationDir: path.join(dir, 'absent'), scheduler: async () => { throw Error('SECRET_PATH') } })
  const out = await a.methods.readInvestigation({ query: 'credit' })
  const rows = Object.fromEntries(out.results.map(r => [r.fields.section, r.fields]))
  assert.equal(rows.usage.state, 'unavailable')
  assert.equal(rows.schedules.state, 'unavailable')
  assert.equal(rows.work.state, 'partial')
  assert.doesNotMatch(JSON.stringify(out), /SECRET_PATH/)
  assert.ok(rows.work.records.length > 0)
})

test('read gate is off by default and the normal read layer retains all section receipts including the billing gap', async t => {
  const { dir } = fixture(t)
  const env = { READ_ACCESS: 'on', CONTEXT_XIANGXIANG_OPERATIONS: 'on' }
  const c = createReadConnector({ env })
  c.register(createXiangxiangOperationsReadAdapter({ dataDir: dir, automationDir: path.join(dir, 'absent'), scheduler: async () => ({ state: 'DISABLED' }) }))
  const r = await buildReadContext({ connector: c, message: '之前有什麼會導致不停扣 credit？', sources: ['xiangxiang_operations'], env })
  assert.equal(r.itemsBySource[0].items.length, SECTIONS.length)
  assert.match(r.block, /billing/)
  assert.match(r.block, /not_established/)
  env.CONTEXT_XIANGXIANG_OPERATIONS = 'off'
  assert.equal((await c.read('xiangxiang_operations', 'readInvestigation', {})).trust, 'unavailable')
  assert.equal(c.hasWriteMethod(), false)
})

test('source catalogue offers operational investigation without treating a model choice as permission', () => {
  const { catalogueForPrompt } = require('../../intake/goal/operationCatalogue')
  const { sourcesForPlan } = require('../../intake/goal/goalGate')
  const row = catalogueForPrompt().find(r => r.operation === 'xiangxiang_operations')
  assert.match(row.label, /schedules|排程/)
  assert.deepEqual(sourcesForPlan({ facts: [{ necessity: 'required', operation: row.operation }] }, []), [])
})

test('schedule witness failure stays visible beside usable automation definitions and no source exposes write methods', async t => {
  const { dir, put } = fixture(t)
  put('automations/fixture/automation.toml', 'name = "Fixture task"\nstatus = "PAUSED"\nrrule = "FREQ=HOURLY"\nprompt = "PRIVATE INSTRUCTIONS"')
  const a = createXiangxiangOperationsReadAdapter({ dataDir: dir, automationDir: path.join(dir, 'automations'), scheduler: async () => { throw Error('unavailable') } })
  const out = await a.methods.readInvestigation({ path: 'C:/private', command: 'delete', query: 'credit' })
  const schedules = out.results.find(r => r.fields.section === 'schedules').fields
  assert.equal(schedules.state, 'partial')
  assert.equal(schedules.witnessUnavailable, true)
  assert.equal(schedules.records[0].state, 'PAUSED')
  assert.doesNotMatch(JSON.stringify(out), /PRIVATE INSTRUCTIONS|C:\/private/)
  assert.deepEqual(Object.keys(a.methods), ['readInvestigation'])
  for (const r of out.results) assert.notEqual(r.fields.provesCharge, true)
})
