'use strict'
// Real browser, entirely routed fixtures. This never contacts a service or model.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
for(const available of [true,false])test('formal local page in Edge '+(available?'loads native selection without a subscription label':'keeps Send closed when the local catalogue is unavailable'),{timeout:30000},async t=>{
 const before=process.env.CHAT_BACKEND;let html
 try{process.env.CHAT_BACKEND='local';html=require('../../src/demo/demoHtml').buildDemoHtml()}finally{if(before===undefined)delete process.env.CHAT_BACKEND;else process.env.CHAT_BACKEND=before}
 const browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const context=await browser.newContext(),page=await context.newPage(),calls=[],errors=[]
 page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>localStorage.setItem('xiangxiang-brain-v1','claude-opus-5-5'))
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;assert.equal(url.hostname,'127.0.0.1');assert.equal(req.method(),'GET','offline readiness must not send or save');calls.push(p)
  const reply=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)})
  if(p==='/demo')return route.fulfill({contentType:'text/html',body:html})
  if(p==='/api/v1/demo/models'){
   if(!available)return route.fulfill({status:503,contentType:'application/json',body:'{"code":"local_service_unavailable"}'})
   const cid=req.headers()['x-xiangxiang-conversation'];return reply({billing:'local',models:[{model:'local:qwen3.5:9b',name:'Local Qwen3.5 9B',available:true,supportsEffort:false,efforts:['auto']}],selection:cid?{scope:{kind:'conversation',id:cid},mode:'central',revision:0,effective:{model:'local:qwen3.5:9b',effort:'auto'}}:null})
  }
  if(p==='/api/v1/execution-health')return reply({state:'unavailable',dispatch:{enabled:false,reason:'local_worker_not_connected'},inference:{provider:'local',model:'qwen3.5:9b',state:available?'ready':'unavailable',cloudFallback:false}})
  if(p==='/api/v1/conversations')return reply({ok:true,conversations:[]})
  if(p==='/api/v1/demo/greeting')return reply({line:'Isolated browser fixture'})
  return reply(p==='/api/v1/home/settings'?{entries:[]}:{})
 })
 await page.goto('http://127.0.0.1:19099/demo');await page.locator('#msg').fill('Unsaved readiness fixture; do not send.')
 if(available){await page.waitForFunction(()=>document.getElementById('send').disabled===false);assert.match(await page.locator('#picker-label').textContent(),/Qwen3\.5 9B/);assert.match(await page.locator('#execution-status').textContent(),/本機模型已就緒/)}
 else{await page.waitForFunction(()=>document.getElementById('brain-status').textContent.includes('本機模型尚未就緒'));assert.equal(await page.locator('#send').isDisabled(),true)}
 assert.doesNotMatch(await page.locator('#picker').getAttribute('aria-label'),/Claude|GPT|訂閱|subscription/i);assert.equal(await page.locator('#chat-level').inputValue(),'auto');assert.equal(await page.locator('#chat-level').isDisabled(),true);assert.equal(await page.locator('#brain-company option').count(),1);assert.equal(await page.locator('#brain-company').inputValue(),'local');assert.equal(await page.evaluate(()=>localStorage.getItem('xiangxiang-brain-v1')),'claude-opus-5-5');assert.deepEqual(errors,[]);assert.equal(calls.includes('/api/v1/demo/intake'),false)
 const dir=fs.mkdtempSync(path.join(process.env.AROMA_ARTIFACT_DIR||os.tmpdir(),'local-chat-pixels-'));await page.screenshot({path:path.join(dir,available?'ready.png':'unavailable.png'),fullPage:true});fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify({engine:'Edge offline fixtures',available,calls,errors,inferenceSends:0,formalAcceptance:false}))
})

