'use strict'
const {t}=require('../i18n/t')

const localeFor=message=>/[\u3400-\u9fff]/.test(message)?'zh':'en'
const safeText=value=>typeof value==='string'&&value.length<=120&&value.trim()&&!/[<>\r\n`]/.test(value)?value:null
const safeModel=value=>safeText(value)&&/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)
const safeTime=value=>safeText(value)&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)&&Number.isFinite(Date.parse(value))
const escapeInline=value=>value.replace(/[\\*_{}\[\]()#+!|~]/g,'\\$&')
const readable=section=>['ok','partial'].includes(section.state)
const unique=(items,key)=>items.filter(item=>items.filter(other=>key(other)===key(item)).length===1)

// This is a small, deterministic finding set for the Owner cost question. It
// describes only fields read from the same uniquely identified live receipt.
// The fallible free-prose review remains separate and can never promote a
// rejected model claim into these findings.
function renderCostFindings(report,{message=''}={}){
 if(report?.readOnly!==true||report.focus!=='cost'||!Array.isArray(report.sections))return null
 const locale=localeFor(message),sections=unique(report.sections.filter(s=>s&&typeof s.sourceId==='string'),s=>s.sourceId)
 const references=[],lines=[]
 const execution=sections.filter(s=>s.section==='execution'&&readable(s))
 const observed=unique(execution.flatMap(s=>(s.records||[]).filter(r=>r&&typeof r.sourceId==='string').map(r=>({s,r}))),x=>x.r.sourceId)
  .filter(({r})=>r.evidenceBasis==='owner_bridge_invocation_ledger'&&r.usageBasis==='provider_result_model_usage'&&r.state==='succeeded'&&r.modelResultObserved===true&&['memory_completion','chat_completion'].includes(r.role)&&safeModel(r.actualModel)&&safeTime(r.startedAt)&&Number.isSafeInteger(r.usage?.outputTokens)&&r.usage.outputTokens>=0)
 const call=observed.find(({r})=>r.role==='memory_completion')||observed[0]
 if(call){
  const {s,r}=call
  references.push({sourceId:s.sourceId,recordId:r.sourceId,fields:{role:r.role,state:r.state,modelResultObserved:r.modelResultObserved,actualModel:r.actualModel,startedAt:r.startedAt,usageBasis:r.usageBasis,outputTokens:r.usage.outputTokens}})
  const role=r.role==='memory_completion'?t('investigation.memoryCompletion',{},locale):t('investigation.chatCompletion',{},locale)
  lines.push(t('investigation.costObservedCall',{role,model:r.actualModel,at:r.startedAt,output:r.usage.outputTokens},locale))
 }
 const schedules=sections.filter(s=>s.section==='schedules'&&readable(s))
 const schedule=unique(schedules.flatMap(s=>(s.records||[]).filter(r=>r&&typeof r.sourceId==='string').map(r=>({s,r}))),x=>x.r.sourceId)
  .find(({r})=>safeText(r.name)&&['PAUSED','ACTIVE'].includes(r.state))
 if(schedule){
  const {s,r}=schedule
  references.push({sourceId:s.sourceId,recordId:r.sourceId,fields:{name:r.name,state:r.state}})
  const state=r.state==='PAUSED'?t('investigation.paused',{},locale):t('investigation.costEnabled',{},locale)
  lines.push(t('investigation.costSchedule',{name:escapeInline(r.name),state},locale))
 }
 const billing=sections.filter(s=>s.section==='billing')
 if(billing.length===1&&billing[0].state==='unconnected'){
  references.push({sourceId:billing[0].sourceId,recordId:null,fields:{state:'unconnected'}})
  lines.push(t('investigation.costBillingGap',{},locale))
 }else if(lines.length&&report.billingConfirmed!==true)lines.push(t('investigation.costUnverified',{},locale))
 if(!lines.length)return null
 return {version:1,text:lines.join('\n\n'),references,scope:'bounded_receipts_not_billing',modelProseUsed:false}
}
module.exports={renderCostFindings}
