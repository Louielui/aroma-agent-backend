'use strict'
const assert = require('node:assert/strict')
const {test} = require('node:test')
const {fromSavedConversation} = require('./conversationEvidence')
const {answerOwnerRecall, resolveConversationReference} = require('./ownerRecall')
const {createGateway,OWNER} = require('../memory/governed')
const {createHash} = require('node:crypto')

const personalPrompt = '你知道我的理念是什麼嗎?'
const aromaPrompt = '你知道我對 Aroma 的理念嗎？'
const motto = '用食物凝聚社區。'
const history = (...texts) => texts.flatMap(content=>[{role:'user',content},{role:'assistant',content:'收到。'}])
const token = (question,...prior) => fromSavedConversation({messages:history(...prior)},question)
const oldId='ca4e367b-5109-4b49-9831-7406333303cc'

test('previous same-thread question is quoted exactly after multiple turns', async () => {
  const q='我剛才問咗咩？'
  const out=await answerOwnerRecall(q,token(q,'你好嗎？','你叫什麼名字?'),{})
  assert.equal(out.reply,'你剛才問我「你叫什麼名字?」。')
  assert.equal(await answerOwnerRecall('我剛才問咗咩？順便查庫存',token(q,'你好嗎？'),{}),null)
  const safe=await answerOwnerRecall(q,JSON.parse(JSON.stringify(token(q,'你好嗎？'))),{})
  assert.match(safe.reply,/無法核對/)
})

test('current Owner words precede memory and an explicit update wins', async () => {
  const out=await answerOwnerRecall(aromaPrompt,token(aromaPrompt,'我對 Aroma 的理念是：用心。','我更新對 Aroma 的理念是：'+motto),{
    readApproved:()=>assert.fail('already grounded')
  })
  assert.match(out.reply,/用食物凝聚社區。/)
  assert.doesNotMatch(out.reply,/用心。/)
  const partial=await answerOwnerRecall(aromaPrompt,token(aromaPrompt,'我對 Aroma 的理念其中一條是用心待人。'),{})
  assert.match(partial.reply,/其中一部分/)
  const conflict=await answerOwnerRecall(personalPrompt,token(personalPrompt,'我的理念是用心。','我的理念是務實。'),{})
  assert.match(conflict.reply,/多個不同說法/)
  const correction='更正，我的理念是先理解，才回應。'
  const current=await answerOwnerRecall(correction,token(correction,'我的理念是用心。'),{readApproved:()=>assert.fail('current correction is authoritative')})
  assert.equal(current.reply,'我會以你現在的說法為準：「先理解，才回應。」。')
})

test('the saved personal question distinguishes no approved record from an unavailable service', async () => {
  const ask=token(personalPrompt,'你叫什麼名字?')
  assert.match((await answerOwnerRecall(personalPrompt,ask,{readApproved:async()=>[]})).reply,/查了.*未找到/)
  assert.match((await answerOwnerRecall(personalPrompt,ask,{readApproved:async()=>{throw Error('offline')}})).reply,/目前讀不到/)
})

test('explicitly selected old thread is used by exact reference and never replaced with a recent excerpt',async () => {
  const stored={id:oldId,title:'Aroma 開店理念',messages:history('我對 Aroma 的理念是：'+motto)}
  const store={get:id=>id===oldId?stored:null,list:()=>[{id:oldId,title:stored.title,createdAt:'2026-11-20T16:00:00Z'}]}
  assert.equal(resolveConversationReference(store,'2026-11-20').conversation.id,oldId)
  const q='請查舊對話「Aroma 開店理念」，我對 Aroma 的理念是什麼？'
  const out=await answerOwnerRecall(q,token(q),{readConversation:ref=>resolveConversationReference(store,ref),readApproved:()=>assert.fail()})
  assert.match(out.reply,/用食物凝聚社區。/)
  assert.match(out.reply,/Aroma 開店理念/)
  assert.match((await answerOwnerRecall(q,token(q),{readConversation:()=>({state:'missing'})})).reply,/找不到/)
  assert.match((await answerOwnerRecall(q,token(q),{readConversation:()=>{throw Error('unreadable')}})).reply,/讀不到/)
  assert.equal(resolveConversationReference({...store,list:()=>[
    {id:oldId,title:stored.title},{id:'59eb5b7f-3c5a-4104-ae39-a9583647b693',title:stored.title}
  ]},stored.title).state,'ambiguous')
})

test('the Memory Gateway returns only current, Owner-approved relevant originals and detects changes',async () => {
  const hash=s=>createHash('sha256').update(s).digest('hex')
  const record=(id,over={})=>({id,type:'decision',scope:'global:aroma',status:'active',version:2,subject:'Aroma 餐飲理念',text:motto,
    source:{kind:'owner_note',id:'note',at:'2026-11-20T01:00:00.000Z',attribution:'owner_statement'},approval:{kind:'owner',actor:'owner',contentHash:hash(motto)},...over})
  const rows=[
    record('xx-5ec5de7d-b495-4a90-8ac6-d31a8dfd55d0'),
    record('xx-1bc3d8a4-fe4c-474a-8d3c-b37bd215da4a',{status:'superseded'}),
    record('xx-6247a818-1fec-40f0-afed-f09c682cfbba',{approval:{kind:'policy',actor:'owner',contentHash:hash(motto)}}),
    record('xx-dab77120-fca9-4b10-8b5c-05995a9a5517',{subject:'Aroma 每週排程'}),
    record('xx-fafe8e90-1a00-4adb-8145-3944edfe8109',{expiresAt:'2026-11-01T00:00:00Z'}),
  ]
  const gateway=createGateway({store:{generalRows:async()=>rows,get:async id=>rows.find(r=>r.id===id)}})
  await assert.rejects(gateway.ownerPrinciples({id:'not-owner',role:'agent'}),/permission_denied/)
  const matches=await gateway.ownerPrinciples(OWNER)
  assert.deepEqual(matches.map(r=>r.id),[rows[0].id])
  const reply=await answerOwnerRecall(personalPrompt,token(personalPrompt),{readApproved:()=>gateway.ownerPrinciples(OWNER)})
  assert.match(reply.reply,/用食物凝聚社區。/)
  assert.match(reply.reply,/已確認記憶/)
  const stale=createGateway({store:{generalRows:async()=>[rows[0]],get:async()=>({...rows[0],status:'archived'})}})
  await assert.rejects(stale.ownerPrinciples(OWNER),/stale_evidence/)
})
