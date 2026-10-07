'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { processIntake } = require('./intakeService')

async function turn (t, { allowed = true, question = '之前有什麼會導致不停扣 credit？', failed = false, verdict = 'allow_final', judgment = null } = {}) {
  const old = { ...process.env }
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in old)) delete process.env[k]; Object.assign(process.env, old) })
  Object.assign(process.env, { CHAT_BACKEND: 'codex-subscription', GOAL_DECOMPOSER: 'on', READ_ACCESS: 'on', CONTEXT_XIANGXIANG_OPERATIONS: 'on', XIANGXIANG_MEMORY: 'on', TURN_ROUTER: 'on', A4_KNOWLEDGE_ROUTING: 'on', MULTI_AI_ROUTER: 'off', DECISION_RECALL: 'off', CONVERSATION_RECALL: 'off' })
  const events = [], calls = [], reads = []
  const a = { providerName: 'claude', preflight: async () => {}, complete: async (p, options = {}) => {
    calls.push({ p, schema: options.responseFormat?.name })
    return { billing: 'claude-subscription', model: 'claude-opus-5-5', text: JSON.stringify(options.responseFormat?.name === 'goal_plan'
      ? { question_restated: question, facts: [{ id: 'f1', need: 'Investigate own previous usage and work', operation: 'xiangxiang_operations', entity: null, fields: [], necessity: 'required' }], joins: [] }
      : { mode: 'chat', intent: 'question', reply: '已找到排程設定，但實際扣款原因未確認。', nextRead: null, answerPlan: null, executiveJudgment: judgment }) }
  } }
  let recall = 0
  const result = await processIntake(question, { complete: async () => { throw Error('API must not be used') } }, [], {
    demo: true, interactionMode: 'chat', ownerInvestigation: allowed, openaiAdapter: a, controlAdapter: { complete: async () => { throw Error('unexpected API control call') } },
    memoryClient: { recall: async () => { recall++; return [] } },
    onInvestigation: e => events.push(e),
    readContextDeps: { sources: ['xiangxiang_operations'], connector: { read: async (source, method) => { reads.push({ source, method }); if (failed) throw Error('unavailable'); return { results: [{ source, sourceId: 'billing:abc', title: 'billing', retrievedAt: '2026-10-06T12:00:00Z', content: 'Billing source is unconnected: charge cause not established.', trust: 'live', fields: { section: 'billing', state: 'unconnected', evidenceState: 'not_established', provesCharge: false, records: [], sha256: 'a'.repeat(64) } }] } } }, finalVerifier: async () => ({ decision: verdict, question: null }), sourceIntentResolver: async () => JSON.stringify({ intent: 'internal', question: null }) }
  })
  return { result, events, calls, reads, recall }
}

test('a historical enquiry with empty memory reads own operational sources before answering, on the selected subscription', async t => {
  const x = await turn(t)
  assert.ok(x.recall > 0)
  assert.equal(x.calls.filter(c => c.schema === 'goal_plan').length, 1)
  assert.deepEqual(x.reads, [{ source: 'xiangxiang_operations', method: 'readInvestigation' }])
  assert.ok(x.calls.find(c => c.schema !== 'goal_plan').p.includes('charge cause not established'))
  assert.equal(x.result.investigation.sections[0].evidenceState, 'not_established')
  assert.ok(x.events.some(e => e.state === 'reading'))
  assert.ok(x.events.some(e => e.state === 'evaluating'))
  assert.notEqual(x.result.demoOutcome, 'clarification')
})
test('the same operational source choice handles English without a Chinese intent keyword', async t => {
  const x = await turn(t, { question: 'Find what previously kept consuming my credits and whether it is still running.' })
  assert.equal(x.reads.length, 1)
  assert.ok(x.result.investigation)
})

test('an operational answer does not prepend an unchecked auxiliary judgment over its evidence answer', async t => {
  const x = await turn(t, { judgment: { status: 'provisional', statement: 'Unsupported-billing-judgment', uncertainties: ['This task has no execution records.'], changeIf: [] } })
  assert.doesNotMatch(x.result.reply, /Unsupported-billing-judgment|no execution records/)
  assert.equal(x.result.investigation.unverifiedJudgmentOmitted, true)
  assert.match(x.result.reply, /扣款原因未確認/)
})
test('a plan cannot grant local operational access to a non-Owner caller', async t => {
  const x = await turn(t, { allowed: false })
  assert.deepEqual(x.reads, [])
  assert.equal(x.result.investigation, undefined)
})

test('a completed operational read satisfies an internal obligation without repeat reasoning or duplicate reads', async t => {
  const x = await turn(t, { verdict: 'require_internal' })
  assert.equal(x.calls.filter(c => c.schema !== 'goal_plan').length, 1)
  assert.equal(x.reads.length, 1)
  assert.ok(x.result.investigation.sections.length)
})

test('empty memory does not erase evidence gathered from other authorized sources', async t => {
  const x = await turn(t, { verdict: 'require_memory' })
  assert.ok(x.recall > 0)
  assert.ok(x.result.investigation.sections.length)
  assert.doesNotMatch(x.result.reply, /沒有找到|找不到|no matching memories/i)
})

test('a failed operational read is not counted as a fulfilled internal obligation', async t => {
  const x = await turn(t, { failed: true, verdict: 'require_internal' })
  assert.equal(x.result.investigation.state, 'unavailable')
  assert.deepEqual(x.result.investigation.sections, [])
  assert.equal(x.result.investigation.plan.completion, 'sources_exhausted_with_gaps')
})
test('an exhausted operational scope reports the gap without repeated subscription answers or reads', async t => {
  const x = await turn(t, { failed: true, verdict: 'require_internal' })
  assert.equal(x.result.investigation.state, 'unavailable')
  assert.equal(x.calls.filter(c => c.schema !== 'goal_plan').length, 1)
  assert.equal(x.reads.length, 1)
  assert.equal(x.result.investigation.plan.automaticModelRetries, 0)
})
