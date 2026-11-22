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


test('natural Cantonese resolves the same-thread last Owner message after many turns with memory down', async () => {
  const turns = Array.from({length: 12}, (_, i) => '隔離合成的第 ' + (i + 1) + ' 條問題？')
  for (const message of ['我頭先問咗咩？', '香香，我先頭問你咩呀？', '我頭先講咗乜嘢？', '我剛才問了你什麼？']) {
    const result = await answerOwnerRecall(message, token(message, ...turns), {
      readApproved: () => assert.fail('same-thread recall does not read memory'),
      readHistory: () => assert.fail('same-thread recall does not search history')
    })
    assert.equal(result?.reply, '你剛才問我「隔離合成的第 12 條問題？」。')
  }
  const mixed = '我頭先問咗咩？順便改排更'
  assert.equal(await answerOwnerRecall(mixed, token(mixed, ...turns)), null)
})

test('natural Cantonese about Aroma uses topic evidence and separates the literal from its interpretation', async () => {
  const message = '你仲記唔記得我做 Aroma 嘅理念？'
  const original = '食物可以連結鄰里。'
  const result = await answerOwnerRecall(message, token(message,
    '我對 Aroma 的理念是：用心。', '我更新對 Aroma 的理念是：' + original, '仲有一件事想問。'), {
    readApproved: () => assert.fail('current topic evidence takes precedence')
  })
  assert.match(result?.reply, /「食物可以連結鄰里。」/)
  assert.match(result.reply, /我的理解.*Aroma/)
  assert.doesNotMatch(result.reply, /用心。/)
  const scoped = await answerOwnerRecall(personalPrompt, token(personalPrompt,
    '我的個人理念是：守時。', '先傾 Aroma 餐飲。', '仲有一件事想問。'), {
    readApproved: async () => []
  })
  assert.doesNotMatch(scoped.reply, /守時/)
})

test('a newer literal correction in the current thread stays distinct from historical identifier lookup', async () => {
  const q = '今次嘅代號係咩？'
  const turns = ['這次的代號是「青梨-46」', '記住我頭先嗰句。', '更正，這次的代號是「青梨-47」', '謝謝。']
  const current = await answerOwnerRecall(q, token(q,...turns), {
    readHistory: () => assert.fail('current identifier does not read historical values')
  })
  assert.match(current?.reply, /「青梨-47」/)
  assert.doesNotMatch(current.reply, /青梨-46/)
  const update = '更正，這次的代號是 \x60青梨-47\x60'
  assert.equal((await answerOwnerRecall(update, token(update,...turns))).reply,'這次的代號是「青梨-47」。')
  const old = '以前用過甚麼代號？'
  const historyResult = await answerOwnerRecall(old, token(old,...turns), {
    readHistory: async subject => {
      assert.equal(subject,'代號')
      return [{id:'xx-5ec5de7d-b495-4a90-8ac6-d31a8dfd55d0',version:2,text:'上回活動的代號是木瓜-21。'}]
    }
  })
  assert.match(historyResult?.reply, /木瓜-21/)
  assert.doesNotMatch(historyResult.reply, /青梨/)
})

