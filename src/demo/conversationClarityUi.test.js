'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto')
test('candidate pixels space long prose without deleting words, limits, repeated history or safe markup',{timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xx-clarity-ui-')),cid=randomUUID(),store=require('../store/conversationStore').createConversationStore({dataDir:dir})
 t.after(()=>{assert.ok(dir.startsWith(os.tmpdir()+path.sep));fs.rmSync(dir,{recursive:true,force:true})})
 const sentence='建議先核對目前的流程，再決定需要修正的部分。這項建議只涵蓋隔離候選，部署與模型用量須按原有批准處理。'
 const reply=sentence.repeat(7)+'沒有修改正式資料，也沒有執行業務動作。'
 store.appendTurn({id:cid,userText:'請說明建議',replyText:reply})
 const app=require('express')();app.locals.conversationDemo=true;app.use(require('../routes/demoRouter').createDemoRouter({conversationStore:store,getAdapterFn:()=>{throw Error('No model calls allowed')}}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close())
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port+'/demo');await page.getByRole('button',{name:store.list()[0].title,exact:true}).click()
 const md=page.locator('#log .turn.bot .md').last();await md.waitFor();assert.ok(await md.locator(':scope > p').count()>=7)
 const joined=await md.locator(':scope > p').allTextContents();assert.equal(joined.join(''),reply)
 assert.ok(await md.getByText('沒有修改正式資料，也沒有執行業務動作。',{exact:true}).isVisible())
 const desktop=await md.boundingBox();assert.ok(desktop.width<=680,JSON.stringify(desktop))
 if(process.env.AROMA_ARTIFACT_DIR){fs.mkdirSync(process.env.AROMA_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.AROMA_ARTIFACT_DIR,'candidate-reading-desktop.png'),fullPage:true})}
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 if(process.env.AROMA_ARTIFACT_DIR){await page.screenshot({path:path.join(process.env.AROMA_ARTIFACT_DIR,'candidate-reading-mobile.png'),fullPage:true});fs.writeFileSync(path.join(process.env.AROMA_ARTIFACT_DIR,'candidate-reading.json'),JSON.stringify({scope:'Isolated candidate browser test; synthetic long prose, not native production acceptance',paragraphs:joined.length,sourceExactlyPreserved:joined.join('')===reply,desktopWidth:desktop.width,mobileNoHorizontalOverflow:true,modelCalls:0,errors},null,2))}
 assert.deepEqual(errors,[])
})
