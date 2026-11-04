'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fixture=require('./fixtures/adviceGroundingReplay.json'),semantic=require('../investigation/semanticAnswer')
const raw=fixture.case5.raw,edits=[
 {before:'你每天要主動去問核對數量（甲）做完沒有、有沒有問題',after:'需要你親自追問進度的環節',reason:'unsupported_premise'},
 {before:'甲每天重複、結果容易分成對或不對，又只做唯讀，所以最快見效、風險也最低',after:'目前只知道甲維持唯讀，實際頻率、耗時和風險還未比較，因此只能把甲當作暫定試點',reason:'unsupported_comparison'}
]
const input={reply:raw.reply,judgment:raw.executiveJudgment,message:fixture.case5.message,history:fixture.case5.history,billing:'claude-subscription',model:'claude-opus-5-5'}
// Offline review decisions are explicit substitutes; this tests integration and
// exact-span admission, never the subscription reviewer's semantic accuracy.
test('saved native failure can be corrected locally without replacing unaffected advice or creating work',async()=>{
 let calls=0,accounted=0
 const adapter={complete:async(prompt,opts)=>{calls++;assert.equal(opts.invocationPhase,'evidence_review');assert.match(prompt,/assistant.*not.*evidence/is);assert.equal(opts.responseFormat.strict,true);return{text:JSON.stringify({status:'revised',edits}),model:input.model,billing:input.billing}}}
 const r=await semantic.reviewAdviceAnswer({...input,adapter,onResult:async()=>{accounted++}})
 assert.equal(r.state,'revised');assert.equal(r.calls,1);assert.equal(calls,1);assert.equal(accounted,1)
 let expected=raw.reply;for(const e of edits)expected=expected.replace(e.before,e.after)
 assert.equal(r.reply,expected);assert.equal(r.reply.split('。').filter(Boolean).length,2)
 assert.equal(r.reply.includes('乙的摘要可以之後再沿用'),true);assert.equal(r.editedSpans,2)
})
test('a missing, ambiguous or injected edit cannot be accepted as a repaired answer; no retry',async()=>{
 for(const edit of [{...edits[0],before:'NOT_IN_THE_ANSWER'},{...edits[0],after:'<script>unsafe()</script>'}]){
  let calls=0;const r=await semantic.reviewAdviceAnswer({...input,adapter:{complete:async()=>{calls++;return{text:JSON.stringify({status:'revised',edits:[edit]}),model:input.model,billing:input.billing}}}})
  assert.equal(r.state,'unavailable');assert.equal(r.reason,'invalid_review');assert.equal(calls,1);assert.equal(r.reply,raw.reply)
 }
})
test('failed or mismatched review remains diagnosable, preserves the draft and does not switch channel',async()=>{
 for(const reply of [()=>{throw Error('SECRET_TRANSPORT_DETAIL')},()=>({text:'{}',model:'other-model',billing:input.billing})]){
  let calls=0;const r=await semantic.reviewAdviceAnswer({...input,adapter:{complete:async()=>{calls++;return reply()}}})
  assert.equal(r.state,'unavailable');assert.equal(calls,1);assert.equal(r.reply,raw.reply);assert.doesNotMatch(JSON.stringify(r),/SECRET_TRANSPORT_DETAIL/)
 }
})
test('evidence guard still withholds operational claims but does not assert an unrelated lookup is required',()=>{
 const {enforceRouteEvidence}=require('./routeEvidenceGuard')
 const r=enforceRouteEvidence({reply:'存貨還有 12 箱。建議先設計回報流程。',message:fixture.office.message,evidenceSets:[]})
 assert.equal(r.violated,true);assert.ok(r.withheld.length);assert.match(r.reply,/建議先設計回報流程/)
 assert.doesNotMatch(r.reply,/這個問題要查|要我現在查|要我查過再答/)
 assert.ok(r.sources.includes('aroma_system'))
})

