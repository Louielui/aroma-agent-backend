'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createGateway, OWNER } = require('./governed')
const { createTestStore } = require('./structuredStore')
const { recallContext } = require('./context')

// Preserved Owner inputs, replayed offline. The extraction result is an explicit
// substitute, not evidence that a real model has learned or passed acceptance.
const complaint = '文字太多很難看, 你有什麼建議?'
const format = '第一行用一句話講結論，中間最多列三個重點、每點只寫一行，細節等你追問時才展開。'
const confirmation = '好,以後就這樣做'
const conversationId = '6961a6fe-8bf4-468a-a38a-113d7379f78f'
function setup(extract) {
  const store = createTestStore(),history=new Map(); let calls = 0; let packet
  const g = createGateway({ store, clock: () => '2026-11-05T06:00:00Z', engine: { forScope: () => ({
    consolidate: async source => { calls++; packet = source; return extract(source) },
    recall: async () => { throw Error('fixture_semantic_unavailable') }
  }) } })
  const event = async (id, text, attribution, at, conv = conversationId) => {
    const messages=history.get(conv)||[]
    const details=attribution==='owner_statement'?{conversationId:conv,learningAnchor:require('./learningContext').anchor(messages)}:{}
    const r=await g.observe(OWNER,{type:'episodic',subject:id,text,scope:'private:owner',policy:'owner_history',source:{kind:'conversation',id,at,attribution},details})
    messages.push({role:attribution==='owner_statement'?'user':'assistant',content:text});history.set(conv,messages)
    return r
  }
  return {g,store,event,calls:()=>calls,packet:()=>packet}
}
const plan = source => ({ candidates:[{kind:'preference',subject:'Communication format',text:format,
  reason:'Owner confirmed the preceding offered format; requires exact revision review.',quote:source.text,supersedes:null,taskState:null}] })

test('a contextual confirmation retains the prior proposal as context, not owner authority', async () => {
  const f=setup(plan)
  const prior=await f.event('prior:received',complaint,'owner_statement','2026-11-05T05:31:22Z')
  const proposed=await f.event('prior:result',format,'assistant_claim','2026-11-05T05:32:26Z')
  await f.event('other:received','Unrelated private topic.','owner_statement','2026-11-05T05:33:00Z','other-conversation')
  const source=await f.event('current:received',confirmation,'owner_statement','2026-11-05T05:34:01Z')
  const result=await f.g.consolidate(OWNER,source.id)
  assert.equal(result.state,'done')
  assert.deepEqual(f.packet().context.map(r=>r.id),[prior.id,proposed.id])
  assert.equal(f.packet().text,confirmation)
  const candidate=await f.g.get(OWNER,result.candidateIds[0])
  assert.equal(candidate.status,'candidate'); assert.equal(candidate.approval,null)
  assert.equal(candidate.details.quote,confirmation)
  assert.deepEqual(candidate.details.evidenceVersions.map(r=>r.id),[source.id,prior.id,proposed.id])
  assert.equal(candidate.details.learningContext[1].source.attribution,'assistant_claim')
  assert.deepEqual((await f.g.preferences(OWNER)).items,[])
  await f.g.transition(OWNER,candidate.id,candidate.version,'approve')
  assert.equal((await f.g.preferences(OWNER)).items[0].text,format)
  await f.g.consolidate(OWNER,source.id); assert.equal(f.calls(),1)
})

test('withdrawn proposal evidence invalidates approval without promoting assistant claims', async () => {
  const f=setup(plan)
  await f.event('prior:received',complaint,'owner_statement','2026-11-05T05:31:22Z')
  const proposed=await f.event('prior:result',format,'assistant_claim','2026-11-05T05:32:26Z')
  const source=await f.event('current:received',confirmation,'owner_statement','2026-11-05T05:34:01Z')
  const result=await f.g.consolidate(OWNER,source.id),candidate=await f.g.get(OWNER,result.candidateIds[0])
  await f.g.transition(OWNER,proposed.id,proposed.version,'archive')
  await assert.rejects(f.g.transition(OWNER,candidate.id,candidate.version,'approve'),/stale_evidence/)
  assert.equal((await f.g.preferences(OWNER)).items.length,0)
})

