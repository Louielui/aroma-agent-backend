'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
function fixture({native=false}={}){
 const calls=[],listeners={},injections=[],session={},nativeCalls=[];let nativeReply;let focusedWindow=99,nextText='Example Domain'
 const chrome={
  action:{onClicked:{addListener:f=>{listeners.action=f}}},
  sidePanel:{setPanelBehavior:async o=>{calls.push({kind:'behavior',...o})},setOptions:async o=>{calls.push({kind:'options',...o})},open:async o=>{calls.push({kind:'open',...o})}},
  storage:{session:{get:async key=>({[key]:session[key]}),set:async v=>{Object.assign(session,v)},remove:async key=>{delete session[key]}}},
  tabs:{get:async id=>({id,windowId:id-100}),query:async o=>{calls.push({kind:'query',...o});const windowId=o.windowId??focusedWindow;return[{id:windowId+100,windowId}]},onActivated:{addListener:f=>{listeners.activated=f}},onAttached:{addListener:f=>{listeners.attached=f}},onUpdated:{addListener:f=>{listeners.updated=f}},onRemoved:{addListener:f=>{listeners.removed=f}}},
  scripting:{executeScript:async o=>{injections.push(o);return[{frameId:0,documentId:'document-'+o.target.tabId,result:{title:'Public fixture',url:'https://example.com/',text:nextText,truncated:false}}]}},
  runtime:{id:'test-extension',getURL:s=>'chrome-extension://test-extension/'+s,onMessage:{addListener:f=>{listeners.message=f}},connectNative:()=>{if(!native)throw Error('unexpected_native_dispatch');return {onMessage:{addListener:f=>{nativeReply=f}},onDisconnect:{addListener:()=>{}},postMessage:m=>nativeCalls.push(m),disconnect:()=>{}}}}
 }
 const context=vm.createContext({chrome,URL,crypto:require('node:crypto').webcrypto,TextEncoder,setTimeout:(f,n)=>setTimeout(f,n===10000?1:n),clearTimeout,importScripts:()=>{},collectVisiblePage:()=>{},operatorPage:async scope=>({scope:{...scope,url:'https://example.com/',width:800,height:600}})})
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../extensions/browser-read/worker.js'),'utf8'),context)
 const send=(message,url=chrome.runtime.getURL('sidepanel.html'))=>new Promise(resolve=>listeners.message(message,{id:chrome.runtime.id,url},resolve))
 return{calls,listeners,send,injections,nativeCalls,reply:(m,result)=>nativeReply({id:m.id,result}),setText:text=>{nextText=text},setFocusedWindow:id=>{focusedWindow=id}}
}
test('toolbar read uses the explicit action gesture and opens only its returned window without reading',async()=>{
 const f=fixture();assert.equal(typeof f.listeners.action,'function');await f.listeners.action({id:107,windowId:7})
 assert.deepEqual(f.calls,[{kind:'behavior',openPanelOnActionClick:false},{kind:'options',tabId:107,path:'sidepanel.html?tabId=107&windowId=7',enabled:true},{kind:'open',tabId:107}])
 await f.listeners.action({id:108});assert.equal(f.calls.length,3)
})
test('side-panel capture stays bound to its own window when another Chrome window has focus',async()=>{
 const f=fixture();f.setFocusedWindow(99)
 const result=await f.send({type:'capture',windowId:7});assert.equal(result.error,undefined);assert.equal(result.result.source.windowId,7);assert.equal(result.result.source.tabId,107)
 const query=f.calls.find(c=>c.kind==='query');assert.deepEqual(query,{kind:'query',active:true,windowId:7})
 assert.equal((await f.send({type:'capture',windowId:-1})).error,'invalid_request')
 assert.equal((await f.send({type:'capture'})).error,'invalid_request')
 assert.equal((await f.send({type:'capture',windowId:7,arbitrary:true})).error,'invalid_request')
})
test('read verification rechecks the prepared window instead of the last-focused Chrome window',async()=>{
 const f=fixture(),prepared=await f.send({type:'capture',windowId:7});f.setFocusedWindow(99)
 const response=await f.send({type:'rpc',body:{op:'read',id:require('node:crypto').randomUUID(),consent:true,source:prepared.result.source,text:prepared.result.text}})
 // The fixture deliberately refuses the native handoff. Reaching that refusal
 // proves the real worker matched the unchanged prepared source first.
 assert.equal(response.error,'unexpected_native_dispatch')
 assert.deepEqual(f.calls.filter(c=>c.kind==='query'),[{kind:'query',active:true,windowId:7},{kind:'query',active:true,windowId:7},{kind:'query',active:true,windowId:7}])
})

