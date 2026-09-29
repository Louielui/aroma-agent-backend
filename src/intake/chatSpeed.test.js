'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { canUseSocialFastPath, profileFor } = require('./chatSpeed')
const { processIntake } = require('./intakeService')

test('profiles map to explicit efforts and reject arbitrary execution settings', () => {
  assert.deepEqual(['fast', 'standard', 'deep'].map(level => profileFor(level).effort), ['low', 'medium', 'high'])
  assert.equal(profileFor().level, 'fast')
  for (const input of ['ultra', 'constructor', {}, null]) assert.throws(() => profileFor(input))
})

test('only standalone social turns with no earlier conversation or attached context qualify', () => {
  const route = { route: 'CONVERSATION' }
  for (const message of ['你好', '你好香香', 'Hello!', 'thanks']) {
    assert.equal(canUseSocialFastPath(message, route, [], {}), true)
    assert.equal(canUseSocialFastPath(message, route, [{role:'user',text:message}], {}), true)
    assert.equal(canUseSocialFastPath(message, route, [{role:'assistant',text:'Approve the order?'}], {}), false)
    assert.equal(canUseSocialFastPath(message, route, [], {contextCard:{}}), false)
    assert.equal(canUseSocialFastPath(message, route, [], {sectionPreamble:'attached work'}), false)
  }
  for (const message of ['你好，批准採購', '你好香香，查庫存', 'yes', '幫我寄信', '今天有甚麼安排']) assert.equal(canUseSocialFastPath(message, route, [], {}), false)
})

test('HTTP validates levels before model acquisition and passes them only to chat', async t => {
  const express = require('express')
  const { createDemoRouter } = require('../routes/demoRouter')
  const app = express(); app.use(express.json()); app.locals.conversationDemo = true
  const seen = []; let acquisitions = 0
  app.use(createDemoRouter({ getAdapterFn: () => { acquisitions++; return {} }, processIntakeFn: async (m, a, h, opts) => {
    seen.push(opts); return {mode:'chat', reply:'fixture', tasks:[]}
  } }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const send = body => fetch('http://127.0.0.1:' + server.address().port + '/api/v1/demo/intake', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  for (const chatLevel of ['ultra', null, {}]) assert.equal((await send({message:'hello',chatLevel})).status,400)
  assert.equal(acquisitions,0)
  for (const chatLevel of ['fast','standard','deep']) {
    assert.equal((await send({message:'hello',chatLevel})).status,200)
    assert.equal(seen.at(-1).chatLevel,chatLevel)
  }
  await send({message:'hello',interactionMode:'email_draft',chatLevel:'deep'})
  assert.equal(seen.at(-1).chatLevel,undefined)
})

test('subscription social turn uses one answer call and no control model, recall, read or verifier', async () => {
  const saved = {...process.env}
  Object.assign(process.env, { CHAT_BACKEND:'codex-subscription', TURN_ROUTER:'on', READ_ACCESS:'on', CONTEXT_AROMA_SYSTEM:'on', GOAL_DECOMPOSER:'on', A4_KNOWLEDGE_ROUTING:'on' })
  let answers = 0; let auxiliary = 0
  const denied = async () => { auxiliary++; throw Error('unexpected auxiliary call') }
  const gpt = {preflight:async()=>{}, complete:async()=>{ answers++; return {text:JSON.stringify({intent:'chit_chat',mode:'chat',reply:'你好，Chef。',nextRead:null}),model:'gpt-6-astra',billing:'chatgpt-subscription'} }}
  try {
    const result = await processIntake('你好香香', {complete:denied}, [{role:'user',text:'你好香香'}], {
      demo:true,interactionMode:'chat',openaiAdapter:gpt,controlAdapter:{complete:denied},semanticCallModel:denied,
      decisionRecallDeps:{listDecisionsFn:denied,listTasksFn:denied},
      readContextDeps:{finalVerifier:denied,connector:{read:denied}}
    })
    assert.equal(result.reply,'你好，Chef。')
    assert.equal(answers,1)
    assert.equal(auxiliary,0)
  } finally { for(const k of Object.keys(process.env)) if(!(k in saved)) delete process.env[k]; Object.assign(process.env,saved) }
})
