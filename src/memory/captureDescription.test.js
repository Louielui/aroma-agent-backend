'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {enforceCapturePolicyReply:guard}=require('./recallReply'),{runtimeSelfBlock}=require('../governance/selfDescription')
const message='給我你的網址。請不要保存這段內容到長期記憶。'
test('single-paragraph retained denial is corrected without removing the observed URL or inventing a deletion receipt',()=>{
 const original=require('../intake/fixtures/postdeploymentAnswerReplay.json').history[1].text,out=guard(original,message)
 assert.equal(out.corrected,true);assert.match(out.reply,/127\.0\.0\.1:8090\/demo/);assert.match(out.reply,/排除規則/);assert.match(out.reply,/以實際回執/);assert.match(out.reply,/不代表已刪除/);assert.doesNotMatch(out.reply,/沒辦法保證|沒有權限阻止/)
 const following=guard('我不能阻止長期記憶保存。系統網址是 http://127.0.0.1:8090/demo。',message);assert.match(following.reply,/127\.0\.0\.1:8090\/demo/)
})
test('service outages, truthful unobserved receipts, quoted transformations and historical recall are not overwritten',()=>{
 for(const reply of ['長期記憶服務無法連線，召回失敗。','我無法連接長期記憶服務。','I cannot connect to long-term memory.','長期記憶排除有支援，但我還沒核對回執，不能保證本輪結果。'])assert.deepEqual(guard(reply,message),{reply,corrected:false})
 const quoted='I cannot prevent long-term memory storage.';assert.deepEqual(guard(quoted,"Translate to Chinese: I cannot prevent long-term memory storage; do not save."),{reply:quoted,corrected:false})
 assert.equal(guard('我不記得上次安排。','照上次安排').corrected,false)
})
test('host policy is derived from the existing capture rule, cannot be overwritten by socket-like text, and remains distinct from a receipt',t=>{
 const block=runtimeSelfBlock({address:'127.0.0.1',port:8090,memoryOptOut:false,publicUrl:'https://evil.invalid'},{message})
 assert.match(block,/owner opt-out: yes/);assert.match(block,/receipt is not observed/);assert.ok(!block.includes('evil.invalid'))
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capture-policy-replay-'));t.after(()=>{assert.ok(dir.startsWith(os.tmpdir()+path.sep));fs.rmSync(dir,{recursive:true,force:true})})
 const capture=require('./capture').createCapture({dir,client:{retainAutomatic:()=>{throw Error('No model or memory write permitted')}}})
 const row=capture.turn({id:'policy-replay',userText:message,replyText:guard('我不能保存長期記憶。',message).reply},2);assert.equal(row.state,'skipped');assert.equal(row.reason,'owner_opt_out');assert.equal(row.text,'')
})
