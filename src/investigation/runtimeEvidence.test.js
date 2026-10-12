'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { readSchedulerWitness, windowsCommand } = require('../home/schedulerWitness')
const { createBridge } = require('../subscription/bridge')
const { createBackendRuntimeReader } = require('./runtimeEvidence')
const at = '2026-10-07T20:00:00.000Z'
test('unknown found/result values cannot become absence or a successful Windows run', async () => {
  for (const value of [{}, {found:null}, {found:0}, {found:'false'}, []]) {
    const w = await readSchedulerWitness({exec:async()=>JSON.stringify(value),cache:false})
    assert.equal(w.state,'UNREADABLE'); assert.equal(w.scheduled,null)
  }
  const w = await readSchedulerWitness({exec:async()=>JSON.stringify({found:true,state:'Ready',lastRunTime:at,lastTaskResult:null}),cache:false})
  assert.equal(w.lastTaskResult,null); assert.equal(w.healthy,null)
})
test('Windows query preserves read failures and explicit UTC offsets',()=>{
  assert.doesNotMatch(windowsCommand,/SilentlyContinue/)
  assert.match(windowsCommand,/ToUniversalTime\(\)\.ToString\("o"\)/)
  assert.match(windowsCommand,/-ErrorAction Stop/)
})
test('live backend background status is light, role bound and never claims an idle queue is absent',async()=>{
  let statusReads=0
  const reader=createBackendRuntimeReader({clock:()=>at,
    mailMemory:{runtimeStatus:()=>({enabled:true,syncActive:false,analysisConnected:true,analysisActive:false,indexEnabled:true,indexActive:true})},
    mailScheduler:{status:async()=>({paused:false,reason:'foreground_busy',nextAt:at})},
    memory:{status:()=>({enabled:true,indexing:false,active:false,nextIndexAt:at})}})
  const r=await reader.read()
  assert.equal(statusReads,0)
  assert.equal(r.records.find(x=>x.role==='mail_index').currentRunningState,'active')
  assert.equal(r.records.find(x=>x.role==='mail_analysis').currentRunningState,'idle')
  assert.equal(r.records.find(x=>x.role==='mail_analysis').enabled,true)
  assert.equal(r.records.find(x=>x.role==='mail_analysis').reason,'foreground_busy')
  assert.equal(r.records.find(x=>x.role==='memory_index').model,null)
  assert.ok(r.records.every(x=>x.at===at&&x.evidenceBasis==='live_process_snapshot'))
  assert.equal(r.provesCharge,false)
})
test('missing background probes remain unknown rather than invented idle',async()=>{
  const r=await createBackendRuntimeReader({clock:()=>at}).read()
  assert.ok(r.records.length>=4)
  assert.ok(r.records.every(x=>x.currentRunningState==='unknown'&&x.enabled===null))
})
test('authenticated runtime metadata remains readable during memory inference without another model call',async t=>{
  let release,started; const entered=new Promise(r=>{started=r}); const pending=new Promise(r=>{release=r}); let calls=0
  const token='a'.repeat(64)
  const server=createBridge({token,clientOptions:{},memoryEnabled:true,backgroundModel:'claude-sonnet',
    claudeFn:async()=>{calls++;started();await pending;return {text:'ok',model:'claude-sonnet'}},
    schedulerReader:async()=>({state:'INSTALLED',scheduled:true,currentRunningState:'idle',readAt:Date.parse(at)})})
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close())
  const url='http://127.0.0.1:'+server.address().port
  const post=(route,body={},authorization='Bearer '+token)=>fetch(url+route,{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify(body)})
  const running=post('/v1/chat/completions',{messages:[{role:'user',content:'fixture'}]})
  await entered
  try {
    const response=await post('/runtime-metadata');assert.equal(response.status,200)
    const value=await response.json();assert.equal(value.scheduler.state,'INSTALLED')
    const row=value.records.find(x=>x.role==='memory_completion')
    assert.equal(row.currentRunningState,'active');assert.equal(row.model,'claude-sonnet');assert.equal(row.provider,'claude')
    assert.equal((await post('/runtime-metadata',{command:'Get-ScheduledTask'})).status,400)
    assert.equal((await post('/runtime-metadata',{},'Bearer bad')).status,401)
    assert.equal(calls,1)
  } finally { release();await running }
  const value=await(await post('/runtime-metadata')).json()
  assert.equal(value.records.find(x=>x.role==='memory_completion').currentRunningState,'idle');assert.equal(calls,1)
})
