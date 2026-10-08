'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {renderCostFindings}=require('./costFindings')

const report=()=>({readOnly:true,focus:'cost',billingConfirmed:false,sections:[
 {section:'execution',sourceId:'execution:fresh',state:'partial',records:[
  {sourceId:'invocation:memory',role:'memory_completion',state:'succeeded',modelResultObserved:true,actualModel:'claude-sonnet-5-5',startedAt:'2026-10-08T01:10:19.069Z',usage:{inputTokens:2,cacheReadInputTokens:576,outputTokens:149},usageBasis:'provider_result_model_usage',evidenceBasis:'owner_bridge_invocation_ledger'},
  {sourceId:'invocation:pending',role:'memory_completion',state:'started',modelResultObserved:false,actualModel:null,startedAt:'2026-10-08T01:10:23.759Z',usage:null,evidenceBasis:'owner_bridge_invocation_ledger'}
 ]},
 {section:'schedules',sourceId:'schedules:fresh',state:'ok',records:[{sourceId:'codex-automation:memory',name:'Memory follow-up',state:'PAUSED'}]},
 {section:'billing',sourceId:'billing:fresh',state:'unconnected',records:[]}
]})

test('a bounded credit investigation leads with observed calls and current schedule state while preserving the billing gap',()=>{
 const result=renderCostFindings(report(),{message:'之前有什麼會不停扣 credit？'})
 assert.match(result.text,/claude-sonnet-5-5/)
 assert.match(result.text,/149/)
 assert.match(result.text,/Memory follow-up/)
 assert.match(result.text,/暫停/)
 assert.match(result.text,/扣款.*未確認/)
 assert.doesNotMatch(result.text,/invocation:pending|已證實扣款|已停止扣款/)
 assert.deepEqual(result.references.map(r=>r.recordId),['invocation:memory','codex-automation:memory',null])
 assert.equal(result.scope,'bounded_receipts_not_billing')
 assert.ok(result.text.length<700)
})

test('English answer retains observed-versus-billing distinction and does not infer global absence',()=>{
 const result=renderCostFindings(report(),{message:'What previously used credits, and is it still running?'})
 assert.match(result.text,/model request.*claude-sonnet-5-5/i)
 assert.match(result.text,/paused/i)
 assert.match(result.text,/charge.*unconfirmed/i)
 assert.doesNotMatch(result.text,/no other|nothing else|all jobs/i)
})

test('ambiguous, failed and uncited rows never become cost findings',()=>{
 const p=report()
 p.sections[0].records[0].state='failed'
 p.sections[1].records.push({...p.sections[1].records[0]})
 const result=renderCostFindings(p,{message:'credit?'})
 assert.doesNotMatch(result.text,/claude-sonnet-5-5|Memory follow-up/)
 assert.equal(result.references.length,1)
 assert.equal(result.references[0].sourceId,'billing:fresh')
 assert.equal(renderCostFindings({...p,readOnly:false},{message:'credit?'}),null)
})

test('receipt text is not treated as markdown or a model identity',()=>{
 const p=report()
 p.sections[1].records[0].name='[open](https://example.invalid)'
 p.sections[0].records[0].actualModel='claude-sonnet-5-5 [fake](https://example.invalid)'
 const result=renderCostFindings(p,{message:'credit?'})
 assert.doesNotMatch(result.text,/actual model/)
 assert.match(result.text,/\\\[open\\\]\\\(https:\/\/example.invalid\\\)/)
 assert.equal(result.references[0].recordId,'codex-automation:memory')
})
