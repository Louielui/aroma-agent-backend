'use strict'
const {isSharedWith}=require('../context/providerSharing'),{validLocator}=require('../context/gmailReplyContract'),goals=require('../intake/goal/ownerGoal')
function createGmailReplyTask({gmail,env=process.env}){
 function lease(provider,source){if(!gmail||source?.origin!=='https://mail.google.com'&&!source?.url?.startsWith('https://mail.google.com/mail/')||!validLocator(source?.gmail)||!isSharedWith(provider,'gmail',env))return null;try{const access=gmail.captureReplyScope(source.gmail.accountEmail);return {...access,capability:{...access.capability,messageId:source.gmail.messageId,threadId:source.gmail.threadId}}}catch{return null}}
 function describe(provider,source){const access=lease(provider,source);return access?[access.capability]:[]}
 async function run({question,page,adapter,actor,capabilities,signal,onEvent,ownerGoal}){
  if(actor?.id!=='owner'||actor.role!=='owner')throw Error('permission_denied')
  const goal=ownerGoal||goals.createGoal({objective:question,requestId:require('node:crypto').randomUUID()}),zh=/[\u3400-\u9fff]/u.test(question)
  const blocked=text=>({model:adapter.model,text,evidence:{operation:'gmail.reply_preview',state:'not_read',complete:false,previewPrepared:false,gmailDraftCreated:false,sent:false},ownerGoal:goal})
  const access=lease(adapter.providerName,page?.source),admitted=capabilities.find(c=>c.id==='gmail.reply_preview')
  if(!access||!admitted)return blocked(zh?'尚未確認這封郵件的已授權帳號、message ID 及 thread ID；未讀取郵件或製作回覆。請在已授權 Gmail 分頁只展開要回覆的郵件，再重新準備。':'The authorized mailbox, message and thread identity are not confirmed. No email was read or reply prepared. Expand only the intended message in the granted Gmail tab and prepare again.')
  const check=()=>{if(signal?.aborted)throw Error('read_timeout');access.verify();if(JSON.stringify(access.capability)!==JSON.stringify(admitted)||JSON.stringify(describe(adapter.providerName,page.source))!==JSON.stringify([admitted]))throw Error('task_scope_changed')}
  check();if(typeof onEvent!=='function')throw Error('audit_unavailable')
  onEvent({stage:'read_task_started',operation:'gmail.reply_preview',method:'get'})
  const locator=page.source.gmail,pack=await access.read(actor,{messageId:locator.messageId,threadId:locator.threadId});check()
  onEvent({stage:'read_task_finished',operation:'gmail.reply_preview',state:pack?.state==='ok'?'live':'unavailable',complete:pack?.coverage?.complete===true})
  if(pack?.state!=='ok'||pack.source!=='gmail'||pack.trust!=='source_data'||pack.contentPolicy!=='data_only'||!Array.isArray(pack.content)||!pack.content.length)return blocked(zh?'本次未能核對 Gmail 帳號或讀取指定 thread；未製作回覆。':'The Gmail account or exact thread could not be verified. No reply was prepared.')
  const rows=pack.content;if(rows.some(r=>r.fields?.accountEmail!==locator.accountEmail||r.fields?.threadId!==locator.threadId))throw Error('task_scope_changed')
  const parent=rows.find(r=>r.sourceId===locator.messageId),h=parent?.fields?.replyHeaders,to=h?.['Reply-To']||h?.From
  if(!parent||!h?.['Message-ID']||!h.Subject||!to)return blocked(zh?'指定郵件缺少必要的回覆標頭；未猜測收件人或主旨，尚未製作回覆。':'Required reply headers are missing. Recipient and subject were not guessed; no reply was prepared.')
  const complete=pack.coverage.complete===true&&rows.every(r=>r.fields.originalBodyComplete===true&&!r.truncated)
  const replyContext={account:locator.accountEmail,parentMessageId:locator.messageId,threadId:locator.threadId,complete,replyHeaders:h,messages:rows.map(r=>({messageId:r.sourceId,date:r.originalDate,headers:r.fields.replyHeaders,text:r.content,complete:r.fields.originalBodyComplete===true}))}
  const out=await require('../intake/u1DraftShadow').runU1DraftShadow({instruction:question,adapter,history:[],requestId:goal.requestId,replyContext,signal});check()
  const limitations=zh?'僅供回覆預覽，未儲存 Gmail 草稿、未寄信。':'Reply preview only. No Gmail draft was saved and no email was sent.'
  const text=[zh?'回覆預覽':'Reply preview',complete?'':(zh?'郵件內容未完整：部分正文、較早訊息或附件未讀取；以下僅根據已核對內容。':'Thread context is incomplete: some body text, earlier messages or attachments were not read. This preview uses verified content only.'),out.mode==='ask'?out.clarifyingQuestion:[(zh?'回覆給：':'Reply to: ')+to,(zh?'原收件人：':'Original To: ')+(h.To||'—'),(zh?'原副本：':'Original Cc: ')+(h.Cc||'—'),(zh?'主旨：':'Subject: ')+h.Subject,out.draft.body].join('\n\n'),limitations].filter(Boolean).join('\n\n')
  const mapped=goals.refineGoal(goal,goal.outcomes.filter(o=>require('../context/gmailReplyContract').replyRequest(o.ownerQuote)).map(o=>({ownerQuote:o.ownerQuote,capability:'gmail.read',kind:'read'})))
  const observed=goals.observeReads(mapped,{perSource:[{source:'gmail',trust:'live'}],evidenceSets:[{source:'gmail',completeness:complete?'complete':'partial'}]})
  return {model:adapter.model,actualModel:out.actualModel||null,billing:out.billing||null,text,ownerGoal:observed,evidence:{operation:'gmail.reply_preview',state:'live',complete,previewPrepared:out.mode==='draft_proposal',needsClarification:out.mode==='ask',gmailDraftCreated:false,sent:false,messageId:locator.messageId,threadId:locator.threadId,mailbox:admitted.mailbox,returnedMessages:rows.length}}
 }
 return {describe,run}
}
module.exports={createGmailReplyTask}
