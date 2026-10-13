'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{collectVisiblePage}=require('../../extensions/browser-read/collector')
test('real rendered DOM collector excludes input values, hidden content and other frames and declares truncation',async t=>{
 const pageHtml='<main><h1>Visible heading</h1><p>Visible content</p><input value="secret password"><textarea>private notes</textarea><div hidden>hidden token</div><div style="display:none">hidden CSS token</div><iframe srcdoc="frame secret"></iframe><p>'+('large text '.repeat(1000))+'</p></main>'
 const server=http.createServer((q,s)=>{s.setHeader('content-type','text/html');s.end(pageHtml)}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close())
 const {chromium}=require('playwright-core'),browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/?token=secret#fragment');const r=await page.evaluate(collectVisiblePage);assert.match(r.text,/Visible heading/);assert.ok(!/secret|private notes|hidden token|hidden CSS/.test(r.text));assert.ok(r.text.length<=6000);assert.equal(r.truncated,true);assert.ok(!r.url.includes('?'));assert.ok(!r.url.includes('#'))
})
