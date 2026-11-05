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

test('the retained PR134 Markdown scope keeps its two substantive changes visible, rather than only draft status',()=>{
 const c=require('../intake/fixtures/proposalContinuationReplay.json').cases[2],out=compactPlanningAdvice(c.reviewedReply,{message:c.message})
 assert.equal(out.points,2);assert.match(out.reply,/假設目標拆解是主要延遲來源/);assert.match(out.reply,/並實測確認不影響上下文理解/);assert.match(out.reply,/正文只放答案/);assert.equal(out.details,c.reviewedReply)
})

test('Markdown list selection is structural across markers, headings and languages and precedes later acceptance lists',()=>{
 for(const heading of ['## Scope','**Scope**','__Scope__',''])for(const markers of [['1.','2.'],['1)','2)'],['-','-'],['*','*'],['+','+']]){
  const reply='Measure first, while retaining context.\n\n'+heading+'\n'+markers[0]+' Trial one only if reversible.\n'+markers[1]+' Trial two while retaining approvals.\n\n**Checks**\n- A later check.\n- Another later check.',out=compactPlanningAdvice(reply)
  assert.equal(out.points,2);assert.match(out.reply,/only if reversible/);assert.match(out.reply,/retaining approvals/);assert.doesNotMatch(out.reply,/later check/);assert.equal(out.details,reply)
 }
})

test('wrapped, spaced and nested conditions remain part of the selected complete item without truncation',()=>{
 const reply='First prepare a reversible trial.\r\n\r\n### Scope\r\n1. Keep the first proposal.\r\n   Only if the original context test passes.\r\n\r\n   - Withdraw if accuracy falls.\r\n2. Keep the second proposal\r\nwhile preserving source checks.\r\n\r\n### Later\r\nDo not infer execution.',out=compactPlanningAdvice(reply)
 assert.equal(out.points,2);assert.match(out.reply,/Only if the original context test passes/);assert.match(out.reply,/Withdraw if accuracy falls/);assert.match(out.reply,/while preserving source checks/);assert.equal(out.details,reply)
})

test('quoted or fenced examples do not become planning items and malformed or oversized first lists fail visibly',()=>{
 const reply='Prepare a trial.\n\n```text\n1. Quoted example.\n2. Another example.\n```\n\n> 1. A quotation.\n\n**Scope**\n1. Keep context.\n\n2. Keep approvals.\n3. Keep sources.\n4. Retain full wording in details.',out=compactPlanningAdvice(reply)
 assert.equal(out.points,3);assert.doesNotMatch(out.reply,/Quoted example|A quotation|Retain full wording/);assert.match(out.details,/Retain full wording/)
 for(const bad of ['Prepare a trial.\n\n1. First.\n3. Missing second.','Prepare a trial.\n\n2. Missing first.\n3. Third.','Prepare a trial.\n\n1. '+('x'.repeat(401))+'\n2. Small.','Prepare a trial.\n\n1. A point.\n   ```text\n   Hidden condition.\n   ```\n2. Another.'])assert.equal(compactPlanningAdvice(bad),null,bad)
})
