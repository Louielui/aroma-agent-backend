'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fixture=require('./fixtures/localAnswerBoundaryReplay.json'),conversation=require('./conversationEvidence'),guard=require('./routeEvidenceGuard')
const first=fixture.messages[0].content,follow=fixture.messages[2].content,question=fixture.messages[4].content
const receipt=(message=follow,history=fixture.messages.slice(0,2))=>conversation.fromSavedConversation({messages:history},message)
// Synthetic interpretation contract; the original model completion was not retained.
const proposal=()=>({kind:'minimum_transfer',locations:[{entity:'甲店',quantity:12,unit:'盒',quote:'甲店有12盒'},{entity:'乙店',quantity:3,unit:'盒',quote:'乙店有3盒'}],minimum:{quantity:6,unit:'盒',quote:'每店至少要6盒'},transferOnlyQuote:'只能調貨不能購買'})
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto')
if(!process.env.AROMA_DATA_DIR)process.env.AROMA_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'local-answer-boundary-'))
test('saved real capability enquiry is conversation, not a dispatch command or refusal template',()=>{
 const {parseRequest}=require('../core/codeDiagnosis/chat');assert.equal(parseRequest(question),null)
 for(const q of ['你可以直接派 Codex 嗎？離線能做什麼？','Can you delegate to Codex, and what works offline?','不要派 Codex，先說明你能做什麼。','Codex 可以派工嗎？斷網又如何？','Codex 的派工有什麼限制？','Codex 能否修改程式？'])assert.equal(parseRequest(q),null)
 assert.equal(parseRequest('請 Codex 唯讀調查香香派工流程'),'dispatch');assert.equal(parseRequest('請 Codex 唯讀調查 .env'),'unsupported')
})
test('verified Owner premises permit a program-computed minimum transfer, never a business-evidence exemption',()=>{
 const c=require('./suppliedCalculation'),r=c.calculate(proposal(),receipt())
 assert.ok(r);assert.equal(r.moved,3);assert.deepEqual(r.locations.map(v=>v.quantity),[9,6]);assert.match(r.reply,/3.*盒/);assert.match(r.reply,/甲店.*9.*盒/);assert.match(r.reply,/乙店.*6.*盒/);assert.match(r.reply,/假設/);assert.doesNotMatch(r.reply,/自然廣東話|講完兩句/)
 // The business guard is not disabled, even if the question says hypothetical.
 assert.equal(guard.enforceRouteEvidence({message:first,reply:'目前餐廳存貨全部充足，今日收到99盒。',evidenceSets:[],noReadRecommendation:true}).violated,true)
})
test('calculation ignores old assistant guesses and rejects missing, forged, mismatched and stale premises',()=>{
 const c=require('./suppliedCalculation');assert.equal(c.calculate(proposal(),JSON.parse(JSON.stringify(receipt()))),null)
 for(const change of [p=>p.locations[0].quantity=13,p=>p.locations[0].quote='甲店有13盒',p=>p.locations[0].entity='丙店',p=>p.locations[0].unit='箱',p=>p.minimum.quantity=9,p=>p.minimum.quote='先前助手建議6盒',p=>p.locations.push({...p.locations[0]}),p=>p.execute=true]){const p=proposal();change(p);assert.equal(c.calculate(p,receipt()),null)}
 assert.equal(c.calculate(proposal(),receipt('現在查系統的實際庫存，再調貨。')),null)
 const h=[...fixture.messages.slice(0,2),{role:'user',content:'仍作假設，甲店改成10盒，其餘不變。'},{role:'assistant',content:'Noted.'}];assert.equal(c.calculate(proposal(),receipt(follow,h)),null)
 assert.equal(c.calculate(proposal(),receipt(follow,[{role:'user',content:'只作測試。'},{role:'assistant',content:first}])),null)
 for(const amendment of ['可以購買補貨了，請計算。','甲店不得調出，請計算。','乙店最多收2盒，請計算。'])assert.equal(c.calculate(proposal(),receipt(amendment)),null)
 const p=proposal();p.locations[0].quote='甲店欠12盒';assert.equal(c.calculate(p,receipt(first.replace('甲店有12盒','甲店欠12盒'),[])),null)
 const neg=proposal();neg.locations[0].quote='甲店有-12盒';assert.equal(c.calculate(neg,receipt(first.replace('甲店有12盒','甲店有-12盒'),[])),null)
 for(const field of ['transferOnlyQuote','minimum']){
  const altered=proposal();if(field==='minimum')altered.minimum.quote+='但甲店不得調出';else altered.transferOnlyQuote+='但甲店最多調2盒'
  const text=first.replace(field==='minimum'?'每店至少要6盒':'只能調貨不能購買',field==='minimum'?altered.minimum.quote:altered.transferOnlyQuote)
  assert.equal(c.calculate(altered,receipt(text,[])),null,'extra constraints cannot hide inside a quoted operand')
 }
})
test('minimum-movement computation conserves quantities and reports infeasibility without inventing purchases',()=>{
 const c=require('./suppliedCalculation')
 for(const values of [[18,2,4],[9,8,1],[6,6,6],[2,1,3]]){
  const locations=values.map((quantity,i)=>({entity:'Site'+String.fromCharCode(65+i),quantity,unit:'boxes',quote:'Site'+String.fromCharCode(65+i)+' has '+quantity+' boxes'})),minimum={quantity:6,unit:'boxes',quote:'each site needs at least 6 boxes'},transferOnlyQuote='Only transfers, no purchases',m='Hypothetical, no tools or actions: '+locations.map(v=>v.quote).join('; ')+'. '+minimum.quote+'. '+transferOnlyQuote+'. Calculate the minimum transfer.'
  const r=c.calculate({kind:'minimum_transfer',locations,minimum,transferOnlyQuote},receipt(m,[]));assert.ok(r)
  assert.equal(r.locations.reduce((s,v)=>s+v.quantity,0),values.reduce((s,v)=>s+v,0))
  if(values.reduce((s,v)=>s+v,0)>=18){assert.equal(r.moved,values.reduce((s,v)=>s+Math.max(0,6-v),0));assert.ok(r.locations.every(v=>v.quantity>=6))}else{assert.equal(r.feasible,false);assert.equal(r.moved,0);assert.match(r.reply,/未夠|insufficient|short/i);assert.ok(r.reply.includes(String(18-values.reduce((s,v)=>s+v,0))))}
 }
})
test('only a verified hypothetical conversation adds the interpretation contract; old envelope keys remain unchanged',()=>{
 const c=require('./suppliedCalculation'),base={type:'json_schema',schema:{type:'object',required:['reply'],properties:{reply:{type:'string'}},additionalProperties:false}}
 const shaped=c.withFormat(base,receipt());assert.ok(shaped.schema.properties.suppliedCalculation);assert.ok(shaped.schema.required.includes('suppliedCalculation'));assert.equal(base.schema.properties.suppliedCalculation,undefined)
 assert.equal(c.withFormat(base,receipt('你好',[])),base)
 const {parseDistillResponse}=require('./distillPrompt'),text={mode:'chat',intent:'question',reply:'Model wording is not used for a verified computation.',suppliedCalculation:proposal()};assert.deepEqual(parseDistillResponse(JSON.stringify(text)).suppliedCalculation,proposal());assert.equal('suppliedCalculation' in parseDistillResponse(JSON.stringify({mode:'chat',intent:'question',reply:'Hi'})),false)
})
test('local product capability context distinguishes blocked workers and offline prerequisites without creating authority',()=>{
 const block=require('../governance/selfCapability').capabilityBlock({localOnly:true})
 assert.match(block,/Codex/);assert.match(block,/未接入|停用|blocked|unavailable/);assert.match(block,/離線|offline/);assert.match(block,/Gmail.*Drive|Drive.*Gmail/);assert.match(block,/全部|每個|each|every/)
 assert.doesNotMatch(block,/已有批准後派工嘅開發流程/)
 const old=require('../governance/selfCapability').capabilityBlock();assert.match(old,/已有批准後派工嘅開發流程/)
})
async function post(app,body,manual=false){
 const {IncomingMessage,ServerResponse}=require('node:http'),{Duplex}=require('node:stream'),wire=[],socket=new Duplex({read(){},write(c,e,n){wire.push(c.toString());n()}}),req=new IncomingMessage(socket),text=JSON.stringify(body)
 req.method='POST';req.url='/api/v1/demo/intake';req.httpVersion='1.1';req.httpVersionMajor=1;req.httpVersionMinor=1;req.headers={host:'127.0.0.1:18099',origin:'http://127.0.0.1:18099','content-type':'application/json','content-length':String(Buffer.byteLength(text))};if(manual)Object.assign(req.headers,{accept:'text/event-stream',cookie:'aroma_owner_session=fixture-owner'});req.complete=true
 const res=new ServerResponse(req);res.assignSocket(socket);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture_timeout')),12000);res.once('finish',()=>{clearTimeout(timer);resolve()});app.handle(req,res,e=>{if(e){clearTimeout(timer);reject(e)}});req.push(text);req.push(null)});const raw=wire.join('');return{status:res.statusCode,body:JSON.parse(raw.slice(raw.indexOf('\r\n\r\n')+4))}
}
async function integrated(message,answer,prior,manual=false,controls={}){
 const vars={LOCAL_BRAIN_ONLY:'1',LOCAL_APP_PORT:'18099',CHAT_BACKEND:'local',LOCAL_MODEL:'qwen3.5:9b',XIANGXIANG_MEMORY:'off',GOAL_DECOMPOSER:'off',READ_ACCESS:'off',TURN_ROUTER:'shadow',...controls.env},saved=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars)
 try{
  const calls=[],writes=[],sizing={},adapter={providerName:'local',context:controls.context,preflight:async()=>({ready:true}),complete:async(prompt,opts)=>{calls.push({prompt,opts});controls.checkInput?.(prompt,opts);assert.ok(calls.length<=2,'fixture may not loop');return{text:JSON.stringify(typeof answer==='function' ? answer(prompt,opts) : answer),provider:'local',billing:'local',model:'qwen3.5:9b',usage:{inputTokens:1,outputTokens:1,totalTokens:2}}}},express=require('express'),app=express();let starts=0,admitted=0
  app.locals.conversationDemo=true;if(manual)app.locals.ownerSessions={valid:id=>id==='fixture-owner'};app.use(express.json());app.use(require('../routes/demoRouter').createDemoRouter({getAdapterFn:()=>adapter,dailyDialogue:manual?async(_conversation,_request,run)=>{admitted++;return run()}:null,conversationStore:{get:()=>({messages:prior}),appendTurn:v=>writes.push(v)},codeDiagnosis:{start:()=>{starts++;throw Error('dispatch_forbidden')}},processIntakeFn:(m,a,h,o)=>require('./intakeService').processIntake(m,a,controls.savedHistory ? prior : h,{...o,telemetry:sizing,openaiAdapter:adapter,readContextDeps:{sources:[],connector:{read:()=>{throw Error('business_read_forbidden')}}},...controls.intake})}))
  const requestId=randomUUID();const response=await post(app,{message,history:[],interactionMode:'chat',conversationId:randomUUID(),workflowRequestId:requestId,...(manual?{websiteRequestId:requestId}:{})},manual);return{...response,calls,writes,starts,admitted,sizing:sizing.localAnswerSizing}
 }finally{for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v}
}
test('actual HTTP intake computes from saved Owner premises before any repeat generation or operational answer guard',async()=>{
 const r=await integrated(follow,{mode:'chat',intent:'question',reply:'UNVERIFIED_MODEL_TEXT_MUST_NOT_APPEAR',nextRead:null,suppliedCalculation:proposal()},fixture.messages.slice(0,2));assert.equal(r.status,200);assert.equal(r.starts,0);assert.equal(r.calls.length,1);assert.equal(r.body.utility,'supplied_calculation');assert.match(r.body.reply,/甲店.*9.*盒/);assert.match(r.body.reply,/乙店.*6.*盒/);assert.doesNotMatch(r.body.reply,/UNVERIFIED|沒有查任何來源/);assert.ok(r.calls[0].opts.responseFormat.schema.properties.suppliedCalculation);assert.equal(r.writes.length,1)
})

