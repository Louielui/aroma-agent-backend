'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
function fixture(){
 const calls=[],listeners={};let focusedWindow=99
 const chrome={
  action:{onClicked:{addListener:f=>{listeners.action=f}}},
  sidePanel:{setPanelBehavior:async o=>{calls.push({kind:'behavior',...o})},open:async o=>{calls.push({kind:'open',...o})}},
  tabs:{query:async o=>{calls.push({kind:'query',...o});const windowId=o.windowId??focusedWindow;return[{id:windowId+100,windowId}]}},
  scripting:{executeScript:async o=>[{frameId:0,documentId:'document-'+o.target.tabId,result:{title:'Public fixture',url:'https://example.com/',text:'Example Domain',truncated:false}}]},
  runtime:{id:'test-extension',getURL:s=>'chrome-extension://test-extension/'+s,onMessage:{addListener:f=>{listeners.message=f}},connectNative:()=>{throw Error('unexpected_native_dispatch')}}
 }
 const context=vm.createContext({chrome,crypto:require('node:crypto').webcrypto,TextEncoder,setTimeout,clearTimeout,importScripts:()=>{},collectVisiblePage:()=>{}})
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../extensions/browser-read/worker.js'),'utf8'),context)
 const send=message=>new Promise(resolve=>listeners.message(message,{id:chrome.runtime.id,url:chrome.runtime.getURL('sidepanel.html')},resolve))
 return{calls,listeners,send,setFocusedWindow:id=>{focusedWindow=id}}
}
test('toolbar read uses the explicit action gesture and opens only its returned window without reading',async()=>{
 const f=fixture();assert.equal(typeof f.listeners.action,'function');await f.listeners.action({id:107,windowId:7})
 assert.deepEqual(f.calls,[{kind:'behavior',openPanelOnActionClick:false},{kind:'open',windowId:7}])
 await f.listeners.action({id:108});assert.equal(f.calls.length,2)
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
 assert.deepEqual(f.calls.filter(c=>c.kind==='query'),[{kind:'query',active:true,windowId:7},{kind:'query',active:true,windowId:7}])
})
