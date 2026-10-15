'use strict'
const {createHash}=require('node:crypto')
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
// Fits the existing 50 KiB JSON parser even with escaped control characters.
const MAX_TEXT=6000,MAX_QUESTION=1000
const NATIVE_FAILURES=Object.freeze(['native_input_unknown','native_input_unavailable','native_input_timeout','native_input_source_changed','browser_pixels_changed','browser_viewport_changed','browser_foreground_changed','browser_url_unverified','browser_viewport_unverified','browser_viewport_ambiguous','native_target_outside_page','native_click_target_changed','native_typing_target_unavailable','owner_moved_pointer','owner_stopped_native_input','native_site_unavailable','invalid_native_action'])
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===keys.slice().sort().join(',')
const digest=text=>createHash('sha256').update(text,'utf8').digest('hex')
// Pure wire identity validation must remain available in the flat Native Host
// package. Intent routing and backend-only imports do not belong here.
const GMAIL_ID=/^[a-f0-9]{1,100}$/,GMAIL_EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
function validGmailLocator(v){return !!v&&Object.keys(v).sort().join(',')==='accountEmail,kind,messageId,routeToken,threadId'&&v.kind==='gmail_message'&&typeof v.accountEmail==='string'&&v.accountEmail.length<=254&&GMAIL_EMAIL.test(v.accountEmail)&&GMAIL_ID.test(v.messageId||'')&&GMAIL_ID.test(v.threadId||'')&&typeof v.routeToken==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(v.routeToken)}
function site(url){
 let u;try{u=new URL(url)}catch{throw Error('site_not_allowed')}
 if(u.protocol!=='https:'||u.href!==url||u.username||u.password||u.search||u.hash||u.hostname==='localhost'||u.hostname.startsWith('[')||/^\d+(?:\.\d+){3}$/.test(u.hostname)||/(?:^|\.)(?:bank|banking|paypal|adp|localhost)(?:\.|$)/i.test(u.hostname)||/\.(?:local|internal)$/.test(u.hostname))throw Error('site_not_allowed')
 return u.origin
}
function validateSource(s,now){
 const keys=['url','tabId','windowId','documentId','frameId','capturedAt','contentHash','truncated']
 if(!s||(!exact(s,keys)&&!exact(s,[...keys,'coverage'])&&!exact(s,[...keys,'gmail'])&&!exact(s,[...keys,'coverage','gmail']))||(s.coverage!==undefined&&!['main_frame_visible_text','selection_text'].includes(s.coverage))||typeof s.url!=='string'||s.url.length>2048||!Number.isSafeInteger(s.tabId)||s.tabId<0||!Number.isSafeInteger(s.windowId)||s.windowId<0||typeof s.documentId!=='string'||!s.documentId||s.documentId.length>128||s.frameId!==0||! /^[a-f0-9]{64}$/.test(s.contentHash)||typeof s.truncated!=='boolean')throw Error('invalid_source')
 const origin=site(s.url),time=Date.parse(s.capturedAt)
 if(!Number.isFinite(time)||now-time>30000||time-now>5000)throw Error('capture_stale')
 if(Object.hasOwn(s,'gmail')&&(origin!=='https://mail.google.com'||!/^https:\/\/mail\.google\.com\/mail\/u\/\d+\/$/.test(s.url)||!validGmailLocator(s.gmail)))throw Error('invalid_source')
 return {origin,tabId:s.tabId,windowId:s.windowId,documentId:s.documentId,frameId:0,contentHash:s.contentHash,truncated:s.truncated,capturedAt:s.capturedAt,urlHash:digest(s.url),coverage:s.coverage||'main_frame_visible_text',...(s.gmail?{gmail:structuredClone(s.gmail)}:{})}
}
function validate(b){
 const shapes={prepare:['op','requestId','question','source'],read:['op','id','consent','source','text'],get:['op','id'],cancel:['op','id']}
 const taskShape=b?.op==='prepare'?['op','requestId','question']:b?.op==='read'?['op','id','consent']:null
 const task=taskShape&&(exact(b,taskShape)||(b.op==='prepare'&&exact(b,[...taskShape,'parentId'])&&ID.test(b.parentId)))
 const taskPage=b?.op==='prepare'&&[1,2,3].includes(b.taskVersion)&&(exact(b,[...shapes.prepare,'taskVersion'])||(exact(b,[...shapes.prepare,'taskVersion','parentId'])&&ID.test(b.parentId)))
 const contextTask=b?.op==='prepare'&&[2,3].includes(b.taskVersion)&&['unavailable','excluded'].includes(b.contextAvailability)&&(exact(b,[...taskShape,'taskVersion','contextAvailability'])||(exact(b,[...taskShape,'taskVersion','contextAvailability','parentId'])&&ID.test(b.parentId)))
 if(!b||!Object.hasOwn(shapes,b.op)||(!task&&!taskPage&&!contextTask&&!exact(b,shapes[b.op])&&!(b.op==='prepare'&&exact(b,[...shapes.prepare,'parentId'])&&ID.test(b.parentId)))||!ID.test(b.op==='prepare'?b.requestId:b.id))throw Error('invalid_request')
 if(b.op==='prepare'&&(typeof b.question!=='string'||!b.question.trim()||b.question.length>MAX_QUESTION))throw Error('invalid_request')
 if(b.op==='read'&&(typeof b.consent!=='boolean'||(!task&&(typeof b.text!=='string'||!b.text.trim()||b.text.length>MAX_TEXT))))throw Error('invalid_request')
 return b
}
module.exports={ID,MAX_TEXT,MAX_QUESTION,NATIVE_FAILURES,exact,digest,site,validateSource,validate,GMAIL_ID,GMAIL_EMAIL,validGmailLocator}
