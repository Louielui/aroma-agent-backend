'use strict'
const test=require('node:test'), assert=require('node:assert/strict')
const {strataFrames,ollamaFrames,assertSchema}=require('./adapter')
const {readTool,permit,createSession}=require('./dialogue')
test('SSE requires both a successful finish and terminal frame',()=>{
  const frames=strataFrames('x')
  frames.consume('data: {"model":"x","choices":[{"delta":{"content":"hello"},"finish_reason":null}]}')
  assert.throws(()=>frames.finish(),/incomplete/)
  frames.consume('data: {"model":"x","choices":[{"delta":{},"finish_reason":"stop"}]}')
  assert.throws(()=>frames.finish(),/incomplete/)
  frames.consume('data: [DONE]')
  assert.equal(frames.finish().text,'hello')
})
test('natively labelled unavailable or substitute model fails closed',()=>{
  const frames=ollamaFrames('baseline')
  assert.throws(()=>frames.consume('{"model":"substitute","done":true}'),/model_mismatch/)
})
test('schema check refuses unexpected fields and malformed numbers',()=>{
  const schema={type:'object',properties:{n:{type:'integer'}},required:['n'],additionalProperties:false}
  assert.deepEqual(assertSchema('{"n":2}',schema),{n:2})
  assert.throws(()=>assertSchema('{"n":2,"action":"send"}',schema),/schema/)
  assert.throws(()=>assertSchema('{"n":2.5}',schema),/schema/)
})
test('read-only tool registry uses explicit names and exact fixture IDs',()=>{
  assert.throws(()=>readTool({name:'read_record',args:{id:'owner-secret'}}),/not_available/)
  assert.throws(()=>readTool({name:'write_record',args:{id:'F-17'}}),/not_authorized/)
})
test('a chat utterance cannot consume an owner approval',()=>{
  const session=createSession()
  session.pending={id:'p',name:'propose_fixture_write',args:{id:'F-17',note:'new'}}
  assert.throws(()=>permit(session,'好'),/approval/)
  assert.equal(session.pending.id,'p')
  const applied=permit(session,'p')
  assert.equal(applied.executed,'fixture_only')
  assert.throws(()=>permit(session,'p'),/approval/)
})

test('ordinary lightweight chat makes one request and preserves all roles and exact final text',async t=>{
  const http=require('node:http')
  const captured=[]
  const server=http.createServer(async(req,res)=>{
    let buf=''
    for await(const part of req)buf+=part
    captured.push(JSON.parse(buf))
    res.write('data: {"model":"mock","choices":[{"delta":{"content":"第一行\\n"},"finish_reason":null}]}\n\n')
    res.write('data: {"model":"mock","choices":[{"delta":{"content":"第二行"},"finish_reason":null}]}\n\n')
    res.end('data: {"model":"mock","choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>server.close())
  const pin={url:'http://127.0.0.1:'+server.address().port,engine:'strata',model:'mock'}
  const {turn}=require('./dialogue')
  const session=createSession()
  session.history.push({role:'user',content:'前文'},{role:'assistant',content:'保存內容'})
  const result=await turn({arm:'B',session,message:'沿用',manager:{withEngine:(kind,fn)=>fn(pin)}})
  assert.equal(result.calls,1)
  assert.equal(captured.length,1)
  assert.deepEqual(captured[0].messages.slice(1),[{role:'user',content:'前文'},{role:'assistant',content:'保存內容'},{role:'user',content:'沿用'}])
  assert.equal(captured[0].tools,undefined)
  assert.equal(result.text,'第一行\n第二行')
  await assert.rejects(()=>turn({arm:'D',session,message:'沿用',manager:{withEngine(){throw Error('inference must not happen')}}}),/conversation_model_mismatch/)
})
test('a cancelled or truncated response is never emitted as a successful final',()=>{
  const frame=strataFrames('x')
  frame.consume('data: {"model":"x","choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}')
  frame.consume('data: [DONE]')
  assert.throws(()=>frame.finish(),/local_output_limit/)
})
test('registered reads have disjoint fixture scopes',()=>{
  assert.equal(readTool({name:'read_record',args:{id:'F-17'}}).stockKg,8.4)
  assert.equal(readTool({name:'read_memory',args:{id:'M-44'}}).synthetic,true)
  assert.throws(()=>readTool({name:'read_record',args:{id:'M-44'}}),/not_available/)
  assert.throws(()=>readTool({name:'read_record',args:{id:'F-17',extra:'x'}}),/invalid/)
})


test('isolated C keeps the original A4 contracts while routing its verifier through the engine adapter',async()=>{
  const {createA4RuntimeDependencies}=require('../../intake/a4Runtime')
  const scopes=[]
  const adapter={complete:async(prompt,opts)=>{
    scopes.push({phase:opts.invocationPhase,schema:opts.responseFormat?.type,prompt})
    return {text:'{"decision":"allow_final","question":null}'}
  }}
  const result=createA4RuntimeDependencies({env:{LOCAL_BRAIN_ONLY:'1',CHAT_BACKEND:'local',A4_KNOWLEDGE_ROUTING:'on'},localAdapterFactory:()=>adapter})
  assert.equal(await result.deps.finalVerifier({ownerMessages:['sample'],availableWorlds:{},system:'verify',schema:{type:'object'}}),'{"decision":"allow_final","question":null}')
  assert.deepEqual(scopes.map(x=>[x.phase,x.schema]),[['final_verification','json_schema']])
  assert.match(scopes[0].prompt,/sample/)
})