test('the first hypothetical turn receives its own attested premises without browser history or an earlier model answer',async()=>{
 const r=await integrated(first,{mode:'chat',intent:'question',reply:'UNVERIFIED',nextRead:null,suppliedCalculation:proposal()},[]);assert.equal(r.status,200);assert.equal(r.calls.length,1);assert.equal(r.body.utility,'supplied_calculation');assert.match(r.body.reply,/甲店.*9.*盒/);assert.match(r.body.reply,/乙店.*6.*盒/);assert.doesNotMatch(r.body.reply,/UNVERIFIED|講完兩句/)
})
test('saved multi-question capability enquiry reaches ordinary local understanding with current restrictions and no dispatch',async()=>{
 const reply='而家唔可以直接派 Codex 改程式。斷網時，我可以用本機模型處理對話同已保存資料；Gmail、Drive 等外部服務仍要網絡。',r=await integrated(question,{mode:'chat',intent:'question',reply,nextRead:null},fixture.messages.slice(0,4));assert.equal(r.status,200);assert.equal(r.starts,0);assert.equal(r.calls.length,1);assert.match(r.body.reply,/Codex/);assert.match(r.body.reply,/斷網/);assert.doesNotMatch(r.body.reply,/完整要求沒有進入派工入口|建立一般修正工作單/);assert.match(r.calls[0].prompt,/本機模式的實際限制/);assert.match(r.calls[0].prompt,/每個問題都要逐項回答/)
})
test('an explicit unsupported command in local mode reports the actual Worker restriction without proposing a cloud entrance',async()=>{
 const r=await integrated('請 Codex 唯讀調查 .env',{mode:'chat',intent:'question',reply:'SHOULD_NOT_RUN'},[]);assert.equal(r.status,200);assert.equal(r.starts,0);assert.equal(r.calls.length,0);assert.match(r.body.reply,/本機|未接入|不可用/);assert.doesNotMatch(r.body.reply,/可直接交代 Codex|SHOULD_NOT_RUN/)
})

