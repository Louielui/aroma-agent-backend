'use strict'
const {t}=require('../i18n/t')
const safe=v=>'`'+String(v).replace(/[^a-zA-Z0-9_.:\/-]/g,'').slice(0,160)+'`'
function renderCostAssessment(a,locale){
 if(a?.readOnly!==true)return null
 const s=a.summary,lines=[t('investigation.costAssessmentTitle',{},locale),t('investigation.costAssessmentSummary',{chains:s.sampledChains,linked:s.exactJobs,usage:s.jobsWithUsageEvidence,partial:s.jobsWithIncompleteUsage},locale)]
 const names={mail_analysis:'workMailAnalysis',mail_index:'workMailIndex',memory_index:'workMemoryIndex',memory_consolidation:'workMemoryConsolidation',host_request:'chatCompletion',worker_work:'costAssessmentDevelopment',bridge_lane:'costAssessmentUnlinked',codex_session:'usageSource.codexSessions',worker_record:'usageSource.workerRecords'}
 const state=v=>t('investigation.costAssessmentState.'+v,{},locale),chosen=a.jobs.slice(0,4),references=[]
 for(const j of chosen){
  references.push(...j.references)
  const name=t('investigation.'+(names[j.workKind]||names[j.kind]||'costAssessmentUnlinked'),{},locale)
  const models=j.models.state==='CONFIRMED'&&j.models.value?.length?j.models.value.map(safe).join(', '):state(j.models.state)
  lines.push('- '+t('investigation.costAssessmentJob',{name,id:safe(j.recordId||j.id),execution:state(j.execution.state),models,usage:state(j.usage.state),at:j.startedAt||j.finishedAt||state('UNKNOWN')},locale))
 }
 if(a.jobs.length>chosen.length)lines.push(t('investigation.costAssessmentMore',{shown:chosen.length,total:a.jobs.length},locale))
 for(const activity of a.activities){references.push(...activity.references)}
 const active=a.activities.filter(r=>r.running.state==='CONFIRMED'&&r.running.value==='active').length
 const unknown=a.activities.filter(r=>r.running.state!=='CONFIRMED').length
 lines.push(t('investigation.costAssessmentActivity',{observed:a.activities.length,active,unknown},locale))
 for(const r of a.activities.slice(0,6))lines.push('- '+t('investigation.costAssessmentComponent',{id:safe(r.id),model:r.configuredModel.state==='CONFIRMED'?safe(r.configuredModel.value):state(r.configuredModel.state),running:r.running.state==='CONFIRMED'?t('investigation.costAssessmentRuntime.'+(['active','idle'].includes(r.running.value)?r.running.value:'unknown'),{},locale):state(r.running.state),at:r.running.observedAt||state('UNKNOWN')},locale))
 lines.push(t('investigation.costAssessmentCharge',{},locale))
 for(const step of a.recommendations)lines.push(t('investigation.costAssessmentNext.'+step.kind,{},locale))
 references.push(...a.sources.flatMap(s=>s.references))
 return{text:lines.join('\n'),references}
}
module.exports={renderCostAssessment}
