'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createGateway, OWNER } = require('../memory/governed')
const { projectProgress, buildWorkPurpose, renderWorkPurpose } = require('./workPurpose')
const at = '2026-10-10T12:00:00.000Z'
const never = () => { throw Error('unexpected_write_model_or_network') }
const row = (index, consolidation) => ({ status:'active', type:'episodic', scope:'private:owner', text:'PRIVATE_BODY', subject:'PRIVATE_SUBJECT', source:{kind:'conversation',attribution:'owner_statement'}, index, details:consolidation?{consolidation}:{} })
test('canonical memory failure evidence preserves reason, retry policy and observed success without reading contents or performing work', async () => {
 const rows = [
  row({state:'unconfirmed',reason:'memory_timeout',attempts:2,checkedAt:'2026-10-10T11:50:00Z',nextRetryAt:'2026-10-10T11:55:00Z'}, {state:'failed',error:'invalid_consolidation',attempts:3,checkedAt:at,nextRetryAt:null}),
  row({state:'unconfirmed',reason:'memory_unauthorized',attempts:1,checkedAt:at,nextRetryAt:null}, {state:'failed',error:'consolidation_unavailable',attempts:1,checkedAt:at,nextRetryAt:'2026-10-10T12:05:00Z'}),
  row({state:'unconfirmed',reason:'SECRET_ERROR',attempts:3,checkedAt:at,nextRetryAt:null}),
  row({state:'saved',checkedAt:'2026-10-10T11:00:00Z'}, {state:'empty',checkedAt:'2026-10-10T10:00:00Z'}),
  {...row({state:'unconfirmed',reason:'memory_timeout',attempts:3}),source:{kind:'admin_mail_thread'}}
 ]
 const g = createGateway({store:{generalRows:async()=>rows,commit:never,health:never,all:never},engine:{forScope:never},clock:()=>at})
 await assert.rejects(g.progress({id:'agent',role:'agent'}),/permission_denied/)
 const p = await g.progress(OWNER)
 assert.equal(p.memory_index.diagnostics.failed,3)
 assert.deepEqual(p.memory_index.diagnostics.retry,{scheduled:0,due:1,exhausted:0,blocked:1,unknown:1})
 assert.equal(p.memory_index.diagnostics.lastRecordedSuccessAt,'2026-10-10T11:00:00.000Z')
 assert.deepEqual(p.memory_consolidation.diagnostics.retry,{scheduled:1,due:0,exhausted:1,blocked:0,unknown:0})
 assert.equal(p.memory_consolidation.diagnostics.lastRecordedSuccessAt,'2026-10-10T10:00:00.000Z')
 assert.doesNotMatch(JSON.stringify(p),/PRIVATE|SECRET_ERROR|admin_mail/)
 for(const role of ['memory_index','memory_consolidation']) {
  const projected = projectProgress(role,p[role]);assert.equal(projected.diagnostics.failed,p[role].diagnostics.failed)
 }
 const report={sections:[{section:'configuration',state:'partial',sourceId:'canonical:test',records:Object.entries(p).map(([role,progress])=>({sourceId:'backend:'+role,role,at,evidenceBasis:'live_process_snapshot',progressState:'ok',progress}))}]}
 const value=buildWorkPurpose(report,{now:Date.parse(at)})
 for(const message of ['記憶處理為什麼有失敗？會影響什麼？','Why did memory processing fail, and what is affected?']) {
  const view=renderWorkPurpose(value,{message});assert.match(view.text,/逾時|timed out/);assert.match(view.text,/重試上限|retry limit/)
  assert.match(view.text,/根本原因.*未確認|root cause.*unconfirmed/i);assert.doesNotMatch(view.text,/PRIVATE|SECRET_ERROR|⟦\?/)
 }
})
test('missing or inconsistent diagnostic evidence is unknown, never invented or a false zero', () => {
 const {buildDiagnostics,projectDiagnostics}=require('./memoryFailures')
 const d=buildDiagnostics('memory_index',[row({state:'unconfirmed'})],at)
 assert.equal(d.retry.unknown,1);assert.equal(d.lastRecordedSuccessAt,null)
 assert.equal(projectDiagnostics('memory_index',d,2,at),null)
 assert.equal(projectDiagnostics('memory_index',{...d,retry:{...d.retry,exhausted:1}},1,at),null)
 assert.equal(projectDiagnostics('memory_index',{...d,lastRecordedSuccessAt:'2099-01-01T00:00:00Z'},1,at),null)
 assert.equal(projectDiagnostics('memory_index',null,1,at),null)
 const scheduled=buildDiagnostics('memory_index',[row({state:'unconfirmed',reason:'memory_timeout',attempts:1,checkedAt:at,nextRetryAt:'2026-10-10T12:05:00Z'})],at)
 const invalid=structuredClone(scheduled);invalid.reasons[0].retry={scheduled:0,due:1,exhausted:0,blocked:0,unknown:0};invalid.retry={...invalid.reasons[0].retry}
 assert.equal(projectDiagnostics('memory_index',invalid,1,at),null)
})
test('retry status requires consistent attempts and timestamps and never infers a root cause from generic availability',()=>{
 const {buildDiagnostics,projectDiagnostics}=require('./memoryFailures')
 const d=buildDiagnostics('memory_index',[
  row({state:'unconfirmed',reason:'memory_unavailable',attempts:3,checkedAt:at,nextRetryAt:null}),
  row({state:'unconfirmed',reason:'memory_timeout',attempts:2,checkedAt:'2099-01-01T00:00:00Z',nextRetryAt:null}),
  row({state:'unconfirmed',reason:'memory_timeout',attempts:3,checkedAt:at,nextRetryAt:'2026-10-10T12:05:00Z'}),
  row({state:'unconfirmed',reason:'memory_timeout',attempts:1,checkedAt:at,nextRetryAt:'2026-10-10T11:59:00Z'})
 ],at)
 assert.deepEqual(d.retry,{scheduled:0,due:0,exhausted:1,blocked:0,unknown:3})
 assert.equal(d.rootCauseConfirmed,false);assert.equal(d.missingFailureTime,1)
 assert.equal(projectDiagnostics('memory_index',d,4,at).rootCauseConfirmed,false)
})
test('stale, contradictory and unavailable failure snapshots retain uncertainty and never become current reasons',()=>{
 const {buildDiagnostics}=require('./memoryFailures')
 const diagnostics=buildDiagnostics('memory_index',[row({state:'unconfirmed',reason:'memory_timeout',attempts:3,checkedAt:at,nextRetryAt:null})],at)
 const progress={version:1,at,unit:'memory_record',scope:'active_general_memory_records',counts:{total:1,saved:0,raw_only:0,pending:0,unconfirmed:1,source_only:0,other:0},diagnostics}
 const record={sourceId:'backend:memory_index',role:'memory_index',at,evidenceBasis:'live_process_snapshot',progressState:'ok',progress}
 const r={sections:[{section:'configuration',state:'partial',sourceId:'one',records:[record]}]}
 assert.equal(buildWorkPurpose(r,{now:Date.parse(at)+300001}).jobs[0].progress,null)
 const changed={...progress,diagnostics:buildDiagnostics('memory_index',[row({state:'unconfirmed',reason:'memory_unavailable',attempts:3,checkedAt:at,nextRetryAt:null})],at)}
 r.sections[0].records.push({...record,progress:changed})
 assert.equal(buildWorkPurpose(r,{now:Date.parse(at)}).jobs[0].progressState,'CONTRADICTED')
 r.sections[0].records=[{...record,progressState:'unavailable'}]
 assert.equal(buildWorkPurpose(r,{now:Date.parse(at)}).jobs[0].progressState,'UNAVAILABLE')
})
