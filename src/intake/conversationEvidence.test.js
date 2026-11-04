'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {enforceRouteEvidence}=require('./routeEvidenceGuard')
const anchor='我想設計一個協作工作室，由不同助手負責不同範圍，統一回報給我。'
const history=()=>[anchor,anchor+' 先談設計。',anchor+' 請接續。'].flatMap(text=>[{role:'user',content:text},{role:'assistant',content:'Saved reply.'}])
const message=anchor+' 先談設計。'
const facts=(messages=history(),current=message)=>require('./conversationEvidence').fromSavedConversation({messages},current)
const say=(reply,conversationEvidence=facts())=>enforceRouteEvidence({reply,message,evidenceSets:[],reviewedNoReadAdvice:true,conversationEvidence})

test('saved conversation counts are a separate evidence class, not business rows',()=>{
 for(const reply of ['這已經是你第四次提出同一個構想。','這是你第4次提起這個想法。','這是你第四次詢問同一個問題。']) {
  const out=say(reply);assert.equal(out.violated,false,reply);assert.equal(out.reply,reply)
 }
})

test('conversation proof follows the saved ordinal across different transcript lengths',()=>{
 for(let count=2;count<=8;count++) {
  const h=Array.from({length:count-1},()=>[{role:'user',text:anchor},{role:'assistant',text:'Reply.'}]).flat()
  const evidence=facts(h)
  assert.equal(say(`這已經是你第${count}次提及這個要求。`,evidence).violated,false)
  assert.equal(say(`這已經是你第${count+1}次提及這個要求。`,evidence).violated,true)
 }
})

test('unverified conversation claims have an accurate notice and preserve useful answer bytes',()=>{
 const good='## Plan\n\n- 設計交接方式。\n\n',claim='這已經是你第九十九次提出同一個構想。'
 const out=say(good+claim)
 assert.equal(out.violated,true);assert.deepEqual(out.withheld,[claim]);assert.ok(out.reply.startsWith(good))
 assert.match(out.reply,/對話紀錄/);assert.doesNotMatch(out.reply,/營運狀況|沒有查任何來源/)
})

test('client-shaped or serialized evidence cannot attest conversation facts',()=>{
 const claim='這已經是你第四次提出同一個構想。'
 for(const evidence of [null,{}, {count:4,verified:true},JSON.parse(JSON.stringify(facts()))]) {
  const out=say(claim,evidence);assert.equal(out.violated,true);assert.match(out.reply,/對話紀錄/)
 }
})

test('missing, malformed, mixed-topic and short histories do not prove a repeated request',()=>{
 const mixed=history();mixed[2]={role:'user',text:'換個話題，請解釋引力。'}
 const wrongRole=history();wrongRole[0]={role:'assistant',text:anchor}
 for(const h of [[],mixed,wrongRole,history().slice(1),[{role:'user',text:anchor}],history().map(h=>({...h,text:'好',content:undefined}))]) {
  assert.equal(say('這已經是你第四次提出同一個構想。',facts(h)).violated,true)
 }
 assert.equal(say('這已經是你第四次提出同一個構想。',facts(history(),'換一個問題。')).violated,true)
})

test('the server count retains intentional repeats and never counts assistant statements',()=>{
 const h=history();h[1].content='這是你第九次提出同一個構想。'
 assert.equal(say('這已經是你第四次提出同一個構想。',facts(h)).violated,false)
 assert.equal(say('這已經是你第七次提出同一個構想。',facts(h)).violated,true)
 const evidence=facts(h);h.push({role:'user',text:anchor},{role:'assistant',text:'ok'})
 assert.equal(say('這已經是你第四次提出同一個構想。',evidence).violated,false)
})

test('typed conversation support never exempts mixed business assertions or changes markdown',()=>{
 const conversation='這已經是你第四次提出同一個構想。'
 for(const claim of ['今日有 3 樣貨已經到。','存貨全部充足。','存貨還有 12 箱。']) {
  const out=say('## Plan\n\n'+conversation+'\n\n'+claim)
  assert.equal(out.violated,true,claim);assert.deepEqual(out.withheld,[claim]);assert.ok(out.reply.startsWith('## Plan\n\n'+conversation+'\n\n'))
 }
 for(const claim of ['這已經是你第四次下單。','這已經是你第四次提出同一個構想，存貨全部充足。'])assert.equal(say(claim).violated,true,claim)
})

test('the read-result boundary consumes host-issued evidence',()=>{
 const reply='## Discussion\n\n這已經是你第四次提出同一個構想。\n\n保留這段。'
 const out=require('./readResultView').buildReadResultReply({reply,message,conversationEvidence:facts(),reviewedNoReadAdvice:true,evidenceSets:[],itemsBySource:[],perSource:[]})
 assert.equal(out.reply,reply)
})

test('supplied-text transformations preserve quoted counts instead of claiming a conversation fact',()=>{
 const reply='這已經是你第四次提出同一個構想。'
 const out=enforceRouteEvidence({reply,message:'改寫：'+reply,evidenceSets:[]})
 assert.equal(out.reply,reply);assert.equal(out.violated,false)
})
