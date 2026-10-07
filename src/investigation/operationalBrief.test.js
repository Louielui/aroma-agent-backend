'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {renderOperationalBrief}=require('./operationalBrief')
const report=(focus,sections)=>({version:1,focus,readOnly:true,sections})
test('background summaries name the observed components and distinguish configured models from active inference',()=>{
 const r=report('background',[{section:'configuration',state:'ok',records:[{sourceId:'backend:mail_analysis',role:'mail_analysis',model:'claude-sonnet',modelBasis:'bridge_route_configuration',currentRunningState:'idle',enabled:true,at:'2026-10-07T20:00:00Z',evidenceBasis:'live_process_snapshot'}]}])
 const zh=renderOperationalBrief(r,{message:'哪些背景工作在運行？'}),en=renderOperationalBrief(r,{message:'What background jobs are running?'})
 assert.match(zh,/電郵分析.*未在執行.*claude-sonnet/)
 assert.match(en,/Mail analysis.*idle.*claude-sonnet/i)
 assert.match(en,/route.*configuration|configured.*route/i)
 assert.doesNotMatch(zh,/backend:mail_analysis/)
})
test('English operational briefs retain verified reasons and uncertainty without admitting model prose or claims of repair',()=>{
 const r=report('work_failure',[{section:'work',state:'partial',sourceId:'work:receipt',latestFailureId:'failed-id',records:[{sourceId:'failed-id',state:'failed',reason:'source_dirty',fixedInCurrentVersion:null},{sourceId:'unrelated',state:'completed',tests:{passed:9}}]}])
 const text=renderOperationalBrief(r,{message:'Why did the previous task fail? Is it fixed?',modelReply:'InventedCompany has fixed everything.'})
 assert.match(text,/source_dirty/);assert.match(text,/not.*confirm/i);assert.match(text,/failed-id/);assert.doesNotMatch(text,/InventedCompany|fixed everything|unrelated/)
 assert.match(renderOperationalBrief(r,{message:'上一個任務為什麼失敗？'}),/失敗原因.*source_dirty/)
 assert.equal(renderOperationalBrief({...r,readOnly:false},{message:'Why did it fail?'}),null)
 assert.equal(renderOperationalBrief({...r,focus:'cost'},{message:'What charged my credit?'}),null)
 assert.equal(renderOperationalBrief(report('work_failure',[{section:'work',state:'unavailable',records:[]}]),{message:'Why did it fail?'}).includes('not established'),true)
})

test('mixed-language follow-ups show fresh evidence for the same record, not a newer unrelated failure',()=>{
 const r=report('work_failure',[{section:'work',state:'ok',latestFailureId:'unrelated',records:[{sourceId:'unrelated',state:'failed',reason:'other'},{sourceId:'original',state:'completed',reason:null}]}])
 r.continuity={state:'compared',referenceRunId:'prior',previousAt:'2026-10-07T01:00:00Z',selectedRecordId:'original',targetState:'observed',compared:1,changes:[{recordId:'original',field:'state',before:'failed',after:'completed'}],missing:[],ambiguous:[],changesOmitted:0,provesRepair:false}
 const text=renderOperationalBrief(r,{message:'剛才那個 task，now怎樣？'})
 assert.match(text,/重新讀取/); assert.match(text,/original/); assert.match(text,/failed.*completed/); assert.match(text,/尚未確認/)
 assert.doesNotMatch(text,/unrelated|other/)
 r.continuity.targetState='not_observed';r.continuity.changes=[];r.sections[0].records.shift()
 assert.match(renderOperationalBrief(r,{message:'And now?'}),/previously selected.*not.*observed/i)
})
test('English background briefs bind models to exact roles and keep paused definitions distinct from live observations',()=>{
 const text=renderOperationalBrief(report('background',[{section:'configuration',state:'ok',records:[{role:'central_brain_default',model:'claude-opus-5-5',effort:'medium'}]},{section:'schedules',state:'ok',records:[{sourceId:'codex-automation:a',name:'Fixture',state:'PAUSED',model:null}]},{section:'work',state:'partial',workflows:[{role:'development',state:'idle',model:'gpt-6.1-sol',modelBasis:'host_workflow_default_not_per_job_selection',at:'2026-10-07T00:00:00Z'},{role:'review',state:'occupied',model:'sonnet',modelBasis:'host_workflow_default_not_per_job_selection',at:'2026-10-07T00:00:00Z'}],records:[{state:'running',model:'invented-historical-model'}]}]),{message:'What jobs are configured and running?'})
 assert.match(text,/Fixture.*Paused.*not recorded/);assert.match(text,/Development workflow.*idle.*gpt-6.1-sol/);assert.match(text,/Review workflow.*occupied.*sonnet/);assert.match(text,/claude-opus-5-5/)
 assert.match(text,/does not identify.*named.*running/i);assert.doesNotMatch(text,/invented-historical-model|no jobs are running/)
})
