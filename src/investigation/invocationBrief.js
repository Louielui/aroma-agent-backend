'use strict'
const {t}=require('../i18n/t')
function phaseTitle(phase,locale){
 switch(phase){
 case 'intent':return t('investigation.callIntent',{},locale)
 case 'goal_understanding':return t('investigation.callGoal',{},locale)
 case 'answer':return t('investigation.callAnswer',{},locale)
 case 'evidence_review':return t('investigation.callReview',{},locale)
 default:return t('investigation.callUnspecified',{},locale)
 }
}
function renderInvocationSummary(report,{message=''}={}){
 if(report?.readOnly!==true||report.focus!=='cost')return null
 const locale=/[\u3400-\u9fff]/.test(message)?'zh':'en',references=[],rows=[]
 for(const s of report.sections||[])if(s.section==='execution'&&['ok','partial'].includes(s.state))for(const r of s.records||[])if(r.evidenceBasis==='owner_bridge_invocation_ledger'&&r.sourceId)rows.push({s,r})
 const unique=rows.filter(({r})=>rows.filter(x=>x.r.sourceId===r.sourceId).length===1).slice(0,6)
 if(!unique.length)return null
 const unknown=()=>t('investigation.briefNotRecorded',{},locale)
 const safe=v=>typeof v==='string'?'`'+v.replace(/[^a-zA-Z0-9:._ -]/g,'').slice(0,100)+'`':unknown()
 const lines=unique.map(({s,r})=>{
  const state=r.state==='succeeded'&&r.modelResultObserved===true?t('investigation.callSucceeded',{},locale):r.state==='failed'?t('investigation.callFailed',{},locale):r.state==='started'?t('investigation.callPending',{},locale):t('investigation.callUnknown',{},locale)
  const role=r.role==='memory_completion'?t('investigation.memoryCompletion',{},locale):t('investigation.chatCompletion',{},locale)+' ('+phaseTitle(r.phase,locale)+')'
  const count=v=>Number.isSafeInteger(v)&&v>=0?String(v):unknown()
  references.push({sourceId:s.sourceId,recordId:r.sourceId,fields:{role:r.role,phase:r.phase,state:r.state,modelResultObserved:r.modelResultObserved,actualModel:r.actualModel,startedAt:r.startedAt,usage:r.usage,durationMs:r.durationMs,requestId:r.requestId}})
  return '- '+t('investigation.callRow',{role,state,model:safe(r.actualModel),at:safe(r.startedAt),input:count(r.usage?.inputTokens),output:count(r.usage?.outputTokens),seconds:Number.isSafeInteger(r.durationMs)?String(Math.round(r.durationMs/100)/10):unknown()},locale)
 })
 return {version:1,text:[t('investigation.callTitle',{},locale),lines.join('\n'),t('investigation.callBoundary',{},locale)].join('\n\n'),references,scope:'bounded_invocation_receipts_not_billing'}
}
module.exports={renderInvocationSummary}