const prep = '假設 The Forks 明天要 80 份雲吞，St Mary\u2019s 要 40 份。中央每盤做 30 份，幫我排明天的 prep。'
const prepCorrection = '改一改，The Forks 只要 50 份，其他照舊。重新計。'
const demoStub = {mode:'chat',intent:'question',reply:'Offline replay placeholder before the fix.',nextRead:null}
const prepHistory = [{role:'user',content:prep},{role:'assistant',content:'助手猜 St Mary\u2019s 99 份，每盤 77 份。'}]

test('saved prep request computes four trays through the normal manual chat route',async()=>{
 const r=await integrated(prep,demoStub,[],true)
 assert.equal(r.status,200);assert.equal(r.admitted,1);assert.equal(r.body.utility,'supplied_calculation')
 assert.match(r.body.reply,/The Forks 80 份.*St Mary\u2019s 40 份/s)
 assert.match(r.body.reply,/120 份.*每盤 30 份.*4 盤/s)
 assert.equal(r.body.reply,r.body.replyForArchive);assert.deepEqual(r.body.tasks,[])
 assert.equal(r.body.decision,null);assert.equal(r.calls.length,0);assert.equal(r.writes.length,1)
})

test('same-thread correction keeps the other demand and ignores assistant guesses',async()=>{
 const r=await integrated(prepCorrection,demoStub,prepHistory,true)
 assert.equal(r.status,200);assert.equal(r.admitted,1);assert.equal(r.body.utility,'supplied_calculation')
 assert.match(r.body.reply,/The Forks 50 份.*St Mary\u2019s 40 份/s)
 assert.match(r.body.reply,/90 份.*每盤 30 份.*3 盤/s)
 assert.doesNotMatch(r.body.reply,/99|77|這一輪沒有查任何來源/)
 assert.deepEqual(r.body.tasks,[]);assert.equal(r.calls.length,0)
})

