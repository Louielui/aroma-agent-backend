'use strict'
const {LocalModelError,events}=require('../../src/adapters/LocalAdapter')
const {createAdapter}=require('../../src/localBrain/next/adapter')

let busy=false
process.on('message',async message=>{
  if(busy)return
  busy=true
  const {pin,history,input,mode}=message
  const url=new URL(pin.url)
  if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')throw Error('invalid_baseline_endpoint')
  require('../../src/localBrain/isolation').install({port:Number(url.port),tokenizerPort:Number(url.port),
    audit:event=>process.send?.({trace:event})})
  const emit=trace=>process.send?.({trace})
  emit.budget={sent:0,limit:12}
  const adapter=createAdapter(pin,{trace:emit})
  try{
    const evidence=require('../../src/intake/conversationEvidence').fromSavedConversation({messages:history},input)
    const fixture=require('../../src/localBrain/fixtures').createFixtureConnector({context:()=>emit})
    const a4=require('../../src/intake/a4Runtime').createA4RuntimeDependencies({env:process.env,localAdapterFactory:()=>adapter}).deps
    const memory={preferences:async()=>[],recall:async()=>[],get:async()=>null,ownerPrinciples:async()=>[],ownerHistory:async()=>[]}
    const result=await events.run(emit,()=>require('../../src/intake/intakeService').processIntake(input,adapter,history,{
      interactionMode:'chat',demo:true,viaRoute:'demo',manualLocalDialogue:true,ownerInvestigation:true,
      conversationEvidence:evidence,controlAdapter:adapter,memoryClient:memory,
      readContextDeps:{...a4,...(mode==='tools'?{connector:fixture}:{})},
      latencySink:(label,body)=>{try{emit({type:'pipeline_phase',label,...JSON.parse(body)})}catch{}}
    }))
    emit({type:'baseline_projection',result})
    process.send?.({result:{text:result.reply,blocked:Boolean(result.blocked),existingMode:result.mode}})
  }catch(error){
    const local=error instanceof LocalModelError?error:error.cause
    process.send?.({error:local?.code||'baseline_pipeline_failed'})
  }
})
