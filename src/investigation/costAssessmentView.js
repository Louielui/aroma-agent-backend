'use strict'
const {t}=require('../i18n/t')
const safe=v=>'`'+String(v).replace(/[^a-zA-Z0-9_.:\/-]/g,'').slice(0,160)+'`'
function renderCostAssessment(a,locale){
 if(a?.readOnly!==true)return null
 const s=a.summary,lines=[t('investigation.costAssessmentTitle',{},locale),t('investigation.costAssessmentSummary',{chains:s.sampledChains,linked:s.exactJobs,usage:s.jobsWithUsageEvidence,partial:s.jobsWithIncompleteUsage},locale)]
 const names={mail_analysis:()=>t('investigation.workMailAnalysis',{},locale),mail_index:()=>t('investigation.workMailIndex',{},locale),memory_index:()=>t('investigation.workMemoryIndex',{},locale),memory_consolidation:()=>t('investigation.workMemoryConsolidation',{},locale),host_request:()=>t('investigation.chatCompletion',{},locale),worker_work:()=>t('investigation.costAssessmentDevelopment',{},locale),bridge_lane:()=>t('investigation.costAssessmentUnlinked',{},locale),codex_session:()=>t('investigation.usageSource.codexSessions',{},locale),worker_record:()=>t('investigation.usageSource.workerRecords',{},locale)}
 const states={CONFIRMED:()=>t('investigation.costAssessmentState.confirmed',{},locale),SUPPORTED:()=>t('investigation.costAssessmentState.supported',{},locale),CANDIDATE:()=>t('investigation.costAssessmentState.candidate',{},locale),CONTRADICTED:()=>t('investigation.costAssessmentState.contradicted',{},locale),UNKNOWN:()=>t('investigation.costAssessmentState.unknown',{},locale),UNAVAILABLE:()=>t('investigation.costAssessmentState.unavailable',{},locale)}
 const runtime={active:()=>t('investigation.costAssessmentRuntime.active',{},locale),idle:()=>t('investigation.costAssessmentRuntime.idle',{},locale),disabled:()=>t('investigation.costAssessmentRuntime.disabled',{},locale),not_installed:()=>t('investigation.costAssessmentRuntime.notInstalled',{},locale)}
 const next={resolve_execution_identity:()=>t('investigation.costAssessmentNext.resolveExecutionIdentity',{},locale),obtain_missing_usage_receipts:()=>t('investigation.costAssessmentNext.obtainMissingUsageReceipts',{},locale),read_available_account_quota:()=>t('investigation.costAssessmentNext.readAvailableAccountQuota',{},locale),inspect_claude_quota_separately:()=>t('investigation.costAssessmentNext.inspectClaudeQuotaSeparately',{},locale),obtain_identity_linked_billing_evidence:()=>t('investigation.costAssessmentNext.obtainIdentityLinkedBillingEvidence',{},locale)}
 const state=v=>states[v]?.()||states.UNKNOWN(),chosen=a.jobs.slice(0,4),references=[]
 for(const j of chosen){
  references.push(...j.references)
  const name=(names[j.workKind]||names[j.kind]||names.bridge_lane)()
  const models=j.models.state==='CONFIRMED'&&j.models.value?.length?j.models.value.map(safe).join(', '):state(j.models.state)
  lines.push('- '+t('investigation.costAssessmentJob',{name,id:safe(j.recordId||j.id),execution:state(j.execution.state),models,usage:state(j.usage.state),at:j.startedAt||j.finishedAt||state('UNKNOWN')},locale))
 }
 if(a.jobs.length>chosen.length)lines.push(t('investigation.costAssessmentMore',{shown:chosen.length,total:a.jobs.length},locale))
 for(const activity of a.activities){references.push(...activity.references)}
 const active=a.activities.filter(r=>r.running.state==='CONFIRMED'&&r.running.value==='active').length
 const unknown=a.activities.filter(r=>r.running.state!=='CONFIRMED').length
 lines.push(t('investigation.costAssessmentActivity',{observed:a.activities.length,active,unknown},locale))
 for(const r of a.activities.slice(0,6))lines.push('- '+t('investigation.costAssessmentComponent',{id:safe(r.id),model:r.configuredModel.state==='CONFIRMED'?(r.configuredModel.value==='no_model'?t('investigation.costAssessmentNoModel',{},locale):safe(r.configuredModel.value)):state(r.configuredModel.state),running:r.running.state==='CONFIRMED'?(runtime[r.running.value]?.()||t('investigation.costAssessmentRuntime.unknown',{},locale)):state(r.running.state),at:r.running.observedAt||state('UNKNOWN')},locale))
 lines.push(t('investigation.costAssessmentCharge',{},locale))
 for(const step of a.recommendations)if(next[step.kind])lines.push(next[step.kind]())
 references.push(...a.sources.flatMap(s=>s.references))
 return{text:lines.join('\n'),references}
}
module.exports={renderCostAssessment}