test('prep calculation requires complete hypothetical premises from verified Owner turns',()=>{
 const {suppliedPrep}=require('./suppliedCalculation')
 const token=(message,messages=[])=>conversation.fromSavedConversation({messages},message)
 const view=(message,messages)=>suppliedPrep(message,token(message,messages))
 for(const invalid of [
  prep.replace('假設 ',''),prep.replace('30 份','0 份'),prep.replace('中央每盤做 30 份，',''),
  prep+' 順便查正式庫存。',prep+' 然後更新正式排程。',prep.replace('80 份','-80 份'),
  prep.replace('40 份','40 份水餃'),prep.replace('St Mary\u2019s','The Forks')
 ])assert.equal(view(invalid),null,invalid)
 assert.equal(view(prepCorrection),null)
 assert.equal(view(prepCorrection.replace('The Forks','未知店'),prepHistory),null)
 const duplicateAlias = prep.replace('40 份。', '40 份，St Mary\'s 要 5 份。')
 assert.equal(view(duplicateAlias),null)
 const correctAlias = "更正，st mary's 改成 10 份，其他照舊。重新計。"
 assert.match(view(correctAlias,prepHistory).reply,/St Mary’s 10 份.*90 份.*3 盤/s)
 assert.equal(view(prepCorrection,[...prepHistory,{role:'user',content:'順便安排另一個班次。'},{role:'assistant',content:'好的。'}]),null)
 assert.equal(suppliedPrep(prep,JSON.parse(JSON.stringify(token(prep)))),null)
 assert.equal(suppliedPrep(prep,token(prepCorrection,prepHistory)),null)
 assert.match(view(prep.replace('80 份','70 份')).reply,/110 份.*4 盤.*多 10 份/s)
 const three = prep.replace('St Mary\u2019s 要 40 份。','St Mary\u2019s 要 40 份，第三店要 12 份。')
 const again = '更正，第三店改為 0 份，其餘照舊。重新計算。'
 const saved = content => [{role:'user',content},{role:'assistant',content:'Fixture reply.'}]
 assert.match(view(again,[...saved(three),...saved(prepCorrection)]).reply,/The Forks 50 份.*St Mary\u2019s 40 份.*第三店 0 份.*90 份.*3 盤/s)
})

