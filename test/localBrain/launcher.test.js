'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const {ready}=require('../../scripts/localBrain/launch.cjs')
test('launcher readiness refuses errors, redirects and absent health routes',async()=>{
  for(const status of [302,401,404,500,501]){
    let calls=0
    await assert.rejects(ready('http://127.0.0.1:11437/health',{attempts:2,waitFn:async()=>{},fetchFn:async()=>{calls++;return {status}}}),/isolated_service_not_ready/)
    assert.equal(calls,2)
  }
})
test('launcher readiness accepts health success without model generation',async()=>{
  let calls=0
  await ready('http://127.0.0.1:11437/health',{waitFn:async()=>{},fetchFn:async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:11437/health');assert.equal(options.redirect,'error');return {status:200}}})
  assert.equal(calls,1)
})
