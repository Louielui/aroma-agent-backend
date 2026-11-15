'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{apply}=require('../../src/localBrain/dispatchProfile')
test('versioned host profile opens control only; explicit off remains off and caller text cannot activate it',()=>{
 const profile={controlledDispatch:'owner_scoped_subscription'},env={}
 apply(env,profile);assert.equal(env.XIANGXIANG_CONTROLLED_DISPATCH,'on');assert.equal(env.LOCAL_BRAIN_ONLY,undefined)
 const off={XIANGXIANG_CONTROLLED_DISPATCH:'off'};apply(off,profile);assert.equal(off.XIANGXIANG_CONTROLLED_DISPATCH,'off')
 const unknown={};apply(unknown,{controlledDispatch:'on'});assert.equal(unknown.XIANGXIANG_CONTROLLED_DISPATCH,undefined)
 assert.throws(()=>apply({XIANGXIANG_CONTROLLED_DISPATCH:'maybe'},profile),/controlled_dispatch_configuration_invalid/)
})
