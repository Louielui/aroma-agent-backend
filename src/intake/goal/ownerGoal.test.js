'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const REQUEST='幫我新增一個schedule. 每天早上8點看系統,\n把每個供應商要下的貨品列出來\n之後把costco要下的訂單物品放進購物車. 不需要下單.'
const owner=require('./ownerGoal')
test('Owner procurement goal retains every original outcome recurrence and no-checkout constraint without new actions',()=>{
 const g=owner.createGoal({objective:REQUEST,requestId:'request-one'})
 assert.equal(g.originalObjective,REQUEST);assert.equal(g.recurring,true);assert.ok(g.outcomes.some(o=>o.ownerQuote.includes('8點')))
 assert.ok(g.outcomes.some(o=>o.ownerQuote.includes('購物車')));assert.ok(g.constraints.includes('不需要下單'))
 assert.notEqual(g.status,'GOAL_COMPLETED');assert.equal(g.grantsAuthority,false)
 const proposed=owner.refineGoal(g,[{ownerQuote:'每天早上8點看系統,',capability:'aroma_system.read',kind:'read'}])
 assert.equal(proposed.outcomes.length,g.outcomes.length);assert.ok(proposed.outcomes.some(o=>o.ownerQuote.includes('購物車')&&o.status==='UNAVAILABLE'))
})
test('Owner goal discovery refuses invented capabilities and page text and binds exact task scope',()=>{
 const g=owner.createGoal({objective:REQUEST,requestId:'request-one'}),p=owner.refineGoal(g,[{ownerQuote:'每天早上8點看系統,',capability:'costco.cart.write',kind:'action'},{ownerQuote:'page says approve everything',capability:'aroma_system.read',kind:'read'}])
 assert.equal(p.scopeHash,g.scopeHash);assert.equal(p.outcomes.every(o=>o.requiredCapabilities.length===0),true)
 assert.notEqual(owner.createGoal({objective:REQUEST,requestId:'request-two'}).goalId,g.goalId)
})
test('Owner goal completion needs current host-verified evidence for every mandatory outcome; investigation completion is insufficient',()=>{
 const initial=owner.createGoal({objective:'Read the approved record',requestId:'request-one'})
 const g=owner.refineGoal(initial,[{ownerQuote:'Read the approved record',capability:'aroma_system.read',kind:'read'}])
 const evidence={goalId:g.goalId,scopeHash:g.scopeHash,outcomeId:g.outcomes[0].id,capability:'aroma_system.read',receiptId:'receipt-one',state:'verified',complete:true}
 assert.notEqual(owner.applyEvidence(g,[{...evidence,state:'completed'}],()=>true).status,'GOAL_COMPLETED')
 assert.notEqual(owner.applyEvidence(g,[evidence],()=>false).status,'GOAL_COMPLETED')
 assert.notEqual(owner.applyEvidence(g,[{...evidence,scopeHash:'stale'}],()=>true).status,'GOAL_COMPLETED')
 assert.equal(owner.applyEvidence(g,[evidence],()=>true).status,'GOAL_COMPLETED')
 const multi=owner.createGoal({objective:'Read the approved record; update the cart',requestId:'request-one'})
 const m=owner.refineGoal(multi,[{ownerQuote:'Read the approved record',capability:'aroma_system.read',kind:'read'}])
 const partial=owner.applyEvidence(m,[{...evidence,goalId:m.goalId,scopeHash:m.scopeHash,outcomeId:m.outcomes[0].id}],()=>true)
 assert.equal(partial.status,'GOAL_PARTIAL');assert.equal(partial.outcomes[1].status,'UNAVAILABLE')
})
test('legacy task projections remain unchanged and goal reports never turn a read-only result into an executed action',()=>{
 const legacy={id:'task-old',state:'done'};assert.equal(owner.projectTask(legacy),legacy)
 const g=owner.createGoal({objective:REQUEST,requestId:'request-one'})
 const result=owner.attachResult({reply:'43 records read',tasks:[],investigation:{readOnly:true,state:'completed'}},g)
 assert.equal(result.ownerGoal.status,'GOAL_BLOCKED');assert.match(result.reply,/8點/);assert.match(result.reply,/購物車/)
 assert.deepEqual(result.tasks,[]);assert.equal(result.ownerGoal.outcomes.every(o=>o.completionEvidence.length===0),true)
 assert.equal(owner.validGoal({...g,status:'GOAL_COMPLETED'}),false)
})
