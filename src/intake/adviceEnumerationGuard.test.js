'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {enforceRouteEvidence}=require('./routeEvidenceGuard')
const say=(reply,extra={})=>enforceRouteEvidence({reply,message:'只討論設計，不查資料。',evidenceSets:[],reviewedNoReadAdvice:true,...extra})

test('reviewed design requirements retain a verifiable enumeration of open questions',()=>{
 for(const reply of [
  '每個 Agent 都要寫清楚三件事：可以讀什麼、可以產出什麼、不能碰什麼。',
  '每位 Worker 都要列明 2 點：可以產出什麼、不能碰什麼。',
  '每張工作單都要交代兩項內容：何時、如何。'
 ]) { const out=say(reply);assert.equal(out.violated,false,reply);assert.equal(out.reply,reply) }
})

test('enumeration admission does not establish business facts, mismatched counts or nested claims',()=>{
 for(const reply of [
  '每個 Agent 都要寫清楚三件事：可以讀什麼、不能碰什麼。',
  '每個 Agent 都要寫清楚三件事：可以讀什麼、可以讀什麼、不能碰什麼。',
  '每個 Agent 都要寫清楚三件事：存貨全部充足、可以產出什麼、不能碰什麼。',
  '每個 Agent 都要寫清楚三件事：可以讀什麼、已有 12 箱可以產出什麼、不能碰什麼。',
  '每個 Agent 都要寫清楚三件事：有三箱可以讀什麼、可以產出什麼、不能碰什麼。',
  '三個 Agent 都要寫清楚三件事：可以讀什麼、可以產出什麼、不能碰什麼。',
  '每個 Agent 都要寫清楚三件事：有〇箱可以讀什麼、可以產出什麼、不能碰什麼。',
  '我們每個 Agent 都要寫清楚三件事：可以讀什麼、可以產出什麼、不能碰什麼。',
  '目前每個 Agent 都要寫清楚三件事：可以讀什麼、可以產出什麼、不能碰什麼。',
  '存貨都要列明三件事：可以讀什麼、可以產出什麼、不能碰什麼。',
  '每個 Agent 全部正常都要列明三件事：可以讀什麼、可以產出什麼、不能碰什麼。',
  '每個 Agent 都要寫清楚三件事：可以讀什麼、已經產出什麼、不能碰什麼。'
 ]) { const out=say(reply);assert.equal(out.violated,true,reply);assert.ok(out.withheld.length,reply) }
})

test('real operational counts and statuses alongside admitted design requirements remain guarded',()=>{
 const requirement='每個 Agent 都要寫清楚三件事：可以讀什麼、可以產出什麼、不能碰什麼。'
 for(const claim of ['今日有 3 樣貨要補。','存貨還有 12 箱。','存貨全部充足。']){
  const out=say(requirement+'\n\n'+claim)
  assert.equal(out.violated,true);assert.deepEqual(out.withheld,[claim]);assert.ok(out.reply.startsWith(requirement+'\n\n'))
 }
 assert.equal(say(requirement,{reviewedNoReadAdvice:false}).violated,true)
})

test('enumeration removal never changes the existing pending-action and current-stock protections',()=>{
 for(const claim of ['存貨是要補的。','庫存需要補。','供應商整理要訂的貨品。','目前整理要補的庫存。'])assert.equal(say(claim).violated,true,claim)
 for(const reply of ['按供應商整理要訂的貨品。','列出需要補的庫存清單。'])assert.equal(say(reply).reply,reply)
})

test('the existing read-result presentation keeps admitted requirements and unrelated layout',()=>{
 const reply='## Design\n\n- 每個 Agent 都要寫清楚三件事：可以讀什麼、可以產出什麼、不能碰什麼。\n\n### Next\n討論交接方式。'
 const out=require('./readResultView').buildReadResultReply({reply,message:'只討論設計，不查資料。',reviewedNoReadAdvice:true,answerPlan:null,evidenceSets:[],itemsBySource:[],perSource:[]})
 assert.equal(out.reply,reply)
})
