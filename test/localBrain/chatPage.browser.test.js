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
