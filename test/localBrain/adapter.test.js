'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const {LocalAdapter,endpoint}=require('../../src/adapters/LocalAdapter')
const stream=(rows)=>new Response(rows.map(r=>JSON.stringify(r)).join('\n')+'\n')
test('local endpoint rejects remote, credentials, paths and cloud names',()=>{
  for(const value of ['https://127.0.0.1:11435','http://localhost:11435','http://example.com','http://x:y@127.0.0.1','http://127.0.0.1/path'])assert.throws(()=>endpoint(value))
  assert.equal(endpoint('http://127.0.0.1:11435'),'http://127.0.0.1:11435')
  assert.throws(()=>new LocalAdapter({env:{LOCAL_MODEL:'qwen-cloud'}}))
  assert.throws(()=>new LocalAdapter({env:{LOCAL_MODEL:'other:8b',LOCAL_TOKENIZER_URL:'http://127.0.0.1:11436'}}))
})
test('streamed structured output retains timings and local attribution',async()=>{
  let sent;const events=[]
  const adapter=new LocalAdapter({env:{},onEvent:e=>events.push(e),fetchFn:async(url,opts)=>{
    sent=JSON.parse(opts.body);assert.equal(url,'http://127.0.0.1:11435/api/chat')
    return stream([{message:{content:'{"reply":'}},{message:{content:'"你好"}'}},{done:true,load_duration:2000000,prompt_eval_duration:3000000,eval_duration:4000000,prompt_eval_count:5,eval_count:6}])
  }})
  const result=await adapter.complete('hello',{system:'safe',maxTokens:100,responseFormat:{type:'json_schema',schema:{type:'object'}}})
  assert.equal(result.text,'{"reply":"你好"}');assert.equal(result.billing,'local');assert.equal(result.timing.loadMs,2)
  assert.equal(sent.keep_alive,-1);assert.equal(sent.think,false);assert.equal(sent.stream,true)
  assert.deepEqual(sent.format,{type:'object'});assert.equal(events.filter(e=>e.type==='model_delta').length,2)
  assert.ok(sent.messages[0].content.includes('HOST OUTPUT CONTRACT'))
  assert.ok(sent.messages[0].content.includes(JSON.stringify(sent.format)))
})
test('capacity, invalid budget and wrong tokenizer stop before inference',async()=>{
  let calls=0;const a=new LocalAdapter({env:{LOCAL_MODEL_CONTEXT:'2048'},fetchFn:async()=>{calls++;throw Error('not allowed')}})
  await assert.rejects(a.complete('x'.repeat(2048)),{code:'local_context_capacity_exceeded'})
  await assert.rejects(a.complete('x',{maxTokens:-1}),{code:'local_output_budget_invalid'});assert.equal(calls,0)
  const b=new LocalAdapter({env:{LOCAL_TOKENIZER_URL:'http://127.0.0.1:11436'},fetchFn:async()=>{calls++;return Response.json({tokens:1,model:'wrong'})}})
  await assert.rejects(b.complete('hello'),{code:'local_tokenizer_unavailable'});assert.equal(calls,1)
})
test('local failures never fallback or retry',async()=>{
  for(const response of [new Response('unavailable',{status:503}),stream([{message:{content:'{}'}}]),stream([{message:{content:'{}'}},{done:true,done_reason:'length'}])]){
    let calls=0;const a=new LocalAdapter({env:{},fetchFn:async()=>{calls++;return response}})
    await assert.rejects(a.complete('hello'),e=>e.localModelFailure===true);assert.equal(calls,1)
  }
})
test('global local mode overrides a pinned cloud chat lane',()=>{
  const saved={...process.env};try{
    process.env.LOCAL_BRAIN_ONLY='1';process.env.LLM_PROVIDER='claude';process.env.CLAUDE_CHAT_MODEL='claude-opus-5-5'
    assert.equal(require('../../src/adapters/adapterFactory').getAdapterForLane('chat').providerName,'local')
    assert.equal(require('../../src/adapters/liveEgressFence').liveEgressAllowed(),'false'===true)
  }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved)}
})