test('learning context does not cross opted-out, future or unrelated conversation turns', async () => {
  const f=setup(()=>({candidates:[]}))
  await f.event('prior:received','Do not remember this message.','owner_statement','2026-11-05T05:31:22Z')
  await f.event('prior:result',format,'assistant_claim','2026-11-05T05:32:26Z')
  await f.event('future:received','Future private content.','owner_statement','2026-11-05T05:45:00Z')
  const source=await f.event('current:received',confirmation,'owner_statement','2026-11-05T05:34:01Z')
  await f.g.consolidate(OWNER,source.id)
  assert.deepEqual(f.packet().context,[])
})

test('approved preferences survive restart and unrelated search failures; latest revision wins', async () => {
  const f=setup(()=>({candidates:[]})),source={kind:'owner',id:'explicit-style',at:'2026-11-05T05:00:00Z',attribution:'owner_statement'}
  const first=await f.g.propose(OWNER,{type:'preference',subject:'Communication format',text:format,scope:'private:owner',source})
  await f.g.transition(OWNER,first.id,first.version,'approve')
  const next=await f.g.propose(OWNER,{type:'preference',subject:first.subject,text:'Use two concise paragraphs.',scope:first.scope,source:{...source,id:'correction'},supersedes:first.id})
  assert.equal((await f.g.preferences(OWNER)).items[0].id,first.id)
  await f.g.transition(OWNER,next.id,next.version,'approve')
  const restarted=createGateway({store:f.store,clock:()=> '2026-11-05T06:00:00Z'})
  const prefs=await restarted.preferences(OWNER)
  assert.deepEqual(prefs.items.map(r=>r.id),[next.id])
  const context=await recallContext({enabled:true,query:'Explain the office idea.',memory:{preferences:()=>restarted.preferences(OWNER),recall:async()=>{throw Error('fixture_failure')}}})
  assert.equal(context.preferences.state,'ok'); assert.match(context.block,/Use two concise paragraphs/)
  assert.doesNotMatch(context.block,/最多列三個重點/); assert.equal(context.retrieval.general,'unavailable')
  assert.match(context.block,/not execution approval/)
  await assert.rejects(restarted.preferences({id:'worker',role:'agent'}),/permission_denied/)
})

test('failed preference loading is visible; disabled memory performs no preference reads', async () => {
  let calls=0
  const memory={preferences:async()=>{calls++;throw Error('credential-not-for-output')},recall:async()=>[]}
  assert.equal(await recallContext({enabled:false,query:'Hello',memory}),null);assert.equal(calls,0)
  const context=await recallContext({enabled:true,query:'Hello',memory})
  assert.equal(context.preferences.state,'unavailable');assert.match(context.block,/preferences.*unavailable/i)
  assert.doesNotMatch(context.block,/credential-not-for-output/)
})

test('context withdrawal during extraction creates no preference candidate',async()=>{
  let f, offered
  f=setup(async source=>{await f.g.transition(OWNER,offered.id,offered.version,'archive');return plan(source)})
  await f.event('prior:received',complaint,'owner_statement','2026-11-05T05:31:22Z')
  offered=await f.event('prior:result',format,'assistant_claim','2026-11-05T05:32:26Z')
  const source=await f.event('current:received',confirmation,'owner_statement','2026-11-05T05:34:01Z')
  const result=await f.g.consolidate(OWNER,source.id)
  assert.equal(result.state,'failed');assert.equal(result.error,'stale_evidence')
  assert.equal((await f.g.list(OWNER,{type:'preference'})).length,0)
})

test('private approved preferences are bounded and omissions are explicit',async()=>{
  const f=setup(()=>({candidates:[]})),source={kind:'owner',id:'source',at:null,attribution:'owner_statement'}
  for(let i=0;i<10;i++){
    const r=await f.g.propose(OWNER,{type:'preference',subject:'Preference '+i,text:'Concise personal note '+i,scope:'private:owner',source})
    if(i!==9)await f.g.transition(OWNER,r.id,r.version,'approve')
  }
  const domain=await f.g.propose(OWNER,{type:'preference',subject:'Domain-only fixture',text:'Domain note.',scope:'domain:hr',source})
  await f.g.transition(OWNER,domain.id,domain.version,'approve')
  const prefs=await f.g.preferences(OWNER)
  assert.equal(prefs.state,'partial');assert.equal(prefs.total,9);assert.equal(prefs.items.length,8)
  assert.ok(prefs.items.every(r=>r.scope==='private:owner'&&r.approval.kind==='owner'))
})