test('selection capture passes only a fixed scope argument and changed selected content refuses native dispatch',async()=>{const f=fixture(),selected=await f.send({type:'capture',windowId:7,coverage:'selection_text'});assert.equal(selected.result.source.coverage,'selection_text');assert.equal(f.injections[0].args[0],'selection_text');f.setText('Changed selection');assert.equal((await f.send({type:'rpc',body:{op:'read',id:require('crypto').randomUUID(),consent:true,source:selected.result.source,text:selected.result.text}})).error,'source_changed');assert.equal((await f.send({type:'capture',windowId:7,coverage:'input_fields'})).error,'invalid_request')})
test('task-only worker handoff never queries or injects the Owner page',async()=>{const f=fixture(),r=await f.send({type:'rpc',body:{op:'read',id:require('crypto').randomUUID(),consent:true}});assert.equal(r.error,'unexpected_native_dispatch');assert.equal(f.injections.length,0);assert.equal(f.calls.filter(c=>c.kind==='query').length,0)})

test('topic context keys are unique per tab, survive concurrent restore, and never capture the page',async()=>{
 const f=fixture(),a='chrome-extension://test-extension/sidepanel.html?tabId=107&windowId=7',b='chrome-extension://test-extension/sidepanel.html?tabId=108&windowId=8';const [x,y,z]=await Promise.all([f.send({type:'context'},a),f.send({type:'context'},b),f.send({type:'context'},a)]);assert.equal(x.result.key,z.result.key);assert.notEqual(x.result.key,y.result.key);assert.equal(x.result.tabId,107);assert.equal(y.result.windowId,8);assert.equal(f.injections.length,0);assert.equal((await f.send({type:'context'},a.replace('windowId=7','windowId=99'))).error,'conversation_tab_changed')
 assert.equal((await f.send({type:'capture',windowId:7},a.replace('test-extension','foreign-extension'))).error,'side_panel_required');assert.equal(f.injections.length,0)
})

test('a scoped panel cannot capture another active tab or another window and rejects extra scope parameters',async()=>{
 const f=fixture(),a='chrome-extension://test-extension/sidepanel.html?tabId=108&windowId=7';assert.equal((await f.send({type:'capture',windowId:7},a)).error,'conversation_tab_changed');assert.equal(f.injections.length,0);assert.equal((await f.send({type:'capture',windowId:99},a)).error,'conversation_tab_changed');assert.equal((await f.send({type:'context'},a+'&url=https://example.com')).error,'side_panel_required')
})

test('tab switches and navigation cancel an in-flight contextual read without capturing the new tab',async()=>{
 for(const event of ['activated','updated','attached','removed']){const f=fixture({native:true}),url='chrome-extension://test-extension/sidepanel.html?tabId=107&windowId=7',page=await f.send({type:'capture',windowId:7},url),id=require('node:crypto').randomUUID(),pending=f.send({type:'rpc',body:{op:'read',id,consent:true,source:page.result.source,text:page.result.text}},url);while(!f.nativeCalls.some(m=>m.body.op==='read'))await new Promise(r=>setImmediate(r));if(event==='activated')f.listeners.activated({tabId:108,windowId:7});else if(event==='updated')f.listeners.updated(107,{status:'loading'});else if(event==='attached')f.listeners.attached(107,{newWindowId:8});else f.listeners.removed(107);const cancel=f.nativeCalls.find(m=>m.body.op==='cancel');assert.equal(cancel.body.id,id);assert.equal(f.injections.length,2);f.reply(cancel,{state:'cancelled'});f.reply(f.nativeCalls.find(m=>m.body.op==='read'),{state:'cancelled'});assert.equal((await pending).result.state,'cancelled')}
})
test('same-tab navigation preserves existing Operator jobs while contextual reads retain their navigation stop',async()=>{
 const f=fixture({native:true}),url='chrome-extension://test-extension/sidepanel.html?tabId=107&windowId=7',id=require('node:crypto').randomUUID(),start=f.send({type:'operator_start',question:'Open the employee list',consent:true},url)
 while(!f.nativeCalls.some(m=>m.body.op==='operator_start'))await new Promise(r=>setImmediate(r));f.reply(f.nativeCalls.find(m=>m.body.op==='operator_start'),{id,state:'ready'});await start
 f.listeners.updated(107,{status:'loading',url:'https://example.com/employees'});const stopped=f.nativeCalls.find(m=>m.body.op==='operator_stop');if(stopped)f.reply(stopped,{state:'stopped'});assert.equal(f.nativeCalls.filter(m=>m.body.op==='operator_stop').length,0)
 const get=f.send({type:'operator_get',id},url);while(!f.nativeCalls.some(m=>m.body.op==='operator_get'))await new Promise(r=>setImmediate(r));f.reply(f.nativeCalls.find(m=>m.body.op==='operator_get'),{id,state:'ready'});assert.equal((await get).result.id,id)
})
