'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {request,definition}=require('./contract'),{randomUUID}=require('node:crypto')
const input=()=>{const id=randomUUID();return{id,bootCommit:'a'.repeat(40),requestId:randomUUID(),goal:'Repair a registered Node module',criteria:['Preserve existing behavior'],editable:['src/logic.js'],execution:'local',scope:{profile:'repository',files:['src/logic.js'],budgetRoot:id}}}
test('local selection is sealed into registered source and never inherits cloud effort or billing',()=>{
 const {id,...v}=input(),d=definition(id,request(v),{testCode:"const test=require('node:test'),assert=require('node:assert/strict');",expectedTests:3})
 assert.equal(d.workOrder.execution,'local');assert.equal(d.workOrder.billing,'local');assert.deepEqual(d.workOrder.providers,['local']);assert.equal(d.workOrder.effort,undefined)
 assert.equal(d.workOrder.localSelection.digest,require('../../localBrain/deploymentProfile.json').digest)
 const other=definition(id,request((({execution,...r})=>r)(v)),{testCode:"const test=require('node:test'),assert=require('node:assert/strict');",expectedTests:3});assert.notEqual(other.workOrder.registrationHash,d.workOrder.registrationHash)
 assert.throws(()=>request({...v,execution:'cloud'}),/invalid_request/)
 const {scope,...fixed}=v;assert.throws(()=>request({...fixed,editable:['src/context/contextResult.js']}),/invalid_request/)
})
test('local package rejects non-Node and oversized source before model dispatch',()=>{
 const {validateSnapshot}=require('./localScope')
 assert.doesNotThrow(()=>validateSnapshot({order:{files:{'src/logic.js':'module.exports=1','acceptance/registered-task.test.cjs':''}}}))
 for(const files of [{'src/demo/assets/app.js':'x'},{'src/style.css':'x'},{'src/logic.js':'x'.repeat(24577)}])assert.throws(()=>validateSnapshot({order:{files}}),/local_package_limit/)
})