test('formal rendering records a visible guarded-answer paint opportunity, never an internal model token',{timeout:30000},async t=>{
 const before=process.env.CHAT_BACKEND;let html
 try{process.env.CHAT_BACKEND='local';html=require('../../src/demo/demoHtml').buildDemoHtml()}finally{if(before===undefined)delete process.env.CHAT_BACKEND;else process.env.CHAT_BACKEND=before}
 const browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const context=await browser.newContext(),page=await context.newPage(),errors=[];let intake=0
 page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;assert.equal(url.hostname,'127.0.0.1');const reply=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)})
  if(p==='/demo')return route.fulfill({contentType:'text/html',body:html})
  if(p==='/api/v1/demo/intake'){assert.equal(req.method(),'POST');intake++;return route.fulfill({contentType:'text/event-stream',body:'data: {"type":"model_complete","timing":{"firstTokenMs":1}}\n\ndata: {"type":"final","body":{"reply":"Offline guarded answer fixture.","historySaved":true,"mode":"chat","lane":"chat"}}\n\n'})}
  assert.equal(req.method(),'GET','fixture cannot save, execute or call an inference service')
  if(p==='/api/v1/demo/models')return reply({billing:'local',models:[{model:'local:qwen3.5:9b',name:'Local Qwen3.5 9B',available:true,supportsEffort:false,efforts:['auto']}],selection:{scope:{kind:'conversation',id:req.headers()['x-xiangxiang-conversation']},mode:'central',revision:0,effective:{model:'local:qwen3.5:9b',effort:'auto'}}})
  if(p==='/api/v1/execution-health')return reply({dispatch:{enabled:false},inference:{provider:'local',state:'ready',cloudFallback:false}})
  if(p==='/api/v1/conversations')return reply({ok:true,conversations:[]});if(p==='/api/v1/demo/greeting')return reply({line:'Offline browser fixture'});return reply(p==='/api/v1/home/settings'?{entries:[]}:{})
 })
 await page.goto('http://127.0.0.1:19099/demo');await page.locator('#msg').fill('Offline timing fixture, no real model.');await page.waitForFunction(()=>document.getElementById('send').disabled===false);await page.locator('#send').click()
 await page.waitForFunction(()=>{const n=document.querySelector('[data-local-answer-timing]');return n&&JSON.parse(n.getAttribute('data-local-answer-timing')).answerPaintOpportunityMs!==null})
 const node=page.locator('[data-local-answer-timing]'),timing=JSON.parse(await node.getAttribute('data-local-answer-timing'));assert.match(await node.innerText(),/Offline guarded answer fixture/);assert.ok(timing.answerPaintOpportunityMs>=timing.answerDomMs);assert.ok(timing.answerDomMs>=timing.firstGuardedResponseMs);assert.equal(Object.hasOwn(timing,'firstTokenMs'),false);assert.equal(intake,1);assert.deepEqual(errors,[])
 const dir=fs.mkdtempSync(path.join(process.env.AROMA_ARTIFACT_DIR||os.tmpdir(),'local-answer-timing-pixels-'));await page.screenshot({path:path.join(dir,'guarded-answer.png'),fullPage:true});fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify({engine:'Edge routed fixture',formalAcceptance:false,inferenceSends:0,intake,errors,timing}))
})

