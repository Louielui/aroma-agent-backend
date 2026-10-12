'use strict'
// Decision support over the existing evidence graph, not a new source or action
// planner. Source prose, model drafts and account totals cannot choose remedies.
const {currentFact}=require('./evidenceState')
const readable=s=>['ok','partial'].includes(s.state)
const reference=a=>a.references.map(r=>({sourceId:r.sourceId,recordId:r.recordId,fields:{[r.field||'observation']:r.value},...(r.collection?{collection:r.collection}:{})}))
function buildDecisionAdvice(report){
 if(report?.readOnly!==true||!report.evidenceModel)return null
 const e=report.evidenceModel,sections=report.sections||[],options=[]
 const add=(kind,state,refs,targets,unknowns)=>options.push({kind,evidenceState:state,readOnly:true,targets:[...new Set(targets.filter(Boolean))].slice(0,3),references:refs,expectedEffect:kind,tradeoff:kind,unknowns})
 const safeAssertions=e.assertions.filter(a=>['CONFIRMED','SUPPORTED'].includes(a.state)&&a.references.length&&
  sections.filter(s=>s.sourceId===a.sourceId&&readable(s)).length===1&&
  sections.find(s=>s.sourceId===a.sourceId).records?.filter(r=>r.sourceId===a.recordId).length===1)
 const conflicts=e.assertions.filter(a=>a.state==='CONTRADICTED')
 const coverage=e.coverage.filter(c=>['UNKNOWN','UNAVAILABLE'].includes(c.state))
 if(conflicts.length||e.contradictions.length||report.contradictions?.length){
   const refs=conflicts.flatMap(reference)
  add('resolve_conflicting_evidence','CONTRADICTED',refs,conflicts.map(a=>a.recordId),['conflict_unresolved'])
 }else if(report.focus==='cost'){
  const jobs=report.costAssessment?.jobs||[]
  const measured=jobs.filter(j=>j.identityState==='CONFIRMED'&&j.usage.state==='CONFIRMED'&&j.execution.state==='CONFIRMED'&&j.executionToUsage.state==='CONFIRMED'&&
   j.usage.models.some(m=>Object.values(m.subtotal||{}).some(n=>typeof n==='number'&&n>0)))
  if(measured.length)add('review_observed_usage','CONFIRMED',measured.slice(0,3).flatMap(j=>j.references),measured.map(j=>j.recordId||j.id),['necessity_unknown','savings_unknown','coverage_partial'])
  else{
   const observed=jobs.slice(0,3)
   add('complete_usage_evidence',observed.length?'SUPPORTED':'UNKNOWN',observed.flatMap(j=>j.references),observed.map(j=>j.recordId||j.id),['identity_or_usage_incomplete','savings_unknown'])
  }
  const billing=sections.filter(s=>s.section==='billing')
  add('compare_billing_evidence','UNKNOWN',billing.map(s=>({sourceId:s.sourceId,recordId:null,fields:{state:s.state}})),[],['charge_unconfirmed','claude_quota_unavailable'])
 }else if(report.focus==='work_failure'){
  const c=report.workCorrelation,target=c?.target
  const bound=target&&safeAssertions.find(a=>a.sourceId===target.sourceId&&a.recordId===target.recordId&&a.facet==='work_state')
  if(bound){
   const verified=c.componentVerification==='CONFIRMED'
   const stages=c.repairChain?.stages||[]
   const missing=stages.find(s=>s.state!=='CONFIRMED')
   const refs=reference(bound)
   if(verified)refs.push(...(stages.find(s=>s.key==='live_failure_verification')?.references||[]).map(r=>({sourceId:r.sourceId,recordId:r.recordId,fields:{liveVerification:r.value}})))
   add(verified?'review_verified_scope':'verify_same_failure','CONFIRMED',refs,[target.recordId],verified?['component_not_global_fix']:['same_failure_not_verified',...(missing?[missing.key]:[])])
   const reason=safeAssertions.find(a=>a.sourceId===target.sourceId&&a.recordId===target.recordId&&a.facet==='failure_reason')
   if(reason)add('review_failure_prerequisite',reason.state,reference(reason),[target.recordId],['remedy_not_executed'])
  }
 }else if(report.focus==='background'){
  const witnesses=safeAssertions.filter(a=>a.facet==='running'&&a.temporalScope==='current_runtime'&&
   currentFact(report,a.sourceId,a.recordId,'running')?.state==='CONFIRMED'&&
   currentFact(report,a.sourceId,a.recordId,'running')?.value==='active')
  const enabled=safeAssertions.filter(a=>a.facet==='enabled'&&a.value===true&&currentFact(report,a.sourceId,a.recordId,'enabled')?.value===true)
  if(witnesses.length)add('review_active_purpose','CONFIRMED',witnesses.slice(0,3).flatMap(reference),witnesses.map(a=>a.recordId),['necessity_unknown','snapshot_not_continuous'])
  if(enabled.length)add('verify_enabled_runtime','CONFIRMED',enabled.slice(0,3).flatMap(reference),enabled.map(a=>a.recordId),['enablement_not_execution','savings_unknown'])
 }
 if(!options.length){
  const gaps=coverage.slice(0,3)
  add('resolve_source_gaps',gaps.some(c=>c.state==='UNAVAILABLE')?'UNAVAILABLE':'UNKNOWN',gaps.filter(c=>c.sourceId).map(c=>({sourceId:c.sourceId,recordId:null,fields:{state:c.state}})),[],['no_supported_remedy'])
 }
 return{version:1,readOnly:true,executionAllowed:false,preferred:options[0].kind,options:options.slice(0,2),
  evidenceCounts:e.counts,coverageComplete:false,scope:'bounded_evidence_to_read_only_decision_support_no_savings_or_charge_inference'}
}
module.exports={buildDecisionAdvice}
