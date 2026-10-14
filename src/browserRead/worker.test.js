'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
function fixture({native=false,local={},session={},releaseHash=null,url='https://example.com/',failLocalRemove=false,grantedTabs=null}={}){
 const calls=[],listeners={},injections=[],nativeCalls=[];let nativeReply;let focusedWindow=99,nextText='Example Domain'
 const storage=data=>({get:async key=>key===null?{...data}:Object.fromEntries((Array.isArray(key)?key:[key]).map(k=>[k,data[k]])),set:async v=>{Object.assign(data,v)},remove:async key=>{if(data===local&&failLocalRemove)throw Error('fixture_storage_failure');for(const k of Array.isArray(key)?key:[key])delete data[k]}})
 const chrome={
  action:{onClicked:{addListener:f=>{listeners.action=f}}},
  sidePanel:{setPanelBehavior:async o=>{calls.push({kind:'behavior',...o})},setOptions:async o=>{calls.push({kind:'options',...o})},open:async o=>{calls.push({kind:'open',...o})}},
  storage:{session:storage(session),local:storage(local)},
  tabs:{get:async id=>({id,windowId:id-100,...(!grantedTabs||grantedTabs.has(id)?{url}:{})}),query:async o=>{calls.push({kind:'query',...o});const windowId=o.windowId??focusedWindow;return[{id:windowId+100,windowId,url}]},onActivated:{addListener:f=>{listeners.activated=f}},onAttached:{addListener:f=>{listeners.attached=f}},onUpdated:{addListener:f=>{listeners.updated=f}},onRemoved:{addListener:f=>{listeners.removed=f}}},
  scripting:{executeScript:async o=>{injections.push(o);return[{frameId:0,documentId:'document-'+o.target.tabId,result:{title:'Public fixture',url:'https://example.com/',text:nextText,truncated:false}}]}},
  runtime:{id:'test-extension',getURL:s=>'chrome-extension://test-extension/'+s,onStartup:{addListener:f=>{listeners.startup=f}},onInstalled:{addListener:f=>{listeners.installed=f}},onMessage:{addListener:f=>{listeners.message=f}},connectNative:()=>{if(!native)throw Error('unexpected_native_dispatch');return {onMessage:{addListener:f=>{nativeReply=f}},onDisconnect:{addListener:()=>{}},postMessage:m=>nativeCalls.push(m),disconnect:()=>{}}}}
 }
 const context=vm.createContext({IMAGINE_CLIENT_RELEASE:releaseHash?{workerHash:releaseHash}:null,chrome,URL,crypto:require('node:crypto').webcrypto,TextEncoder,setTimeout:(f,n)=>setTimeout(f,n===10000?1:n),clearTimeout,importScripts:()=>{},collectVisiblePage:()=>{},operatorPage:async scope=>({scope:{...scope,url:'https://example.com/',width:800,height:600}})})
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../extensions/browser-read/worker.js'),'utf8'),context)
 const send=(message,url=chrome.runtime.getURL('sidepanel.html'))=>new Promise(resolve=>listeners.message(message,{id:chrome.runtime.id,url},resolve))
 return{calls,listeners,send,injections,nativeCalls,reply:(m,result)=>nativeReply({id:m.id,result}),setText:text=>{nextText=text},setFocusedWindow:id=>{focusedWindow=id}}
}
test('toolbar read uses the explicit action gesture and opens only its returned window without reading',async()=>{
 const f=fixture();assert.equal(typeof f.listeners.action,'function');await f.listeners.action({id:107,windowId:7})
 assert.deepEqual(f.calls,[{kind:'behavior',openPanelOnActionClick:false},{kind:'options',tabId:107,path:'sidepanel.html?tabId=107&windowId=7',enabled:true},{kind:'open',tabId:107}])
 await f.listeners.action({id:108});assert.equal(f.calls.length,3)
})

