'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {reserveUntilCap}=require('./fixtures/reservationContender.cjs')
const error=code=>Object.assign(Error(code),{code})
test('contention contender yields through more than 150 busy locks and confirms the unchanged cap',async()=>{
 let time=0,attempts=0,reserved=0,waits=0
 const budget={withScope:(s,fn)=>fn(),reserve:()=>{attempts++;if(attempts<=151)throw error('usage_busy');if(reserved===6)throw error('usage_limit_reached');reserved++;return{}}}
 const r=await reserveUntilCap({budget,scope:{},timeoutMs:1000,clock:()=>time,wait:async()=>{waits++;time++}})
 assert.equal(r.reserved,6);assert.equal(r.busy,151);assert.equal(waits,151);assert.equal(r.reachedLimit,true);assert.equal(attempts,158)
})
test('permanently busy contention ends in a visible bounded failure, never an underfilled success',async()=>{
 let time=0
 const budget={withScope:(s,fn)=>fn(),reserve:()=>{throw error('usage_busy')}}
 await assert.rejects(reserveUntilCap({budget,scope:{},timeoutMs:20,clock:()=>time,wait:async()=>{time+=5}}),e=>e.code==='reservation_test_timeout'&&e.reserved===0&&e.busy===4)
})
test('unexpected reservation errors propagate immediately without retry or provider invocation',async()=>{
 let waits=0,calls=0
 const budget={withScope:(s,fn)=>fn(),reserve:()=>{calls++;throw error('usage_binding_conflict')}}
 await assert.rejects(reserveUntilCap({budget,scope:{},wait:async()=>{waits++}}),/usage_binding_conflict/);assert.equal(calls,1);assert.equal(waits,0)
})
