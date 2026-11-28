'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {runHybrid}=require('./architecture')
const {runTreatment}=require('../../../../scripts/localBrain/ablation/factors.cjs')
const input=[{role:'system',content:'base'},{role:'user',content:'original'}]
const response=(text,calls=[])=>({text,calls})
const call=(name,args)=>({id:'test-id',name,args})

test('ordinary hybrid chat keeps original text and one model call',async()=>{
  let n=0
  const adapter={generate:async (message,options)=>{
    n++
    assert.deepEqual(message.at(-1),input.at(-1))
    assert.ok(options.tools.every(t=>!t.function.name.includes('write')))
    return response('line one\nline two')
  }}
  const seen=[]
  assert.deepEqual(await runHybrid({adapter,messages:input,readTools:[],trace:e=>seen.push(e)}),
    {text:'line one\nline two',route:'conversation'})
  assert.equal(n,1)
  assert.equal(seen[0].route,'conversation')
})

test('hybrid tool synthesis receives trusted calculated results, separate from chat authorization',async()=>{
  const payload={steps:[{id:'out',op:'percent',values:['15','40']}]}
  const adapter={generate:async (messages,{phase})=>{
    if(phase==='hybrid_admission')return response('',[call('calculate_exact',payload)])
    assert.equal(messages.at(-1).role,'tool')
    assert.equal(messages.at(-1).content,'{"out":"37.5"}')
    return response('37.5%')
  }}
  const trace=[]
  const result=await runHybrid({adapter,messages:input,trace:x=>trace.push(x),readTools:[]})
  assert.equal(result.text,'37.5%')
  assert.equal(result.route,'tool')
  assert.equal(trace[1].result.out,'37.5')
})

test('an injected model tool proposal cannot write or access ungranted records',async()=>{
  for(const name of ['propose_fixture_write','read_record','exec_shell']){
    let reads=0
    const adapter={generate:async()=>response('',[call(name,{id:'F-17'})])}
    await assert.rejects(runHybrid({adapter,messages:input,trace:()=>{},readTools:[],read:()=>reads++}),/not_authorized/)
    assert.equal(reads,0)
  }
})

test('old verification can withhold an answer without changing a permitted draft',async()=>{
  const args={id:'V',messages:input,history:[],message:'test',trace:()=>{},readTools:[]}
  const adapter={generate:async()=>response('pass\nthrough'),complete:async(_prompt,options)=>{
    assert.equal(options.responseFormat.type,'json_schema')
    return {text:'{"decision":"allow_final","question":null}'}
  }}
  assert.equal((await runTreatment({...args,adapter})).text,'pass\nthrough')
  adapter.complete=async()=>({text:'{"decision":"require_internal","question":null}'})
  const stopped=await runTreatment({...args,adapter})
  assert.equal(stopped.evidenceOutcome,'require_internal')
  assert.notEqual(stopped.text,'pass\nthrough')
})

test('provider tool text never becomes a visible final after a tool phase',async()=>{
  const adapter={generate:async(_,o)=>o.phase==='hybrid_admission'
    ?response('',[call('calculate_exact',{steps:[{id:'out',op:'add',values:['2','3']}]})])
    :response('<tool_call>fake payload</tool_call>')}
  await assert.rejects(runHybrid({adapter,messages:input,readTools:[],trace:()=>{}}),/hybrid_tool_text_refused/)
})
