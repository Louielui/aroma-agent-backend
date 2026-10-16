'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{collectVisiblePage}=require('../../extensions/browser-read/collector')
test('real rendered DOM collector excludes input values, hidden content and other frames and declares truncation',async t=>{
 const pageHtml='<main><h1>Visible heading</h1><p>Visible content</p><input value="secret password"><textarea>private notes</textarea><div hidden>hidden token</div><div style="display:none">hidden CSS token</div><iframe srcdoc="frame secret"></iframe><p>'+('large text '.repeat(1000))+'</p></main>'
 const server=http.createServer((q,s)=>{s.setHeader('content-type','text/html');s.end(pageHtml)}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close())
 const {chromium}=require('playwright-core'),browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/?token=secret#fragment');const r=await page.evaluate(collectVisiblePage);assert.match(r.text,/Visible heading/);assert.ok(!/secret|private notes|hidden token|hidden CSS/.test(r.text));assert.ok(r.text.length<=6000);assert.equal(r.truncated,true);assert.ok(!r.url.includes('?'));assert.ok(!r.url.includes('#'))
})

test('real selected DOM capture includes only selected visible text and rejects input/hidden/empty selections',async t=>{
 const browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.setContent('<main><p id="a">BEFORE selected AFTER</p><textarea id="private">private text</textarea><div hidden id="hidden">hidden text</div></main>');
 await page.evaluate(()=>{const node=document.getElementById('a').firstChild,r=document.createRange();r.setStart(node,7);r.setEnd(node,15);const s=getSelection();s.removeAllRanges();s.addRange(r)});const selected=await page.evaluate(collectVisiblePage,'selection_text');assert.equal(selected.text,'selected');assert.equal(selected.coverage,'selection_text');assert.equal(selected.truncated,false);
 for(const id of ['private','hidden']){await page.evaluate(id=>{const r=document.createRange();r.selectNodeContents(document.getElementById(id));const s=getSelection();s.removeAllRanges();s.addRange(r)},id);await assert.rejects(page.evaluate(collectVisiblePage,'selection_text'),/selection_text_unavailable/)}await page.evaluate(()=>getSelection().removeAllRanges());await assert.rejects(page.evaluate(collectVisiblePage,'selection_text'),/selection_text_unavailable/)
})

test('E1 Gmail collector uses one visible expanded message and account marker, never decodes URL tokens into API identity',async t=>{
 const browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage()
 const html='<a href="https://accounts.google.com/SignOutOptions" aria-label="Google Account: Chef (chef@example.test)">Account</a><main data-legacy-thread-id="def456"><div data-legacy-message-id="abc122"><div class="a3s" hidden>Older hidden body</div></div><div data-legacy-message-id="abc123"><div class="a3s">Visible message</div></div></main>'
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://mail.google.com/mail/u/1/#inbox/FMfcgSyntheticMessage')
 const r=await page.evaluate(collectVisiblePage);assert.equal(r.url,'https://mail.google.com/mail/u/1/');assert.deepEqual(r.gmail,{kind:'gmail_message',accountEmail:'chef@example.test',messageId:'abc123',threadId:'def456',routeToken:'FMfcgSyntheticMessage'});assert.doesNotMatch(r.text,/Older hidden/)
 await page.goto('https://mail.google.com/mail/u/1/#inbox/FMfcgAnotherMessage');assert.equal((await page.evaluate(collectVisiblePage)).gmail.routeToken,'FMfcgAnotherMessage')
 await page.locator('[data-legacy-message-id="abc122"] .a3s').evaluate(e=>e.removeAttribute('hidden'));assert.equal((await page.evaluate(collectVisiblePage)).gmail,undefined)
 await page.locator('[data-legacy-message-id="abc122"]').evaluate(e=>e.remove());await page.locator('[data-legacy-thread-id]').evaluate(e=>e.removeAttribute('data-legacy-thread-id'));assert.equal((await page.evaluate(collectVisiblePage)).gmail,undefined)
})