test('managed update observes only client metadata, blocks concurrent dispatch, and chooses panel refresh for identical worker bytes',async()=>{
 const hash='b'.repeat(64),f=fixture({native:true,releaseHash:hash}),url='chrome-extension://test-extension/sidepanel.html?tabId=107&windowId=7',pending=f.send({type:'client_update'},url)
 while(!f.nativeCalls.length)await new Promise(r=>setImmediate(r));assert.equal(JSON.stringify(f.nativeCalls[0].body),JSON.stringify({op:'client_status'}));assert.equal((await f.send({type:'rpc',body:{op:'read',id:require('crypto').randomUUID(),consent:true}},url)).error,'client_update_busy')
 f.reply(f.nativeCalls[0],{state:'ready',commit:'a'.repeat(40),workerHash:hash});assert.equal((await pending).result.reload,'panel');assert.equal(f.injections.length,0);assert.equal((await f.send({type:'context'},url)).error,undefined)
})
test('managed update fails closed for a busy or unknown host and rejects page senders and extra update arguments',async()=>{
 const url='chrome-extension://test-extension/sidepanel.html?tabId=107&windowId=7'
 for(const state of ['busy','unavailable']){const f=fixture({native:true}),pending=f.send({type:'client_update'},url);while(!f.nativeCalls.length)await new Promise(r=>setImmediate(r));f.reply(f.nativeCalls[0],{state});assert.equal((await pending).error,state==='busy'?'client_update_busy':'client_update_unavailable');assert.equal(f.injections.length,0);assert.equal((await f.send({type:'context'},url)).error,undefined)}
 const f=fixture();assert.equal((await f.send({type:'client_update'},'https://example.com/')).error,'side_panel_required');assert.equal((await f.send({type:'client_update',command:'arbitrary'},url)).error,'invalid_request');assert.equal(f.nativeCalls.length,0)
})
test('extension reload preserves legacy topic bindings while a real browser startup discards only tab bindings',async()=>{
 const local={},session={'browser-tab:107':'00000000-0000-4000-8000-000000000007'},url='chrome-extension://test-extension/sidepanel.html?tabId=107&windowId=7',f=fixture({native:true,local,session}),first=await f.send({type:'context'},url);local[first.result.key]={draft:'Fixture draft'};assert.equal(first.result.key,'browser-topic:'+session['browser-tab:107'])
 const update=f.send({type:'client_update'},url);while(!f.nativeCalls.length)await new Promise(r=>setImmediate(r));f.reply(f.nativeCalls[0],{state:'ready',commit:'a'.repeat(40),workerHash:'b'.repeat(64)});assert.equal((await update).result.reload,'extension')
 const reloaded=fixture({local});reloaded.listeners.installed({reason:'update'});assert.equal((await reloaded.send({type:'context'},url)).result.key,first.result.key);reloaded.listeners.startup();const fresh=await reloaded.send({type:'context'},url);assert.notEqual(fresh.result.key,first.result.key);assert.equal(local[first.result.key].draft,'Fixture draft')
})

test('first managed installation recovers a unique saved read topic from content-free host bindings after session storage was cleared',async()=>{
 const key='browser-topic:00000000-0000-4000-8000-000000000007',headId='00000000-0000-4000-8000-000000000017',local={[key]:{headId,draft:'Fixture retained draft'}},f=fixture({native:true,local}),url='chrome-extension://test-extension/sidepanel.html?tabId=107&windowId=7';f.listeners.installed({reason:'update'});const pending=f.send({type:'context'},url)
 while(!f.nativeCalls.length)await new Promise(r=>setImmediate(r));assert.equal(f.nativeCalls[0].body.op,'client_status');f.reply(f.nativeCalls[0],{state:'ready',bindings:[{headId,tabId:107,windowId:7,urlHash:require('node:crypto').createHash('sha256').update('https://example.com/').digest('hex')}]});assert.equal((await pending).result.key,key);assert.equal(local[key].draft,'Fixture retained draft');assert.equal(f.injections.length,0);assert.equal(f.nativeCalls.length,1)
 const newBoot=fixture({local});newBoot.listeners.startup();assert.notEqual((await newBoot.send({type:'context'},url)).result.key,key);assert.equal(local[key].draft,'Fixture retained draft')
})

