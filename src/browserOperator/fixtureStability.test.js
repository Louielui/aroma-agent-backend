'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createHash}=require('node:crypto')
const URL='http://127.0.0.1:8090/browser-operator-fixture'
async function fixture(t){
 const browser=await require('playwright-core').chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close())
 const page=await browser.newPage({viewport:{width:1200,height:770}}),html=fs.readFileSync(path.join(__dirname,'fixture.html'),'utf8')
 // Owned synthetic HTML only; never request the actual backend or another site.
 await page.route('**/*',route=>route.request().url()===URL?route.fulfill({status:200,contentType:'text/html',body:html}):route.abort())
 await page.goto(URL);return page
}
test('owned fixture focused input remains visually stable without weakening native pixel validation',async t=>{
 const page=await fixture(t),input=page.getByLabel('Fixture input');await input.click();const clip=await input.boundingBox(),hashes=[]
 for(let n=0;n<8;n++){hashes.push(createHash('sha256').update(await page.screenshot({clip,caret:'initial'})).digest('hex'));await new Promise(resolve=>setTimeout(resolve,200))}
 assert.equal(new Set(hashes).size,1,'Caret blinking changed the input image while no data or focus changed')
 assert.equal(await input.inputValue(),'')
})
test('owned fixture keeps both admitted controls visible after a real wheel scroll for post-action observation',async t=>{
 const page=await fixture(t),context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../../extensions/browser-read/operator.js'),'utf8'),context)
 const before=await page.evaluate(context.collectOperatorPage);assert.deepEqual(before.targets.map(t=>t.id).sort(),['fixture_button','fixture_input'])
 await page.mouse.move(800,600);await page.mouse.wheel(0,360);await page.waitForFunction(()=>scrollY>0)
 const after=await page.evaluate(context.collectOperatorPage);assert.deepEqual(after.targets.map(t=>t.id).sort(),['fixture_button','fixture_input'])
 const measured=JSON.parse(await page.locator('#events').innerText());assert.ok(measured.scrolls>0);assert.equal(measured.untrusted,0)
})
