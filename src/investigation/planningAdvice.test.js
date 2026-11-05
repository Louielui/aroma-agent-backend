'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{isPlanningAdvice,compactPlanningAdvice}=require('./planningAdvice')
const input={plan:{executiveFrame:{taskType:'plan',decisionNeeded:true}},report:{readOnly:true,focus:'work_failure'},mode:'recommend'}
test('the foreground gate uses the judged task and non-executable mode, never wording or a focus-based permission',()=>{
 assert.equal(isPlanningAdvice(input),true);assert.equal(isPlanningAdvice({...input,report:{readOnly:true,focus:'cost'}}),true)
 for(const over of [{ownerGoal:{}},{clarification:true},{mode:'commit'},{mode:'ask'},{report:{readOnly:false}},{plan:{executiveFrame:{taskType:'diagnose',decisionNeeded:true}}},{plan:null}])assert.equal(isPlanningAdvice({...input,...over}),false)
})
test('bilingual compact advice retains all complete reviewed wording in details and keeps important boundaries visible',()=>{
 for(const [message,reply] of [['請先規劃，不要保存長期記憶','建議先量度現有流程。不要先停用理解。\n\n- 保留上下文。\n- 保留來源保護。\n- 保留批准。\n\n完整方案：先建立比較基準，再在隔離副本驗證。'],['Prepare a plan only, do not save this.','First measure the existing stages. Do not remove understanding.\n\n- Retain context.\n- Retain evidence protection.\n- Retain approvals.\n\nDetailed plan: establish a baseline and verify the isolated copy.']]){
  const out=compactPlanningAdvice(reply,{message,report:{gaps:[{section:'github'}]}});assert.equal(out.details,reply);assert.equal(out.points,3);assert.doesNotMatch(out.reply,/完整方案：|Detailed plan:/);assert.match(out.reply,/未.*部署|no work was created/i);assert.match(out.reply,/排除規則|exclusion/i);assert.match(out.reply,/未知|unknown/i)
 }
})
test('unusable or overly long shapes remain unavailable instead of silently cutting an arbitrary prefix',()=>{
 for(const reply of ['', 'x'.repeat(3601),'# Heading only','- A point without a conclusion','A'.repeat(401)+'.\n\n- small'])assert.equal(compactPlanningAdvice(reply),null)
})
