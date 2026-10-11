'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { runWebsiteFlow, candidate, publicUrl } = require('./websiteFlow')

test('website intent uses owner context, dispatches, and returns measured result instead of a promise', async () => {
  const events = []; let dispatched = 0
  const result = await runWebsiteFlow({ message: '去business centre既網站', history: [{ role: 'user', text: '香香,幫我去costco的business centre' }, { role: 'assistant', text: 'SECRET FROM MEMORY' }],
    classify: async prompt => { assert.ok(prompt.includes('costco')); assert.ok(!prompt.includes('SECRET')); return { intent: 'navigate', target: 'costco的business centre',requestedOutput:'website_url' } },
    search: async target => { dispatched++; assert.equal(target, 'costco的business centre'); return { status: 'found', url: 'https://www.costcobusinesscentre.ca/', title: 'Costco Business Centre', searchCalls: 2, model: 'gpt-6-astra' } },
    record: e => events.push(e) })
  assert.equal(dispatched, 1); assert.match(result.reply, /https:\/\/www.costcobusinesscentre.ca\//)
  assert.deepEqual(events.map(e => e.state), ['classifying', 'searching', 'completed'])
  assert.equal(result.website.state, 'completed')
})
test('no dispatch for other intent, invented target, or private URLs; failures are terminal and visible', async () => {
  assert.equal(candidate('你好香香'), false); assert.equal(candidate('香香,幫我去costco的business centre'), true)
  for (const url of ['http://127.0.0.1', 'https://localhost', 'https://10.0.0.1', 'javascript:alert(1)', 'https://site.test/?token=secret', 'https://user:pass@example.com']) assert.equal(publicUrl(url), null)
  let calls = 0
  const options = { message: '去 example 網站', history: [], record: () => {}, search: async () => { calls++; throw Error('timeout') } }
  assert.equal(await runWebsiteFlow({ ...options, classify: async () => ({ intent: 'other', target: '' }) }), null)
  const invented = await runWebsiteFlow({ ...options, classify: async () => ({ intent: 'navigate', target: 'private secret',requestedOutput:'website_url' }) })
  assert.equal(invented.website.state, 'failed'); assert.equal(calls, 0)
  const failed = await runWebsiteFlow({ ...options, classify: async () => ({ intent: 'navigate', target: 'example',requestedOutput:'website_url' }) })
  assert.equal(failed.website.state, 'failed'); assert.ok(failed.reply); assert.equal(calls, 1)
})

test('a site mentioned as factual authority never dispatches the legacy link finder, even with a conflicting navigate label',async()=>{
 for(const requestedOutput of ['factual_answer','other',undefined]){
  const out=await runWebsiteFlow({message:'What are the opening hours according to the official website?',classify:async()=>({intent:'navigate',target:'official',requestedOutput}),search:()=>assert.fail('unexpected legacy search')})
  assert.equal(out,null)
 }
})
test('read switches and sensitive previous context stop before classification or web egress', async () => {
  const never = async () => { throw Error('must not call') }
  const base = { message: 'Open Costco website', classify: never, search: never }
  const disabled = await runWebsiteFlow({ ...base, readEnabled: false })
  assert.equal(disabled.website.reason, 'read_disabled')
  const sensitive = await runWebsiteFlow({ ...base, history: [{ role: 'user', text: 'my password is secret' }] })
  assert.equal(sensitive.website.state, 'needs_input'); assert.equal(sensitive.website.reason, 'sensitive_context')
})

test('subscription login failure is labelled as authentication rather than a failed website lookup',async()=>{
 const out=await runWebsiteFlow({message:'Opening hours according to the official website?',classify:async()=>{const error=Error('subscription_login_required');error.code='subscription_login_required';throw error},search:()=>assert.fail('unauthenticated search')})
 assert.equal(out.website.reason,'subscription_login_required');assert.match(out.reply,/訂閱.*登入|subscription.*sign.in/i);assert.doesNotMatch(out.reply,/沒有確認到可交付的網址/)
})