test('historical questions search only their resolved topic and identify partial, absent and unavailable evidence', async () => {
  const q = '我以前有沒有說過這件事？'
  const input = token(q,'雲端備援','請核對舊店的週末午餐')
  const seen=[]
  const found = await answerOwnerRecall(q,input,{
    readHistory: async subject => {
      seen.push(subject)
      return [{id:'xx-5ec5de7d-b495-4a90-8ac6-d31a8dfd55d0',version:1,text:'舊店的週末午餐當時有兩組班表。',partial:true}]
    }
  })
  assert.deepEqual(seen,['舊店的週末午餐'])
  assert.match(found?.reply,/一部分/)
  assert.match(found.reply,/舊店的週末午餐當時有兩組班表/)
  const recent = '你仲記唔記得我以前講過舊店的週末午餐？'
  const older = '請查舊對話「Aroma 開店理念」，'+recent
  const selected = await answerOwnerRecall(older,token(older),{
    readConversation:()=>({state:'found',conversation:{title:'Aroma 開店理念',id:oldId,messages:history('舊店的週末午餐當時有兩組班表。')}}),
    readHistory:()=>assert.fail('explicit older thread takes precedence')
  })
  assert.equal(selected.ownerRecallSource.kind,'selected_conversation')
  const noMatch=await answerOwnerRecall(q,input,{readHistory:async()=>[]})
  const unavailable=await answerOwnerRecall(q,input,{readHistory:async()=>{throw Error('inert failure')}})
  assert.match(noMatch.reply,/未找到/)
  assert.match(unavailable.reply,/讀不到/)
  const unresolved=await answerOwnerRecall(q,token(q,'謝謝'),{readHistory:()=>assert.fail('ambiguous scope')})
  assert.match(unresolved.reply,/哪一句|哪個主題/)
  const mixed='我以前有沒有提過排更，順便改表'
  assert.equal(await answerOwnerRecall(mixed,token(mixed,'排更')),null)
})

test('historical memory verifies canonical Owner evidence and never returns assistant, private mail or stale matches', async () => {
  const record=(n,over={})=>({id:'xx-5ec5de7d-b495-4a90-8ac6-d31a8dfd55d'+n,version:1,scope:'private:owner',
    status:'active',type:'episodic',subject:'conversation',text:'上次的代號是木瓜-21。',
    source:{kind:'conversation',id:'thread:turn',at:'2026-11-15T00:00:00Z',attribution:'owner_statement'},
    approval:{kind:'policy',id:'owner_history',actor:'owner'},...over})
  const rows=[record('0'),record('1',{source:{kind:'conversation',id:'reply',attribution:'assistant_claim'}}),
   record('2',{source:{kind:'admin_mail_received',id:'mail',attribution:'owner_statement'}}),
   record('3',{status:'archived'}),record('4',{text:'只是提到班表，沒有固定位號。'}),record('5',{status:'superseded',text:'更早的代號是橙葉-15。'}),
   record('6',{details:{conversationId:oldId},text:'這次的代號是青梨-47。'})]
  const form=()=>createGateway({store:{generalRows:async()=>rows,get:async id=>rows.find(r=>r.id===id)}})
  const reply=await form().ownerHistory(OWNER,'代號',oldId)
  assert.deepEqual(reply.map(row=>row.id),[rows[0].id,rows[5].id])
  await assert.rejects(form().ownerHistory({id:'guest',role:'agent'},'代號'),/permission_denied/)
  const stale=createGateway({store:{generalRows:async()=>[rows[0]],get:async()=>({...rows[0],text:'更改了代號。'})}})
  await assert.rejects(stale.ownerHistory(OWNER,'代號'),/stale_evidence/)
})
test('literal paste markup is recognized without rewriting evidence or swallowing mixed requests', async () => {
  const pasted = text => '\x60' + text + '\x60。'
  const raw = pasted('更正，我對 Aroma 的理念是：『隔離測試-甲！』')
  const unavailable = () => assert.fail('same-thread evidence takes precedence')
  const correction = await answerOwnerRecall(raw, token(raw), {readApproved: unavailable})
  assert.equal(correction?.reply, '我會以你現在的說法為準：「隔離測試-甲！」。')
  assert.equal(correction.ownerRecallSource.kind, 'current_owner_statement')
  const same = pasted('我頭先問咗咩？')
  const prior = await answerOwnerRecall(same, token(same, '較早的話。', raw), {readApproved: unavailable})
  assert.ok(prior?.reply.includes(raw))
  const principles = pasted('你仲記唔記得我做 Aroma 嘅理念')
  const recall = await answerOwnerRecall(principles, token(principles, raw), {readApproved: unavailable})
  assert.equal(recall?.ownerRecallSource.kind, 'current_conversation')
  assert.match(recall.reply, /「隔離測試-甲！」/)
  const selected = pasted('請查舊對話「指定的標題」，我對 Aroma 的理念是什麼？')
  const older = await answerOwnerRecall(selected, token(selected, raw), {
    readConversation: reference => {
      assert.equal(reference, '指定的標題')
      return {state:'found', conversation:{id:oldId,title:reference,messages:history('更正，我對 Aroma 的理念是：『舊版本-乙。』。')}}
    },
    readApproved: unavailable
  })
  assert.equal(older?.ownerRecallSource.kind, 'selected_conversation')
  assert.match(older.reply, /「舊版本-乙。」/)
  for (const mixed of [
    raw + '順便改排更', '更正，我對 Aroma 的理念是：『甲』。幫我改排更',
    pasted('更正，我對 Aroma 的理念是：『甲』，並幫我改排更'),
    pasted('更正，我對 Aroma 的理念是：甲，順便改排更'),
    pasted('更正，我對 Aroma 的理念是：甲。幫我改排更'),
    pasted('更正，我對 Aroma 的理念是：甲順便幫我改排更'),
    pasted('我頭先問咗咩？再幫我改排更'), same + '順便查庫存',
    '\x60我頭先問咗咩？', '\x60\x60\x60\n我頭先問咗咩？\n\x60\x60\x60',
    '更正，我對 Aroma 的理念是：『沒有閉合', '我頭先問咗咩？？',
    pasted('我以前有沒有說過週末午餐，順便改排更'),
    pasted('我以前有沒有說過週末午餐順便幫我改排更')
  ]) {
    assert.equal(await answerOwnerRecall(mixed, token(mixed, raw), {readApproved: unavailable, readHistory: unavailable}), null, mixed)
  }
  const fullMotto = '分享回憶，創造回憶。用食物連結街坊。'
  const complete = '更正，我對 Aroma 的理念是：' + fullMotto
  const full = await answerOwnerRecall(complete, token(complete), {readApproved: unavailable})
  assert.equal(full.reply, '我會以你現在的說法為準：「' + fullMotto + '」。')
  const mixedHistory = '更正，我對 Aroma 的理念是：『錯誤證據』。幫我改排更'
  const approved = await answerOwnerRecall(principles, token(principles, raw, mixedHistory), {readApproved: unavailable})
  assert.match(approved.reply, /「隔離測試-甲！」/)
  assert.doesNotMatch(approved.reply, /錯誤證據/)
})

