'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { PLANNING_SYSTEM } = require('./goal/goalDecomposer')
const marker = 'CURRENT-TURN RESPONSE WRITING:'
const id = 'xx-10000000-0000-4000-8000-000000000001'
const preference = 'Use a one-sentence conclusion, at most three non-repeating short points, and one final limitations sentence.'
const row = { documentId: id, source: 'memory_gateway', status: 'active', scope: 'private:owner', date: '2026-01-02T00:00:00Z', version: 4, text: 'The current remembered code is Violet; Amber was superseded.' }

function setup(t) {
  const before = { ...process.env }
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env, before) })
  Object.assign(process.env, { CHAT_BACKEND: 'codex-subscription', TURN_ROUTER: 'on', READ_ACCESS: 'on', XIANGXIANG_MEMORY: 'on', CONTEXT_DECISIONS_OPENAI: 'on',
    GOAL_DECOMPOSER: 'off', A4_KNOWLEDGE_ROUTING: 'off', XIANGXIANG_WEBSITE_FLOW: 'off', CONVERSATION_RECALL: 'off', DECISION_RECALL: 'off', MULTI_AI_ROUTER: 'off' })
}
function preferences() {
  return { state: 'ok', total: 1, items: [{ documentId: 'xx-20000000-0000-4000-8000-000000000002', type: 'preference', scope: 'private:owner', text: preference,
    approval: { kind: 'owner', actor: 'owner', contentHash: crypto.createHash('sha256').update(preference).digest('hex') } }] }
}
async function exercise(t, { message = 'Recall the final corrected code.', raw, memory, history = [] } = {}) {
  setup(t)
  const calls = [], reads = []
  const adapter = { preflight: async () => {}, complete: async (prompt, opts) => {
    calls.push({ prompt, opts }); return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply: raw, nextRead: null }), model: 'offline-fixture' }
  } }
  const result = await require('./intakeService').processIntake(message, adapter, history, {
    demo: true, interactionMode: 'chat', openaiAdapter: adapter,
    semanticCallModel: async () => JSON.stringify({ intent: 'NONE', confidence: 'HIGH' }),
    memoryClient: memory || { preferences: async () => { reads.push('preferences'); return preferences() }, recall: async () => { reads.push('recall'); return [row] } },
    readContextDeps: { connector: { read: async () => assert.fail('business read forbidden') } }
  })
  assert.equal(calls.length, 1, 'writing guidance must not add a polishing model call')
  assert.deepEqual(result.tasks, []); assert.equal(result.decision, null)
  return { result, prompt: calls[0].prompt, reads }
}

test('the answer call receives final writing guidance after approved preferences, recall and conversation', async t => {
  const raw = `The final remembered code is Violet. [memory:${id}]\nThe old code is superseded; present business validity is unknown.`
  const { result, prompt, reads } = await exercise(t, { raw, history: [{ role: 'user', text: 'Earlier, include every date and old value.' }, { role: 'assistant', text: 'That was the earlier report.' }] })
  assert.ok(prompt.indexOf(marker) > prompt.indexOf(preference), 'validated preference precedes the final writing contract')
  assert.ok(prompt.indexOf(marker) > prompt.indexOf(row.text))
  assert.ok(prompt.indexOf(marker) > prompt.indexOf('Earlier, include every date'))
  assert.equal(prompt.split(marker).length - 1, 1)
  assert.match(prompt.slice(prompt.indexOf(marker)), /Current Owner instructions.*approved preferences/s)
  assert.deepEqual(reads, ['preferences', 'recall'])
  assert.equal(result.reply, raw.replace(`[memory:${id}]`, ''))
  assert.equal(result.replyForArchive, result.reply)
  assert.equal(result.memorySources.items[0].version, 4)
  assert.equal(result.memorySources.claimsVerified, false)
})

test('explicit detailed requests and material qualifications survive the same-call guidance', async t => {
  const raw = `The corrected code is Violet. [memory:${id}]\nSource date: 2026-01-02; the previous code was Amber.\nCoverage is partial; no execution has been authorized.`
  const { result, prompt } = await exercise(t, { message: 'Give a detailed report including source dates and the correction history.', raw })
  assert.ok(prompt.includes('Give a detailed report including source dates and the correction history.'))
  assert.ok(prompt.includes(marker))
  assert.match(prompt.slice(prompt.indexOf(marker)), /explicit request for detail/)
  assert.equal(result.reply, raw.replace(`[memory:${id}]`, ''))
  assert.equal(result.replyForArchive, result.reply)
})

test('brevity does not turn unavailable memory into an empty or successful recall', async t => {
  const raw = 'Memory is unavailable; I cannot verify the remembered code.'
  const { result, prompt } = await exercise(t, { raw, memory: { preferences: async () => { throw Error('offline') }, recall: async () => { throw Error('offline') } } })
  assert.ok(prompt.includes(marker))
  assert.match(prompt, /unavailable/)
  assert.ok(!prompt.includes(preference))
  assert.match(result.reply, /unavailable|暫時|記憶|記錄/)
  assert.equal(result.memorySources || null, null)
})

test('planner success criteria cannot introduce presentation requirements from historical requests', () => {
  assert.match(PLANNING_SYSTEM, /Do not add presentation requirements/)
  assert.match(PLANNING_SYSTEM, /source dates or correction history/)
  assert.match(PLANNING_SYSTEM, /Historical requests do not override the current request/)
  assert.ok(PLANNING_SYSTEM.length < 1800)
})

test('the standalone fast answer retains the preference and does not add recall or a helper', async t => {
  const { result, prompt } = await exercise(t, { message: 'Hello!', raw: 'Hello!', memory: {
    preferences: async () => preferences(), recall: async () => assert.fail('fast answer must not add recall')
  } })
  assert.equal(result.reply, 'Hello!')
  assert.ok(prompt.indexOf(marker) > prompt.indexOf(preference))
  assert.equal(prompt.split(marker).length - 1, 1)
})

test('non-chat writing formats are not changed by the chat contract', () => {
  const { forAnswer } = require('./responseWriting')
  for (const mode of ['email_draft', 'command', undefined]) assert.equal(forAnswer('Preserve the supplied full document.', mode), 'Preserve the supplied full document.')
})