test('expired and archived preferences never load into a new conversation',async()=>{
  const f=setup(()=>({candidates:[]})),source={kind:'owner',id:'source',at:null,attribution:'owner_statement'}
  const row=await f.g.propose(OWNER,{type:'preference',subject:'Temporary format',text:format,scope:'private:owner',source,expiresAt:'2026-11-05T07:00:00Z'})
  const approved=await f.g.transition(OWNER,row.id,row.version,'approve')
  assert.equal((await createGateway({store:f.store,clock:()=> '2026-11-05T07:01:00Z'}).preferences(OWNER)).items.length,0)
  await f.g.transition(OWNER,approved.id,approved.version,'archive')
  assert.equal((await f.g.preferences(OWNER)).items.length,0)
})

test('legacy confirmation recovery requires one exact same-chat occurrence and its adjacent pair',async()=>{
  const f=setup(()=>({candidates:[]}))
  const prior=await f.event('prior:received',complaint,'owner_statement','2026-11-05T05:31:22Z')
  const offered=await f.event('prior:result',format,'assistant_claim','2026-11-05T05:32:26Z')
  const source=await f.event('current:received',confirmation,'owner_statement','2026-11-05T05:34:01Z')
  const legacy=structuredClone(source);delete legacy.details.learningAnchor;legacy.version++
  await f.store.commit([{expected:source.version,row:legacy}],{op:'fixture_legacy'})
  const rows=await f.g.list(OWNER),current=r=>r.status==='active'
  const readConversation=()=>({messages:[{role:'user',content:complaint},{role:'assistant',content:format},{role:'user',content:confirmation}]})
  assert.deepEqual(require('./learningContext').precedingExchange(rows,legacy,current,readConversation).map(r=>r.id),[prior.id,offered.id])
  const ambiguous=()=>({messages:[...readConversation().messages,{role:'assistant',content:'Acknowledged.'},{role:'user',content:confirmation}]})
  assert.deepEqual(require('./learningContext').precedingExchange(rows,legacy,current,ambiguous),[])
  assert.deepEqual(require('./learningContext').precedingExchange(rows,legacy,current,()=>null),[])
})

test('an opt-out between exchanges prevents an old offer becoming the confirmation referent',async()=>{
  const f=setup(()=>({candidates:[]}))
  await f.event('prior:received',complaint,'owner_statement','2026-11-05T05:31:22Z')
  await f.event('prior:result',format,'assistant_claim','2026-11-05T05:32:26Z')
  await f.event('private:received','Do not remember this private topic.','owner_statement','2026-11-05T05:33:00Z')
  await f.event('private:result','Excluded private reply.','assistant_claim','2026-11-05T05:33:20Z')
  const source=await f.event('current:received',confirmation,'owner_statement','2026-11-05T05:34:01Z')
  await f.g.consolidate(OWNER,source.id);assert.deepEqual(f.packet().context,[])
})

test('premise review receives approved style evidence and rejects an unapproved substitute without a helper send',async()=>{
  const f=setup(()=>({candidates:[]})),source={kind:'owner',id:'explicit',at:null,attribution:'owner_statement'}
  const r=await f.g.propose(OWNER,{type:'preference',subject:'Reply format',text:format,scope:'private:owner',source})
  await f.g.transition(OWNER,r.id,r.version,'approve')
  const prefs=await f.g.preferences(OWNER);let calls=0,prompt
  const input={reply:'I will use the concise format you approved.',recommendation:true,message:'Please advise.',history:[],ownerPreferences:prefs,model:'claude-opus-5-5',billing:'claude-subscription',adapter:{complete:async p=>{calls++;prompt=p;return{text:JSON.stringify({status:'supported',checks:{goal:'aligned',priority:'not_applicable',capabilities:'not_applicable',facts:'supported'},edits:[]}),model:'claude-opus-5-5',billing:'claude-subscription'}}}}
  const result=await require('../investigation/semanticAnswer').reviewAdviceAnswer(input)
  assert.equal(result.state,'supported');assert.ok(prompt.includes(r.id));assert.ok(prompt.includes(format))
  const invalid=structuredClone(prefs);invalid.items[0].approval.kind='policy'
  assert.equal((await require('../investigation/semanticAnswer').reviewAdviceAnswer({...input,ownerPreferences:invalid})).reason,'invalid_preference_evidence')
  assert.equal(calls,1)
})