test('mixed operations and incomplete prep requests continue through the existing HTTP intake',async()=>{
 const mixed = [
  prep.replace('St Mary\u2019s','順便查正式庫存 St Mary\u2019s'),
  prep.replace('80 份雲吞','80 份雲吞要查實際庫存'),
  prep.replace('St Mary\u2019s','幫我落單 St Mary\u2019s'),
  prep.replace('St Mary\u2019s','查庫存第三店'),
  prep.replace('St Mary\u2019s','Check Live Inventory St Mary\u2019s'),
  prep.replace('St Mary\u2019s','Place Order St Mary\u2019s'),
  prep.replace('St Mary\u2019s','Send a confirmation to St Mary\u2019s'),
  prep.replace('中央每盤做 30 份，',''),
  prep.replace('80 份雲吞','80 份')
 ]
 for (const message of mixed) {
  const r = await integrated(message,demoStub,[],true)
  assert.equal(r.status,200,message)
  assert.equal(r.admitted,1,message)
  assert.notEqual(r.body.utility,'supplied_calculation',message)
  assert.ok(r.calls.length > 0,'ordinary intake must receive '+message)
  assert.equal(r.starts,0,message)
  assert.deepEqual(r.body.tasks ?? [],[],message)
  assert.doesNotMatch(r.body.reply,/合共 120 份.*4 盤/s,message)
 }
})

test('a correction cannot revive a prep scenario containing an ignored operational clause',()=>{
 const {suppliedPrep}=require('./suppliedCalculation')
 const forgedScenario=prep.replace('St Mary\u2019s','幫我落單 St Mary\u2019s')
 const saved=[{role:'user',content:forgedScenario},{role:'assistant',content:'Fixture response.'}]
 assert.equal(suppliedPrep(prepCorrection,conversation.fromSavedConversation({messages:saved},prepCorrection)),null)
})

test('hypothetical quantities keep the unchanged site and packaging rule across manual turns', async () => {
 const turns = [
  ['純虛構練習。東店需 23 個包，西店需 16 個，每盒裝 8 個。合併裝盒，只計整盒。總共要預幾盒？', /39\s*個.*5\s*盒/s],
  ['東店少 7 個，西店其他照舊，依家要幾多盒？', /32\s*個.*4\s*盒/s],
  ['剛才講少 7 個取消，東店最終要 7 個，西店仍照舊。請列兩店數量、總數同盒數。', /東店.*7\s*個.*西店.*16\s*個.*23\s*個.*3\s*盒/s]
 ]
 const saved = []
 for (const [message, expected] of turns) {
  const r = await integrated(message, demoStub, saved, true)
  assert.equal(r.status, 200)
  assert.equal(r.admitted, 1)
  assert.equal(r.body.utility, 'supplied_calculation')
  assert.match(r.body.reply, expected)
  assert.deepEqual(r.body.tasks, [])
  assert.equal(r.body.decision, null)
  assert.equal(r.calls.length, 0)
  assert.equal(r.starts, 0)
  assert.equal(r.writes.length, 1)
  saved.push({role:'user',content:message},{role:'assistant',content:r.body.reply})
 }
})

test('a compound hypothetical conversion also answers full trays and remainder',async()=>{
 const message='假設用 6.1 kg 麵糰。每盤用 400 g，做完一盤先開下一盤。可以做足幾多整盤，同埋剩幾多克？'
 const r=await integrated(message,demoStub,[],true)
 assert.equal(r.status,200)
 assert.equal(r.body.utility,'supplied_calculation')
 assert.match(r.body.reply,/6[,]?100\s*(?:g|克).*15\s*(?:個)?整?盤.*100\s*(?:g|克)/s)
 assert.equal(r.calls.length,0)
})

test('hypothetical clarification asks for the missing divisor only, then uses the saved premises', async () => {
 const initial = '虛構備料題，兩店要 21 份同 7 份蒸點。我想知要幾多盤。'
 const first = await integrated(initial, demoStub, [], true)
 assert.equal(first.body.utility, 'supplied_calculation')
 assert.match(first.body.reply, /合共 28 份.*每盤幾多 份/s)
 assert.doesNotMatch(first.body.reply, /\d+\s*盤/)
 assert.equal(first.calls.length, 0)
 const next = await integrated('每盤 9 份，只做整盤，補返答案。', demoStub,
   [{role:'user',content:initial},{role:'assistant',content:first.body.reply}], true)
 assert.match(next.body.reply, /28 份.*4 盤.*多 8 份/s)
 assert.equal(next.calls.length, 0)
})