async function httpReplay(t,{review={status:'revised',edits},draft=raw,throwReview=false}={}){
 const before={...process.env};Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',TURN_ROUTER:'on',CONVERSATION_CONTRACT:'on',MULTI_AI_ROUTER:'off',READ_ACCESS:'off',CONVERSATION_RECALL:'off',DECISION_RECALL:'off',GOAL_DECOMPOSER:'off',A4_KNOWLEDGE_ROUTING:'off',XIANGXIANG_MEMORY:'off',XIANGXIANG_ARCHIVE:'off',LLM_LANGUAGE_MODE:'off',XIANGXIANG_WEBSITE_FLOW:'off'})
 t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before)})
 const express=require('express'),{createDemoRouter}=require('../routes/demoRouter'),{processIntake}=require('./intakeService'),calls=[]
 const adapter={preflight:async()=>{},complete:async(prompt,opts)=>{
  calls.push({prompt,phase:opts.invocationPhase})
  if(opts.invocationPhase==='evidence_review'){if(throwReview)throw Error('SECRET_REVIEW_FAILURE');return{text:JSON.stringify(review),model:input.model,billing:input.billing}}
  assert.equal(calls.length,1,'unexpected extra helper');return{text:JSON.stringify(draft),model:input.model,billing:input.billing}
 }}
 const app=express();app.locals.conversationDemo=true;app.use(express.json());app.locals.promoteToProposal=()=>assert.fail('unexpected proposal')
 app.use(createDemoRouter({getAdapterFn:()=>adapter,conversationStore:{get:()=>({messages:fixture.case5.history}),appendTurn:()=>{}},processIntakeFn:(m,a,h,o)=>processIntake(m,a,h,{...o,openaiAdapter:adapter})}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:fixture.case5.message,conversationId:'advice-grounding-offline',interactionMode:'chat'})})
 assert.equal(response.status,200);return{result:await response.json(),calls}
}
test('actual HTTP intake routes the retained native draft through the bounded review and ordinary guards',async t=>{
 const {result,calls}=await httpReplay(t)
 let expected=raw.reply;for(const e of edits)expected=expected.replace(e.before,e.after)
 assert.equal(result.reply,expected);assert.equal(result.replyForArchive,expected)
 assert.equal(result.adviceReview.state,'revised');assert.equal(result.adviceReview.editedSpans,2)
 assert.deepEqual(calls.map(c=>c.phase),['answer','evidence_review']);assert.equal(result.decision,null);assert.deepEqual(result.tasks,[])
})
test('review failure produces an explicit unverified-draft status without generic clarification or a retry',async t=>{
 const {result,calls}=await httpReplay(t,{throwReview:true})
 assert.equal(result.adviceReview.state,'unavailable');assert.equal(result.adviceReview.reason,'review_unavailable');assert.equal(calls.length,2)
 assert.ok(result.reply.endsWith(raw.reply));assert.match(result.reply,/未驗證草稿/);assert.doesNotMatch(result.reply,/SECRET_REVIEW_FAILURE/)
 assert.equal(result.decision,null);assert.deepEqual(result.tasks,[])
})
test('a proposed review edit cannot bypass the existing operational evidence guard',async t=>{
 const {result}=await httpReplay(t,{review:{status:'revised',edits:[{...edits[0],after:'存貨還有 999 箱'}]}})
 assert.doesNotMatch(result.reply,/999/);assert.match(result.reply,/這一輪沒有查任何來源/);assert.equal(result.replyForArchive,result.reply)
})
test('ordinary chat does not acquire an advice-review helper',async t=>{
 const {result,calls}=await httpReplay(t,{draft:{...raw,mode:'chat',intent:'chit_chat',executiveJudgment:null,reply:'生日快樂！'}})
 assert.equal(result.reply,'生日快樂！');assert.equal(calls.length,1);assert.equal(result.adviceReview,undefined)
})
