'use strict'
const {t}=require('../i18n/t'),{intent,hash,UUID}=require('./procurementContract'),goals=require('../intake/goal/ownerGoal')
const display=value=>String(value).replace(/[\\`*_{}\[\]()#+.!|<>]/g,'\\$&')
function renderStatus(result){
 const s=result.schedule,r=result.lastAttempt,report=r?.report,lines=[t('procurement.status',{state:s?.status||'not_created',next:result.nextRunAt||t('live.unknown')}),t('procurement.attempts',{attempt:r?.startedAt||t('live.unknown'),success:result.lastSuccess?.finishedAt||t('live.unknown')})]
 if(result.windows?.exists)lines.push(t('procurement.triggerStatus',{attempt:result.windows.lastRunAt||t('live.unknown'),result:result.windows.lastTaskResult??t('live.unknown')}))
 if(s?.windowsDisableVerified===false)lines.push(t('procurement.disableUnverified'))
 if(report){lines.push(t('procurement.completeness',{state:report.completeness}));for(const group of report.groups){lines.push('### '+display(group.supplier));for(const item of group.items)lines.push('- '+display(item.name)+' — '+item.quantity+' '+display(item.unit))}if(report.unresolved.length)lines.push(t('procurement.unresolved',{count:report.unresolved.length}));for(const item of report.unresolved)lines.push('- '+display(item.name||item.sourceId||t('live.unknown'))+' — '+item.reason);if(report.issues.length)lines.push(t('procurement.issues',{issues:report.issues.join(', ')}))}
 if(r?.reason)lines.push(t('procurement.failure',{reason:r.reason}));lines.push(t('procurement.limits'));return lines.join('\n\n')
}
function createChat({request,conversations,tasks,receipts=require('./store').createStore({dir:require('node:path').join(require('../store/dataDir').resolveDataDir(),'procurement-dialogue-receipts')})}){
 const pending=new Set(),call=async b=>{const r=await request(b);if(r?.error)throw Error(r.error);return r}
 function latest(id){return receipts.list().filter(r=>r.kind==='procurement_dialogue'&&r.conversationId===id&&r.state==='completed').sort((a,b)=>b.sequence-a.sequence)[0]||null}
 async function respond(input,action=null){const {message,conversationId,requestId}=input;if(!UUID.test(conversationId)||!UUID.test(requestId)||typeof message!=='string')throw Error('invalid_request');const parsed=action||intent(message);if(!parsed)return null;const requestHash=hash({message,conversationId,action}),old=receipts.get(requestId);if(old){if(old.requestHash!==requestHash||old.state!=='completed')throw Error('request_conflict');return{...old.result,replayed:true}}if(pending.has(conversationId))throw Error('request_conflict');pending.add(conversationId)
  const prior=conversations.get(conversationId),previous=latest(conversationId),row={id:requestId,kind:'procurement_dialogue',workflow:'daily_procurement_report',conversationId,requestHash,state:'preparing',sequence:(previous?.sequence||0)+1,timeline:[]};let goal=goals.currentGoal(prior),taskId=previous?.taskId,result
  try{receipts.save(row);if(parsed.operation==='create'){
    goal=goals.createGoal({objective:message,requestId});goal=goals.refineGoal(goal,goal.outcomes.map(o=>({ownerQuote:o.ownerQuote,capability:/schedule|排程|採購報告/iu.test(o.ownerQuote)?'business_scheduler.daily_procurement':/供應商|看系統|補貨/u.test(o.ownerQuote)?'aroma_system.read':null,kind:'recurring'})));const stored=tasks.persistIntake({understanding:message,tasks:[{title:'Daily Procurement Report / 08:00 America/Winnipeg'}],ownerGoal:goal,provenance:{source:'owner_business_schedule_request'}});taskId=stored.task_ids[0];row.taskId=taskId;row.goalId=goal.goalId;receipts.save(row)
   }
   if(parsed.operation!=='create'&&parsed.operation!=='approve'){
    const observed=await call({op:'procurement_status'}),s=observed.schedule
    if(s&&s.conversationId===conversationId){const original=goals.goalsFor(prior).find(g=>g.goalId===s.goalId);if(!original)throw Error('schedule_context_mismatch');goal=original;taskId=s.taskId}
    if(parsed.operation==='status')result={reply:renderStatus(observed),procurementStatus:observed}
   }
   if(parsed.operation==='status'){}
   else if(parsed.operation==='approve'){
    const p=previous?.result?.procurementProposal;if(!p||!goal||previous.goalId!==goal.goalId||prior?.messages?.at(-1)?.content!==previous.result.reply||parsed.approveOperation&&parsed.approveOperation!==p.operation)throw Error('approval_unavailable');if(action&&action.id!==p.id||action&&action.hash!==p.hash)throw Error('approval_unavailable')
    const observed=await call({op:'procurement_approve',id:p.id,hash:p.hash,nonce:p.nonce,conversationId});result={reply:renderStatus(observed),procurementStatus:observed}
   }else{
    if(!goal||!taskId)throw Error('schedule_context_mismatch');const prepared=await call({op:'procurement_prepare',operation:parsed.operation,taskId,conversationId,goalId:goal.goalId});const p=prepared.proposal;result={reply:t('procurement.proposal',{operation:p.operation})+'\n\n'+t('procurement.limits'),procurementProposal:p}
   }
   if(goal){result.ownerGoal=goal;result.reply+='\n\n'+require('../intake/goal/ownerGoalView').renderGoal(goal)}result=goals.withOutstanding({...result,mode:'chat',lane:'chat',servedBy:null},prior)
   conversations.appendTurn({id:conversationId,userText:message,replyText:result.reply,...(goal?{ownerGoal:goal,...(goals.goalsFor(prior).some(g=>g.goalId===goal.goalId)?{ownerGoalReference:goal.goalId}:{})}:{})});row.taskId=taskId;row.goalId=goal?.goalId;row.result=result;row.state='completed';receipts.save(row);return result
  }catch(e){row.reason=['approval_unavailable','request_conflict','schedule_context_mismatch','procurement_not_enabled','schedule_already_exists'].includes(e.message)?e.message:'schedule_unavailable';const blocked={mode:'chat',lane:'chat',servedBy:null,reply:t('procurement.blocked',{reason:row.reason}),...(goal?{ownerGoal:goal}:{})};if(goal)blocked.reply+='\n\n'+require('../intake/goal/ownerGoalView').renderGoal(goal);conversations.appendTurn({id:conversationId,userText:message,replyText:blocked.reply,...(goal?{ownerGoal:goal,...(goals.goalsFor(prior).some(g=>g.goalId===goal.goalId)?{ownerGoalReference:goal.goalId}:{})}:{})});row.result=blocked;row.taskId=taskId;row.goalId=goal?.goalId;row.state='completed';receipts.save(row);return blocked}finally{pending.delete(conversationId)}
 }
 async function present(b){const last=latest(b.conversationId),p=last?.result?.procurementProposal;if(!p||p.id!==b.id||p.hash!==b.hash||conversations.get(b.conversationId)?.messages?.at(-1)?.content!==last.result.reply)throw Error('approval_unavailable');return call({op:'procurement_present',id:b.id,hash:b.hash,conversationId:b.conversationId})}
 return{candidate:message=>!!intent(message),start:input=>respond(input),present,approve:b=>respond({message:t('procurement.buttonApproval'),conversationId:b.conversationId,requestId:b.requestId},{operation:'approve',id:b.id,hash:b.hash}),status:()=>call({op:'procurement_status'})}
}
module.exports={createChat,renderStatus}