test('hypothetical route declines mixed requests, unverified history and incompatible subquestions', () => {
 const {answer} = require('./suppliedScenario')
 const scenario = '虛構備貨：紅店要 28 份，藍店要 8 份，每箱 12 份。兩店一定要分開裝，每箱可未裝滿。各用幾箱，合共幾箱？'
 const token = (message, saved = []) => conversation.fromSavedConversation({messages:saved},message)
 const saved = [{role:'user',content:scenario},{role:'assistant',content:'Fixture reply.'}]
 assert.ok(answer(scenario,token(scenario)))
 assert.equal(answer(scenario,JSON.parse(JSON.stringify(token(scenario)))),null)
 for (const input of [
   scenario + '順便查正式庫存。', scenario.replace('紅店','查庫存店'),
   scenario.replace('藍店','打電話店'), scenario + '幫我落單。',
   scenario + '最後一瓶裝幾多 mL？',
   scenario.replace('各用幾箱，合共幾箱','合併裝幾箱'),
   scenario.replace('兩店一定要分開裝','合併裝盒'),
   scenario.replace('紅店要 28 份','紅店要 28 份雲吞').replace('藍店要 8 份','藍店要 8 份燒賣'),
   '假設每盤用 300 mL，用 2.1 kg 麵糰。可以做足幾多整盤？'
 ]) assert.equal(answer(input,token(input)),null,input)
 const update='紅店改成 14 份，藍店照舊。重新計。'
 assert.equal(answer(update,token(update)),null)
 assert.equal(answer(update,token(update,[...saved,{role:'user',content:'查庫存。'},{role:'assistant',content:'Fixture reply.'}])),null)
 const mixedUpdate=update+'順便落單。'
 assert.equal(answer(mixedUpdate,token(mixedUpdate,saved)),null)
})

test('mixed operational requests retain the ordinary verification path after a hypothetical turn', async () => {
 const first='假設紅店要 25 份、藍店要 11 份，每箱 12 份。合計要幾箱？'
 const prior=[{role:'user',content:first},{role:'assistant',content:'Fixture reply.'}]
 for (const input of ['紅店改成 17 份，其他照舊。順便查正式庫存。','紅店改成 17 份，其他照舊。幫我落單。']) {
  const r=await integrated(input,demoStub,prior,true)
  assert.equal(r.status,200)
  assert.notEqual(r.body.utility,'supplied_calculation',input)
  assert.ok(r.calls.length>0,input)
  assert.equal(r.starts,0,input)
  assert.deepEqual(r.body.tasks ?? [],[],input)
 }
})


test('current weather outside the retailer pilot has an honest local reply in new and saved threads', async () => {
  for (const history of [[], fixture.messages.slice(0, 4)]) {
    for (const message of ['今天幾度?', '今日 Winnipeg 幾多度？', 'Winnipeg 今日氣溫幾多？', 'What is the temperature in Winnipeg today?']) {
      const r = await integrated(message, {}, history, true, {
        env: { READ_ACCESS: 'on' },
        intake: { readLocalPublic: async () => { throw Error('public_read_forbidden') } }
      })
      assert.equal(r.status, 200)
      assert.equal(r.body.utility, 'weather_unverified')
      assert.match(r.body.reply, /未能查證即時氣溫|cannot verify the current temperature/)
      assert.equal(r.calls.length, 0)
      assert.equal(r.starts, 0)
      assert.equal(r.admitted, 1)
      assert.equal(r.writes.length, 1)
    }
  }
})

test('weather routing leaves mixed, non-current, cooking and nonmanual requests in ordinary intake', async () => {
  for (const [message, manual] of [
    ['今天幾度？順便查庫存', true],
    ['昨天幾度？', true],
    ['焗爐今天要校到幾度？', true],
    ['今天幾度?', false]
  ]) {
    const r = await integrated(message, {mode:'chat',intent:'question',reply:'Sample answer',nextRead:null}, [], manual)
    assert.equal(r.status, 200)
    assert.notEqual(r.body.utility, 'weather_unverified')
    assert.ok(r.calls.length > 0)
  }
})


