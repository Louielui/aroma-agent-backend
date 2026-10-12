'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createMailScheduler } = require('./mailScheduler')
const { createTestStore } = require('../memory/structuredStore')
test('scheduler persists pause, respects foreground activity, and quota failures back off across restart', async () => {
  const store = createTestStore(); let now = Date.parse('2026-09-30T12:00:00Z'); let calls = 0; let busy = false
  const mailbox = { status: () => ({mailbox:'adm@example.test'}), lease: () => () => {} }
  const memory = { enabled: () => true, cancelAnalysis: () => {}, analyzeNext: async () => {calls++; throw Object.assign(Error('limited'),{code:'subscription_limit_reached'})} }
  const make = () => createMailScheduler({store,mailbox,memory,clock:()=>new Date(now).toISOString(),foreground:()=>busy})
  const s=make(); busy=true; await s.tick(); assert.equal(calls,0)
  busy=false; await s.tick(); assert.equal(calls,1); assert.equal((await s.status()).reason,'subscription_limit_reached')
  await make().tick(); assert.equal(calls,1)
  await s.control({owner:true},{paused:true,mode:'catchup'}); now+=7200000; await make().tick(); assert.equal(calls,1)
  await s.control({owner:true},{paused:false,mode:'balanced'}); await s.tick(); assert.equal(calls,2)
  await assert.rejects(s.control({owner:false},{paused:false,mode:'catchup'}), /denied/)
})

test('hourly budget survives restarts and one in five attempts is reserved for historical mail', async () => {
  const store = createTestStore(); let now = Date.parse('2026-09-30T12:00:00Z'); const attempts = []
  const mailbox = { status: () => ({mailbox:'adm@example.test'}), lease: () => () => {} }
  const memory = { enabled: () => true, cancelAnalysis: () => {}, analyzeNext: async (_, options) => { attempts.push(options.oldest); return {state:'ready'} } }
  const make = () => createMailScheduler({store,mailbox,memory,clock:()=>new Date(now).toISOString()})
  await make().control({owner:true},{paused:false,mode:'balanced'})
  for (let i=0;i<31;i++) { await make().tick(); now+=60000 }
  assert.equal(attempts.length,30); assert.equal(attempts.filter(Boolean).length,6)
  assert.equal((await make().status()).reason,'hourly_budget')
})

test('analysis deadlines begin after completion and semantic deferral does not consume the model budget', async () => {
  const store = createTestStore(); let now = Date.parse('2026-10-01T12:00:00Z'); let deferred = false; let background
  const mailbox = { status: () => ({mailbox:'adm@example.test'}), lease: () => () => {} }
  const memory = { enabled: () => true, cancelAnalysis: () => {}, analyzeNext: async (_, options) => {
    background = options.background
    if (deferred) return {state:'deferred',reason:'semantic_index_active'}
    now += 30000; return {state:'ready'}
  } }
  const scheduler = createMailScheduler({store,mailbox,memory,clock:()=>new Date(now).toISOString()})
  await scheduler.tick()
  assert.equal(Date.parse((await scheduler.status()).nextAt), now + 5000)
  assert.equal(background, true)
  const attempts = (await scheduler.status()).attempts
  deferred = true; now += 5000; await scheduler.tick()
  const status = await scheduler.status()
  assert.equal(status.attempts, attempts)
  assert.equal(status.reason, 'semantic_index_active')
  assert.equal(status.completed, 1)
})

test('a staggered persistence deadline retains waiting demand on the intermediate fixed timer tick', async () => {
  const store = createTestStore(); let now = Date.parse('2026-10-01T12:00:00Z'); const start = now; const requests=[]
  const commit=store.commit; store.commit=async(...args)=>{const result=await commit(...args);now+=2000;return result}
  const mailbox={status:()=>({mailbox:'adm@example.test'}),lease:()=>()=>{}}
  const memory={enabled:()=>true,cancelAnalysis:()=>{},backgroundAnalysisDemand:value=>requests.push(value),
    analyzeNext:async()=>({state:'deferred',reason:'semantic_index_active'})}
  const scheduler=createMailScheduler({store,mailbox,memory,clock:()=>new Date(now).toISOString()})
  await scheduler.tick();now=start+5000
  assert.ok(Date.parse((await scheduler.status()).nextAt)>now)
  await scheduler.tick()
  assert.equal(requests.at(-1),true,'intermediate timer withdrew an outstanding handoff')
  await scheduler.control({owner:true},{paused:true,mode:'catchup'})
  assert.equal(requests.at(-1),false)
})
