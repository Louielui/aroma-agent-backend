'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {renderSourceBoundFindings}=require('./sourceBoundFindings')

const section=(section,sourceId,records,more={})=>({section,sourceId,state:'partial',records,...more})
const report=(focus,sections,more={})=>({focus,sections,readOnly:true,...more})

test('one selected failed run yields a short, cited reason and leaves current repair unverified',()=>{
 const r=report('work_failure',[section('work','work:fresh',[
  {sourceId:'failed-run',state:'failed',reason:'source_dirty',fixedInCurrentVersion:null},
  {sourceId:'later-unrelated',state:'completed',reason:null}
 ],{latestFailureId:'failed-run'})])
 const zh=renderSourceBoundFindings(r,{message:'上個任務為什麼失敗，現在修好了嗎？'})
 const en=renderSourceBoundFindings(r,{message:'Why did the task fail? Is it fixed?'})
 assert.equal(zh.kind,'work_failure');assert.match(zh.text,/source_dirty/)
 assert.match(zh.text,/尚未確認/);assert.doesNotMatch(zh.text,/later-unrelated/)
 assert.match(en.text,/not confirm/i)
 assert.deepEqual(zh.references,[{sourceId:'work:fresh',recordId:'failed-run',fields:{state:'failed',reason:'source_dirty'}}])
 assert.equal(zh.modelProseUsed,false)
})

test('ambiguous, unreadable, redirected and follow-up work cannot become deterministic findings',()=>{
 const row={sourceId:'failed-run',state:'failed',reason:'source_dirty'}
 const base=report('work_failure',[section('work','work:fresh',[row],{latestFailureId:'failed-run'})])
 assert.equal(renderSourceBoundFindings({...base,readOnly:false}),null)
 assert.equal(renderSourceBoundFindings({...base,continuity:{state:'compared'}}),null)
 assert.equal(renderSourceBoundFindings(report('work_failure',[{...base.sections[0],state:'unavailable'}])),null)
 assert.equal(renderSourceBoundFindings(report('work_failure',[base.sections[0],base.sections[0]])),null)
 assert.equal(renderSourceBoundFindings(report('work_failure',[{...base.sections[0],records:[row,{...row}]}])),null)
 assert.equal(renderSourceBoundFindings(report('work_failure',[{...base.sections[0],records:[{...row,reason:'<script>'}]}])),null)
})

test('background rows use the same bounded source-bound answer shape',()=>{
 const at='2026-10-07T20:00:00Z'
 const r=report('background',[section('configuration','configuration:fresh',[
  {sourceId:'backend:mail_analysis',role:'mail_analysis',currentRunningState:'idle',model:'claude-sonnet',modelBasis:'bridge_route_configuration',evidenceBasis:'live_process_snapshot',at}
 ])])
 const x=renderSourceBoundFindings(r,{message:'哪些背景工作在運行？'})
 assert.equal(x.kind,'background');assert.match(x.text,/電郵分析.*未在執行.*claude-sonnet/)
 assert.equal(x.references[0].sourceId,'configuration:fresh')
 assert.equal(x.references[0].recordId,'backend:mail_analysis')
})

test('cost findings retain the verified receipt and billing gap; general questions need semantic review',()=>{
 const cost=report('cost',[section('billing','billing:fresh',[],{state:'unconnected'})])
 const x=renderSourceBoundFindings(cost,{message:'credit?'})
 assert.equal(x.kind,'cost');assert.match(x.text,/charges.*unconfirmed/i)
 assert.deepEqual(x.references.map(r=>r.sourceId),['billing:fresh'])
 assert.equal(renderSourceBoundFindings({...cost,focus:'general'}),null)
})
