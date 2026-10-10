'use strict'
const {TARGETS,ID,hash}=require('./contract'),{isValidId}=require('../store/conversationStore'),{t}=require('../i18n/t')
const REPLIES={
 'actions.continuationExplicit':()=>t('actions.continuationExplicit'),
 'actions.continuationMultiple':()=>t('actions.continuationMultiple'),
 'actions.continuationNoContext':()=>t('actions.continuationNoContext'),
 'actions.continuationPending':()=>t('actions.continuationPending'),
 'actions.continuationVerified':()=>t('actions.continuationVerified'),
 'actions.continuationUncertain':()=>t('actions.continuationUncertain'),
 'actions.continuationExpired':()=>t('actions.continuationExpired'),
 'actions.continuationInverse':()=>t('actions.continuationInverse'),
 'actions.continuationMismatch':()=>t('actions.continuationMismatch'),
 'actions.continuationNotDisplayed':()=>t('actions.continuationNotDisplayed')
}
// Initial requests only prepare proposals. Continuations below use a closed,
// anchored grammar and the stored, displayed exact proposal, never model output.
function parseRequest(message){
 const s=String(message||''),exact=value=>new RegExp('(^|[^a-z0-9_-])'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^a-z0-9_-])','i').test(s),targets=TARGETS.filter(v=>exact(v.taskName)||exact(v.id))
 const candidate=targets.length>0||/排程|scheduled? tasks?|scheduler/i.test(s)
 const pause=/暫停|停用|\bpause|\bpausing|\bdisable/i.test(s),resume=/恢復|啟用|\bresume|\bresuming|\benable/i.test(s)
 const conditional=/如果|若|重複|不要|唔好|別|\bif\b|duplicat|\bnot\b|don['’]t|是否|會不會|\bwhat\b|\bwhy\b/i.test(s)
 return {candidate,targetId:targets.length===1?targets[0].id:null,action:!conditional&&pause!==resume&&targets.length===1?(pause?'scheduler.pause':'scheduler.resume'):null}
}
function parseContinuation(message){
 const s=String(message||'').trim().replace(/[。.!！?？]$/,'').trim()
 if(/^(確認|批准)(剛才|剛剛)(那個|的)?(暫停|停用)方案$/.test(s)||/^I (confirm|approve) (the )?(previous|last) pause proposal$/i.test(s))return {kind:'approve',capability:'scheduler.pause'}
 if(/^(確認|批准)(剛才|剛剛)(那個|的)?(恢復|啟用)方案$/.test(s)||/^I (confirm|approve) (the )?(previous|last) resume proposal$/i.test(s))return {kind:'approve',capability:'scheduler.resume'}
 if(/^(確認|批准)(剛才|剛剛)(那個|的)?方案$/.test(s)||/^I (confirm|approve) (the )?(previous|last) proposal$/i.test(s))return {kind:'approve'}
 if(/^(做完了嗎|完成了嗎|查看結果|查看成果|現在進度|剛才那個任務完成了嗎)$/.test(s)||/^(did it finish|is it done|what is the status|show the result)$/i.test(s))return {kind:'status'}
 if(/^(恢復|還原)(剛才|剛剛)(那個|的)?排程$/.test(s)||/^(restore|resume) (the )?(previous|last) schedule$/i.test(s))return {kind:'restore'}
 if(/^(好|好的|開始|確認|批准|yes|ok|okay|confirm|approved|go ahead)$/i.test(s))return {kind:'ambiguous'}
 return null
}
function createChatGateway({request,receipts,conversations,providerFor,semanticTimeoutMs=60000,semanticStore=require('./store').createStore({dir:require('node:path').join(require('../store/dataDir').resolveDataDir(),'scheduler-understanding-receipts')}),continuationStore=require('./store').createStore({dir:require('node:path').join(require('../store/dataDir').resolveDataDir(),'scheduler-dialogue-receipts')}),now=()=>Date.now()}){
 const ongoing=new Set()
 const call=async b=>{const v=await request(b);if(v?.error)throw Error(v.error);return v}
 function contextOf(b){
  if(!isValidId(b.conversationId)||!ID.test(b.investigationId||''))throw Error('invalid_request')
  const r=receipts.get(b.investigationId),c=conversations.get(b.conversationId)
  if(r?.conversationId!==b.conversationId||r.state!=='completed'||r.investigation?.readOnly!==true||r.investigation.focus!=='background'||!c?.messages?.some(m=>m.role==='assistant'&&m.investigationRunId===r.id))throw Error('investigation_unavailable')
  return {conversationId:b.conversationId,investigationId:b.investigationId}
 }
 async function handle(b){
  const shapes={present:['op','conversationId','investigationId','id','hash'],recommend:['op','conversationId','investigationId'],prepare_recommended:['op','conversationId','investigationId','inspectionId','targetId'],inspect:['op','conversationId','investigationId'],list:['op','conversationId','investigationId'],get:['op','conversationId','investigationId','id'],prepare:['op','conversationId','investigationId','targetId','action'],approve:['op','conversationId','investigationId','id','hash','nonce'],restore:['op','conversationId','investigationId','id']}
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
 function latestContext(conversationId){
  if(!isValidId(conversationId))return null
  const c=conversations.get(conversationId),last=c?.messages?.filter(m=>m.role==='assistant').at(-1)
  if(!last?.investigationRunId)return null
  try{return contextOf({conversationId,investigationId:last.investigationRunId})}catch(_){return null}
 }
 async function continueTurn({message,conversationId,requestId},parsed){
  const requestHash=hash({message,conversationId}),prior=continuationStore.get(requestId)
  if(receipts.get(requestId))throw Error('request_conflict')
  if(prior){
   if(prior.requestHash!==requestHash||prior.conversationId!==conversationId)throw Error('request_conflict')
   if(prior.state!=='completed')throw Error('action_unavailable')
   return {...prior.response,replayed:true}
  }
  const receipt={id:requestId,conversationId,requestHash,state:'started',kind:parsed.kind,readOnly:parsed.kind!=='approve',timeline:[{phase:'received',at:new Date(now()).toISOString()}],createdAt:new Date(now()).toISOString()}
  continuationStore.save(receipt)
  const context=latestContext(conversationId)
  const result={mode:'chat',lane:'chat',servedBy:null,reply:t('actions.continuationNoContext')}
  function explain(key,run){result.reply=REPLIES[key]();if(run){result.reply+='\n'+run.target.taskPath+run.target.taskName;if(run.state==='verified'&&run.after?.at)result.reply+='\n'+t('actions.checkedAt',{at:run.after.at});result.actionContinuation={id:run.id,state:run.state,readOnly:receipt.readOnly}}}
  try{
   if(context){
    result.investigationRunId=context.investigationId
    const all=(await call({op:'list'})).runs.filter(r=>r.target&&r.context?.conversationId===conversationId&&['scheduler.pause','scheduler.resume'].includes(r.capability))
    const live=all.filter(r=>r.state==='awaiting_approval'&&r.expiresAt>now())
    const rows=all.filter(r=>r.context.investigationId===context.investigationId)
    const leaves=rows.filter(r=>!rows.some(v=>v.restoreOf===r.id))
    const pending=live.filter(r=>r.context.investigationId===context.investigationId)
    const run=pending.length===1?pending[0]:leaves.length===1?leaves[0]:null
    if(run){receipt.context=context;receipt.proposalId=run.id;receipt.proposalHash=run.hash;receipt.timeline.push({phase:'bound',at:new Date(now()).toISOString()});continuationStore.save(receipt)}
    if(parsed.kind==='ambiguous')explain('actions.continuationExplicit')
    else if(live.length>1||leaves.length>1)explain('actions.continuationMultiple')
    else if(!run)explain('actions.continuationNoContext')
    else if(parsed.kind==='status')explain(run.state==='verified'?'actions.continuationVerified':run.state==='awaiting_approval'?(run.expiresAt>now()?'actions.continuationPending':'actions.continuationExpired'):'actions.continuationUncertain',run)
    else if(parsed.kind==='restore'){
     if(run.state==='awaiting_approval')explain('actions.continuationPending',run)
     else if(run.state!=='verified')explain('actions.continuationUncertain',run)
     else{const inverse=(await call({op:'chat_restore',id:run.id,context})).run;explain('actions.continuationInverse',inverse)}
    }else if(parsed.capability&&parsed.capability!==run.capability)explain('actions.continuationMismatch',run)
    else if(run.state==='verified')explain('actions.continuationVerified',run)
    else if(run.state!=='awaiting_approval')explain('actions.continuationUncertain',run)
    else if(run.expiresAt<=now())explain('actions.continuationExpired',run)
    else if(live.some(r=>r.context.investigationId!==context.investigationId))explain('actions.continuationMultiple')
    else{
     try{const done=(await call({op:'chat_approve_displayed',context,id:run.id,hash:run.hash})).run;explain(done.state==='verified'?'actions.continuationVerified':'actions.continuationUncertain',done)}
     catch(e){
      if(e.message==='presentation_required')explain('actions.continuationNotDisplayed',run)
      else if(e.message==='approval_unavailable')explain('actions.continuationExpired',run)
      else explain('actions.continuationUncertain',{...run,state:'outcome_unknown'})
     }
    }
   }
   // A durable request receipt precedes dispatch. A lost response is never retried.
   receipt.state='completed';receipt.response=result;receipt.timeline.push({phase:'completed',at:new Date(now()).toISOString()});continuationStore.save(receipt)
   conversations.appendTurn({id:conversationId,userText:message,replyText:result.reply,investigationRunId:result.investigationRunId})
   return result
  }catch(e){receipt.state='interrupted';continuationStore.save(receipt);throw e}
 }
 async function start(input){
  const {message,conversationId,requestId}=input
  if(!isValidId(conversationId)||!ID.test(requestId||''))throw Error('invalid_request')
  if(semanticStore.get(requestId))return semanticTurn(input)
  const continuation=parseContinuation(message)
  if(continuation){
   if(ongoing.has(conversationId))throw Error('request_conflict');ongoing.add(conversationId)
   try{return await continueTurn({message,conversationId,requestId},continuation)}finally{ongoing.delete(conversationId)}
  }
  const parsed=parseRequest(message)
  if(!parsed.action && providerFor && (latestContext(conversationId)||require('./understanding').surface(message)))return semanticTurn(input)
  if(!parsed.candidate)return null
  return prepareTurn(input,parsed)
 }
 async function prepareTurn({message,conversationId,requestId},parsed){
  if(continuationStore.get(requestId))throw Error('request_conflict')
  const requestHash=hash({message,conversationId}),prior=receipts.get(requestId)
  if(prior){if(prior.requestHash!==requestHash||prior.conversationId!==conversationId)throw Error('request_conflict');if(prior.state!=='completed')throw Error('investigation_unavailable');return {...prior.response,investigationRunId:requestId,replayed:true}}
  if(ongoing.has(conversationId))throw Error('request_conflict');ongoing.add(conversationId)
  try{
   receipts.begin(requestId,conversationId,requestHash)
   const i=(await call({op:'inspect'})).inspection
   const report={readOnly:true,focus:'background',goal:message,duplicateState:'UNKNOWN',sections:[{section:'schedules',state:i.observations.some(o=>o.state==='CONFIRMED')?'partial':'unavailable',sourceId:i.id,retrievedAt:new Date().toISOString(),records:i.observations.map(o=>({sourceId:o.target.id,state:o.state,taskName:o.target.taskName,...(o.snapshot?{enabled:o.snapshot.enabled,currentRunningState:o.snapshot.runtime,definitionHash:o.snapshot.definitionHash,at:o.snapshot.at}:{})}))}],persistenceState:'saved'}
   const result={mode:'chat',lane:'chat',reply:parsed.action?t('actions.chatPrepared'):t('actions.unknown'),investigation:report,investigationRunId:requestId,servedBy:null}
   if(parsed.action){
    try{await call({op:'chat_prepare',inspectionId:i.id,targetId:parsed.targetId,action:parsed.action,context:{conversationId,investigationId:requestId}})}
    catch(_){result.reply=t('actions.chatRefused')}
   }
   receipts.finish(requestId,result)
   conversations.appendTurn({id:conversationId,userText:message,replyText:result.reply,investigationRunId:requestId})
   return result
  }catch(e){try{receipts.finish(requestId,null,true)}catch(_){}throw e}finally{ongoing.delete(conversationId)}
 }
 async function semanticTurn(input){
  const {message,conversationId,requestId,model=require('../subscription/chatModels').DEFAULT_BRAIN_MODEL,effort='medium'}=input
  const identity=hash({message,conversationId,model,effort}),old=semanticStore.get(requestId)
  if(old){
   if(old.identity!==identity)throw Error('request_conflict')
   if(old.state!=='completed')throw Error('action_unavailable')
   return old.response?{...old.response,replayed:true}:null
  }
  if(receipts.get(requestId)||continuationStore.get(requestId)||ongoing.has(conversationId))throw Error('request_conflict')
  const before=conversations.get(conversationId),context=latestContext(conversationId)
  const receipt={id:requestId,conversationId,identity,state:'interpreting',model,effort,readOnly:true,timeline:[{phase:'interpreting',at:new Date(now()).toISOString()}]}
  semanticStore.save(receipt);ongoing.add(conversationId)
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),semanticTimeoutMs)
  let abortListener
  try{
   const all=context?(await call({op:'list'})).runs.filter(r=>r.context?.conversationId===conversationId):[]
   const rows=context?all.filter(r=>r.context?.investigationId===context.investigationId):[]
   const leaves=rows.filter(r=>!rows.some(v=>v.restoreOf===r.id))
   const live=all.filter(r=>r.state==='awaiting_approval'&&r.expiresAt>now())
   const run=leaves.length===1&&live.length<=1?leaves[0]:null
   const currentAction=run?{targetId:run.target.id,taskName:run.target.taskName,capability:run.capability,state:run.state}:null
   const {SCHEMA,SYSTEM,admit,resolveTarget}=require('./understanding')
   const pending=providerFor({model,effort}).complete(JSON.stringify({currentMessage:message,currentAction,catalogue:TARGETS.map(t=>({id:t.id,taskName:t.taskName,effect:t.effect,capabilities:['scheduler.pause','scheduler.resume']}))}),{system:SYSTEM,signal:controller.signal,responseFormat:{type:'json_schema',name:'scheduler_understanding',schema:SCHEMA}})
   const stopped=new Promise((_,reject)=>{abortListener=()=>reject(Error('timed_out'));controller.signal.addEventListener('abort',abortListener,{once:true});if(controller.signal.aborted)abortListener()})
   const response=await Promise.race([pending,stopped])
   if(response?.model!==model||response.billing!==require('../subscription/chatModels').billingFor(model)||typeof response.text!=='string'||response.text.length>16000)throw Error('invalid_interpretation')
   const decision=admit(JSON.parse(response.text));receipt.intent=decision.intent;receipt.actualModel=response.model;receipt.billing=response.billing;receipt.interpretationMs=Date.now()-Date.parse(receipt.timeline[0].at)
   if(hash(conversations.get(conversationId)||null)!==hash(before||null))throw Error('conversation_changed')
   let result=null
   const clarify=key=>{
    const v={mode:'ask',lane:'chat',servedBy:null,reply:key==='unsupported'?t('actions.semanticUnsupported'):key==='approval'?t('actions.semanticApproval'):t('actions.semanticClarify'),...(context?{investigationRunId:context.investigationId}:{})}
    conversations.appendTurn({id:conversationId,userText:message,replyText:v.reply,investigationRunId:v.investigationRunId});return v
   }
   if(decision.intent==='approval')result=clarify('approval')
   else if(decision.intent==='unsupported')result=clarify('unsupported')
   else if(decision.intent==='clarify')result=clarify('clarify')
   else if(['status','restore'].includes(decision.intent)){
    if(!run || decision.targetId!=='none'&&decision.targetId!==run.target.id)result=clarify('clarify')
    else result=await continueTurn(input,{kind:decision.intent})
   }else if(decision.intent==='prepare'){
    const targetId=resolveTarget(decision,message,currentAction)
    if(!targetId||!['scheduler.pause','scheduler.resume'].includes(decision.capability))result=clarify('clarify')
    else if(run&&run.target.id===targetId&&run.capability===decision.capability&&run.state==='awaiting_approval')result=await continueTurn(input,{kind:'status'})
    else{
     // Reinspect and create a proposal only. Understanding can never consume approval.
     ongoing.delete(conversationId)
     result=await prepareTurn(input,{candidate:true,targetId,action:decision.capability})
    }
   }
   receipt.state='completed';receipt.response=result;receipt.timeline.push({phase:'completed',at:new Date(now()).toISOString()});semanticStore.save(receipt)
   return result
  }catch(e){receipt.state='interrupted';receipt.reason=['timed_out','conversation_changed','invalid_interpretation','request_conflict'].includes(e.message)?e.message:'understanding_unavailable';semanticStore.save(receipt);throw e}
  finally{clearTimeout(timer);if(abortListener)controller.signal.removeEventListener('abort',abortListener);ongoing.delete(conversationId)}
 }
 // Broad investigative questions still use the existing multi-source reasoning pipeline.
 return {candidate:(message,conversationId,requestId)=>{const p=parseContinuation(message);return !!(ID.test(requestId||'')&&semanticStore.get(requestId))||!!parseRequest(message).action||!!p&&(p.kind==='approve'||p.kind==='restore'||!!latestContext(conversationId))||!!providerFor&&(!!latestContext(conversationId)||require('./understanding').surface(message))},handle,start}
}
module.exports={createChatGateway,parseRequest,parseContinuation}
