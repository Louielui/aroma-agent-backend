'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const evidence=require('./conversationEvidence'),{enforceRouteEvidence}=require('./routeEvidenceGuard')
const initial='我想建立一個協作工作室，讓各個助手處理不同範圍，最後統一回報給我。',message=initial+' 這次先討論，不執行。'
const history=[initial,message,message,message].flatMap(text=>[{role:'user',content:text},{role:'assistant',content:'Previous suggestion.'}])
const token=()=>evidence.fromSavedConversation({messages:history},message)
const say=(reply,t=token())=>enforceRouteEvidence({reply,message,evidenceSets:[],conversationEvidence:t})

test('exact current-message repetition and substantial first-request repetition have different verified counts',()=>{
 for(const reply of ['這已經是你第四次發同一段話。','你第4次重複這段文字。','這是你第五次提出同一個構想。'])assert.equal(say(reply).violated,false,reply)
 for(const reply of ['這已經是你第五次發同一段話。','這是你第四次提出同一個構想。']){
  const r=say(reply);assert.equal(r.violated,true);assert.match(r.reply,/對話紀錄/);assert.doesNotMatch(r.reply,/營運狀況/)
 }
 for(const t of [{ownerMessages:5,currentMessageOccurrences:4},JSON.parse(JSON.stringify(token()))])assert.equal(say('這已經是你第四次發同一段話。',t).violated,true)
})

test('conversation proof does not attest sending mail, business counts, or nested operational assertions',()=>{
 for(const reply of ['這已經是你第四次寄同一封信。','存貨已經有4箱。','這已經是你第四次發同一段話，存貨全部充足。'])assert.equal(say(reply).violated,true,reply)
})

test('ordered-list counters are presentation, while quantities and operational status remain guarded',()=>{
 const reply='1. 接單：先整理。\n2. 分頭做：先寫大綱。\n3. 收件核對：我把各桌交回來的結果對一遍，看看來源。\n4. 回報給你。'
 assert.equal(say(reply).reply,reply)
 for(const reply of ['3. 收件有12封新信。','3. 存貨全部充足。','3. 今日有3樣貨要補。','3. 一切正常。','3.14159 件存貨已經不足。'])assert.equal(say(reply).violated,true,reply)
})

test('only host-issued conversation receipts enter the chat prompt; history and current input stay unchanged',()=>{
 const {buildDistillPrompt}=require('./distillPrompt'),base=buildDistillPrompt(message,history,{chatLane:true}),out=buildDistillPrompt(message,history,{chatLane:true,conversationEvidence:token()})
 assert.notEqual(out.prompt,base.prompt);assert.ok(out.prompt.includes('currentMessageOccurrences'));assert.ok(out.prompt.includes('firstRequestPrefixOccurrences'))
 assert.ok(out.prompt.includes('Louie 現在說:「'+message+'」'));assert.equal(out.system,base.system)
 assert.equal(buildDistillPrompt(message,history,{chatLane:true,conversationEvidence:{currentMessageOccurrences:4}}).prompt,base.prompt)
 assert.equal(buildDistillPrompt(message,history,{chatLane:false,conversationEvidence:token()}).prompt,buildDistillPrompt(message,history,{chatLane:false}).prompt)
})
