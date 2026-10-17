'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
test('R1 assembled UI posts typed clarification with server identities, literal Chinese/English reply and stable retry identity', {timeout:60000},async()=>{
 const {page:html,modelCatalogue}=require('../workers/execution/chatBrowser.cjs'),browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true})
 try{for(const locale of ['en','zh']){
  const context=await browser.newContext(),page=await context.newPage(),posts=[],errors=[],taskId='task_'+randomUUID(),clarificationId=randomUUID()
  let waiting=true,drop=true
  const projection=()=>({version:1,taskId,goalId:'a'.repeat(64),attemptId:randomUUID(),revision:7,objective:'Find tea quotation and investigate invoices',executionState:waiting?'WAITING_CLARIFICATION':'CLARIFICATION_COMPLETED',active:waiting,coverage:'unknown',continuationEnabled:true,outcomes:[],clarification:{id:clarificationId,candidates:[{label:'Green tea / 綠茶',sourceId:'NEVER_SEND_A'},{label:'Black tea / 紅茶',sourceId:'NEVER_SEND_B'}]},result:'Synthetic clarification'})
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url()),p=url.pathname
   if(url.hostname!=='xiangxiang.invalid')return route.abort()
   if(p==='/demo')return route.fulfill({contentType:'text/html',body:html(locale).replace('data-unified-task-intake="false"','data-unified-task-intake="true"')})
   if(p==='/api/v1/demo/task-intake'&&route.request().method()==='POST'){
    const b=route.request().postDataJSON();posts.push(b)
    if(b.operation==='clarification_response'){if(drop){drop=false;return route.abort()}waiting=false}
    return route.fulfill({contentType:'application/json',body:JSON.stringify({unifiedTask:projection(),historySaved:true})})
   }
   if(p.startsWith('/api/v1/demo/task-intake/'))return route.fulfill({contentType:'application/json',body:JSON.stringify(projection())})
   const fixtures={'/api/v1/demo/models':modelCatalogue(),'/api/v1/conversations':{ok:true,conversations:[]},'/api/v1/home/settings':{entries:[]},'/api/v1/demo/greeting':{line:'Fixture'},'/api/v1/demo/version':{build:'offline'},'/manifest.webmanifest':{},'/api/v1/execution-health':{state:'unavailable'}}
   return route.fulfill({contentType:'application/json',body:JSON.stringify(fixtures[p]||{})})
  })
  await page.goto('https://xiangxiang.invalid/demo');await page.fill('#msg','Investigate tea')
  await page.getByRole('button',{name:locale==='en'?'Start shared task':'建立共用任務',exact:true}).click()
  const input=page.getByRole('textbox',{name:locale==='en'?'Reply to clarification':'回覆澄清問題'}),button=page.getByRole('button',{name:locale==='en'?'Submit reply':'提交回覆',exact:true})
  await input.fill(locale==='en'?'The second black tea quotation.':'第二份，紅茶那份。');await button.click();await button.waitFor({state:'visible'});await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Submit reply'||b.textContent==='提交回覆')?.disabled)
  await button.click();await input.waitFor({state:'detached'})
  assert.equal(posts.length,3);assert.deepEqual(posts[1],posts[2]);assert.equal(posts[1].operation,'clarification_response');assert.equal(posts[1].taskRef,taskId);assert.equal(posts[1].clarificationId,clarificationId);assert.equal(posts[1].expectedRevision,7)
  assert.deepEqual(Object.keys(posts[1]).sort(),['version','operation','clientSubmissionId','conversationId','taskRef','expectedRevision','clarificationId','response'].sort())
  assert(!JSON.stringify(posts).includes('NEVER_SEND'));assert.deepEqual(errors,[]);await context.close()
 }}finally{await browser.close()}
})
