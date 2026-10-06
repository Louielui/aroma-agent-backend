'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {definition,createRegistry,INTERFACE_FILES,CHAT_FILES}=require('./contract'),{digest}=require('../../workers/execution/windowsSandbox'),{createMemoryRunStore}=require('../operating/runStore')
test('legacy browser registrations keep their sealed definition while fresh tasks receive provider-aware checks',()=>{
 for(const editable of [[INTERFACE_FILES[1]],[CHAT_FILES[2]]]){
  const store=createMemoryRunStore(),id=randomUUID(),input={requestId:randomUUID(),bootCommit:'a'.repeat(40),goal:'Spacing improvement',criteria:['Keep existing controls'],editable},generated={testCode:"const test=require('node:test'),assert=require('node:assert/strict');",expectedTests:3}
  const registration=definition(id,input,generated,{legacyBrowser:true}),snapshot={hash:'original'},review={verdict:'pass',billing:'claude-subscription'},approvalHash=digest(JSON.stringify({registration,snapshot,review}))
  store.save({id,state:'registered',input,generated,registration,snapshot,acceptanceReview:review,approvalHash,steps:[{stage:'registered',facts:{actor:'owner',hash:approvalHash}}]})
  assert.deepEqual(createRegistry(store).resolve(registration.workOrder.recipe),registration)
  const fresh=definition(randomUUID(),input,generated)
  assert.equal(fresh.workOrder.version,editable[0].includes('sidebar')?3:2)
  assert.match(fresh.tests['acceptance/chat-browser.test.cjs'],/edge-headless-offline-v2/)
  assert.match(registration.tests['acceptance/chat-browser.test.cjs'],/edge-headless-offline-v1/)
  const tampered=store.get(id);tampered.registration.tests['acceptance/chat-browser.test.cjs']=fresh.tests['acceptance/chat-browser.test.cjs'];store.save(tampered)
  assert.throws(()=>createRegistry(store).resolve(registration.workOrder.recipe),/invalid_request/)
 }
})
