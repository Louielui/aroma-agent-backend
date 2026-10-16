'use strict'
importScripts('release.js','collector.js','operator.js')
const HOST='com.imagine.browser_read',pending=new Map()
let port=null,closeTimer=null
let updating=false,updateUntil=0,startupReady=Promise.resolve()
let bindingInit=null,coldStartup=false
const SESSION='browser-session-ready-v1',HANDOFF='browser-update-handoff-v1'
async function resetBindings(cold){
 await chrome.storage.session.set({[SESSION]:{state:'clear_pending',cold}})
 const stored=await chrome.storage.local.get(null);await chrome.storage.local.remove(Object.keys(stored).filter(k=>k.startsWith('browser-tab:')))
 if(cold)await chrome.storage.local.set({'browser-client-topic-migration-v1':true})
 topicLoads.clear();await chrome.storage.session.set({[SESSION]:{state:'ready'}})
}
async function ensureBindings(){
 if(!chrome.storage.local)return
 if(!bindingInit)bindingInit=(async()=>{const saved=(await chrome.storage.session.get(SESSION))[SESSION];if(saved?.state!=='ready')await resetBindings(saved?.state==='clear_pending'?saved.cold!==false:true)})().finally(()=>{bindingInit=null})
 return bindingInit
}
// The explicit toolbar action grants activeTab; opening a persistent panel alone
// is not evidence of a page grant. Open synchronously within that user gesture.
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{})
const topicLoads=new Map()
const operatorJobs=new Map()
const readJobs=new Map()
function stopTabReads(tabId){for(const [id,scope]of readJobs)if(scope.tabId===tabId){rpc({op:'cancel',id}).catch(()=>{});readJobs.delete(id)}}
function stopTabOperations(tabId){for(const [id,scope]of operatorJobs)if(scope.tabId===tabId){rpc({op:'operator_stop',id}).catch(()=>{});operatorJobs.delete(id)}}
function configureTab(tabId,windowId){if(!Number.isSafeInteger(tabId)||tabId<0||!Number.isSafeInteger(windowId)||windowId<0)return;return chrome.sidePanel.setOptions({tabId,path:'sidepanel.html?tabId='+tabId+'&windowId='+windowId,enabled:true}).catch(()=>{})}
chrome.action.onClicked.addListener(tab=>{if(Number.isSafeInteger(tab?.id)&&tab.id>=0&&Number.isSafeInteger(tab.windowId)&&tab.windowId>=0){configureTab(tab.id,tab.windowId);chrome.sidePanel.open({tabId:tab.id}).catch(()=>{})}})
chrome.tabs.onActivated?.addListener(info=>{for(const scope of operatorJobs.values())if(scope.windowId===info.windowId&&scope.tabId!==info.tabId)stopTabOperations(scope.tabId);for(const scope of readJobs.values())if(scope.windowId===info.windowId&&scope.tabId!==info.tabId)stopTabReads(scope.tabId);configureTab(info.tabId,info.windowId)})
chrome.tabs.onAttached?.addListener((tabId,info)=>{stopTabOperations(tabId);stopTabReads(tabId);configureTab(tabId,info.newWindowId)})
chrome.tabs.onUpdated?.addListener((tabId,change)=>{if(change.status==='loading'||typeof change.url==='string')stopTabReads(tabId)})
chrome.tabs.onRemoved?.addListener(tabId=>{stopTabOperations(tabId);stopTabReads(tabId);topicLoads.delete(tabId);chrome.storage.session.remove('browser-tab:'+tabId).catch(()=>{});chrome.storage.local?.remove('browser-tab:'+tabId).catch(()=>{})})
const configureExisting=()=>chrome.tabs.query({}).then(tabs=>Promise.all(tabs.map(t=>configureTab(t.id,t.windowId)))).catch(()=>{})
chrome.runtime.onInstalled?.addListener(details=>{startupReady=startupReady.catch(()=>{}).then(async()=>{const handoff=(await chrome.storage.local.get(HANDOFF))[HANDOFF];if(!coldStartup&&details?.reason==='update'&&handoff&&Object.keys(handoff).sort().join(',')==='expiresAt,nonce'&&/^[a-f0-9-]{36}$/.test(handoff.nonce||'')&&Number.isFinite(handoff.expiresAt)&&handoff.expiresAt>Date.now()&&handoff.expiresAt<Date.now()+5000)await chrome.storage.session.set({[SESSION]:{state:'ready'}});else await resetBindings(coldStartup);await chrome.storage.local.remove(HANDOFF);await configureExisting()});startupReady.catch(()=>{})})
chrome.runtime.onStartup?.addListener(()=>{coldStartup=true;startupReady=startupReady.catch(()=>{}).then(async()=>{await resetBindings(true);await configureExisting()});startupReady.catch(()=>{})})
function panelScope(url){const u=new URL(url);if(u.protocol!==new URL(chrome.runtime.getURL('')).protocol||u.host!==new URL(chrome.runtime.getURL('')).host||u.pathname!=='/sidepanel.html'||u.hash||[...u.searchParams.keys()].sort().join(',')!=='tabId,windowId')throw Error('side_panel_required');const tabId=u.searchParams.get('tabId'),windowId=u.searchParams.get('windowId');if(!/^\d+$/.test(tabId)||!/^\d+$/.test(windowId)||!Number.isSafeInteger(Number(tabId))||!Number.isSafeInteger(Number(windowId)))throw Error('side_panel_required');return {tabId:Number(tabId),windowId:Number(windowId)}}
async function topicContext(scope,windowId){
 await startupReady.catch(()=>{});await ensureBindings()
 const tab=scope?await chrome.tabs.get(scope.tabId):(await chrome.tabs.query({active:true,windowId}))[0]
 if(!tab||!Number.isSafeInteger(tab.id)||!Number.isSafeInteger(tab.windowId)||scope&&scope.windowId!==tab.windowId)throw Error('conversation_tab_changed')
 if(!topicLoads.has(tab.id)){const key='browser-tab:'+tab.id;topicLoads.set(tab.id,(async()=>{
  const storage=chrome.storage.local||chrome.storage.session,stored=await storage.get(key),legacy=await chrome.storage.session.get(key);let recovered=null
  // activeTab exposes only the granted tab URL. Recover this tab independently;
  // opening one panel must not permanently abandon topics in other tabs.
  if(chrome.storage.local&&!stored[key]&&typeof tab.url==='string'){
   const all=await storage.get(null),topics=Object.entries(all).filter(([k,v])=>/^browser-topic:[a-f0-9-]{36}$/.test(k)&&/^[a-f0-9-]{36}$/.test(v?.headId||''));if(topics.length>500)throw Error('conversation_unavailable')
   if(!all['browser-client-topic-migration-v1']&&topics.length){
    let metadata;try{metadata=await rpc({op:'client_status'})}catch{metadata=null}
    const bindings=Array.isArray(metadata?.bindings)&&metadata.bindings.length<=500?metadata.bindings:[],bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tab.url)),urlHash=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join(''),current=await chrome.tabs.get(tab.id).catch(()=>null),keys=current?.windowId===tab.windowId&&current.url===tab.url?topics.filter(([,v])=>bindings.some(b=>b.headId===v.headId&&b.tabId===tab.id&&b.windowId===tab.windowId&&b.urlHash===urlHash)).map(([k])=>k.slice('browser-topic:'.length)):[]
    if(keys.length===1)recovered=keys[0];else if(keys.includes(legacy[key]))recovered=legacy[key]
   }
  }
  const id=stored[key]||recovered||legacy[key]||crypto.randomUUID();if(!/^[a-f0-9-]{36}$/.test(id))throw Error('conversation_unavailable');if(!stored[key])await storage.set({[key]:id});return id
 })().catch(e=>{topicLoads.delete(tab.id);throw e}))}
 const id=await topicLoads.get(tab.id);return {key:'browser-topic:'+id,tabId:tab.id,windowId:tab.windowId}
}
async function capture(windowId,coverage='main_frame_visible_text',expectedTab=null){
 if(!['main_frame_visible_text','selection_text'].includes(coverage))throw Error('invalid_request')
 if(!Number.isInteger(windowId)||windowId<0)throw Error('invalid_request')
 const [tab]=await chrome.tabs.query({active:true,windowId})
 if(!tab||!Number.isInteger(tab.id))throw Error('current_tab_unavailable')
 if(expectedTab!==null&&tab.id!==expectedTab)throw Error('conversation_tab_changed')
 const rows=await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',func:collectVisiblePage,args:[coverage]})
 const row=rows.find(r=>r.frameId===0)
 if(!row?.documentId||!row.result?.text)throw Error('page_text_unavailable')
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.result.text))
 const contentHash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')
  return{title:row.result.title,text:row.result.text,source:{url:row.result.url,tabId:tab.id,windowId:tab.windowId,documentId:row.documentId,frameId:0,capturedAt:new Date().toISOString(),contentHash,truncated:row.result.truncated,coverage,...(row.result.gmail?{gmail:row.result.gmail}:{})}}
}
function rpc(body){
 clearTimeout(closeTimer)
 if(!port){
  port=chrome.runtime.connectNative(HOST)
  port.onMessage.addListener(message=>{const call=pending.get(message.id);if(!call)return;pending.delete(message.id);clearTimeout(call.timer);message.error?call.reject(Error(message.error)):call.resolve(message.result);if(!pending.size)closeTimer=setTimeout(()=>{port?.disconnect();port=null},10000)})
  port.onDisconnect.addListener(()=>{for(const call of pending.values()){clearTimeout(call.timer);call.reject(Error('native_host_unavailable'))}pending.clear();port=null})
 }
 return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('native_reply_unknown_check_saved_result'))},125000);pending.set(id,{resolve,reject,timer});try{port.postMessage({id,body})}catch{pending.delete(id);clearTimeout(timer);reject(Error('native_host_unavailable'))}})
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 let scope=null
 try{if(sender.url!==chrome.runtime.getURL('sidepanel.html'))scope=panelScope(sender.url)}catch{sendResponse({error:'side_panel_required'});return false}
 if(sender.id!==chrome.runtime.id||sender.tab){sendResponse({error:'side_panel_required'});return false}
 ;(async()=>{
  if(updating&&Date.now()<updateUntil)throw Error('client_update_busy')
  if(message?.type==='client_update'&&Object.keys(message).join(',')==='type'){
   if(!scope)throw Error('side_panel_required')
   if(pending.size||readJobs.size)throw Error('client_update_busy')
   updating=true;updateUntil=Infinity
   try{await topicContext(scope);const state=await rpc({op:'client_status'});if(state.state==='busy')throw Error('client_update_busy');if(state.state!=='ready'||! /^[a-f0-9]{40}$/.test(state.commit||'')||! /^[a-f0-9]{64}$/.test(state.workerHash||''))throw Error('client_update_unavailable');const reload=globalThis.IMAGINE_CLIENT_RELEASE?.workerHash===state.workerHash?'panel':'extension';if(reload==='extension')await chrome.storage.local.set({[HANDOFF]:{nonce:crypto.randomUUID(),expiresAt:Date.now()+3000}});updating=reload==='extension';updateUntil=Date.now()+3000;return {reload}}catch(e){updating=false;throw e}
  }
  if(message?.type==='context'&&['type','type,windowId'].includes(Object.keys(message).sort().join(','))){if(!scope&&(!Number.isSafeInteger(message.windowId)||message.windowId<0))throw Error('invalid_request');return topicContext(scope,message.windowId)}
  if(message?.type==='capture'&&['type,windowId','coverage,type,windowId'].includes(Object.keys(message).sort().join(','))){if(scope&&message.windowId!==scope.windowId)throw Error('conversation_tab_changed');return capture(message.windowId,message.coverage,scope?.tabId??null)}
  if(message?.type==='operator_start'&&Object.keys(message).sort().join(',')==='consent,question,type'){
   if(!scope)throw Error('conversation_tab_changed');const page=await operatorPage(scope)
   const result=await rpc({op:'operator_start',requestId:crypto.randomUUID(),question:message.question,consent:message.consent,scope:page.scope});operatorJobs.set(result.id,scope);return result
  }
  if(['operator_next','operator_stop','operator_get'].includes(message?.type)&&Object.keys(message).sort().join(',')==='id,type'){
   const bound=operatorJobs.get(message.id);if(!scope||!bound||bound.tabId!==scope.tabId||bound.windowId!==scope.windowId)throw Error('conversation_tab_changed')
   if(message.type==='operator_next'){const page=await operatorPage(scope);return rpc({op:'operator_next',id:message.id,...page})}
   return rpc({op:message.type,id:message.id})
  }
  if(message?.type!=='rpc'||Object.keys(message).sort().join(',')!=='body,type')throw Error('invalid_request')
  const b=message.body
  if(typeof b?.op==='string'&&b.op.startsWith('operator_'))throw Error('invalid_request')
  if(b?.op==='read'&&Object.hasOwn(b,'source')){
   if(scope&&(b.source?.windowId!==scope.windowId||b.source?.tabId!==scope.tabId))throw Error('conversation_tab_changed')
    readJobs.set(b.id,{tabId:b.source?.tabId,windowId:b.source?.windowId})
    try{
     const fresh=await capture(b.source?.windowId,b.source?.coverage,scope?.tabId??null)
     if(!b.source?.gmail)delete fresh.source.gmail
    const current=(await chrome.tabs.query({active:true,windowId:fresh.source.windowId}))[0]
    if(!readJobs.has(b.id)||current?.id!==fresh.source.tabId)throw Error('source_changed')
   for(const k of ['url','tabId','windowId','documentId','frameId','contentHash','truncated'])if(fresh.source[k]!==b.source?.[k])throw Error('source_changed')
    if(fresh.source.coverage!==(b.source?.coverage||'main_frame_visible_text')||JSON.stringify(fresh.source.gmail)!==JSON.stringify(b.source?.gmail))throw Error('source_changed')
   if(fresh.text!==b.text)throw Error('source_changed')
    return await rpc({...b,source:fresh.source})
    }finally{readJobs.delete(b.id)}
  }
  return rpc(b)
 })().then(result=>sendResponse({result}),error=>sendResponse({error:/^[a-z_]+$/.test(error.message)?error.message:'page_access_unavailable_click_extension_icon'}))
 return true
})
