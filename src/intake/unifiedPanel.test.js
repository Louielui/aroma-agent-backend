'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
test('C09/C21 assembled bilingual Main UI explicitly starts/views/continues shared tasks without automatic replay', {timeout:60000},async()=>{
 const {page:html,modelCatalogue}=require('../workers/execution/chatBrowser.cjs'),browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true})
 try{for(const locale of ['en','zh'])for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),posts=[],errors=[],taskId='task_'+randomUUID(),objective='Find the tea recipe; do not checkout'
  const projection={version:1,taskId,goalId:'a'.repeat(64),attemptId:randomUUID(),revision:1,objective,executionState:'finished',coverage:'partial',continuationEnabled:true,outcomes:[{ownerQuote:'Find the tea recipe',blockers:['outcome_not_verified']}],result:'Synthetic retained result'}
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url()),p=url.pathname
   if(url.hostname!=='xiangxiang.invalid')return route.abort()
   if(p==='/demo')return route.fulfill({contentType:'text/html',body:html(locale).replace('data-unified-task-intake="false"','data-unified-task-intake="true"')})
   if(p==='/api/v1/demo/task-intake'&&route.request().method()==='POST'){posts.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:JSON.stringify({reply:'Synthetic retained result',unifiedTask:projection,historySaved:true})})}
   if(p.startsWith('/api/v1/demo/task-intake/'))return route.fulfill({contentType:'application/json',body:JSON.stringify(projection)})
   const fixtures={'/api/v1/demo/models':modelCatalogue(),'/api/v1/conversations':{ok:true,conversations:[]},'/api/v1/home/settings':{entries:[]},'/api/v1/demo/greeting':{line:'Fixture'},'/api/v1/demo/version':{build:'offline'},'/manifest.webmanifest':{},'/api/v1/execution-health':{state:'unavailable'}}
   return route.fulfill({contentType:'application/json',body:JSON.stringify(fixtures[p]||{})})
  })
  await page.goto('https://xiangxiang.invalid/demo');await page.fill('#msg',objective)
  await page.getByRole('button',{name:locale==='en'?'Start shared task':'建立共用任務',exact:true}).click()
  await page.getByRole('button',{name:locale==='en'?'Continue original goal with current authorization':'以目前授權繼續原目標',exact:true}).waitFor()
  assert.equal(posts.length,1);assert.equal(posts[0].operation,'start');assert.equal(posts[0].message,objective);assert.deepEqual(posts[0].contextRefs,[])
  assert.equal(await page.inputValue('#msg'),objective);assert((await page.locator('#log').textContent()).includes('outcome_not_verified'))
  await page.getByRole('button',{name:locale==='en'?'Continue original goal with current authorization':'以目前授權繼續原目標',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('#log button:disabled').length>0)
  assert.equal(posts.length,2);assert.equal(posts[1].operation,'continue');assert.equal(posts[1].taskRef,taskId);assert.equal(posts[1].message,objective);assert.equal(posts[1].expectedRevision,1);assert.notEqual(posts[1].clientSubmissionId,posts[0].clientSubmissionId)
  assert.deepEqual(errors,[]);await context.close()
 }}finally{await browser.close()}
})