test('local answer fits by omitting advisory archives only and retains the original full answer when it fits', async () => {
  const { localInput, LocalModelError } = require('../adapters/LocalAdapter')
  const message = '請解釋兩種學習方法怎樣比較？'
  const answer = {mode:'chat',intent:'question',reply:'可按目標比較。',nextRead:null}
  const history = [{role:'user',content:'THIS_THREAD_QUESTION'},{role:'assistant',content:'THIS_THREAD_ANSWER'}]
  const controls = {
    context: 65536,
    savedHistory: true,
    env: { DECISION_RECALL: 'on', CONTEXT_DECISIONS_OPENAI: 'on', CONVERSATION_RECALL: 'on' },
    intake: {
      decisionRecallDeps: {listDecisionsFn: () => [{id:'fixture',statement:'DECISION_ONLY ' + '甲'.repeat(400)}],listTasksFn: () => []},
      conversationRecallDeps: {readRecordsFn: () => [{conversationId:'elsewhere',at:'2026-11-22T00:00:00Z',role:'user',text:'ARCHIVE_ONLY ' + '乙'.repeat(400)}]}
    }
  }
  const normal = await integrated(message, answer, history, true, controls)
  assert.equal(normal.status, 200)
  assert.equal(normal.calls.length, 1)
  const call = normal.calls[0]
  assert.match(call.prompt, /THIS_THREAD_QUESTION/)
  assert.match(call.prompt, /DECISION_ONLY/)
  assert.match(call.prompt, /ARCHIVE_ONLY/)
  assert.ok(normal.sizing.fullBound > 4096)
  const sum = Object.values(normal.sizing.envelopeBytes).reduce((a,b)=>a+b,0)
  assert.equal(sum, normal.sizing.inputBound)
  const bound = normal.sizing.fullBound - 1
  const compact = await integrated(message, answer, history, true, {
    ...controls, context: bound,
    checkInput: (prompt, opts) => {
      const size = localInput(prompt, opts)
      if (size.inputBound + size.maxTokens > bound) throw new LocalModelError('local_context_capacity_exceeded')
    }
  })
  assert.equal(compact.status, 200)
  assert.equal(compact.calls.length, 1)
  assert.equal(compact.calls[0].opts.system, call.opts.system)
  assert.deepEqual(compact.calls[0].opts.responseFormat, call.opts.responseFormat)
  assert.match(compact.calls[0].prompt, /THIS_THREAD_QUESTION/)
  assert.match(compact.calls[0].prompt, /請解釋兩種學習方法怎樣比較/)
  assert.match(compact.calls[0].prompt, /Historical advisory context was omitted/)
  assert.doesNotMatch(compact.calls[0].prompt, /DECISION_ONLY|ARCHIVE_ONLY/)
  assert.equal(compact.sizing.outputReserve, 4096)
  assert.deepEqual(compact.sizing.promptBytes.filter(p => !p.included).map(p => p.name), ['conversation_archive','decision_archive'])
  assert.ok(compact.sizing.inputBound + compact.sizing.outputReserve <= bound)
  const stillOversized = await integrated(message, answer, history, true, {
    ...controls, context: 2048,
    checkInput: () => { throw new LocalModelError('local_context_capacity_exceeded') }
  })
  assert.equal(stillOversized.calls.length, 1)
  assert.match(stillOversized.calls[0].prompt, /THIS_THREAD_QUESTION/)
  assert.ok(stillOversized.sizing.fullBound > stillOversized.sizing.capacity)
  assert.ok(stillOversized.sizing.promptBytes.every(part => part.included))
})


test('saved fictional layout-only follow-up sends the full thread within 32768 and renders two lines', async () => {
  const history = [
    {role:'user', content:'虛構入場提示有三項：手帶係粉藍色，核對枱係白鷺室門口，只畀場務睇。'},
    {role:'assistant', content:'手帶粉藍色，核對枱喺白鷺室門口，提示只畀場務睇。'}
  ]
  const message = '用返頭先資料，照呢個格式只輸出兩行。第一行係「手帶：顏色，核對枱：位置」，第二行係「只畀場務睇」。唔加其他字、引號或標題。'
  const lines = ['手帶：粉藍色，核對枱：白鷺室門口','只畀場務睇']
  const { localInput } = require('../adapters/LocalAdapter')
  const r = await integrated(message, {mode:'chat',intent:'context',reply:'標題\n' + lines.join('\n'),lines,
    suppliedDetails:['手帶粉藍色','白鷺室門口','只畀場務睇']}, history, true, {
    context:32768, env:{TURN_ROUTER:'on'}
  })
  assert.equal(r.status,200)
  assert.equal(r.admitted,1)
  assert.equal(r.starts,0)
  assert.equal(r.calls.length,1)
  const {prompt,opts} = r.calls[0]
  assert.equal(opts.responseFormat.name,'local_chat_draft')
  assert.deepEqual(opts.responseFormat.schema.properties.mode.enum,['chat','ask'])
  assert.equal(opts.responseFormat.schema.properties.nextRead,undefined)
  const list = opts.responseFormat.schema.properties.lines.anyOf[1]
  assert.deepEqual([list.minItems,list.maxItems],[2,2])
  for (const text of [...history.map(turn=>turn.content),message]) assert.ok(prompt.includes(text))
  const sizing = localInput(prompt,opts)
  assert.ok(sizing.inputBound+sizing.maxTokens<=32768)
  assert.equal(r.body.reply,lines.join('\n'))
  assert.equal(r.body.replyOnlyDraft,true)
  assert.equal(Boolean(r.body.workRequestOffer),false)
  assert.equal(r.writes.length,1)

  const {exerciseDraftLayout} = require('./localChatDraft')
  assert.equal(exerciseDraftLayout(message,[history[0].content,message]),2)
  for (const wrongHistory of [
    [message],
    [history[0].content.replace('虛構','正式'),message],
    [history[0].content+' 順便查庫存。',message],
    [history[0].content,'啱啱講嘅係正式安排。',message]
  ]) assert.equal(exerciseDraftLayout(message,wrongHistory),null)
  for (const mixed of [
    message+'幫我改檔。',
    message+'列埋實際銷售額。',
    message.replace('只畀場務睇','更新班表'),
    message.replace('只輸出兩行','只輸出三行')
  ]) assert.equal(exerciseDraftLayout(mixed,[history[0].content,mixed]),null)
})

