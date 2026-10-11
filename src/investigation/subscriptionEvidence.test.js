'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {quota,usage}=require('../subscription/subscriptionEvidence'),{evaluateInvestigation}=require('./intelligence'),{renderCostFindings}=require('./costFindings')
const at='2026-10-09T13:00:00.000Z',reset=Date.parse('2026-10-09T14:00:00.000Z')/1000
const record=()=>({sourceId:'codex-account-snapshot',provider:'gpt',evidenceBasis:'official_subscription_account_metadata',at,quota:quota({rateLimitsByLimitId:{codex:{primary:{usedPercent:80,windowDurationMins:300,resetsAt:reset},credits:{balance:'15'}}}},at),activity:usage({summary:{lifetimeTokens:10000},dailyUsageBuckets:[{startDate:'2026-10-09',tokens:200}]},at)})
const section=records=>({section:'usage',state:'partial',sourceId:'usage:fixture',retrievedAt:at,records})
test('real adapter continues from missing legacy usage to subscription source, with no unrelated reads',async()=>{
 let calls=0
 const a=require('../context/adapters/xiangxiangOperationsRead').createXiangxiangOperationsReadAdapter({dataDir:__dirname,subscriptionReader:async()=>{calls++;return{state:'partial',records:[record()],coverage:{claudeQuota:'unconnected'}}},executionReader:()=>{throw Error('unrelated')}})
 const raw=await a.methods.readInvestigation({sections:['usage']});assert.equal(calls,1);assert.equal(raw.results[0].fields.coverage.legacy,'missing')
 const r=evaluateInvestigation({focus:'cost',sections:raw.results.map(s=>({...s.fields,sourceId:s.sourceId,retrievedAt:s.retrievedAt}))})
 assert.equal(r.executionUsage.subscriptionEvidence.receipt.quota.buckets[0].primary.remainingPercent,20)
 assert.equal(r.billingConfirmed,false);assert.equal(r.executionUsage.subscriptionCreditUsed,null);assert.equal(r.executionUsage.chains.length,0)
 assert.ok(r.evidenceModel.assertions.some(a=>a.facet==='credit_balance'&&a.state==='CONFIRMED'&&a.value==='15'))
 assert.ok(r.evidenceModel.assertions.some(a=>a.facet==='account_to_job_charge'&&a.state==='UNKNOWN'))
 assert.equal(r.evidenceModel.assertions.some(a=>a.facet==='estimated_usage'),false)
 for(const message of ['現在剩餘多少額度？','How much quota remains?']){
  const view=renderCostFindings(r,{message});assert.match(view.text,/20%/);assert.match(view.text,/15/);assert.match(view.text,/10000/);assert.match(view.text,/200/)
  assert.match(view.text,/不只香香|not (?:Imagine|Xiangxiang) only/);assert.match(view.text,/未確認|not confirmed/);assert.ok(view.references.some(x=>x.recordId==='codex-account-snapshot'))
 }
})
test('same-time conflicting account snapshots are withheld and quota cannot grant per-job charge evidence',()=>{
 const one=record(),two=record();two.quota.buckets[0].credits.balance='99'
 const r=evaluateInvestigation({focus:'cost',sections:[section([one,two])]})
 assert.equal(r.executionUsage.subscriptionEvidence.state,'CONTRADICTED');assert.equal(r.executionUsage.subscriptionEvidence.receipt,null)
 assert.match(renderCostFindings(r,{message:'quota'}).text,/conflict/);assert.equal(r.billingConfirmed,false)
})
test('source failure is visible even when there are no execution receipts; never a zero balance',()=>{
 const r=evaluateInvestigation({focus:'cost',sections:[{...section([]),state:'unavailable'}]})
 assert.equal(r.executionUsage.subscriptionEvidence.state,'UNAVAILABLE');const v=renderCostFindings(r,{message:'quota'})
 assert.match(v.text,/Codex quota unavailable/);assert.doesNotMatch(v.text,/balance: 0/)
})
test('conflicting daily counts survive grading and unsafe extra fields never reach source-bound display references',()=>{
 const r=record();r.quota.secret='do not expose';r.activity=usage({dailyUsageBuckets:[{startDate:'2026-10-09',tokens:1},{startDate:'2026-10-09',tokens:9}]},at)
 const report=evaluateInvestigation({focus:'cost',sections:[section([r])]})
 assert.equal(report.executionUsage.subscriptionEvidence.receipt.activity.dailyUsageBuckets[0].evidenceState,'CONTRADICTED')
 const v=renderCostFindings(report,{message:'quota'});assert.doesNotMatch(JSON.stringify(v),/do not expose/);assert.doesNotMatch(v.text,/2026-10-09: [19] tokens/)
})
