'use strict'
const {ID}=require('./gmailReplyContract'),{decodeBody}=require('../company/mailBody'),{makeContextResult,ENTITY_TYPES}=require('./contextResult')
const MAX_MESSAGES=8,MAX_BODY=4000
function validate(input){if(!input||Object.keys(input).sort().join(',')!=='messageId,threadId'||!ID.test(input.messageId||'')||!ID.test(input.threadId||''))throw Error('invalid_request');return {...input}}
function headers(payload){const rows=payload?.headers;if(!Array.isArray(rows))throw Error('invalid_source_headers');const out={};for(const name of ['Subject','From','Reply-To','To','Cc','Message-ID','In-Reply-To','References']){const values=rows.filter(h=>typeof h.name==='string'&&h.name.toLowerCase()===name.toLowerCase());if(values.length>1||values.some(h=>typeof h.value!=='string'||h.value.length>1000||/[\r\n\x00]/.test(h.value)))throw Error('invalid_source_headers');out[name]=values[0]?.value||null}return out}
function createReplyMethods({scope,readerFactory,clock}){
 const methods={},rowLimits={}
 for(const mailbox of ['owner','admin']){
  const method='get'+(mailbox==='owner'?'Owner':'Admin')+'ReplyThread';rowLimits[method]=MAX_MESSAGES
  methods[method]=async input=>{
   const b=validate(input),lease=scope.lease(mailbox),reader=readerFactory(mailbox),identity=await reader.identity();lease.verify()
   if(!Array.isArray(identity?.scopes)||!identity.scopes.includes('https://www.googleapis.com/auth/gmail.readonly')||identity.scopes.some(s=>s==='https://mail.google.com/'||s.startsWith('https://www.googleapis.com/auth/gmail.')&&!['readonly','metadata'].includes(s.split('.').at(-1))))throw Error('readonly_scope_required')
   const profile=await reader.metadata();lease.verify();if(profile?.emailAddress?.toLowerCase()!==lease.email)throw Error('source_identity_mismatch')
   const parent=await reader.getMessage(b.messageId,true);lease.verify();if(parent?.id!==b.messageId||parent.threadId!==b.threadId)throw Error('source_message_mismatch')
   const thread=await reader.getThread(b.threadId);lease.verify()
   if(thread?.id!==b.threadId||!Array.isArray(thread.messages)||!thread.messages.length||thread.messages.some(m=>!ID.test(m?.id||'')||m.threadId!==b.threadId)||new Set(thread.messages.map(m=>m.id)).size!==thread.messages.length||!thread.messages.some(m=>m.id===b.messageId))throw Error('source_thread_mismatch')
   const all=thread.messages.map(m=>{const n=Number(m.internalDate);if(!/^\d{1,15}$/.test(m.internalDate||'')||!Number.isSafeInteger(n)||!Number.isFinite(new Date(n).getTime()))throw Error('invalid_source_date');return m}).sort((a,b)=>Number(a.internalDate)-Number(b.internalDate)||a.id.localeCompare(b.id))
   const selected=all.find(m=>m.id===b.messageId),last=all.slice(-MAX_MESSAGES),chosen=last.some(m=>m.id===b.messageId)?last:[selected,...last.slice(-(MAX_MESSAGES-1))]
   const results=chosen.map(m=>{const h=headers(m.payload),decoded=decodeBody(m.payload),body=decoded.body||'',truncated=body.length>MAX_BODY||decoded.bodyTruncated===true;return {...makeContextResult({source:'gmail',sourceId:m.id,title:h.Subject,originalDate:new Date(Number(m.internalDate)).toISOString(),retrievedAt:clock(),entityType:ENTITY_TYPES.MAIL,content:body.slice(0,MAX_BODY),fields:{mailbox,accountEmail:lease.email,messageId:m.id,threadId:b.threadId,replyHeaders:h,bodyState:truncated?'partial':decoded.bodyState,attachmentsExcluded:decoded.attachmentsExcluded,originalBodyComplete:!truncated&&decoded.bodyState==='available'&&!decoded.attachmentsExcluded}}),truncated}})
   const complete=all.length===results.length&&results.every(r=>r.fields.originalBodyComplete)
   return {results,evidence:{completeWithinScope:complete,truncated:!complete,sourceTotal:all.length,returnedRows:results.length,queryScope:{window:'exact_authorized_thread',mailbox,threadId:b.threadId,parentMessageId:b.messageId},provenance:'Gmail messages.get + threads.get',selection:'exact_browser_message_and_thread'}}
  }
 }
 return {methods,rowLimits}
}
function resources(){return ['owner','admin'].map(mailbox=>({id:'gmail.'+mailbox+'_reply_thread',source:'gmail',scope:mailbox+'_mailbox_reply_thread',sensitivity:mailbox==='owner'?'private':'company',layer:'truth',validateRow:r=>r.fields?.mailbox===mailbox,operations:{get:{method:'get'+(mailbox==='owner'?'Owner':'Admin')+'ReplyThread',params:validate}}}))}
module.exports={createReplyMethods,resources,validate,headers,MAX_MESSAGES,MAX_BODY}
