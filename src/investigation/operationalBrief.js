'use strict'
const {t}=require('../i18n/t')
const code=v=>'`'+String(v).replace(/[`\\\r\n]/g,' ').slice(0,240)+'`'
function workflowTitle(role,locale){
 switch(role){
 case 'test_draft':return t('investigation.testDraftWorkflow',{},locale)
 case 'development':return t('investigation.developmentWorkflow',{},locale)
 case 'review':return t('investigation.reviewWorkflow',{},locale)
 case 'adoption':return t('investigation.adoptionWorkflow',{},locale)
 default:return null
}
}
function backgroundTitle(role,locale){
 switch(role){
 case 'mail_analysis':return t('investigation.mailAnalysis',{},locale)
 case 'mail_sync':return t('investigation.mailSync',{},locale)
 case 'mail_index':return t('investigation.mailIndex',{},locale)
 case 'memory_index':return t('investigation.memoryIndex',{},locale)
 case 'memory_outbox':return t('investigation.memoryOutbox',{},locale)
 case 'memory_consolidation':return t('investigation.memoryConsolidation',{},locale)
 case 'chat_completion':return t('investigation.chatCompletion',{},locale)
 case 'memory_completion':return t('investigation.memoryCompletion',{},locale)
 default:return null
 }
}
function runningTitle(state,locale){
 switch(state){
 case 'active':return t('investigation.runtimeActive',{},locale)
 case 'idle':return t('investigation.runtimeIdle',{},locale)
 case 'disabled':return t('investigation.runtimeDisabled',{},locale)
 default:return t('investigation.runtimeUnknown',{},locale)
 }
}
// Fixed receipt fields remain visible even when reviewed model prose omits them.
// This does not admit rejected claims, read another source or infer past billing.
function renderRuntimeSummary(report,{message=''}={}){
 if(report?.readOnly!==true||report.focus!=='background'||!Array.isArray(report.sections))return null
 const locale=/[\u3400-\u9fff]/.test(message)?'zh':'en'
 const readable=name=>report.sections.filter(s=>s.section===name&&['ok','partial'].includes(s.state)&&s.sourceId)
 const configuration=readable('configuration'),schedules=readable('schedules'),lines=[],references=[]
 let ambiguous=0
 const bind=(s,r)=>references.push({sourceId:s.sourceId,recordId:r.sourceId,fields:{role:r.role||null,currentRunningState:r.currentRunningState||'unknown',model:r.model??null,modelBasis:r.modelBasis||null,evidenceBasis:r.evidenceBasis||null,usesModel:r.usesModel??null,at:r.at||null}})
 const value=v=>v?code(v):t('investigation.briefNotRecorded',{},locale)
 for(const role of ['mail_sync','mail_analysis','mail_index','memory_index','memory_outbox','memory_consolidation','memory_completion']){
  const id=(role==='memory_completion'?'bridge:':'backend:')+role
  const matches=configuration.flatMap(s=>(s.records||[]).filter(r=>r.role===role&&r.sourceId===id&&r.evidenceBasis==='live_process_snapshot').map(r=>({s,r})))
  if(matches.length>1){ambiguous++;continue}
  if(!matches.length)continue
  const {s,r}=matches[0],model=r.usesModel===false?t('investigation.briefNoModel',{},locale):['bridge_route_configuration','in_flight_request_selection'].includes(r.modelBasis)?value(r.model):t('investigation.briefNotRecorded',{},locale)
  const basis=r.modelBasis==='in_flight_request_selection'?t('investigation.runtimeSelectedModel',{},locale):t('investigation.runtimeConfiguredModel',{},locale)
  lines.push('- '+t('investigation.runtimeRow',{role:backgroundTitle(role,locale),state:runningTitle(r.currentRunningState,locale),basis,model,at:value(r.at)},locale));bind(s,r)
 }
 const recall=schedules.flatMap(s=>(s.records||[]).filter(r=>r.sourceId==='AromaXiangXiang-ErrandRecall'&&r.executionKind==='deterministic_food_recall_check'&&r.usesModel===false).map(r=>({s,r})))
 if(recall.length>1)ambiguous++
 else if(recall.length===1){
  const {s,r}=recall[0],installed=r.state==='INSTALLED'?t('investigation.runtimeInstalled',{},locale):r.state==='NOT_INSTALLED'?t('investigation.notInstalled',{},locale):t('investigation.runtimeUnknown',{},locale)
  lines.push('- '+t('investigation.runtimeRecallRow',{installed,state:runningTitle(r.currentRunningState,locale),model:t('investigation.briefNoModel',{},locale),at:value(r.at)},locale));bind(s,r)
 }
 if(!lines.length&&!ambiguous)return null
 const text=[t('investigation.runtimeInventory',{},locale),lines.join('\n'),...(ambiguous?[t('investigation.runtimeAmbiguous',{count:ambiguous},locale)]:[]),t('investigation.runtimeInventoryBoundary',{},locale)].filter(Boolean).join('\n\n')
 return {version:1,text,references,ambiguousRows:ambiguous,scope:'registered_live_process_receipts_not_complete_worker_inventory'}
}
// The legacy prose-name gate is built for Cantonese answers with Latin entity
// names. Do not weaken that protection or expand its vocabulary to arbitrary
// English. This bounded bilingual presentation uses only the observed operational
// receipt fields and fixed uncertainty/recommendation text, never model prose.
// Script detection chooses presentation only; the judged focus and Owner read
// have already determined access and this module cannot request any operation.
function renderOperationalBrief(report,{message=''}={}){
 if(report?.readOnly!==true||!Array.isArray(report.sections))return null
 const locale=/[\u3400-\u9fff]/.test(message)?'zh':'en'
 const tr=(key,values={})=>{
  switch(key){
   case 'investigation.briefNotRecorded':return t('investigation.briefNotRecorded',values,locale)
   case 'investigation.followupFresh':return t('investigation.followupFresh',values,locale)
   case 'investigation.followupChange':return t('investigation.followupChange',values,locale)
   case 'investigation.followupUnchanged':return t('investigation.followupUnchanged',values,locale)
   case 'investigation.followupNoComparison':return t('investigation.followupNoComparison',values,locale)
   case 'investigation.followupAmbiguous':return t('investigation.followupAmbiguous',values,locale)
   case 'investigation.followupOmitted':return t('investigation.followupOmitted',values,locale)
   case 'investigation.followupUnavailable':return t('investigation.followupUnavailable',values,locale)
   case 'investigation.followupTargetMissing':return t('investigation.followupTargetMissing',values,locale)
   case 'investigation.followupTarget':return t('investigation.followupTarget',values,locale)
   case 'investigation.briefFailure':return t('investigation.briefFailure',values,locale)
   case 'investigation.briefNoFailure':return t('investigation.briefNoFailure',values,locale)
   case 'investigation.sourceDirtyExplanation':return t('investigation.sourceDirtyExplanation',values,locale)
   case 'investigation.briefFixUnknown':return t('investigation.briefFixUnknown',values,locale)
   case 'investigation.briefFailureRecommendation':return t('investigation.briefFailureRecommendation',values,locale)
   case 'investigation.briefBackground':return t('investigation.briefBackground',values,locale)
   case 'investigation.paused':return t('investigation.paused',values,locale)
   case 'investigation.notInstalled':return t('investigation.notInstalled',values,locale)
   case 'investigation.briefSchedule':return t('investigation.briefSchedule',values,locale)
   case 'investigation.briefNoSchedules':return t('investigation.briefNoSchedules',values,locale)
   case 'investigation.briefWorkflow':return t('investigation.briefWorkflow',values,locale)
   case 'investigation.briefCentral':return t('investigation.briefCentral',values,locale)
   case 'investigation.briefActivityUnknown':return t('investigation.briefActivityUnknown',values,locale)
   case 'investigation.briefBackgroundRecommendation':return t('investigation.briefBackgroundRecommendation',values,locale)
   case 'investigation.briefRuntime':return t('investigation.briefRuntime',values,locale)
   case 'investigation.briefNoModel':return t('investigation.briefNoModel',values,locale)
   case 'investigation.briefRecall':return t('investigation.briefRecall',values,locale)
   default:throw Error('unregistered_operational_presentation')
  }
 }
 const section=name=>report.sections.find(s=>s.section===name&&['ok','partial'].includes(s.state))
 const lines=[]
 const c=report.continuity
 if(c?.state==='compared'){
  lines.push(tr('investigation.followupFresh',{at:code(c.previousAt||tr('investigation.briefNotRecorded'))}))
  for(const change of c.changes||[]) lines.push(tr('investigation.followupChange',{id:code(change.recordId),field:code(change.field),before:change.before===null?tr('investigation.briefNotRecorded'):code(change.before),after:change.after===null?tr('investigation.briefNotRecorded'):code(change.after)}))
  if(!c.changes?.length)lines.push(tr(c.compared>0?'investigation.followupUnchanged':'investigation.followupNoComparison'))
  if(c.ambiguous?.length)lines.push(tr('investigation.followupAmbiguous'))
  if(c.changesOmitted>0)lines.push(tr('investigation.followupOmitted',{count:c.changesOmitted}))
 }else if(c)lines.push(tr('investigation.followupUnavailable'))
 if(report.focus==='work_failure'){
  const work=section('work'),records=work?.records||[]
  const selected=c?.state==='compared'&&c.selectedRecordId
  const failed=selected?(c.targetState==='observed'?records.find(r=>r.sourceId===selected):null):(records.find(r=>r.sourceId===work.latestFailureId&&r.state==='failed')||records.find(r=>r.state==='failed'))
  if(selected&&!failed)lines.push(tr('investigation.followupTargetMissing',{id:code(selected)}))
  else if(failed)lines.push(tr(selected?'investigation.followupTarget':'investigation.briefFailure',{id:code(failed.sourceId),state:failed.state?code(failed.state):tr('investigation.briefNotRecorded'),reason:failed.reason?code(failed.reason):tr('investigation.briefNotRecorded')}))
  else lines.push(tr('investigation.briefNoFailure'))
  if(failed?.reason==='source_dirty')lines.push(tr('investigation.sourceDirtyExplanation'))
  lines.push(tr('investigation.briefFixUnknown'),tr('investigation.briefFailureRecommendation'))
 }else if(report.focus==='background'){
  lines.push(tr('investigation.briefBackground'))
  const schedules=section('schedules')
  for(const r of (schedules?.records||[]).slice(0,20)){
   const state=r.state==='PAUSED'?tr('investigation.paused'):r.state==='NOT_INSTALLED'?tr('investigation.notInstalled'):r.state?code(r.state):tr('investigation.briefNotRecorded')
   lines.push(tr('investigation.briefSchedule',{name:code(r.name||r.sourceId),state,model:r.model?code(r.model):tr('investigation.briefNotRecorded')}))
   if(r.executionKind==='deterministic_food_recall_check'&&r.usesModel===false)lines.push(tr('investigation.briefRecall',{state:runningTitle(r.currentRunningState,locale),at:r.at?code(r.at):tr('investigation.briefNotRecorded')}))
  }
  if(!schedules?.records?.length)lines.push(tr('investigation.briefNoSchedules'))
  const work=section('work')
  for(const w of (work?.workflows||[]).slice(0,5)){
   const title=workflowTitle(w.role,locale)
   if(!title||w.modelBasis!=='host_workflow_default_not_per_job_selection')continue
   lines.push(tr('investigation.briefWorkflow',{role:title,state:['idle','occupied'].includes(w.state)?code(w.state):tr('investigation.briefNotRecorded'),model:w.model?code(w.model):tr('investigation.briefNotRecorded'),at:w.at?code(w.at):tr('investigation.briefNotRecorded')}))
  }
  const config=section('configuration')?.records?.find(r=>r.role==='central_brain_default')
  if(config?.model)lines.push(tr('investigation.briefCentral',{model:code(config.model),effort:config.effort?code(config.effort):tr('investigation.briefNotRecorded')}))
  for(const r of section('configuration')?.records||[]){
   const role=backgroundTitle(r.role,locale)
   if(!role||r.evidenceBasis!=='live_process_snapshot')continue
   lines.push(tr('investigation.briefRuntime',{role,state:runningTitle(r.currentRunningState,locale),model:r.usesModel===false?tr('investigation.briefNoModel'):r.model?code(r.model):tr('investigation.briefNotRecorded'),at:r.at?code(r.at):tr('investigation.briefNotRecorded')}))
  }
  lines.push(tr('investigation.briefActivityUnknown'),tr('investigation.briefBackgroundRecommendation'))
 }else return null
 return lines.join('\n\n')
}
module.exports={renderOperationalBrief,renderRuntimeSummary}
