'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{randomUUID}=require('node:crypto')
async function fixture(t,{expiryMs=600000,clock=true,accept=false,display=true,staleIntl=false,displayMismatch=false}={}){
 let expiresAt
 const id=randomUUID(),posts=[],run={id,kind:'repository_repair',state:'awaiting_scope_approval',input:{execution:'local',goal:'SIMULATED scope approval diagnostics',criteria:['Preserve all guards'],editable:['src/example.js'],bootCommit:'a'.repeat(40),scope:{files:['src/example.js'],budgetRoot:id}},steps:[]}
 const server=http.createServer(async(q,s)=>{
  if(q.method==='POST'){let body='';for await(const chunk of q)body+=chunk;posts.push(JSON.parse(body));run.scopeApprovalDiagnostic={outcome:accept?'accepted':'rejected',reason:accept?'accepted':'displayed_hash_mismatch',receivedAt:new Date().toISOString(),evaluatedAt:new Date().toISOString(),expiresAt,expiredAtReceipt:false};if(accept)run.state='queued';s.statusCode=accept?200:409;s.setHeader('content-type','application/json');return s.end(accept?JSON.stringify({run}):'{"error":"approval_unavailable"}')}
  if(q.url.startsWith('/api/')){if(expiresAt===undefined)expiresAt=Date.now()+expiryMs;const label=display?require('./approvalTime').approvalExpiryDisplay(expiresAt):null;if(displayMismatch)label.epoch++;s.setHeader('content-type','application/json');return s.end(JSON.stringify(q.url.endsWith(id)?{run,approval:{id,hash:'b'.repeat(64),nonce:'c'.repeat(48),expiresAt},...(clock?{approvalTiming:{serverNow:Date.now(),expiresAt,remainingMs:Math.max(0,expiresAt-Date.now()),state:run.scopeApprovalDiagnostic?'rejected':Date.now()>=expiresAt?'expired':'pending',display:label}}:{}),usage:{state:'not_activated',helper:{reserved:0,available:8}}}:{runs:[{id,state:run.state,goal:run.input.goal}]}))}
  s.setHeader('content-type','text/html');s.end(require('./view').buildHtml({env:{XIANGXIANG_LOCAL_CODING:'on'}}))
 }).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close()})
 const browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1280,height:900}})
 await page.addInitScript(()=>{Date.now=()=>1}) // A wrong device clock must not extend an Owner card.
 if(staleIntl)await page.addInitScript(()=>{Intl.DateTimeFormat=function(){throw Error('stale_browser_timezone_engine')}})
 await page.goto('http://127.0.0.1:'+server.address().port+'/?task='+id);await page.waitForSelector('#detail:not([hidden])')
 return{page,posts,expiresAt,run}
}
test('offline browser shows server-bound expiry, refuses elapsed cards despite device clock skew, and never renews or sends automatically',async t=>{
 const f=await fixture(t,{expiryMs:4000});await f.page.waitForSelector('#scopeApprovalExpiry');assert.match(await f.page.locator('#scopeApprovalExpiry').innerText(),/Winnipeg/)
 await f.page.locator('#scopeApprovalConfirm').check();assert.equal(await f.page.locator('#scopeApprovalSubmit').isEnabled(),true)
 await f.page.waitForFunction(()=>document.getElementById('scopeApprovalSubmit').disabled&&document.getElementById('scopeApprovalExpiry').textContent.includes('已過期'),null,{timeout:7000})
 assert.deepEqual(f.posts,[]);assert.match(await f.page.locator('#scopeApprovalExpiry').innerText(),/不會自動/)
})
test('offline browser reads the persisted refusal reason after failed POST without reusing nonce or posting again',async t=>{
 const f=await fixture(t);await f.page.locator('#scopeApprovalConfirm').check();await f.page.locator('#scopeApprovalSubmit').click()
 await f.page.waitForSelector('#scopeApprovalDiagnostic');assert.match(await f.page.locator('#scopeApprovalDiagnostic').innerText(),/顯示的版本雜湊不符/);assert.equal(f.posts.length,1);assert.equal(f.posts[0].op,'authorize');assert.equal(await f.page.locator('#scopeApprovalSubmit').isDisabled(),true)
 await f.page.waitForTimeout(2700);assert.equal(f.posts.length,1);assert.equal((await f.page.locator('#detail').innerText()).includes('c'.repeat(48)),false)
})

test('offline browser keeps confirmation through metadata polling, fails closed without host timing, and never authorizes on reload',async t=>{
 const f=await fixture(t);await f.page.locator('#scopeApprovalConfirm').check();await f.page.waitForTimeout(2700);assert.equal(await f.page.locator('#scopeApprovalConfirm').isChecked(),true);assert.equal(await f.page.locator('#scopeApprovalSubmit').isEnabled(),true);await f.page.reload();await f.page.waitForSelector('#scopeApprovalConfirm');assert.equal(await f.page.locator('#scopeApprovalConfirm').isChecked(),false);assert.deepEqual(f.posts,[])
 const g=await fixture(t,{clock:false});assert.equal(await g.page.locator('#scopeApprovalConfirm').isDisabled(),true);assert.equal(await g.page.locator('#scopeApprovalSubmit').isDisabled(),true);assert.match(await g.page.locator('#scopeApprovalExpiry').innerText(),/無法核對/);assert.deepEqual(g.posts,[])
})

test('offline browser replaces sending status with the persisted accepted receipt, without claiming completed tests or coding',async t=>{
 const f=await fixture(t,{accept:true});await f.page.locator('#scopeApprovalConfirm').check();await f.page.locator('#scopeApprovalSubmit').click();await f.page.waitForSelector('#scopeApprovalDiagnostic');assert.match(await f.page.locator('#message').innerText(),/來源批准已記錄/);assert.match(await f.page.locator('#message').innerText(),/不代表測試或編碼已完成/);assert.doesNotMatch(await f.page.locator('#message').innerText(),/正在送出/);assert.equal(f.posts.length,1)
})

test('offline page uses the host-bound numeric-offset and UTC deadline even when browser timezone formatting is unusable',async t=>{
 const f=await fixture(t,{staleIntl:true}),d=require('./approvalTime').approvalExpiryDisplay(f.expiresAt)
 const label=await f.page.locator('#scopeApprovalExpiry').innerText();assert.ok(label.includes(d.local));assert.ok(label.includes(d.utc));assert.ok(label.includes('America/Winnipeg'))
 await f.page.locator('#scopeApprovalConfirm').check();assert.equal(await f.page.locator('#scopeApprovalSubmit').isEnabled(),true);assert.deepEqual(f.posts,[])
})

test('missing or mismatched host display cannot leave an unlabeled source approval enabled',async t=>{
 for(const options of [{display:false},{displayMismatch:true}]){const f=await fixture(t,options);assert.equal(await f.page.locator('#scopeApprovalSubmit').isDisabled(),true);assert.equal(await f.page.locator('#scopeApprovalConfirm').isDisabled(),true);assert.match(await f.page.locator('#scopeApprovalExpiry').innerText(),/無法核對/);assert.deepEqual(f.posts,[])}
})
