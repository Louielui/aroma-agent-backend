'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {evaluateInvestigation}=require('./intelligence')
const s=(name,records,at='2026-10-07T20:00:00Z')=>({section:name,sourceId:name+':receipt',retrievedAt:at,state:'partial',records})
test('same live component conflicts cannot be hidden in currentRunningState; dated activity changes are transitions',()=>{
 const row=(state,at)=>({sourceId:'backend:mail_analysis',role:'mail_analysis',currentRunningState:state,at,evidenceBasis:'live_process_snapshot'})
 const same='2026-10-07T20:00:00Z',later='2026-10-07T20:01:00Z'
 const r=evaluateInvestigation({focus:'background',sections:[s('configuration',[row('idle',same)]),s('configuration',[row('active',same),{...row('idle',same),sourceId:'other'}]),s('configuration',[row('active',later)])]})
 assert.equal(r.contradictions.length,1);assert.equal(r.contradictions[0].field,'currentRunningState')
 assert.equal(r.transitions.length,0)
 const changed=evaluateInvestigation({focus:'background',sections:[s('configuration',[row('idle',same),row('active',later)])]})
 assert.equal(changed.contradictions.length,0);assert.equal(changed.transitions.length,1)
 const previous={state:'available',focus:'background',investigation:{sections:[s('configuration',[row('idle',same)])]}}
 const compared=require('./continuity').compareInvestigation({readOnly:true,focus:'background',sections:[s('configuration',[row('active',later)])]},previous,'previous')
 assert.deepEqual(compared.changes.map(c=>[c.field,c.before,c.after]),[['currentRunningState','idle','active']])
})
test('background reference budget preserves the registered component models and live values, with bounded history',()=>{
 const rows=['central_brain_default','chat_completion','memory_completion','mail_sync','mail_analysis','mail_index','memory_index','memory_outbox','memory_consolidation'].map(role=>({role,sourceId:role,currentRunningState:'idle',model:'claude-sonnet'}))
 const catalog=require('./semanticAnswer').referenceCatalog({focus:'background',sections:[s('configuration',rows),s('history',Array.from({length:50},(_,i)=>({sourceId:'h'+i,state:'old'})))]})
 assert.equal(catalog.sections[0].records.length,9)
 assert.equal(catalog.sections[0].records.find(r=>r.recordId==='memory_consolidation').fields.currentRunningState,'idle')
 assert.equal(catalog.sections[1].records.length,6)
 assert.ok(JSON.stringify(catalog).length<18000)
})
test('live background activity is a bounded observation; configured models and old executions stay separate',()=>{
 const r=evaluateInvestigation({focus:'background',sections:[s('configuration',[
  {role:'central_brain_default',model:'claude-opus-5-5'},
  {sourceId:'backend:mail_analysis',role:'mail_analysis',currentRunningState:'active',model:'claude-sonnet',modelBasis:'bridge_route_configuration',evidenceBasis:'live_process_snapshot'}]),
  s('work',[{sourceId:'old',state:'running',model:'gpt-6.1-sol',at:'2026-10-01T00:00:00Z'}])]})
 const live=r.findings.find(x=>x.kind==='background_activity_observed')
 assert.equal(live.value.state,'active');assert.equal(live.value.modelBasis,'bridge_route_configuration')
 assert.equal(r.findings.find(x=>x.kind==='work_recorded').temporalScope,'historical')
 assert.equal(r.billingConfirmed,false);assert.ok(r.gaps.some(x=>x.section==='live_worker_activity'))
})
test('same-identity same-facet opposing current observations conflict; historical and different roles do not',()=>{
 const sections=[s('schedules',[{sourceId:'task',state:'INSTALLED',at:'2026-10-07T20:00:00Z'}]),
 s('schedules',[{sourceId:'task',state:'NOT_INSTALLED',at:'2026-10-07T20:00:00Z'}]),
 s('work',[{sourceId:'task',state:'failed',at:'2026-10-01T00:00:00Z'}]),
 s('configuration',[{sourceId:'backend:mail_analysis',role:'mail_analysis',model:'claude-sonnet'},{sourceId:'brain',role:'central_brain_default',model:'claude-opus-5-5'}])]
 const r=evaluateInvestigation({focus:'background',sections})
 assert.equal(r.contradictions.length,1);assert.equal(r.contradictions[0].recordId,'task')
 assert.equal(r.transitions.length,0)
})
