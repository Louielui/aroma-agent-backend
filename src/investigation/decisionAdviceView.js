'use strict'
const {t}=require('../i18n/t')
const safe=v=>'`'+String(v).replace(/[`\\<>\r\n]/g,' ').replace(/[\u0000-\u001f]/g,'').slice(0,120)+'`'
function renderDecisionAdvice(a,{message=''}={}){
 if(a?.readOnly!==true||a.executionAllowed!==false)return null
 const locale=/[\u3400-\u9fff]/.test(message)?'zh':'en'
 const copy={
  review_observed_usage:()=>[t('investigation.adviceUsage',{},locale),t('investigation.adviceUsageEffect',{},locale),t('investigation.adviceUsageTradeoff',{},locale)],
  complete_usage_evidence:()=>[t('investigation.adviceMissingUsage',{},locale),t('investigation.adviceMissingUsageEffect',{},locale),t('investigation.adviceMissingUsageTradeoff',{},locale)],
  compare_billing_evidence:()=>[t('investigation.adviceBilling',{},locale),t('investigation.adviceBillingEffect',{},locale),t('investigation.adviceBillingTradeoff',{},locale)],
  verify_same_failure:()=>[t('investigation.adviceFailure',{},locale),t('investigation.adviceFailureEffect',{},locale),t('investigation.adviceFailureTradeoff',{},locale)],
  review_verified_scope:()=>[t('investigation.adviceVerified',{},locale),t('investigation.adviceVerifiedEffect',{},locale),t('investigation.adviceVerifiedTradeoff',{},locale)],
  review_failure_prerequisite:()=>[t('investigation.advicePrerequisite',{},locale),t('investigation.advicePrerequisiteEffect',{},locale),t('investigation.advicePrerequisiteTradeoff',{},locale)],
  review_active_purpose:()=>[t('investigation.adviceActive',{},locale),t('investigation.adviceActiveEffect',{},locale),t('investigation.adviceActiveTradeoff',{},locale)],
  verify_enabled_runtime:()=>[t('investigation.adviceEnabled',{},locale),t('investigation.adviceEnabledEffect',{},locale),t('investigation.adviceEnabledTradeoff',{},locale)],
  resolve_conflicting_evidence:()=>[t('investigation.adviceConflict',{},locale),t('investigation.adviceConflictEffect',{},locale),t('investigation.adviceConflictTradeoff',{},locale)],
  resolve_source_gaps:()=>[t('investigation.adviceGap',{},locale),t('investigation.adviceGapEffect',{},locale),t('investigation.adviceGapTradeoff',{},locale)]
 }
 const lines=[t('investigation.adviceTitle',{},locale)],references=[]
 const grades={CONFIRMED:()=>t('investigation.costAssessmentState.confirmed',{},locale),SUPPORTED:()=>t('investigation.costAssessmentState.supported',{},locale),CONTRADICTED:()=>t('investigation.costAssessmentState.contradicted',{},locale),UNKNOWN:()=>t('investigation.costAssessmentState.unknown',{},locale),UNAVAILABLE:()=>t('investigation.costAssessmentState.unavailable',{},locale)}
 for(const [i,o]of a.options.entries()){
  const words=copy[o.kind]?.();if(!words)continue
  const [title,effect,tradeoff]=words
  lines.push(t('investigation.adviceOption',{number:i+1,title,preferred:o.kind===a.preferred?t('investigation.advicePreferred',{},locale):''},locale))
  if(o.targets.length)lines.push(t('investigation.adviceTargets',{targets:o.targets.map(safe).join(', ')},locale))
  lines.push(t('investigation.adviceBasis',{state:(grades[o.evidenceState]||grades.UNKNOWN)()},locale))
  lines.push(t('investigation.adviceEffect',{effect},locale),t('investigation.adviceTradeoff',{tradeoff},locale))
  const sources=[...new Set(o.references.filter(r=>r.sourceId).map(r=>safe(r.sourceId)+(r.recordId?' / '+safe(r.recordId):'')))].slice(0,3)
  if(sources.length)lines.push(t('investigation.adviceSources',{sources:sources.join('; ')},locale))
  references.push(...o.references)
 }
 lines.push(a.focus==='cost'?t('investigation.adviceBoundary',{},locale):t('investigation.adviceReadOnlyBoundary',{},locale))
 return{text:lines.join('\n\n'),references,modelProseUsed:false}
}
module.exports={renderDecisionAdvice}
