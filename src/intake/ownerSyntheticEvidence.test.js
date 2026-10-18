'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), {randomUUID} = require('node:crypto')
// Existing bounded runner + Context/Tool Gateway + Browser Read disk sink, not the guarded app.
for (const mode of ['synthetic_fixture','connected_source']) test('disk-reloaded runner event provenance: ' + mode, async () => {
  const fixture = require('../../scripts/r1/independentFixture.cjs').createFixture(fs.mkdtempSync(path.join(os.tmpdir(),'r1-evidence-')), { sharing: {goal:true,content:true,source:true} })
  const roots=Object.fromEntries(['config','data'].map(k=>[k,path.join(fixture.root,k)]))
  const registry=require('../company/access').createRegistry({file:path.join(roots.data,'company-access.json')})
  const adapters=require('../../scripts/r1/independentAdapters.cjs').createSyntheticAdapters()
  const audit=require('../core/operating/activityStore').createActivityStore({dir:path.join(roots.data,'activity'),workflow:'drive_context',reason:'synthetic_offline_investigation'})
  const choice={model:'gpt-6-astra',effort:'high'}
  // An injected response claiming the requested provider model is still synthetic.
  const request=async(...args)=>({...await adapters.request(...args),actualModel:choice.model})
  const integration=require('./ownerIntegration').createOwnerIntegration({liveContext:adapters.createContext({registry,audit,roots}),registry,enabled:()=>true,selection:()=>choice,request,evidenceMode:mode,env:{OWNER_TASK_GOAL_SHARING:'true',OWNER_TASK_CONTENT_SHARING:'true',CONTEXT_DRIVE_OPENAI:'on'}})
  const dir=path.join(roots.data,'browser-context-reads'),store=require('../browserRead/store').createStore(dir), record={id:randomUUID(),workflow:'browser_context_read',timeline:[]}
  const result=await integration.withOwner({conversationId:randomUUID()},()=>{},()=>integration.runner.run({question:'Find the synthetic tea record and summarize it.',adapter:integration.provider(choice),capabilities:integration.runner.describe(),actor:{id:'owner',role:'owner'},onEvent:e=>{record.timeline.push(e);store.save(record)}}))
  record.result=result; store.save(record)
  const loaded=require('../browserRead/store').createStore(dir).get(record.id)
  assert(loaded.timeline.some(e=>e.stage==='u2_synthesis_draft_received')); assert(loaded.timeline.some(e=>e.stage==='u2_synthesis_review_received'))
  assert(adapters.calls.length===2); assert(adapters.modelCalls.length>=3)
  for(const event of loaded.timeline) {
    if(mode==='synthetic_fixture') {
      assert.equal(event.executionMode,'synthetic_fixture',event.stage)
      assert.equal(event.requestedModel,choice.model,event.stage)
      assert.equal(event.verifiedActualModel,null,event.stage)
      assert.equal(event.modelInvocationVerified,false,event.stage)
      if(Object.hasOwn(event,'actualModel')) assert.equal(event.actualModel,'synthetic_fixture',event.stage)
      if(Object.hasOwn(event,'billing')) assert.equal(event.billing,'synthetic-not-verified')
    } else {
      assert.equal(event.executionMode,undefined,event.stage)
      if(['u2_synthesis_draft_received','u2_synthesis_review_received'].includes(event.stage)) assert.equal(event.actualModel,choice.model)
    }
  }
  if(mode==='synthetic_fixture') {
    assert.equal(loaded.result.actualModel,'synthetic_fixture')
    assert.equal(loaded.result.verifiedActualModel,null)
    assert.equal(loaded.result.modelInvocationVerified,false)
    assert.equal(loaded.result.evidence.synthesis.review.verifiedActualModel,null)
    assert(!JSON.stringify(loaded).includes('"actualModel":"gpt-6-astra"'))
  } else { assert.equal(loaded.result.executionProvenance,undefined); assert.equal(loaded.result.actualModel,choice.model) }
  if(process.env.R1_MINIMUM_EVIDENCE) fs.writeFileSync(path.join(process.env.R1_MINIMUM_EVIDENCE,mode+'-reload.json'),JSON.stringify({scope:'leaf_runner_disk_sink_contract_only; injected model, not actual subscription or guarded app',record:loaded,sourceCalls:adapters.calls,modelCalls:adapters.modelCalls.map(c=>({route:c.route,execution:c.execution}))},null,2),{flag:'wx'})
})