test('busy or unavailable legacy migration preserves archived topics and still opens a fresh conversation',async()=>{
 const key='browser-topic:00000000-0000-4000-8000-000000000007',headId='00000000-0000-4000-8000-000000000017',url='chrome-extension://test-extension/sidepanel.html?tabId=107&windowId=7'
 for(const state of ['busy','unavailable']){const local={[key]:{headId,draft:'Fixture preserved'}},f=fixture({native:true,local});f.listeners.installed({reason:'update'});const pending=f.send({type:'context'},url);while(!f.nativeCalls.length)await new Promise(r=>setImmediate(r));f.reply(f.nativeCalls[0],{state});const result=await pending;assert.equal(result.error,undefined);assert.notEqual(result.result.key,key);assert.equal(local[key].draft,'Fixture preserved')}
})

test('legacy topics recover separately when each tab receives its own activeTab grant',async()=>{
 const ids=[7,8].map(n=>'00000000-0000-4000-8000-00000000000'+n),heads=[7,8].map(n=>'00000000-0000-4000-8000-00000000001'+n),local=Object.fromEntries(ids.map((id,i)=>['browser-topic:'+id,{headId:heads[i],draft:'Retained '+i}])),grantedTabs=new Set([107]),f=fixture({native:true,local,grantedTabs}),bindings=heads.map((headId,i)=>({headId,tabId:107+i,windowId:7+i,urlHash:require('node:crypto').createHash('sha256').update('https://example.com/').digest('hex')}));f.listeners.installed({reason:'update'});
 const first=f.send({type:'context'},'chrome-extension://test-extension/sidepanel.html?tabId=107&windowId=7');while(f.nativeCalls.length<1)await new Promise(r=>setImmediate(r));f.reply(f.nativeCalls[0],{state:'ready',bindings});assert.equal((await first).result.key,'browser-topic:'+ids[0]);assert.equal(local['browser-tab:108'],undefined);
 grantedTabs.add(108);const second=f.send({type:'context'},'chrome-extension://test-extension/sidepanel.html?tabId=108&windowId=8');for(let i=0;i<20&&f.nativeCalls.length<2;i++)await new Promise(r=>setImmediate(r));assert.equal(f.nativeCalls.length,2);f.reply(f.nativeCalls[1],{state:'ready',bindings});assert.equal((await second).result.key,'browser-topic:'+ids[1]);assert.equal(local['browser-topic:'+ids[1]].draft,'Retained 1');assert.equal(f.injections.length,0);assert.ok(f.nativeCalls.every(m=>m.body.op==='client_status'));
})
test('legacy migration refuses a reused tab identifier whose live URL hash differs from the saved source',async()=>{
 const key='browser-topic:00000000-0000-4000-8000-000000000007',headId='00000000-0000-4000-8000-000000000017',local={[key]:{headId,draft:'Fixture preserved'}},f=fixture({native:true,local,url:'https://unrelated.example/'});f.listeners.installed({reason:'update'});const pending=f.send({type:'context'},'chrome-extension://test-extension/sidepanel.html?tabId=107&windowId=7');while(!f.nativeCalls.length)await new Promise(r=>setImmediate(r));f.reply(f.nativeCalls[0],{state:'ready',bindings:[{headId,tabId:107,windowId:7,urlHash:require('node:crypto').createHash('sha256').update('https://example.com/').digest('hex')}]});assert.notEqual((await pending).result.key,key);assert.equal(local[key].draft,'Fixture preserved');assert.equal(f.injections.length,0)
})
test('a failed startup clear cannot revive stale tab bindings when Chrome later recreates the worker',async()=>{
 const id='00000000-0000-4000-8000-000000000007',local={'browser-tab:107':id,'browser-client-topic-migration-v1':true,['browser-topic:'+id]:{draft:'Fixture old draft'}},session={},url='chrome-extension://test-extension/sidepanel.html?tabId=107&windowId=7',failed=fixture({local,session,failLocalRemove:true});failed.listeners.startup();assert.equal((await failed.send({type:'context'},url)).error!==undefined,true);const recovered=fixture({local,session});assert.notEqual((await recovered.send({type:'context'},url)).result.key,'browser-topic:'+id);assert.equal(local['browser-topic:'+id].draft,'Fixture old draft')
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
