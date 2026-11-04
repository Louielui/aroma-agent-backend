'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {enforceRouteEvidence}=require('./routeEvidenceGuard'),{reviewAdviceAnswer}=require('../investigation/semanticAnswer')
const say=reply=>enforceRouteEvidence({reply,message:'只討論構想，不查資料。',reviewedNoReadAdvice:true,evidenceSets:[]})
const checks={goal:'aligned',priority:'conditional',capabilities:'qualified',facts:'qualified'}
const input={reply:'先做甲。甲最有效。',message:'討論兩個假設方案，尚未比較實際耗時。',history:[],judgment:{status:'provisional',uncertainties:['兩個方案的實際耗時未知。'],changeIf:[]},model:'claude-opus-5-5',billing:'claude-subscription'}
const review=packet=>reviewAdviceAnswer({...input,adapter:{complete:async()=>({text:JSON.stringify(packet),model:input.model,billing:input.billing})}})

test('attributive pending-action objects are not operational status assertions',()=>{
 for(const reply of ['按供應商整理要訂的貨品。','草擬要補的庫存清單。','整理需要補的貨品。','整理要訂嘅貨品。'])assert.equal(say(reply).reply,reply)
})
test('pending-action modifiers cannot hide real counts, shortage or sufficiency claims',()=>{
 for(const reply of ['今天要訂的貨品有 12 種。','要補的庫存全部不足。','存貨要訂。','庫存需要補。','缺貨的庫存全部不足。']){
  const r=say(reply);assert.equal(r.violated,true,reply);assert.ok(r.withheld.length,reply)
 }
})
test('withholding removes exact spans and preserves unrelated markdown and CRLF bytes',()=>{
 const before='## Proposed areas\r\n\r\n- **甲**：整理資料。\r\n- **乙**：草擬摘要。\r\n\r\n',bad='存貨還有 12 箱。',after='\r\n\r\n### Next\r\n  🧭 討論交接方式。\r\n'
 const r=say(before+bad+after);assert.equal(r.violated,true);assert.deepEqual(r.withheld,[bad]);assert.ok(r.reply.startsWith(before+after+'\n\n'));assert.doesNotMatch(r.reply,/12/)
})
test('repeated safe fragments survive, and only the unsupported occurrence is removed',()=>{
 const reply='- 整理資料。\n\n存貨還有 2 箱。\n\n- 整理資料。'
 assert.ok(say(reply).reply.startsWith('- 整理資料。\n\n\n\n- 整理資料。\n\n'))
})
test('a legacy partial-edit packet is not accepted as complete semantic review',async()=>{
 const r=await review({status:'revised',edits:[{before:'甲最有效',after:'尚未比較效益',reason:'unsupported_comparison'}]})
 assert.equal(r.state,'unavailable');assert.equal(r.reason,'review_incomplete');assert.equal(r.reply,input.reply);assert.equal(r.calls,1)
})
test('unresolved priority blocks admission even when other edits and checks succeeded',async()=>{
 const r=await review({status:'revised',checks:{...checks,priority:'unresolved'},edits:[{before:'甲最有效',after:'尚未比較效益',reason:'unsupported_comparison'}]})
 assert.equal(r.state,'unavailable');assert.equal(r.reason,'review_unresolved');assert.equal(r.reply,input.reply);assert.equal(r.calls,1)
})
test('complete review can qualify the priority in the main answer without replacing useful advice',async()=>{
 const r=await review({status:'revised',checks,edits:[{before:'先做甲',after:'若先試驗交接方式，可以用甲作示例',reason:'missing_qualification'},{before:'甲最有效',after:'尚未比較甲乙的實際效益',reason:'unsupported_comparison'}]})
 assert.equal(r.state,'revised');assert.equal(r.reply,'若先試驗交接方式，可以用甲作示例。尚未比較甲乙的實際效益。');assert.equal(r.calls,1)
})
test('every required assessment must be complete and a supported answer is preserved byte for byte',async()=>{
 for(const key of Object.keys(checks)){
  const r=await review({status:'supported',checks:{...checks,[key]:'unresolved'},edits:[]});assert.equal(r.state,'unavailable');assert.equal(r.reason,'review_unresolved')
 }
 const r=await review({status:'supported',checks,edits:[]});assert.equal(r.state,'supported');assert.equal(r.reply,input.reply);assert.equal(r.calls,1)
})