test('opening saved and empty chats only loads local data while Home still refreshes Drive', {timeout:30000}, async t => {
  const express = require('express')
  const { createDemoRouter } = require('../../src/routes/demoRouter')
  const { mountHomeRoutes } = require('../../src/home/homeRoutes')
  const { OUTCOME } = require('../../src/home/errandStore')
  const app = express()
  app.locals.conversationDemo = true
  const driveReads = []
  app.use(createDemoRouter({
    readBacklogFn: async () => { driveReads.push('greeting'); return null },
    backlogTimeoutMs: 5
  }))
  mountHomeRoutes(app, {
    guard: (req, res, next) => req.get('x-test-owner') === 'yes' ? next() : res.sendStatus(403),
    store: {list: () => [{id:'local-fixture',title:'Local waiting fixture',outcome:OUTCOME.STOPPED_FOR_YOU,at:Date.now()}]},
    backlogReader: async () => { driveReads.push('home'); return {line:'Mock Drive invoice backlog',checkedAt:Date.now()} }
  })
  const server = app.listen(0, '127.0.0.1')
  t.after(() => new Promise(resolve => server.close(resolve)))
  await require('node:events').once(server, 'listening')
  const serverUrl = 'http://127.0.0.1:' + server.address().port
  const prior = process.env.CHAT_BACKEND
  let html
  try {
    process.env.CHAT_BACKEND = 'local'
    html = require('../../src/demo/demoHtml').buildDemoHtml()
  } finally {
    if (prior === undefined) delete process.env.CHAT_BACKEND
    else process.env.CHAT_BACKEND = prior
  }
  const browser = await require('playwright-core').chromium.launch({channel:'msedge',headless:true})
  t.after(() => browser.close())
  const context = await browser.newContext()
  const page = await context.newPage()
  const cid = '56f7bf52-e8e1-4b8a-84ea-74633c7abb07'
  const origin = 'http://127.0.0.1:19099'
  const disallowed = []
  await context.route('**/*', async route => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.origin !== origin || req.method() !== 'GET') {
      disallowed.push({origin:url.origin,method:req.method()})
      return route.abort()
    }
    const p = url.pathname
    const json = body => route.fulfill({contentType:'application/json',body:JSON.stringify(body)})
    if (p === '/demo') return route.fulfill({contentType:'text/html',body:html})
    if (['/api/v1/demo/greeting','/api/v1/home/waiting','/api/v1/home/briefing'].includes(p)) {
      const res = await fetch(serverUrl + p, {headers:{'x-test-owner':'yes'}})
      return route.fulfill({status:res.status,contentType:'application/json',body:await res.text()})
    }
    if (p === '/api/v1/conversations') return json({ok:true,conversations:[{id:cid,title:'Saved local fixture',messageCount:2}]})
    if (p === '/api/v1/conversations/' + cid) return json({
      ok:true,conversation:{id:cid,messages:[{role:'user',content:'Mock historical question'},{role:'assistant',content:'Mock historical answer'}]}
    })
    if (p === '/api/v1/demo/models') return json({
      billing:'local',models:[{model:'local:qwen3.5:9b',name:'Local Qwen3.5 9B',available:true,supportsEffort:false,efforts:['auto']}],
      selection:{scope:{kind:'conversation',id:req.headers()['x-xiangxiang-conversation']},mode:'central',revision:0,effective:{model:'local:qwen3.5:9b',effort:'auto'}}
    })
    return json(p === '/api/v1/home/settings' ? {entries:[]} : {})
  })
  const firstGreeting = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/demo/greeting')
  await page.goto(origin + '/demo')
  assert.equal((await firstGreeting).status(),200)
  assert.deepEqual(driveReads,[], 'opening the chat page must not read Drive')

  const savedLoad = page.waitForResponse(r => ['/api/v1/home/waiting','/api/v1/home/briefing'].includes(new URL(r.url()).pathname))
  await page.getByText('Saved local fixture', {exact:true}).first().click()
  assert.equal((await savedLoad).status(),200)
  await page.getByText('Mock historical answer', {exact:true}).waitFor()
  await page.locator('#waiting-bar').waitFor()
  assert.deepEqual(driveReads,[], 'opening saved history must not read Drive')

  const newGreeting = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/demo/greeting')
  await page.locator('#new-chat').click()
  assert.equal((await newGreeting).status(),200)
  assert.deepEqual(driveReads,[], 'opening an empty conversation must not read Drive')
  assert.equal(await page.locator('#waiting-bar').count(),0)
  assert.equal((await fetch(serverUrl + '/api/v1/home/waiting')).status,403)

  await page.locator('#open-home').click()
  await page.getByText('Mock Drive invoice backlog', {exact:false}).waitFor()
  assert.deepEqual(driveReads,['home'])
  assert.deepEqual(disallowed,[])
})
