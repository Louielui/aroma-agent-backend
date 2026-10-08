 'use strict'
// Evidence requirements select fixed read adapters/sections, never arbitrary paths.
const NEEDS = Object.freeze({
  configuration:['configuration'], enablement:['configuration','schedules'],
  live_runtime:['configuration','schedules','work'], execution_history:['execution'],
  work_failure:['work'], source_revision:['work','configuration'],
  test_results:['work'], repair_verification:['work','configuration'],
  history:['history'], usage:['execution','usage'], billing:['billing'],
  correspondence:[], documents:[], code_history:[], events:[]
})
const BASE = Object.freeze({
  cost:['execution_history','configuration','enablement','usage','billing'],
  work_failure:['work_failure','source_revision','test_results','repair_verification'],
  background:['configuration','enablement','execution_history','live_runtime'],
  general:[]
})
const SOURCES = new Set(['xiangxiang_operations','gmail','drive','calendar','github'])
function investigationRoute(plan, authorised=[]) {
  if(!plan || !Object.hasOwn(BASE,plan.investigationFocus)) return null
  const allow=new Set(authorised), facts=(plan.facts||[]).filter(f=>SOURCES.has(f.operation))
  if(!facts.some(f=>f.necessity==='required')) return null
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
    unmappedFacts:(plan.facts||[]).filter(f=>!f.operation||!SOURCES.has(f.operation)).map(f=>({id:f.id,operation:f.operation||null,need:f.need,status:f.operation?'UNAVAILABLE':'UNKNOWN'})),
    policy:'judged_goal_and_requirements_intersect_existing_authorization',maxFollowupSources:2}
}
module.exports={NEEDS,investigationRoute}
