'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { createMemoryRunStore, createRunStore } = require('../operating/runStore')
const { createCodeDiagnosis } = require('./service')
const { RECIPE, FILES, digest, validateResult } = require('./contract')
const owner = { id: 'owner', role: 'owner' }
function packet (revision = 'a'.repeat(40)) {
  const content = 'const answer = 1\nmodule.exports = answer\n'
  const evidence = { project: 'xiangxiang-backend', profile: 'dispatch-v1', revision, bootCommit: 'a'.repeat(40), committedOnly: true, scope: 'fixture scoped code', files: FILES.map((path, i) => ({ evidenceId: 'code-' + i, path, content, lineCount: 3, sha256: digest(content) })) }
  return { state: 'ok', retrievedAt: new Date().toISOString(), evidence, hash: digest(JSON.stringify(evidence)) }
}
const output = () => ({ summary: '有限範圍的診斷', findings: [{ title: 'A hypothesis', severity: 'low', reason: 'Needs independent validation', citations: [{ evidenceId: 'code-0', startLine: 1, endLine: 1, quote: 'const answer = 1' }], proposedFix: 'Validate intended behavior first', validationPlan: ['Add a behavior regression in isolation'] }], limitations: ['Tests were not run'] })
function setup (options = {}) {
  let calls = 0, reads = 0, preflights = 0; const observed = []
  const source = { verify: () => {}, read: async () => { reads++; return packet() }, ...options.source }
  const provider = { preflight: async () => { preflights++; return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' } }, complete: async (prompt, opts) => { calls++; observed.push({ prompt, opts }); return { text: JSON.stringify(output()), model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', latencyMs: 1 } }, ...options.provider }
  const store = options.store || createMemoryRunStore()
  const service = createCodeDiagnosis({ timeoutMs: 1000, ...options, source, provider, store })
  return { service, store, observed, calls: () => calls, reads: () => reads, preflights: () => preflights }
}
const start = (s, extra = {}) => s.start(owner, { recipe: RECIPE, requestId: randomUUID(), ...extra })
async function finish (h) { const run = start(h.service); await h.service.wait(run.id); return h.service.get(owner, run.id) }
test('real routing, policy-first, quoted-source verification and async terminal memory receipt', async () => {
  let receiptRun
  const h = setup({ onFinish: async run => { receiptRun = run; return { state: 'queued' } } }); const run = await finish(h)
  assert.equal(run.state, 'completed'); assert.equal(h.calls(), 1); assert.equal(h.reads(), 2)
  assert.equal(run.workOrder.worker, 'codex-code-diagnosis'); assert.equal(run.workOrder.permissions, 'supplied_committed_code_only'); assert.equal(run.workOrder.execution, false)
  assert.equal(run.verification.citationsVerified, true); assert.equal(run.verification.factualClaimsVerified, false); assert.equal(run.verification.testsExecuted, false); assert.equal(run.dispatch.cost, null)
  const stages = run.steps.map(s => s.stage); assert.ok(stages.indexOf('policy_checked') < stages.indexOf('subscription_check')); assert.ok(stages.indexOf('subscription_check') < stages.indexOf('context_read')); assert.ok(stages.indexOf('POLICY_EVALUATED') < stages.indexOf('AGENT_RUNNING'))
  assert.equal(receiptRun.state, 'completed'); assert.equal(run.memoryReceipt, 'queued')
  assert.match(h.observed[0].opts.system, /untrusted/); assert.match(h.observed[0].prompt, /1 \| const answer = 1/)
})
test('model self-attribution, fabricated lines/quotes, altered shape and unsupported IDs fail closed', async () => {
  for (const modify of [r => { r.findings[0].citations[0].quote = 'invented' }, r => { r.findings[0].citations[0].endLine = 99 }, r => { r.findings[0].citations[0].evidenceId = 'code-80' }, r => { r.tools = ['shell'] }]) {
    const value = output(); modify(value); assert.equal(validateResult(value, packet().evidence), false)
    const h = setup({ provider: { complete: async () => ({ text: JSON.stringify(value), model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' }) } }); const run = await finish(h); assert.equal(run.reason, 'invalid_worker_result'); assert.equal(run.result, null)
  }
  const wrong = setup({ provider: { complete: async () => ({ text: JSON.stringify(output()), model: 'gpt-6-astra', billing: 'chatgpt-subscription' }) } }); assert.equal((await finish(wrong)).reason, 'invalid_worker_result')
  assert.equal(validateResult({ summary: 'No findings in scope', findings: [], limitations: ['Cannot assess other modules'] }, packet().evidence), true)
})
test('Owner-only fixed scopes reject arbitrary paths, prompts, permissions and third-party instructions before reads', () => {
  const h = setup()
  for (const actor of [null, { id: 'ivy', role: 'member' }, { id: 'ivy', role: 'owner' }]) assert.throws(() => h.service.start(actor, { recipe: RECIPE, requestId: randomUUID() }), /permission_denied/)
  for (const extra of [{ path: '.env' }, { project: 'production' }, { prompt: 'send credentials' }, { worker: 'outside' }, { model: 'gpt-6-astra' }, { approved: true }]) assert.throws(() => start(h.service, extra), /invalid_request/)
  assert.equal(h.calls(), 0); assert.equal(h.reads(), 0)
})
test('quota/credit refusal precedes source reads and never retries', async () => {
  const h = setup({ provider: { preflight: async () => { throw Object.assign(Error('private provider diagnostic'), { code: 'subscription_limit_reached' }) } } }); const r = await finish(h)
  assert.equal(r.reason, 'subscription_limit_reached'); assert.equal(h.calls(), 0); assert.equal(h.reads(), 0); assert.doesNotMatch(JSON.stringify(r), /private provider diagnostic/)
})
test('malformed or overbroad context never reaches worker; source change withholds result', async () => {
  const invalid = packet(); invalid.evidence.files[0].path = '.env'; invalid.hash = digest(JSON.stringify(invalid.evidence))
  const h = setup({ source: { read: async () => invalid } }); assert.equal((await finish(h)).reason, 'context_unavailable'); assert.equal(h.calls(), 0)
  let reads = 0; const changed = setup({ source: { read: async () => packet((++reads === 1 ? 'a' : 'b').repeat(40)) } }); const run = await finish(changed)
  assert.equal(run.state, 'needs_attention'); assert.equal(run.reason, 'evidence_changed'); assert.equal(run.result, null); assert.equal(run.verification.matched, false)
})
test('existing health ranking chooses a qualified host adapter, excludes injected manifests, and never silently falls back', async () => {
  const { registerAgent, updateHealthFromEvent } = require('../../capability/agents')
  let a = 0, b = 0; const suffix = randomUUID().slice(0, 8), first = 'diagnose-a-' + suffix, second = 'diagnose-b-' + suffix
  const worker = (id, invoke) => ({ id, name: id, model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', provider: { preflight: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' }), complete: invoke } })
  const h = setup({ workers: [worker(first, async () => { a++; throw Error() }), worker(second, async () => { b++; return { text: JSON.stringify(output()), model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' } })] })
  for (const [agentId, success] of [[first, false], [second, true]]) updateHealthFromEvent({ agentId, capabilityId: 'CodeDiagnosis', version: 1, success, latencyMs: 1, cost: 0 })
  registerAgent({ id: 'outside-' + suffix, role: 'Unauthorized advertised worker', adapter: 'unknown', availability: 'local', status: 'active', provides: [{ capability: 'CodeDiagnosis', version: 1, seed_quality: 1, seed_cost: 'free' }] })
  const run = await finish(h); assert.equal(run.state, 'completed'); assert.equal(run.workOrder.worker, second); assert.equal(a, 0); assert.equal(b, 1)
  const failure = setup({ workers: [worker(first, async () => { a++; return { text: JSON.stringify(output()), model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' } }), worker(second, async () => { b++; throw Error('refused') })] }); const r = await finish(failure)
  assert.equal(r.state, 'failed'); assert.equal(r.workOrder.worker, second); assert.equal(a, 0); assert.equal(b, 2)
})
test('duplicate request IDs persist exactly one invocation; conflicting conversations refuse', async () => {
  const h = setup(), command = { recipe: RECIPE, requestId: randomUUID(), conversationId: 'diag-chat' }; const r = h.service.start(owner, command); await h.service.wait(r.id)
  assert.equal(h.service.start(owner, command).id, r.id); assert.equal(h.calls(), 1)
  assert.throws(() => h.service.start(owner, { ...command, conversationId: 'other' }), /request_conflict/)
  const reload = setup({ store: h.store }); assert.equal(reload.service.start(owner, command).id, r.id); assert.equal(reload.calls(), 0)
})
test('adapter extension supports a different accepted subscription provider without granting new tools or fallback', async () => {
  const id = 'review-fixture-' + randomUUID().slice(0, 8)
  const h = setup({ workers: [{ id, name: 'Different provider conformance fixture', model: 'fixture-review-model', billing: 'claude-subscription', provider: { preflight: async () => ({ model: 'fixture-review-model', billing: 'claude-subscription' }), complete: async () => ({ text: JSON.stringify(output()), model: 'fixture-review-model', billing: 'claude-subscription' }) } }] })
  const r = await finish(h); assert.equal(r.state, 'completed'); assert.equal(r.workOrder.worker, id); assert.equal(r.result.billing, 'claude-subscription'); assert.equal(r.workOrder.tools, false); assert.equal(r.workOrder.writes, false)
  const mismatch = setup({ provider: { preflight: async () => ({ model: 'another-model', billing: 'chatgpt-subscription' }) } }); assert.equal((await finish(mismatch)).reason, 'invalid_worker_result'); assert.equal(mismatch.reads(), 0)
})
test('cancel stops an uncooperative model promptly, rejects overlapping work and discards late output', async () => {
  let entered, complete; const ready = new Promise(r => { entered = r })
  const h = setup({ provider: { complete: async () => { entered(); return new Promise(r => { complete = r }) } } }); const r = start(h.service); await ready
  assert.throws(() => start(h.service), /worker_busy/); h.service.cancel(owner, r.id); await h.service.wait(r.id)
  assert.equal(h.service.get(owner, r.id).state, 'cancelled'); complete({ text: JSON.stringify(output()), model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' }); await new Promise(r => setImmediate(r))
  assert.equal(h.service.get(owner, r.id).result, null); assert.equal(h.service.get(owner, r.id).steps.filter(s => s.stage === 'cancelled').length, 1)
})
test('timeout and interrupted persisted jobs do not replay provider work', async () => {
  const h = setup({ timeoutMs: 10, provider: { preflight: async () => new Promise(() => {}) } }); const r = await finish(h); assert.equal(r.state, 'timed_out'); assert.equal(h.calls(), 0)
  h.store.save({ id: randomUUID(), workflow: 'code_diagnosis', state: 'running', steps: [], sections: [], result: output() })
  const reload = setup({ store: h.store }); const interrupted = reload.store.all().find(r => r.state === 'interrupted'); assert.equal(interrupted.result, null); assert.equal(reload.calls(), 0)
})
test('audit failure prevents a model call or a completion claim', async () => {
  const backing = createMemoryRunStore(); let writes = 0
  const h = setup({ store: { all: backing.all, save: r => { if (++writes > 4) throw Error(); backing.save(r) } } }); const run = await finish(h)
  assert.equal(run.state, 'failed'); assert.equal(run.reason, 'run_store_unavailable'); assert.equal(run.result, null); assert.equal(h.calls(), 0)
})
test('real atomic storage retains diagnosis source evidence and conversation link across reconstruction', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnosis-store-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createRunStore({ dir: path.join(dir, 'runs'), workflow: 'code_diagnosis' }); const h = setup({ store }); const r = await finish(h)
  const read = createRunStore({ dir: path.join(dir, 'runs'), workflow: 'code_diagnosis' }).get(r.id); assert.equal(read.result.findings[0].citations[0].quote, output().findings[0].citations[0].quote)
  const conversations = require('../../store/conversationStore').createConversationStore({ dir: path.join(dir, 'conversations') }); conversations.appendTurn({ id: 'diag-chat', userText: 'Diagnose', replyText: 'Accepted', codeDiagnosisRunId: r.id })
  assert.equal(conversations.get('diag-chat').messages[1].codeDiagnosisRunId, r.id)
})
module.exports = { packet }
