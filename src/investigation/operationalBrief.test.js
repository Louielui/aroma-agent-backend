'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {renderOperationalBrief}=require('./operationalBrief')
const report=(focus,sections)=>({version:1,focus,readOnly:true,sections})
test('English operational briefs retain verified reasons and uncertainty without admitting model prose or claims of repair',()=>{
 const r=report('work_failure',[{section:'work',state:'partial',sourceId:'work:receipt',latestFailureId:'failed-id',records:[{sourceId:'failed-id',state:'failed',reason:'source_dirty',fixedInCurrentVersion:null},{sourceId:'unrelated',state:'completed',tests:{passed:9}}]}])
 const text=renderOperationalBrief(r,{message:'Why did the previous task fail? Is it fixed?',modelReply:'InventedCompany has fixed everything.'})
 assert.match(text,/source_dirty/);assert.match(text,/not.*confirm/i);assert.match(text,/failed-id/);assert.doesNotMatch(text,/InventedCompany|fixed everything|unrelated/)
 assert.equal(renderOperationalBrief(r,{message:'上一個任務為什麼失敗？'}),null)
 assert.equal(renderOperationalBrief({...r,readOnly:false},{message:'Why did it fail?'}),null)
 assert.equal(renderOperationalBrief({...r,focus:'cost'},{message:'What charged my credit?'}),null)
 assert.equal(renderOperationalBrief(report('work_failure',[{section:'work',state:'unavailable',records:[]}]),{message:'Why did it fail?'}).includes('not established'),true)
})
test('English background briefs bind models to exact roles and keep paused definitions distinct from live observations',()=>{
 const text=renderOperationalBrief(report('background',[{section:'configuration',state:'ok',records:[{role:'central_brain_default',model:'claude-opus-5-5',effort:'medium'}]},{section:'schedules',state:'ok',records:[{sourceId:'codex-automation:a',name:'Fixture',state:'PAUSED',model:null}]},{section:'work',state:'partial',workflows:[{role:'development',state:'idle',model:'gpt-6.1-sol',modelBasis:'host_workflow_default_not_per_job_selection',at:'2026-10-07T00:00:00Z'},{role:'review',state:'occupied',model:'sonnet',modelBasis:'host_workflow_default_not_per_job_selection',at:'2026-10-07T00:00:00Z'}],records:[{state:'running',model:'invented-historical-model'}]}]),{message:'What jobs are configured and running?'})
 assert.match(text,/Fixture.*Paused.*not recorded/);assert.match(text,/Development workflow.*idle.*gpt-6.1-sol/);assert.match(text,/Review workflow.*occupied.*sonnet/);assert.match(text,/claude-opus-5-5/)
 assert.match(text,/does not identify.*named.*running/i);assert.doesNotMatch(text,/invented-historical-model|no jobs are running/)
})
