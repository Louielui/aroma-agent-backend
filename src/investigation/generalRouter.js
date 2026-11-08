 'use strict'
// Evidence requirements select fixed read adapters/sections, never arbitrary paths.
const NEEDS = Object.freeze({
  configuration:['configuration'], enablement:['configuration','schedules'],
  live_runtime:['configuration','schedules','work'], execution_history:['execution'],
  work_failure:['work'], work_history:['work'], source_revision:['work','configuration'],
  test_results:['work'], repair_verification:['work','configuration'],
  memory_failures:['configuration'],
  history:['history'], usage:['execution','usage'], billing:['billing'],
  correspondence:[], documents:[], code_history:[], events:[]
})
const BASE = Object.freeze({
  cost:['execution_history','work_history','configuration','enablement','usage','billing'],
  work_failure:['work_failure','source_revision','test_results','repair_verification'],
  background:['configuration','enablement','execution_history','live_runtime'],
  general:[]
})
const SOURCES = new Set(['xiangxiang_operations','gmail','drive','calendar','github'])
// Reuse the judged goal for a narrow first read, not another meaning classifier.
// Every fact must remain within this authorised local source; mixed, unknown,
// historical/runtime diagnosis and action goals retain their existing loop.
function capabilityReadSections(plan, authorised=[]) {
  if(plan?.answerKind!=='capability_explanation'||plan.investigationFocus||plan.investigationReference||
    plan.requestedCapability||plan.joins?.length||plan.ownerOutcomes?.length||
    !authorised.includes('xiangxiang_operations')||
    !['understand','retrieve'].includes(plan.executiveFrame?.taskType)||plan.executiveFrame?.decisionNeeded!==false)return null
  const facts=plan.facts||[],needs=plan.investigationEvidence||[]
  if(!facts.some(f=>f.necessity==='required')||facts.some(f=>f.operation!=='xiangxiang_operations')||
    needs.some(n=>!['configuration','enablement','work_history'].includes(n)))return null
  return ['configuration','work']
}
function investigationRoute(plan, authorised=[]) {
  if(!plan || !Object.hasOwn(BASE,plan.investigationFocus)) return null
  const allow=new Set(authorised), facts=(plan.facts||[]).filter(f=>SOURCES.has(f.operation))
  if(!(plan.facts||[]).some(f=>f.necessity==='required')) return null
  const requirements=[...new Set([...(BASE[plan.investigationFocus]||[]),...(plan.investigationEvidence||[]).filter(n=>Object.hasOwn(NEEDS,n))])]
  const decisions=[...new Set(facts.map(f=>f.operation))].map(source=>({source,
    necessity:facts.some(f=>f.operation===source&&f.necessity==='required')?'required':'enriching',
    authorized:allow.has(source)}))
  const required=decisions.filter(d=>d.necessity==='required'&&d.authorized).map(d=>d.source)
  const local=required.includes('xiangxiang_operations')
  // Older general plans carry no typed needs. Preserve their bounded local scope.
  const localSections=local?[...new Set(requirements.flatMap(n=>NEEDS[n]))]:[]
  return {version:1,focus:plan.investigationFocus,goal:plan.questionRestated,readOnly:true,
    requirements,decisions,requiredSources:required,localSections:local?(localSections.length?localSections:['configuration','schedules','work','history','execution','usage','billing']):[],
    unmappedFacts:(plan.facts||[]).filter(f=>!f.operation||!SOURCES.has(f.operation)).map(f=>({id:f.id,operation:f.operation||null,need:f.need,necessity:f.necessity,status:f.operation?'UNAVAILABLE':'UNKNOWN'})),
    policy:'judged_goal_and_requirements_intersect_existing_authorization',maxFollowupSources:2}
}
// These are access/coverage receipts, never source citations. A denied read and
// an absent read receipt cannot be represented as a successful empty search.
function requiredSourceCoverage(report) {
  return (report.routing?.decisions || []).filter(d => d.necessity === 'required')
    .filter(d => !d.authorized || !(report.sections || []).some(s => d.source === 'xiangxiang_operations'
      ? !s.section.startsWith('external_') : s.section === 'external_' + d.source))
    .map(d => ({ section:'source_' + d.source, source:d.source, sourceId:null,
      state:'UNAVAILABLE', reason:d.authorized ? 'read_receipt_missing' : 'not_authorized',
      attempted:d.authorized ? null : false, scope:'required_source_access_not_content_evidence', retrievedAt:null }))
}
function refreshRequiredSourceGaps(report) {
  report.gaps = (report.gaps || []).filter(g => g.coverage !== 'required_source_access_not_content_evidence')
  report.gaps.push(...requiredSourceCoverage(report).map(c => ({...c, coverage:c.scope})))
  report.gaps = report.gaps.filter(g => g.coverage !== 'unmapped_required_need')
  report.gaps.push(...(report.routing?.unmappedFacts || []).filter(f => f.necessity === 'required')
    .map(f => ({section:'fact_' + f.id, state:f.status, reason:f.operation?'unmapped_operation':'unknown_operation', coverage:'unmapped_required_need'})))
}
module.exports={NEEDS,investigationRoute,capabilityReadSections,requiredSourceCoverage,refreshRequiredSourceGaps}
