'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {argumentsOf,interactiveOwner}=require('./approvePromotion.cjs')
test('approval entry rejects short SHA, approval JSON, arbitrary commands and non-interactive callers',()=>{
 const good=['inspect','--candidate','a'.repeat(40),'--pr','109','--evidence-run','00000000-0000-4000-8000-000000000001','--readiness','00000000-0000-4000-8000-000000000002']
 assert.equal(argumentsOf(good.slice()).options.commit,'a'.repeat(40))
 for(const args of [['approve','--approval-json','anything'],['inspect','--candidate','abc','--pr','109','--evidence-run',good.at(-1)],[...good,'--command','restart']])assert.throws(()=>argumentsOf(args))
 assert.equal(interactiveOwner({isTTY:false},{isTTY:true},'win32',{username:'louis',homedir:'C:/Users/louis'}),false)
 assert.equal(interactiveOwner({isTTY:true},{isTTY:true},'win32',{username:'model',homedir:'C:/Users/louis'}),false)
})
