'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const fixture = require('./fixtures/contextIntegrationReplay.json')
const { enforceRouteEvidence } = require('./routeEvidenceGuard')

test('retained real self reply survives the guard without an unrelated source request', () => {
  const out = enforceRouteEvidence({ reply: fixture.selfFollowup.raw.reply, message: fixture.selfFollowup.message, evidenceSets: [] })
  assert.equal(out.reply, fixture.selfFollowup.raw.reply); assert.equal(out.violated, false)
})

test('business facts remain withheld inside mixed advice and elliptical clauses', () => {
  for (const reply of ['存貨，全部不足。建議做法是先核對。', '存貨，有3件。', '我可以查存貨，目前全部不足。', '存貨全部不足，建議做法是由我整理一份提案，等你批准後才執行。', '存貨有 1,000 件。建議先核對。']) {
    const out = enforceRouteEvidence({ reply, message: '看看再說', evidenceSets: [] })
    assert.equal(out.violated, true, reply); assert.ok(out.withheld.length > 0)
    assert.doesNotMatch(out.reply, /存貨有 1,000|存貨全部不足/)
  }
})

test('memory miss preserves the separately validated clarification instead of the raw unsupported alternative', async () => {
  const question = '你指的是哪一項安排？請補充主題或大約時間。'
  const gate = await require('./finalKnowledgeRequirement').runFinalKnowledgeRequirement({ message: fixture.missingMemory.message, history: [], verify: async () => ({ decision: 'require_memory', question }) })
  assert.equal(gate.question, question); assert.equal(gate.requiredWorlds, null)
  const reply = require('../memory/recallReply').missingRecallReply({ state: 'ok', count: 0 }, gate.question)
  assert.match(reply, /未找到|no matching/i); assert.ok(reply.includes(question))
  assert.doesNotMatch(reply, /每日採購/)
})

test('a missing verifier question still yields an honest minimal recall clarification', () => {
  const { missingRecallReply } = require('../memory/recallReply')
  for (const context of [{ state: 'ok', count: 0 }, { state: 'unavailable', count: null }]) {
    const reply = missingRecallReply(context)
    assert.match(reply, /[？?]/u); assert.doesNotMatch(reply, /每日採購/)
  }
  assert.equal(missingRecallReply({ state: 'ok', count: 2 }), null)
})

test('typed read outcomes outrank a heuristic file offer for all tested success and failure states', () => {
  const { explainOffer } = require('../routes/workRequestOffer')
  for (const state of ['completed', 'failed', 'needs_input']) {
    const out = explainOffer({ message: fixture.topicSwitch.message, response: { ...fixture.topicSwitch.response, website: { state } } })
    assert.equal(out.state, 'not_a_work_request'); assert.equal(out.clarification, undefined)
  }
  assert.equal(explainOffer({ message: '幫我改 docs/canary/agent-canary.md 的一句文字', response: { mode: 'ask', intent: 'unclear', reply: '哪一句？' } }).state, 'work_request_complete')
})

test('an ordinary answered question cannot become a file request just because it contains a change verb', () => {
  const { explainOffer } = require('../routes/workRequestOffer')
  for (const message of ['換個角度說明這個概念', 'Change the subject: explain gravity', fixture.topicSwitch.message]) {
    assert.equal(explainOffer({ message, response: { mode: 'chat', intent: 'question', reply: 'An answer.' } }).state, 'not_a_work_request')
  }
})

test('the served UI snapshots prior history before adding current input and retains intentional repeated history', () => {
  const source = fs.readFileSync(path.join(__dirname, '../demo/assets/app.js'), 'utf8')
  const match = source.match(/function priorHistoryForRequest\s*\(history\)\s*\{[^}]+\}/u)
  assert.ok(match, 'the real browser request boundary must be testable')
  const ctx = {}; vm.createContext(ctx); vm.runInContext(match[0], ctx)
  const history = [{ role: 'user', text: 'repeat' }, { role: 'assistant', text: 'ok' }, { role: 'user', text: 'repeat' }, { role: 'assistant', text: 'again' }]
  const prior = ctx.priorHistoryForRequest(history)
  history.push({ role: 'user', text: 'repeat' })
  assert.equal(prior.length, 4); assert.equal(prior.filter(h => h.role === 'user' && h.text === 'repeat').length, 2)
  assert.ok(source.indexOf('var priorHistory = priorHistoryForRequest(conv.history)') < source.indexOf("conv.history.push({ role: 'user', text: text })"))
  assert.equal((source.match(/history: priorHistory\b/g) || []).length, 2)
  assert.match(source, /var terminalRead = !!\(res\.website \|\| res\.investigation \|\| res\.error\)/)
  for (const card of ['workRequestOffer', 'workRequestResolution', 'workRequestClarification']) {
    assert.ok(source.includes(`if (res.${card} && !terminalRead)`), `${card} must not mask a typed read or error`)
  }
})
