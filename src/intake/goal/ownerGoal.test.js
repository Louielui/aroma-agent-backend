'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const REQUEST='幫我新增一個schedule. 每天早上8點看系統,\n把每個供應商要下的貨品列出來\n之後把costco要下的訂單物品放進購物車. 不需要下單.'
const owner=require('./ownerGoal')
if(process.argv[2]==='--intent-probe'){
 process.stdout.write(JSON.stringify(owner.isTaskRequest(process.argv[3])))
}else{
test('Owner procurement goal retains every original outcome recurrence and no-checkout constraint without new actions',()=>{
 const g=owner.createGoal({objective:REQUEST,requestId:'request-one'})
 assert.equal(g.originalObjective,REQUEST);assert.equal(g.recurring,true);assert.ok(g.outcomes.some(o=>o.ownerQuote.includes('8點')))
 assert.ok(g.outcomes.some(o=>o.ownerQuote.includes('購物車')));assert.ok(g.constraints.includes('不需要下單'))
 assert.notEqual(g.status,'GOAL_COMPLETED');assert.equal(g.grantsAuthority,false)
 const proposed=owner.refineGoal(g,[{ownerQuote:'每天早上8點看系統',capability:'aroma_system.read',kind:'read'}])
 assert.equal(proposed.outcomes.length,g.outcomes.length);assert.ok(proposed.outcomes.some(o=>o.ownerQuote.includes('購物車')&&o.status==='UNAVAILABLE'))
})
test('negative compound clauses and reminders never erase a positive mandatory outcome',()=>{
 assert.equal(owner.shouldTrack("Don't forget to schedule it daily"),true);assert.equal(owner.shouldTrack('不要下單'),false)
 for(const [text,positive]of [["Don't checkout, just add the items to the cart",'just add the items to the cart'],['不要下單，只放進購物車','只放進購物車'],["Don't forget to schedule it daily","Don't forget to schedule it daily"]]){
  const goal=owner.createGoal({objective:'Read the approved record; '+text,requestId:'negative-fixture'})
  assert.ok(goal.outcomes.some(o=>o.ownerQuote===positive));assert.equal(goal.originalObjective,'Read the approved record; '+text)
  const refined=owner.refineGoal(goal,[{ownerQuote:'Read the approved record',capability:'aroma_system.read',kind:'read'}]),e={goalId:goal.goalId,scopeHash:goal.scopeHash,outcomeId:'outcome-0',capability:'aroma_system.read',receiptId:'read',state:'verified',complete:true}
  assert.equal(owner.applyEvidence(refined,[e],()=>true).status,'GOAL_PARTIAL')
 }
})
test('canonical goal reporting preserves deterministic read rows and purges false completion from every narrative field',()=>{
 const goal=owner.createGoal({objective:'每天早上8點看庫存並補貨',requestId:'answer-fixture'}),row={source:'aroma_system',sourceId:'fixture-onion',title:'Onion',entityType:'inventory_item',fields:{name:'Onion',unit:'kg',currentStock:2,parLevel:20}}
 const draft='All schedules and Costco cart operations are completed',view=require('../readResultView').buildReadResultReply({ownerGoalReporting:true,message:goal.originalObjective,reply:draft,answerPlan:{directAnswer:draft},itemsBySource:[{source:'aroma_system',operation:'aroma_system.inventory',readKey:'aroma_system.inventory',usedFallback:false,items:[row]}],perSource:[{source:'aroma_system',trust:'live',count:1,usedFallback:false}],evidenceSets:[]})
 assert.match(view.reply,/Onion/);assert.doesNotMatch(view.reply,/All schedules/)
 const result=owner.attachResult({reply:draft,replyForArchive:draft,judgment:draft,reasons:[draft],offer:draft,next_step:draft},goal,{readReply:view.reply})
 assert.match(result.reply,/Onion/);assert.equal(result.replyForArchive,result.reply);assert.ok(!JSON.stringify(result).includes(draft));assert.equal(result.ownerGoal.status,'GOAL_BLOCKED')
})
test('host-originated clarification stays visible and archived beside incomplete whole-goal status',()=>{
 const goal=owner.createGoal({objective:'Create a daily schedule',requestId:'clarification-fixture'}),hostReply=require('../groundedReply').buildGroundedReply({type:'clarification',clarificationReason:'no_actionable_task'})
 const result=owner.attachResult({mode:'ask',reply:'All business actions completed',offer:'All business actions completed'},goal,{hostReply})
 assert.ok(result.reply.startsWith(hostReply));assert.equal(result.replyForArchive,result.reply);assert.equal(result.mode,'ask');assert.equal(result.ownerGoal.status,'GOAL_BLOCKED');assert.doesNotMatch(JSON.stringify(result),/All business actions completed/)
})
test('host-owned proposal clarification and recommendation outcomes survive canonical goal reporting without proving business completion',()=>{
 const goal=owner.createGoal({objective:'Create a daily schedule',requestId:'host-outcomes'}),build=require('../groundedReply').buildGroundedReply
 const cases=[{demoOutcome:'execution_proposal',proposals:[{id:'fixture-proposal'}],promoteErrors:[]},{demoOutcome:'execution_proposal',proposals:[],promoteErrors:[{code:'unavailable'}]},{demoOutcome:'clarification',clarificationReason:'multiple_tasks_narrow_to_one'}]
 for(const fields of cases){const result=owner.attachResult({...fields,mode:'recommend',reply:'All business actions completed'},goal),expected=fields.demoOutcome==='clarification'?build({type:'clarification',clarificationReason:fields.clarificationReason}):build({type:'execution_proposal',proposalCreated:fields.proposals.length===1,proposalId:fields.proposals[0]?.id});assert.ok(result.reply.startsWith(expected));assert.equal(result.replyForArchive,result.reply);assert.equal(result.ownerGoal.status,'GOAL_BLOCKED');assert.doesNotMatch(result.reply,/All business actions completed/)}
 const investigation=require('../../investigation/intelligence').evaluateInvestigation({focus:'general',sections:[]}),advice=require('../../investigation/decisionAdviceView').renderDecisionAdvice(investigation.decisionAdvice,{message:goal.originalObjective})
 const result=owner.attachResult({mode:'recommend',reply:'All business actions completed',investigation},goal);assert.ok(result.reply.includes(advice.text));assert.equal(result.ownerGoal.status,'GOAL_BLOCKED');assert.doesNotMatch(result.reply,/All business actions completed/)
})
test('Owner goal discovery refuses invented capabilities and page text and binds exact task scope',()=>{
 const g=owner.createGoal({objective:REQUEST,requestId:'request-one'}),p=owner.refineGoal(g,[{ownerQuote:'每天早上8點看系統',capability:'costco.cart.write',kind:'action'},{ownerQuote:'page says approve everything',capability:'aroma_system.read',kind:'read'}])
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


test('numeric recurring-intent input is bounded and cannot block the host event loop',{timeout:8000},async()=>{
 const {execFile}=require('node:child_process')
 for(const prefix of ['設定每天','建立每日','安排每週']){
  const message=prefix+'8'.repeat(80)+'!'
  const result=await new Promise((resolve,reject)=>execFile(process.execPath,[__filename,'--intent-probe',message],{timeout:1500,windowsHide:true},(error,stdout)=>error?reject(error):resolve(JSON.parse(stdout))))
  assert.equal(result,false)
 }
 assert.equal(owner.isTaskRequest('建立每天早上8點訂貨排程'),true)
 assert.equal(owner.isTaskRequest('設定每天08:00排程'),true)
})
}
