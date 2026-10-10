'use strict'
const {TARGETS,ID,hash}=require('./contract'),{isValidId}=require('../store/conversationStore'),{t}=require('../i18n/t')
// This parser can only request a read or a proposal. No words, including "approved",
// authorize mutation. A conditional duplicate request always remains read-only.
function parseRequest(message){
 const s=String(message||''),exact=value=>new RegExp('(^|[^a-z0-9_-])'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^a-z0-9_-])','i').test(s),targets=TARGETS.filter(v=>exact(v.taskName)||exact(v.id))
 const candidate=targets.length>0||/排程|scheduled? tasks?|scheduler/i.test(s)
 const pause=/暫停|停用|\bpause|\bpausing|\bdisable/i.test(s),resume=/恢復|啟用|\bresume|\bresuming|\benable/i.test(s)
 const conditional=/如果|若|重複|不要|唔好|別|\bif\b|duplicat|\bnot\b|don['’]t|是否|會不會|\bwhat\b|\bwhy\b/i.test(s)
 return {candidate,targetId:targets.length===1?targets[0].id:null,action:!conditional&&pause!==resume&&targets.length===1?(pause?'scheduler.pause':'scheduler.resume'):null}
}
function createChatGateway({request,receipts,conversations}){
 const ongoing=new Set()
 const call=async b=>{const v=await request(b);if(v?.error)throw Error(v.error);return v}
 function contextOf(b){
  if(!isValidId(b.conversationId)||!ID.test(b.investigationId||''))throw Error('invalid_request')
  const r=receipts.get(b.investigationId),c=conversations.get(b.conversationId)
  if(r?.conversationId!==b.conversationId||r.state!=='completed'||r.investigation?.readOnly!==true||r.investigation.focus!=='background'||!c?.messages?.some(m=>m.role==='assistant'&&m.investigationRunId===r.id))throw Error('investigation_unavailable')
  return {conversationId:b.conversationId,investigationId:b.investigationId}
 }
 async function handle(b){
  const shapes={recommend:['op','conversationId','investigationId'],prepare_recommended:['op','conversationId','investigationId','inspectionId','targetId'],inspect:['op','conversationId','investigationId'],list:['op','conversationId','investigationId'],get:['op','conversationId','investigationId','id'],prepare:['op','conversationId','investigationId','targetId','action'],approve:['op','conversationId','investigationId','id','hash','nonce'],restore:['op','conversationId','investigationId','id']}
  if(!b||!Object.hasOwn(shapes,b.op)||Object.keys(b).sort().join(',')!==shapes[b.op].sort().join(','))throw Error('invalid_request')
  const context=contextOf(b)
  if(b.op==='inspect')return call({op:'inspect'})
  if(b.op==='prepare'){
   if(!TARGETS.some(t=>t.id===b.targetId)||!['scheduler.pause','scheduler.resume'].includes(b.action))throw Error('invalid_request')
   // Always reread, even when the Owner has spent minutes reading the report.
   const i=(await call({op:'inspect'})).inspection
   return call({op:'chat_prepare',inspectionId:i.id,targetId:b.targetId,action:b.action,context})
  }
  const body={...b,op:'chat_'+b.op,context};delete body.conversationId;delete body.investigationId
  return call(body)
 }
 async function start({message,conversationId,requestId}){
  if(!isValidId(conversationId)||!ID.test(requestId||''))throw Error('invalid_request')
  const parsed=parseRequest(message);if(!parsed.candidate)return null
  const requestHash=hash({message,conversationId}),prior=receipts.get(requestId)
  if(prior){if(prior.requestHash!==requestHash||prior.conversationId!==conversationId)throw Error('request_conflict');if(prior.state!=='completed')throw Error('investigation_unavailable');return {...prior.response,investigationRunId:requestId,replayed:true}}
  if(ongoing.has(conversationId))throw Error('request_conflict');ongoing.add(conversationId)
  try{
   receipts.begin(requestId,conversationId,requestHash)
   const i=(await call({op:'inspect'})).inspection
   const report={readOnly:true,focus:'background',goal:message,duplicateState:'UNKNOWN',sections:[{section:'schedules',state:i.observations.some(o=>o.state==='CONFIRMED')?'partial':'unavailable',sourceId:i.id,retrievedAt:new Date().toISOString(),records:i.observations.map(o=>({sourceId:o.target.id,state:o.state,taskName:o.target.taskName,...(o.snapshot?{enabled:o.snapshot.enabled,currentRunningState:o.snapshot.runtime,definitionHash:o.snapshot.definitionHash,at:o.snapshot.at}:{})}))}],persistenceState:'saved'}
   const result={mode:'chat',lane:'chat',reply:parsed.action?t('actions.chatPrepared'):t('actions.unknown'),investigation:report,investigationRunId:requestId,servedBy:null}
   receipts.finish(requestId,result)
   conversations.appendTurn({id:conversationId,userText:message,replyText:result.reply,investigationRunId:requestId})
   if(parsed.action){
    try{await call({op:'chat_prepare',inspectionId:i.id,targetId:parsed.targetId,action:parsed.action,context:contextOf({conversationId,investigationId:requestId})})}
    catch(_){result.reply=t('actions.chatRefused')}
   }
   return result
  }catch(e){try{receipts.finish(requestId,null,true)}catch(_){}throw e}finally{ongoing.delete(conversationId)}
 }
 // Broad investigative questions still use the existing multi-source reasoning pipeline.
 return {candidate:message=>!!parseRequest(message).action,handle,start}
}
module.exports={createChatGateway,parseRequest}
