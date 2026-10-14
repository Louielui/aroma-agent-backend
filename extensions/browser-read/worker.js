'use strict'
importScripts('collector.js')
const HOST='com.imagine.browser_read',pending=new Map()
let port=null,closeTimer=null
// The explicit toolbar action grants activeTab; opening a persistent panel alone
// is not evidence of a page grant. Open synchronously within that user gesture.
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{})
const topicLoads=new Map()
function configureTab(tabId,windowId){if(!Number.isSafeInteger(tabId)||tabId<0||!Number.isSafeInteger(windowId)||windowId<0)return;return chrome.sidePanel.setOptions({tabId,path:'sidepanel.html?tabId='+tabId+'&windowId='+windowId,enabled:true}).catch(()=>{})}
chrome.action.onClicked.addListener(tab=>{if(Number.isSafeInteger(tab?.id)&&tab.id>=0&&Number.isSafeInteger(tab.windowId)&&tab.windowId>=0){configureTab(tab.id,tab.windowId);chrome.sidePanel.open({tabId:tab.id}).catch(()=>{})}})
chrome.tabs.onActivated?.addListener(info=>{configureTab(info.tabId,info.windowId)})
chrome.tabs.onAttached?.addListener((tabId,info)=>{configureTab(tabId,info.newWindowId)})
chrome.tabs.onRemoved?.addListener(tabId=>{topicLoads.delete(tabId);chrome.storage.session.remove('browser-tab:'+tabId).catch(()=>{})})
const configureExisting=()=>chrome.tabs.query({}).then(tabs=>Promise.all(tabs.map(t=>configureTab(t.id,t.windowId)))).catch(()=>{})
chrome.runtime.onInstalled?.addListener(configureExisting)
chrome.runtime.onStartup?.addListener(configureExisting)
function panelScope(url){const u=new URL(url);if(u.protocol!==new URL(chrome.runtime.getURL('')).protocol||u.host!==new URL(chrome.runtime.getURL('')).host||u.pathname!=='/sidepanel.html'||u.hash||[...u.searchParams.keys()].sort().join(',')!=='tabId,windowId')throw Error('side_panel_required');const tabId=u.searchParams.get('tabId'),windowId=u.searchParams.get('windowId');if(!/^\d+$/.test(tabId)||!/^\d+$/.test(windowId)||!Number.isSafeInteger(Number(tabId))||!Number.isSafeInteger(Number(windowId)))throw Error('side_panel_required');return {tabId:Number(tabId),windowId:Number(windowId)}}
async function topicContext(scope,windowId){
 const tab=scope?await chrome.tabs.get(scope.tabId):(await chrome.tabs.query({active:true,windowId}))[0]
 if(!tab||!Number.isSafeInteger(tab.id)||!Number.isSafeInteger(tab.windowId)||scope&&scope.windowId!==tab.windowId)throw Error('conversation_tab_changed')
 if(!topicLoads.has(tab.id)){const key='browser-tab:'+tab.id;topicLoads.set(tab.id,(async()=>{const stored=await chrome.storage.session.get(key);const id=stored[key]||crypto.randomUUID();if(!/^[a-f0-9-]{36}$/.test(id))throw Error('conversation_unavailable');if(!stored[key])await chrome.storage.session.set({[key]:id});return id})().catch(e=>{topicLoads.delete(tab.id);throw e}))}
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
 return{title:row.result.title,text:row.result.text,source:{url:row.result.url,tabId:tab.id,windowId:tab.windowId,documentId:row.documentId,frameId:0,capturedAt:new Date().toISOString(),contentHash,truncated:row.result.truncated,coverage}}
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
  if(message?.type==='context'&&['type','type,windowId'].includes(Object.keys(message).sort().join(','))){if(!scope&&(!Number.isSafeInteger(message.windowId)||message.windowId<0))throw Error('invalid_request');return topicContext(scope,message.windowId)}
  if(message?.type==='capture'&&['type,windowId','coverage,type,windowId'].includes(Object.keys(message).sort().join(','))){if(scope&&message.windowId!==scope.windowId)throw Error('conversation_tab_changed');return capture(message.windowId,message.coverage,scope?.tabId??null)}
  if(message?.type!=='rpc'||Object.keys(message).sort().join(',')!=='body,type')throw Error('invalid_request')
  const b=message.body
  if(b?.op==='read'&&Object.hasOwn(b,'source')){
   if(scope&&(b.source?.windowId!==scope.windowId||b.source?.tabId!==scope.tabId))throw Error('conversation_tab_changed')
   const fresh=await capture(b.source?.windowId,b.source?.coverage,scope?.tabId??null)
   for(const k of ['url','tabId','windowId','documentId','frameId','contentHash','truncated'])if(fresh.source[k]!==b.source?.[k])throw Error('source_changed')
   if(fresh.source.coverage!==(b.source?.coverage||'main_frame_visible_text'))throw Error('source_changed')
   if(fresh.text!==b.text)throw Error('source_changed')
   return rpc({...b,source:fresh.source})
  }
  return rpc(b)
 })().then(result=>sendResponse({result}),error=>sendResponse({error:/^[a-z_]+$/.test(error.message)?error.message:'page_access_unavailable_click_extension_icon'}))
 return true
})