test('outer quotation marks and punctuation around a previous-message question preserve the exact saved reply', async () => {
  const raw = '\x60更正，我對 Aroma 的理念是：『隔離樣本』\x60。'
  const unavailable = () => assert.fail('this path reads only the authenticated saved turn')
  const sources = {readApproved: unavailable, readConversation: unavailable, readHistory: unavailable}
  for (const ask of ['「我上一句說了什麼？」。', '『我頭先問咗咩？』', '「我頭先問咗咩」 ？']) {
    const result = await answerOwnerRecall(ask, token(ask, '較早的一句。', raw), sources)
    assert.equal(result?.reply, '你上一句是「'+raw+'」。')
    assert.deepEqual(result.ownerRecallSource, {kind:'current_conversation',excerpt:false})
  }
  for (const ask of [
    '「我上一句說了什麼？」。順便改排更', '「我上一句說了什麼？順便改排更」。',
    '「我上一句說了什麼？」。「幫我改排更」。', '「我上一句說了什麼？」。\n改排更',
    '「我上一句說了什麼？』。', '「『我上一句說了什麼？』」。', '「我上一句說了什麼？」。。',
    '「更正，我的理念是用心」。'
  ]) {
    assert.equal(await answerOwnerRecall(ask, token(ask,raw),sources),null,ask)
  }
  const requested = '「我上一句說了什麼？」。'
  const spoofed = JSON.parse(JSON.stringify(token(requested,raw)))
  const unavailablePrior = await answerOwnerRecall(requested,spoofed,sources)
  assert.equal(unavailablePrior.reply,'我目前無法核對這段對話裡你的上一句。')
  assert.equal(unavailablePrior.ownerRecallSource,undefined)
})
