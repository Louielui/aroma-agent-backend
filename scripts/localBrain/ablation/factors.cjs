'use strict'

const {classify}=require('../../../src/context/eval/semanticIntentShadow')
const {decomposeGoal}=require('../../../src/intake/goal/goalDecomposer')
const {buildWorkingContext}=require('../../../src/intake/goal/workingContext')
const {executiveFrameBlock}=require('../../../src/intake/goal/executiveFrame')
const {runFinalKnowledgeRequirement}=require('../../../src/intake/finalKnowledgeRequirement')
const {draftMessages,finishTool,READ_NAMES}=require('../../../src/localBrain/next/ablation/architecture')
const string={type:'string'}
const record=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false})
const ALLOW='allow_final'
const UNAVAILABLE='The requested information is unavailable in this isolated session. I cannot verify it from the supplied evidence.'
const TREATMENTS=Object.freeze({
  B:[], I:['intent'], II:['intent','intent_repeat'], G:['goal'], V:['verify'], S:['shape'], R:['read'],
  GV:['goal','verify'], GS:['goal','shape'], IR:['intent','read']
})

async function intentSignal(adapter,message){
  return classify(message,async ({system,prompt})=>{
    const outcome=await adapter.complete(prompt,{system,maxTokens:128,invocationPhase:'ablation_intent'})
    return outcome.text
  })
}
async function goalSignal(adapter,message,history){
  const out=await decomposeGoal({question:message,workingContext:buildWorkingContext(history),contextBlocks:[],
    callModel:({system,prompt,responseFormat})=>adapter.complete(prompt,{system,responseFormat,maxTokens:1536,invocationPhase:'ablation_goal'})})
  return {ok:out.ok,reason:out.reason,block:executiveFrameBlock(out.ok?out.plan:out.understanding)}
}
async function verifySignal(adapter,message,history,internal){
  return runFinalKnowledgeRequirement({message,history,availableWorlds:{internal,public:false},verify:async({ownerMessages,availableWorlds,system,schema})=>{
    const prompt='Messages Louie wrote himself (oldest to newest):\n'+ownerMessages.map((m,i)=>(i+1)+'. '+m).join('\n')+
      '\n\nReachable knowledge worlds — internal: '+(availableWorlds.internal?'yes':'no')+', public: no.'
    const outcome=await adapter.complete(prompt,{system,responseFormat:{type:"json_schema",schema},maxTokens:256,invocationPhase:'ablation_verify'})
    return outcome.text
  }})
}
async function runTreatment({id,adapter,messages,history,message,readTools,read,trace,onDelta}){
  const stages=TREATMENTS[id]
  if(!stages)throw Error('unknown_ablation_treatment')
  const B=stages.length===0
  let context=messages
  if(stages.includes('intent')){
    const signals=await Promise.all(Array.from({length:stages.includes('intent_repeat')?2:1},()=>intentSignal(adapter,message)))
    trace({type:'ablation_intent',signals})
    const [first]=signals
    if(first.confidence==='HIGH'&&signals.every(x=>x.candidate===first.candidate)&&first.candidate!=='NONE'){
      context=draftMessages(context,'A business-topic classifier suggested '+first.candidate+'. This is a tentative topic label, not proof of need, available evidence, or authority.')
    }
  }
  if(stages.includes('goal')){
    const goal=await goalSignal(adapter,message,history)
    trace({type:'ablation_goal',...goal})
    if(goal.block)context=draftMessages(context,goal.block)
  }
  const structured=stages.includes('shape')
  const reading=stages.includes('read')
  const checked=stages.includes('verify')
  const schema=structured?record({reply:string}):undefined
  const tools=reading?readTools:undefined
  const raw=await adapter.generate(context,{tools,schema,maxTokens:768,phase:'answer',
    onDelta:(B||!checked&&!structured&&!reading)?onDelta:undefined})
  let output={text:structured?JSON.parse(raw.text).reply:raw.text}
  if(raw.calls.length){
    if(!reading||raw.calls.length!==1||!READ_NAMES.has(raw.calls[0].name))throw Error('fixture_tool_not_authorized')
    output=await finishTool({adapter,messages:context,response:raw,readTools,read,trace,onDelta:checked?undefined:onDelta,route:'tool'})
  }
  if(checked){
    const verdict=await verifySignal(adapter,message,history,Boolean(output.source))
    trace({type:'ablation_verdict',verdict})
    return applyVerification(output,verdict)
  }
  return output
}

function applyVerification(output,verdict){
  if(!verdict.ok)return {text:UNAVAILABLE,evidenceOutcome:'verification_unavailable'}
  if(verdict.decision===ALLOW||(verdict.decision==='require_internal'&&output.source))return output
  return {text:verdict.question||UNAVAILABLE,evidenceOutcome:verdict.decision}
}

module.exports={runTreatment,TREATMENTS,verifySignal,applyVerification}
