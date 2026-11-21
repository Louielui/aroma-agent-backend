'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createDailyDialogue } = require('./dailyDialogue')
const { LocalAdapter } = require('../adapters/LocalAdapter')
const profile = require('./deploymentProfile.json')

function fixture(t) {
  let now = 100000
  const commit = 'a'.repeat(40), id = randomUUID(), conversation = randomUUID()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-dialogue-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const open = () => createDailyDialogue({ dir, now: () => now, runtimeCommit: () => commit })
  const sends = []
  const adapter = new LocalAdapter({ env: {LOCAL_MODEL:profile.model,LOCAL_MODEL_DIGEST:profile.digest},
    async fetchFn(url, options) {
      if (url.endsWith('/api/tags')) return Response.json({ models: [{name:profile.model,digest:profile.digest}] })
      assert.equal(url, profile.endpoint + '/api/chat')
      sends.push(JSON.parse(options.body).messages)
      return new Response(JSON.stringify({done:true,message:{content:'{"reply":"mock reply"}'}})+'\n')
    } })
  const dialogue = open()
  const turn = (prompt, service = dialogue) => service.run(conversation, randomUUID(), () => adapter.complete(prompt, {invocationPhase:'answer'}))
  const activate = (limit = 3) => dialogue.activate({id,commit,limit,windowMs:60000})
  return {dialogue, open, turn, activate, sends, dir, id, commit, conversation, expire:()=>{now+=60000}}
}
test('default off, mock multi-turn local replies, durable ceiling across restart plus pause',async t=>{
  const f=fixture(t)
  await assert.rejects(f.turn('first'),/usage_not_enabled/)
  assert.deepEqual(fs.readdirSync(f.dir),[])
  f.activate(2)
  assert.equal((await f.turn('first')).text,'{"reply":"mock reply"}')
  assert.equal((await f.turn('first / mock reply / second',f.open())).text,'{"reply":"mock reply"}')
  await assert.rejects(f.turn('third'),/usage_limit_reached/)
  assert.equal(f.sends.length,2)
  assert.equal(f.open().status().helper.dispatched,2)
  f.dialogue.pause(f.id)
  assert.equal(f.open().status().state,'paused')
  await assert.rejects(f.turn('after pause'),/usage_run_not_active/)
  assert.throws(()=>f.activate(2),/usage_attempt_replayed/)
})
test('expiry, invalid cap and wrong source fail before inference',async t=>{
  const f=fixture(t)
  for(const limit of [0,1.5,-1,Number.MAX_SAFE_INTEGER])assert.throws(()=>f.activate(limit))
  assert.throws(()=>f.dialogue.activate({id:f.id,commit:'b'.repeat(40),limit:2,windowMs:60000}),/usage_binding_conflict/)
  f.activate(); f.expire()
  await assert.rejects(f.turn('late'),/usage_expired/)
  assert.equal(f.sends.length,0)
})
test('an Owner pause closes admission immediately while an earlier turn is still draining',async t=>{
  const f=fixture(t);f.activate()
  let finish
  const pending=f.dialogue.run(f.conversation,randomUUID(),()=>new Promise(resolve=>{finish=resolve}))
  f.open().pause(f.id)
  try {
    const prior=f.dialogue.status()
    assert.equal(prior.turnsUsed,1)
    await assert.rejects(f.turn('later browser press',f.open()),{code:'usage_run_not_active'})
    assert.equal(f.dialogue.status().turnsUsed,prior.turnsUsed)
    assert.equal(f.sends.length,0)
  } finally {finish();await pending}
  assert.equal(f.dialogue.status().state,'paused')
})
test('pause after reservation blocks the native send and retains spent capacity and evidence',async t=>{
  const f=fixture(t);f.activate()
  await f.dialogue.run(f.conversation,randomUUID(),()=>{
    const usage=require('../actions/usageBudget')
    const p=usage.nativePermit('helper',{model:profile.model,digest:profile.digest,effort:'auto',phase:'answer'}).permit
    p.capture('local_model_input',{text:'private synthetic marker'})
    f.open().pause(f.id)
    assert.throws(()=>p.dispatched('local_http_send'),/usage_stopped/)
    p.finish(Error('usage_stopped'))
  })
  const row=f.open().status()
  assert.equal(row.state,'paused')
  assert.equal(row.helper.reserved,1)
  assert.equal(row.helper.dispatched,0)
  assert.ok(row.timeline.some(e=>e.event==='evidence_digest'&&e.bytes>0&&/^[a-f0-9]{64}$/.test(e.sha256)))
  assert.ok(!JSON.stringify(row).includes('private synthetic marker'))
  assert.ok(!fs.existsSync(path.join(f.dir,'evidence')))
})
test('parallel turns share reservations and protected phases cannot borrow daily capacity', async t=>{
  const f=fixture(t);f.activate(2)
  const results=await Promise.allSettled([f.turn('a'),f.turn('b'),f.turn('c')])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,2)
  assert.equal(f.open().status().helper.reserved,2)
  assert.equal(f.sends.length,2)
})
test('coding, memory, website and cloud requests cannot spend the daily allowance', async t=>{
  const f=fixture(t);f.activate(8)
  const usage=require('../actions/usageBudget')
  for(const [kind,phase,model] of [['helper','local_coding',profile.model],['helper','memory_extract',profile.model],['website','answer',profile.model],['helper','answer','other']]){
    await assert.rejects(f.dialogue.run(f.conversation,randomUUID(),()=>usage.nativePermit(kind,{model,phase,digest:profile.digest,effort:'auto'})),/usage_(operation|model)_not_allowed/)
  }
  assert.equal(f.open().status().helper.reserved,0)
})