test('complete fictional notice premises are rendered from the first saved Owner turn', async () => {
  const message = '虛構入場提示有三項：手帶係粉藍色，核對枱係白鷺室門口，只畀場務睇。'
  const r = await integrated(message, demoStub, [], true, {context:65536, env:{TURN_ROUTER:'on'}})
  assert.equal(r.status,200)
  assert.equal(r.admitted,1)
  assert.equal(r.starts,0)
  assert.equal(r.calls.length,0)
  assert.equal(r.body.talkOnly,true)
  assert.equal(r.body.reply,'手帶係粉藍色，核對枱係白鷺室門口，只畀場務睇。')
  assert.equal(Boolean(r.body.workRequestOffer),false)
  assert.equal(r.writes.length,1)
})

test('fictional notice opener requires complete literal clauses from the first authenticated turn', () => {
  const {replyToSuppliedFiction} = require('./localChatDraft')
  const notice = '虛構試飲告示有三項：杯套係深紫色，領杯點係木屏風旁，只俾夜更睇。'
  assert.equal(replyToSuppliedFiction(notice,[],[notice])?.reply,'杯套係深紫色，領杯點係木屏風旁，只俾夜更睇。')
  for (const message of [
    notice.replace('虛構','正式'),
    notice.replace('三項','四項'),
    notice.replace('，只俾夜更睇',''),
    notice.replace('深紫色',''),
    notice.replace('深紫色','點查'),
    notice.replace('木屏風旁','登入後改權限'),
    notice.replace('只俾夜更睇','幫我改檔'),
    notice+' 幫我查實際庫存。',
    notice.replace('木屏風旁','https://localhost')
  ]) assert.equal(replyToSuppliedFiction(message,[],[message]),null,message)
  const previous = [{role:'user',text:'上面係正式安排'},{role:'assistant',text:'收到。'}]
  assert.equal(replyToSuppliedFiction(notice,previous,['上面係正式安排',notice]),null)
  assert.equal(replyToSuppliedFiction(notice,[],[]),null)
})

test('oversized local investigation guidance keeps the full supplied turn and uses the remaining answer budget', async () => {
 const {localInput,LocalModelError}=require('../adapters/LocalAdapter')
 const message='虛構門市收入由 100 跌到 90，採購額由 30 升到 33。就呢啲數字解釋可能原因。'
 const reply='收入下跌而採購金額上升，單價同採購量仍要分開核對。'
 const plan={
  question_restated:'解釋所給收入及採購金額。',executive_frame:{taskType:'diagnose',decisionNeeded:false,
   successDefinition:'分開講數字變化及待核對原因。',answerPosture:'provisional'},
  answer_kind:null,requested_capability:null,investigation_focus:null,investigation_reference:null,
  investigation_evidence:[],owner_outcomes:[],joins:[],
  facts:[{id:'given',need:'所給營業額及採購金額',operation:null,entity:null,fields:[],necessity:'required'}]
 }
 const run=context=>integrated(message,(_prompt,opts)=>opts.invocationPhase==='goal_understanding'
  ? plan : {mode:'chat',intent:'context',reply,nextRead:null},[],true,{
  context,env:{READ_ACCESS:'on',GOAL_DECOMPOSER:'on'},
  checkInput:(prompt,opts)=>{
   if(opts.invocationPhase!=='answer')return
   const size=localInput(prompt,opts)
   if(size.inputBound+size.maxTokens>context)throw new LocalModelError('local_context_capacity_exceeded')
  }
 })
 const normal=await run(65536)
 const original=normal.calls.find(c=>c.opts.invocationPhase==='answer')
 assert.ok(normal.sizing)
 assert.match(original.prompt,/調查狀態/)
 assert.ok(original.prompt.includes(message))
 const reduced=await run(normal.sizing.fullBound-1000)
 const answer=reduced.calls.find(c=>c.opts.invocationPhase==='answer')
 assert.equal(answer.prompt,original.prompt)
 assert.deepEqual(answer.opts.responseFormat,original.opts.responseFormat)
 assert.equal(answer.opts.maxTokens,3096)
 assert.equal(reduced.sizing.outputReserve,3096)
 assert.equal(reduced.sizing.inputBound+reduced.sizing.outputReserve,reduced.sizing.capacity)
 assert.equal(reduced.body.reply,normal.body.reply)
 const fail=await run(normal.sizing.inputBound+1023)
 assert.equal(fail.sizing.outputReserve,4096)
 assert.ok(fail.sizing.inputBound+fail.sizing.outputReserve>fail.sizing.capacity)
 assert.notEqual(fail.body.reply,normal.body.reply)
})
