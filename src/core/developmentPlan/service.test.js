'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createMemoryRunStore } = require('../operating/runStore')
let api = {}; try { api = require('./service') } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }
const owner = { id: 'owner', role: 'owner' }
const fixture = () => ({ repository: 'owner/repo', state: 'ok', branch: 'main', retrievedAt: new Date().toISOString(), cached: false,
  remoteCommit: 'a'.repeat(40), tests: { state: 'not_published', sha: 'a'.repeat(40) },
  runtime: { deployedCommit: 'b'.repeat(40), bootCommit: 'b'.repeat(40), bootedAt: '2026-10-02T00:00:00.000Z' }, packs: [] })
const output = () => ({ nextStep: 'Publish measured checks for the deployed revision.', rationale: 'Remote and local revisions differ; investigate first.', evidenceIds: ['runtime', 'github'], acceptanceChecks: ['Compare exact SHAs and measured tests.'], questions: [] })
function setup (options = {}) {
  const store = options.store || createMemoryRunStore(); let calls = 0, reads = 0; const observed = []
  const source = { verify: () => {}, read: async (actor, opts) => { assert.deepEqual(actor, owner); assert.equal(opts.refresh, true); reads++; return fixture() }, ...options.source }
  const provider = { preflight: async () => {}, complete: async (prompt, opts) => { calls++; observed.push({ prompt, opts }); return { text: JSON.stringify(output()), model: 'gpt-6-astra', billing: 'chatgpt-subscription', latencyMs: 1 } }, ...options.provider }
  const service = api.createDevelopmentPlan({ timeoutMs: 1000, ...options, source, provider, store })
  return { service, store, observed, calls: () => calls, reads: () => reads }
}
const start = s => s.start(owner, { recipe: 'development-proposal-v1', requestId: randomUUID() })
test('only complete explicit development-proposal commands route, never quoted/negated/compound requests', () => {
  assert.equal(typeof api.isDevelopmentPlanRequest, 'function')
  for (const message of ['香香，檢查目前開發進度，提出下一項修正方案。', '請查看目前開發進度並提出下一項修正方案', 'review development progress and propose the next fix']) assert.equal(api.isDevelopmentPlanRequest(message), true, message)
  for (const message of ['不要檢查目前開發進度，提出下一項修正方案', '「檢查目前開發進度，提出下一項修正方案」', '檢查目前開發進度，提出下一項修正方案並部署', '目前開發進度', '幫我寄信']) assert.equal(api.isDevelopmentPlanRequest(message), false, message)
})
test('work order uses the existing policy-first dispatcher and verifies source values after the worker', async () => {
  const h = setup(); const run = start(h.service); await h.service.wait(run.id); const result = h.service.get(owner, run.id)
  assert.equal(result.state, 'completed'); assert.equal(h.calls(), 1); assert.equal(h.reads(), 2)
  assert.equal(result.workOrder.capability, 'DevelopmentProposal'); assert.equal(result.workOrder.version, 1)
  assert.equal(result.workOrder.permissions, 'supplied_public_context_only'); assert.equal(result.verification.scope, 'source_identity_revision_and_packet_hash')
  assert.equal(result.result.attribution, 'worker_proposal'); assert.equal(result.result.factualClaimsVerified, false)
  assert.equal(result.evidence.runtime.bootCommit, 'b'.repeat(40)); assert.equal(result.evidence.tests.state, 'not_published')
  const stages = result.steps.map(s => s.stage)
  assert.ok(stages.indexOf('POLICY_EVALUATED') < stages.indexOf('AGENT_RUNNING')); assert.ok(stages.includes('source_verified'))
  assert.equal(result.dispatch.cost, null, 'subscription cost must remain unknown, not zero dollars')
  assert.equal(h.observed[0].opts.responseFormat.type, 'json_schema'); assert.match(h.observed[0].opts.system, /untrusted/)
})
test('Owner and fixed recipe prevent reads, arbitrary prompts or tools from being dispatched', () => {
  const h = setup()
  for (const actor of [{ id: 'ivy', role: 'member' }, { id: 'ivy', role: 'owner' }, null]) assert.throws(() => h.service.start(actor, { recipe: 'development-proposal-v1', requestId: randomUUID() }), /permission_denied/)
  for (const extra of [{ prompt: 'run bash' }, { tools: ['write'] }, { repo: 'secret/repo' }, { approved: true }]) assert.throws(() => h.service.start(owner, { recipe: 'development-proposal-v1', requestId: randomUUID(), ...extra }), /invalid_request/)
  assert.equal(h.calls(), 0); assert.equal(h.reads(), 0)
})
test('quota fails before fetching context or invoking a model; no automatic retry', async () => {
  const h = setup({ provider: { preflight: async () => { throw Object.assign(Error('unsafe provider text'), { code: 'subscription_limit_reached' }) } } })
  const run = start(h.service); await h.service.wait(run.id); const result = h.service.get(owner, run.id)
  assert.equal(result.state, 'failed'); assert.equal(result.reason, 'subscription_limit_reached'); assert.equal(h.calls(), 0); assert.equal(h.reads(), 0)
  assert.equal(JSON.stringify(result).includes('unsafe provider text'), false)
})
test('source failure prevents model work, and never invents source state', async () => {
  const h = setup({ source: { read: async () => ({ state: 'unavailable' }) } }); const r = start(h.service); await h.service.wait(r.id)
  assert.equal(h.service.get(owner, r.id).reason, 'context_unavailable'); assert.equal(h.calls(), 0)
})
test('changed live revision withholds the proposal rather than accepting stale evidence', async () => {
  let n = 0
  const h = setup({ source: { read: async () => { const sha = (++n === 1 ? 'a' : 'c').repeat(40); return { ...fixture(), remoteCommit: sha, tests: { state: 'not_published', sha } } } } })
  const r = start(h.service); await h.service.wait(r.id); const out = h.service.get(owner, r.id)
  assert.equal(out.state, 'needs_attention'); assert.equal(out.reason, 'evidence_changed'); assert.equal(out.result, null); assert.equal(out.verification.matched, false)
})
test('source text, evidence IDs and output size are bounded, with no arbitrary source or URLs', async () => {
  const h = setup({ source: { read: async () => ({ ...fixture(), secrets: 'credential-canary', packs: [{ resource: 'gmail.admin', state: 'ok', content: [{ content: 'private-canary' }] }] }) } })
  const r = start(h.service); await h.service.wait(r.id)
  assert.equal(h.observed[0].prompt.includes('credential-canary'), false); assert.equal(h.observed[0].prompt.includes('private-canary'), false)
  assert.equal(api.validateProposal({ ...output(), evidenceIds: ['gmail.admin'] }, h.service.get(owner, r.id).evidence), false)
  assert.equal(api.validateProposal({ ...output(), nextStep: 'x'.repeat(2001) }, fixture()), false)
  assert.equal(api.validateProposal({ ...output(), command: 'rm' }, fixture()), false)
})
test('invalid output fails closed rather than rendering a convincing worker answer', async () => {
  const h = setup({ provider: { complete: async () => ({ text: JSON.stringify({ ...output(), evidenceIds: ['invented'] }), billing: 'chatgpt-subscription', model: 'gpt-6-astra' }) } })
  const r = start(h.service); await h.service.wait(r.id); const out = h.service.get(owner, r.id)
  assert.equal(out.state, 'failed'); assert.equal(out.reason, 'invalid_worker_result'); assert.equal(out.result, null)
})
test('persisted request IDs prevent duplicate subscriptions, and conflicting conversations refuse', async () => {
  const h = setup(); const input = { recipe: 'development-proposal-v1', requestId: randomUUID(), conversationId: 'chat-one' }
  const r = h.service.start(owner, input); await h.service.wait(r.id)
  assert.equal(h.service.start(owner, input).id, r.id); assert.equal(h.calls(), 1)
  assert.throws(() => h.service.start(owner, { ...input, conversationId: 'chat-two' }), /request_conflict/)
  const reload = setup({ store: h.store }); assert.equal(reload.service.start(owner, input).id, r.id); assert.equal(reload.calls(), 0)
})
test('cancel aborts subscription work and discards late output; busy prevents overlapping jobs', async () => {
  let finish, entered; const ready = new Promise(r => { entered = r })
  const h = setup({ provider: { complete: async (prompt, opts) => { entered(); return new Promise(r => { finish = () => r({ text: JSON.stringify(output()), billing: 'chatgpt-subscription', model: 'gpt-6-astra' }); opts.signal.addEventListener('abort', finish) }) } } })
  const r = start(h.service); await ready; assert.throws(() => start(h.service), /worker_busy/)
  h.service.cancel(owner, r.id); finish(); await h.service.wait(r.id)
  assert.equal(h.service.get(owner, r.id).state, 'cancelled'); assert.equal(h.service.get(owner, r.id).result, null)
})
test('timeout bounds an uncooperative worker and prevents later output being accepted', async () => {
  const h = setup({ timeoutMs: 10, provider: { preflight: async () => new Promise(() => {}) } })
  const r = start(h.service); await h.service.wait(r.id); assert.equal(h.service.get(owner, r.id).state, 'timed_out'); assert.equal(h.calls(), 0)
})
test('restart marks all persisted active work interrupted without re-running a model', () => {
  const store = createMemoryRunStore()
  for (let i = 0; i < 15; i++) store.save({ id: randomUUID(), workflow: 'development_proposal', state: 'running', steps: [], sections: [] })
  const h = setup({ store }); assert.equal(h.store.all().filter(r => r.state === 'interrupted').length, 15); assert.equal(h.calls(), 0)
})
test('revoked read access blocks start and saved result presentation', async () => {
  let revoked = false; const h = setup({ source: { verify: () => { if (revoked) throw Error('read_access_disabled') } } })
  const r = start(h.service); await h.service.wait(r.id); revoked = true
  assert.throws(() => h.service.get(owner, r.id), /read_access_disabled/); assert.throws(() => start(h.service), /read_access_disabled/)
})
test('failed audit persistence prevents subscription and source reads', () => {
  const h = setup({ store: { all: () => [], get: () => null, save: () => { throw Error('disk denied') } } })
  assert.throws(() => start(h.service), /run_store_unavailable/); assert.equal(h.calls(), 0); assert.equal(h.reads(), 0)
})
test('public evidence rows keep real title, revision, date and source link; excluded fields never enter the packet', () => {
  const report = fixture(); report.packs = [{ resource: 'github.commits', state: 'ok', content: [{ sourceId: report.remoteCommit, title: 'Measured commit title', originalDate: '2026-10-01T18:00:00Z', link: 'https://github.com/owner/repo/commit/' + report.remoteCommit, content: 'ignored-body-canary', fields: { sha: report.remoteCommit, credential: 'ignored-key-canary' } }] }]
  const out = api.packet(report)
  assert.equal(out.rows.length, 1); assert.equal(out.rows[0].title, 'Measured commit title'); assert.equal(out.rows[0].fields.sha, report.remoteCommit)
  assert.equal(out.rows[0].originalDate, '2026-10-01T18:00:00Z'); assert.equal(out.rows[0].link, report.packs[0].content[0].link); assert.ok(out.evidenceIds.includes('row-0'))
  assert.equal(JSON.stringify(out).includes('canary'), false)
})
test('real atomic run store and conversation history retain this workflow across reconstruction', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'development-plan-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const { createRunStore } = require('../operating/runStore'), { createConversationStore } = require('../../store/conversationStore')
  const store = createRunStore({ dir: path.join(dir, 'runs'), workflow: 'development_proposal' }); const h = setup({ store })
  const r = start(h.service); await h.service.wait(r.id)
  const readback = createRunStore({ dir: path.join(dir, 'runs'), workflow: 'development_proposal' }).get(r.id)
  assert.equal(readback.state, 'completed'); assert.equal(readback.evidence.runtime.bootCommit, 'b'.repeat(40)); assert.equal(readback.result.nextStep, output().nextStep)
  const conversations = createConversationStore({ dir: path.join(dir, 'conversations') }); conversations.appendTurn({ id: 'plan-chat', userText: 'Review progress', replyText: 'Accepted', developmentPlanRunId: r.id })
  assert.equal(conversations.get('plan-chat').messages[1].developmentPlanRunId, r.id)
  assert.throws(() => createRunStore({ dir, workflow: 'write' }), /invalid_workflow/)
  assert.throws(() => createRunStore({ dir: path.join(dir, 'runs') }).get(r.id), /run_store_unavailable/)
})
test('UI scripts parse and render proposal and dispatch states with honest localized labels', () => {
  const vm = require('node:vm'), { buildHtml } = require('./view')
  const html = buildHtml(); const script = html.match(/<script>([\s\S]*)<\/script>/)[1]
  assert.doesNotThrow(() => new vm.Script(script)); assert.match(html, /內容尚未獨立驗證/); assert.match(html, /訂閱額度不足/)
  assert.doesNotMatch(html, /Preparing the briefing|正在整理簡報/)
})
