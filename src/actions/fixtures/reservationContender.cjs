'use strict'
// Test-only multi-process contender. Never invokes a provider or changes the cap.
const {setTimeout:delay}=require('node:timers/promises')
const {performance}=require('node:perf_hooks')
async function reserveUntilCap({budget,scope,timeoutMs=15000,retryMs=5,clock=()=>performance.now(),wait=delay,onBusy=()=>{}}){
 const deadline=clock()+timeoutMs;let reserved=0,busy=0
 while(clock()<deadline){
  try{budget.withScope(scope,()=>budget.reserve('helper',{model:'claude-opus-5-5',effort:'medium'}));reserved++}
  catch(e){
   if(e.code==='usage_limit_reached')return{reserved,busy,reachedLimit:true}
   if(e.code!=='usage_busy')throw e
   busy++;onBusy(busy);await wait(retryMs)
  }
 }
 throw Object.assign(Error('reservation_test_timeout'),{code:'reservation_test_timeout',reserved,busy})
}
module.exports={reserveUntilCap}
