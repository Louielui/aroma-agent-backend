'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {handleIntakeError}=require('./intakeDiagnostics')
test('real local budget storage failure has a safe wire diagnostic without writes',()=>{
 const usage=require('../actions/usageBudget'),p=usage.LOCAL_BOUNDARY_PROFILE
 let writes=0
 const store={lockRun:()=>()=>{},get:()=>{throw Error('private store failure')},save:()=>{writes++;throw Error('write_forbidden')}}
 const budget=usage.createUsageBudget({store,profile:p,evidenceDir:'unused'})
 let error;try{budget.reserve('helper',{})}catch(e){error=e}
 assert.equal(error?.code,'usage_audit_unavailable');assert.equal(writes,0)
 let diagnostic;const result=JSON.parse(JSON.stringify(handleIntakeError(error,{correlationId:'paused-fixture'},{sink:e=>{diagnostic=e}})))
 assert.equal(result.status,503);assert.equal(result.body.error.code,'usage_audit_unavailable')
 assert.equal(result.body.error.retryable,false);assert.equal(result.body.error.correlationId,'paused-fixture')
 assert.match(result.body.error.message,/證據|用量/);assert.equal(diagnostic.stage,'usage_budget')
 assert.equal(diagnostic.code,'usage_audit_unavailable');assert.equal(writes,0)
})
test('a code/name impostor and unknown budget failures keep the generic safe boundary',()=>{
 const e=Object.assign(Error('secret path token'),{name:'UsageBudgetError',code:'usage_run_not_active'})
 assert.equal(handleIntakeError(e,{}, {sink(){}}).body.error.code,'internal_error')
 const {UsageBudgetError}=require('../actions/usageError')
 assert.equal(handleIntakeError(new UsageBudgetError('private_unknown'),{}, {sink(){}}).body.error.code,'internal_error')
})
test('paused, expired, capped and unbound errors remain non-retryable with correlation evidence',()=>{
 const {UsageBudgetError}=require('../actions/usageError')
 for(const [code,status]of [['usage_run_not_active',409],['usage_expired',409],['usage_limit_reached',429],['usage_scope_required',409],['usage_busy',503]]){
  const e=new UsageBudgetError(code);e.privateText='secret token path';e.correlationId='fixture-id'
  let diag;const r=JSON.parse(JSON.stringify(handleIntakeError(e,{}, {sink:v=>{diag=v}})))
  assert.equal(r.status,status);assert.equal(r.body.error.code,code);assert.equal(r.body.error.retryable,false)
  assert.equal(r.body.error.correlationId,'fixture-id');assert.equal(diag.code,code);assert.equal(diag.stage,'usage_budget')
  assert.ok(!JSON.stringify({r,diag}).includes('secret token path'))
 }
})
