'use strict'
importScripts('collector.js')
const HOST='com.imagine.browser_read',pending=new Map()
let port=null,closeTimer=null
// The explicit toolbar action grants activeTab; opening a persistent panel alone
// is not evidence of a page grant. Open synchronously within that user gesture.
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{})
chrome.action.onClicked.addListener(tab=>{if(Number.isInteger(tab?.windowId)&&tab.windowId>=0)chrome.sidePanel.open({windowId:tab.windowId}).catch(()=>{})})
async function capture(windowId){
 if(!Number.isInteger(windowId)||windowId<0)throw Error('invalid_request')
 const [tab]=await chrome.tabs.query({active:true,windowId})
 if(!tab||!Number.isInteger(tab.id))throw Error('current_tab_unavailable')
 const rows=await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',func:collectVisiblePage})
 const row=rows.find(r=>r.frameId===0)
 if(!row?.documentId||!row.result?.text)throw Error('page_text_unavailable')
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.result.text))
 const contentHash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')
 return{title:row.result.title,text:row.result.text,source:{url:row.result.url,tabId:tab.id,windowId:tab.windowId,documentId:row.documentId,frameId:0,capturedAt:new Date().toISOString(),contentHash,truncated:row.result.truncated}}
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
 if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('sidepanel.html')||sender.tab){sendResponse({error:'side_panel_required'});return false}
 ;(async()=>{
  if(message?.type==='capture'&&Object.keys(message).sort().join(',')==='type,windowId')return capture(message.windowId)
  if(message?.type!=='rpc'||Object.keys(message).sort().join(',')!=='body,type')throw Error('invalid_request')
  const b=message.body
  if(b?.op==='read'){
   const fresh=await capture(b.source?.windowId)
   for(const k of ['url','tabId','windowId','documentId','frameId','contentHash','truncated'])if(fresh.source[k]!==b.source?.[k])throw Error('source_changed')
   if(fresh.text!==b.text)throw Error('source_changed')
   return rpc({...b,source:fresh.source})
  }
  return rpc(b)
 })().then(result=>sendResponse({result}),error=>sendResponse({error:/^[a-z_]+$/.test(error.message)?error.message:'page_access_unavailable_click_extension_icon'}))
 return true
})
