'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const saved=require('./fixtures/delegationAudit.json')
const projection={...require('./delegationEvidence'),...require('./delegationEvidenceView')}
const sha=saved.runtime,now=()=>new Date().toISOString()
// New-schema declarations are OFFLINE projections of the audited source composition.
// Retained model outputs and native audit receipts above remain unchanged.
function fixture(){
 const at=now(),agents=[
  {id:'codex-code-diagnosis',role:'Read-only code diagnosis',status:'active',delegation:{model:'gpt-6.1-sol',effort:'high',selection:'fixed',permissions:'supplied_committed_code_only'},provides:[{capability:'CodeDiagnosis',version:1}]},
  {id:'codex-development-proposal',role:'Read-only development planner',status:'active',delegation:{model:'gpt-6-astra',effort:'medium',selection:'fixed',permissions:'supplied_public_context_only'},provides:[{capability:'DevelopmentProposal',version:1}]},
  {id:'codex-task-planner',role:'Read-only task planner',status:'active',delegation:{model:'gpt-6.1-sol',effort:'medium',selection:'per_request',permissions:'read_only_committed_profile'},provides:[{capability:'TaskPlanning',version:2}]}
 ]
 const backend=projection.backendSnapshot({bootCommit:sha,agents,legacy:saved.legacy,readAccess:true,at})
 const bridge=projection.bridgeSnapshot({bootCommit:sha,providers:[
  {id:'development',role:'Isolated development',model:'gpt-6.1-sol',effort:'per_work_order',selection:'workflow_default',permissions:'approved_registered_files_only'},
  {id:'review',role:'Result review',model:'sonnet',effort:null,selection:'workflow_default',permissions:'supplied_packet_only'}
 ],enabled:saved.workflow.projects.enabled,recipes:saved.workflow.projects.workOrders,models:saved.models,at})
 return {at,backend,bridge,view:projection.mergeDelegation({backend,bridge,expectedCommit:sha,at})}
}
test('audited channels retain separate identities, defaults, resolved models and untested authorization',()=>{
 const {view}=fixture()
 assert.equal(view.kind,'delegation_evidence_v1');assert.equal(view.scope,'registered_in_process_channels')
 assert.equal(view.records.find(r=>r.workerId==='codex-code-diagnosis').model,'gpt-6.1-sol')
 assert.equal(view.records.find(r=>r.workerId==='codex-development-proposal').model,'gpt-6-astra')
 const review=view.records.find(r=>r.workerId==='review');assert.equal(review.resolvedModel,'claude-sonnet-5-5');assert.equal(review.effort,null)
 assert.equal(view.legacyRoles.length,7);assert.equal(view.catalogueCount,17)
 assert.equal(view.modelChoices.length,17)
 assert.equal(view.records.length,5,'seventeen selectable account models are not seventeen workers')
 assert.ok(view.records.every(r=>r.canAccept===null&&r.authorization==='required_per_job'&&r.budget==='not_evaluated'))
 assert.equal(view.scopeComplete,true);assert.equal(view.dispatchVerified,false)
})
test('catalogue logout preserves configured channels and its safe diagnostic instead of inventing exhaustion',()=>{
 const f=fixture();f.bridge.models.forEach(r=>{if(r.model==='claude-sonnet')r.available=false})
 f.bridge.providerStates.claude={state:'unconfirmed',reason:'subscription_login_required'}
 const v=projection.mergeDelegation({backend:f.backend,bridge:f.bridge,expectedCommit:sha,at:f.at})
 assert.equal(v.records.find(r=>r.workerId==='review').subscription,'catalogue_unavailable')
 assert.equal(v.records.find(r=>r.workerId==='review').resolvedModel,null)
 assert.equal(v.providerStates.claude.reason,'subscription_login_required')
 assert.ok(v.records.some(r=>r.model==='gpt-6-astra'))
})
test('stale or foreign-version component stays unavailable without erasing the other source',()=>{
 for(const change of [b=>b.bootCommit='a'.repeat(40),b=>b.observedAt='2000-01-01T00:00:00Z',b=>b.observedAt='2999-01-01T00:00:00Z']){
  const f=fixture();change(f.bridge);const v=projection.mergeDelegation({backend:f.backend,bridge:f.bridge,expectedCommit:sha,at:f.at})
  assert.equal(v.coverage.bridge,'unavailable');assert.equal(v.scopeComplete,false)
  assert.equal(v.records.length,3);assert.ok(v.records.every(r=>r.subscription==='unknown'))
 }
})
test('missing source, ambiguous IDs and malformed model metadata cannot establish authority',()=>{
 const f=fixture();f.backend.records.push({...f.backend.records[0]})
 const v=projection.mergeDelegation({backend:f.backend,bridge:f.bridge,expectedCommit:sha,at:f.at})
 assert.equal(v.coverage.backend,'unavailable');assert.equal(v.records.length,2)
 const b=structuredClone(f.bridge);b.records[0].authorization='approved';assert.equal(projection.validSnapshot(b),false)
 assert.equal(projection.mergeDelegation({expectedCommit:sha,at:f.at}).scopeComplete,false)
})
test('saved real goal preserves its original missing operation; new catalogue selection is not fabricated retrospectively',()=>{
 const {judgeGoalPlan}=require('../intake/goal/goalPlanContract'),route=require('./generalRouter')
 const old=judgeGoalPlan(saved.goal).plan
 assert.equal(old.facts.find(f=>f.id==='f2').status,'UNAVAILABLE')
 assert.equal(route.capabilityReadGaps(old).find(f=>f.id==='f2').reason,'no_operation_in_this_system_carries_this')
 const updated=structuredClone(saved.goal);updated.facts.find(f=>f.id==='f2').operation='xiangxiang_operations'
 updated.investigation_evidence=['delegation']
 const plan=judgeGoalPlan(updated).plan
 assert.ok(route.capabilityReadSections(plan,['xiangxiang_operations']).includes('delegation'))
 assert.deepEqual(route.capabilityReadGaps(plan),[])
 assert.equal(route.capabilityReadSections(plan,[]),null)
 assert.equal(route.capabilityReadSections({...plan,executiveFrame:{...plan.executiveFrame,taskType:'execute'}},['xiangxiang_operations']),null)
})
test('existing adapter reads one fixed delegation receipt and does not mutate or execute supplied data',async()=>{
 const {view}=fixture();let reads=0
 const a=require('../context/adapters/xiangxiangOperationsRead').createXiangxiangOperationsReadAdapter({delegationReader:async()=>{reads++;return view}})
 const r=await a.methods.readInvestigation({sections:['delegation'],query:'Any natural wording; no keyword dispatch'})
 assert.equal(reads,1);assert.equal(r.results[0].fields.section,'delegation')
 assert.equal(r.results[0].fields.records.find(r=>r.workerId==='review').resolvedModel,'claude-sonnet-5-5')
 assert.equal(r.results[0].fields.dispatchVerified,false)
 await assert.rejects(a.methods.readInvestigation({sections:['start']}),/invalid_investigation_sections/)
})
test('ordinary investigation reads do not add delegation catalogue work and manifest views are detached',async()=>{
 let reads=0
 const a=require('../context/adapters/xiangxiangOperationsRead').createXiangxiangOperationsReadAdapter({delegationReader:async()=>{reads++;assert.fail('unselected metadata')}})
 const result=await a.methods.readInvestigation()
 assert.equal(reads,0);assert.ok(result.results.every(r=>r.fields.section!=='delegation'))
 const agents=require('../capability/agents'),before=agents.agentsProviding('Develop',1)[0].role,view=agents.listManifests()
 view.find(r=>r.id==='claude-code').role='not the registered role'
 assert.equal(agents.agentsProviding('Develop',1)[0].role,before)
})
test('host presentation binds a fresh live section and refuses user, web, stale and action substitutions',()=>{
 const {view}=fixture(),row={source:'xiangxiang_operations',trust:'live',sourceId:'delegation:receipt',fields:{section:'delegation',...view}}
 const input={answerKind:'capability_explanation',capabilityReadSettled:true,itemsBySource:[{source:'xiangxiang_operations',items:[row]}]}
 const shown=projection.renderDelegation(input)
 for(const name of ['gpt-6.1-sol','gpt-6-astra','claude-sonnet-5-5'])assert.ok(shown.reply.includes(name))
 assert.equal(shown.validation.sourceIds[0],'xiangxiang_operations#delegation:receipt');assert.equal(shown.validation.dispatchVerified,false)
 for(const change of [i=>i.capabilityReadSettled=false,i=>i.answerKind='operational_report',i=>i.ownerGoalReporting=true,i=>i.itemsBySource[0].items[0].trust='unavailable',i=>i.itemsBySource[0].items[0].source='public_knowledge',i=>i.itemsBySource[0].items[0].fields.observedAt='2000-01-01T00:00:00Z']){
  const i=structuredClone(input);change(i);assert.equal(projection.renderDelegation(i),null)
 }
 assert.ok(!shown.reply.includes('Manus'),'inactive legacy org roles stay in details, not active model list')
 assert.ok(shown.details.includes('Manus'));assert.ok(shown.details.includes('required_per_job'))
})
test('a settled disabled roster cannot fall back to the old model claim of availability',()=>{
 const {view}=fixture();view.records.forEach(r=>{r.enabled=false})
 const input={answerKind:'capability_explanation',capabilityReadSettled:true,itemsBySource:[{source:'xiangxiang_operations',items:[{source:'xiangxiang_operations',trust:'live',sourceId:'disabled:receipt',fields:{section:'delegation',...view}}]}]}
 const shown=projection.renderDelegation(input)
 assert.ok(shown);assert.doesNotMatch(shown.reply,/^- (?:gpt-|claude-)/m)
 assert.match(shown.reply,/沒有可列出|no enabled model/)
 assert.equal(shown.validation.dispatchVerified,false)
})
test('saved raw answer remains available in details while main answer is source-bound before the existing guard',()=>{
 const {view}=fixture(),row={source:'xiangxiang_operations',trust:'live',sourceId:'delegation:receipt',fields:{section:'delegation',...view}}
 const x=require('../intake/readResultView').buildReadResultReply({message:saved.message,answerKind:'capability_explanation',capabilityReadSettled:true,reply:saved.raw.reply,answerPlan:saved.raw.answerPlan,itemsBySource:[{source:'xiangxiang_operations',items:[row]}],perSource:[{source:'xiangxiang_operations',trust:'live',status:'ok',shownCount:1}],evidenceSets:[],capabilityGaps:[{id:'f2',need:'original missing operation',status:'UNAVAILABLE'}]})
 assert.ok(x.reply.includes('gpt-6-astra'));assert.ok(x.reply.includes('claude-sonnet-5-5'))
 assert.equal(x.capabilityValidation.boundDelegationFacts,5);assert.equal(x.capabilityCoverage.state,'partial','old unmapped goal must remain an explicit gap')
 assert.ok(x.reply.includes('original missing operation'))
})
module.exports={fixture}
