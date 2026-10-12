'use strict'
// Only server-created evidence receipts can reconnect a public query. Browser
// history, quotations and translations are data, never query/permission authority.
const {t}=require('../i18n/t')
const REASONS=new Set(['source_missing','shape_invalid','quote_mismatch','language_mismatch','temporal_scope','unverified_number','data_missing','source_unavailable'])
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(v,k))
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max
const at=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))
const url=v=>typeof v==='string'&&v.length<=2000&&require('../subscription/publicPages').publicUrl(v)===v
function validGap(g){return exact(g,['reason','sourceId','url','quote','quoteVerified','hash','readAt'])&&REASONS.has(g.reason)&&(g.sourceId===null||text(g.sourceId,80))&&(g.url===null||url(g.url))&&typeof g.quoteVerified==='boolean'&&(g.quoteVerified?text(g.quote,800)&&g.url!==null:g.quote===null)&&(g.hash===null||/^[a-f0-9]{64}$/.test(g.hash))&&(g.readAt===null||at(g.readAt))}
function validReceipt(r){return exact(r,['version','query','language','retrievedAt','gaps','completionAttempted'])&&r.version===1&&exact(r.query,['query','freshness','location'])&&require('../subscription/publicSearch').validInput(r.query)&&['zh','en'].includes(r.language)&&at(r.retrievedAt)&&typeof r.completionAttempted==='boolean'&&Array.isArray(r.gaps)&&r.gaps.length<=8&&r.gaps.every(validGap)}
function createReceipt(input){
 const groups=input.itemsBySource||[]
 if(!groups.length||groups.some(g=>g.source!=='public_knowledge'||!g.items?.length))return null
 const rows=groups.flatMap(g=>g.items)
 if(rows.some(r=>r.trust!=='live'||r.fields?.provider!=='claude_subscription_search'||r.fields.consulted!==true||!['publisher_cited_summary','web_search_cited_summary'].includes(r.fields.contentKind)||!['publisher_page','publisher_structured','search_summary'].includes(r.fields.sourceEvidence?.kind)||!r.fields.sourceEvidence?.publicQuery))return null
 const first=rows[0],e=first.fields.sourceEvidence,query=e.publicQuery
 if(rows.some(r=>JSON.stringify(r.fields.sourceEvidence.publicQuery)!==JSON.stringify(query)||r.fields.sourceEvidence.language!==e.language))return null
 const gaps=[],add=g=>{if(validGap(g)&&!gaps.some(v=>JSON.stringify(v)===JSON.stringify(g))&&gaps.length<8)gaps.push(g)}
 for(const row of rows){
  const v=row.fields.sourceEvidence
  for(const gap of v.gaps||[])add(gap)
  if(v.answerState==='insufficient'||v.coverage?.missingDays?.length)add({reason:'data_missing',sourceId:null,url:row.fields.url,quote:null,quoteVerified:false,hash:v.hash||null,readAt:v.readAt||null})
  for(const check of v.pageChecks||[])if(check.state!=='read')add({reason:'source_unavailable',sourceId:null,url:check.url,quote:null,quoteVerified:false,hash:null,readAt:null})
 }
 const receipt={version:1,query:structuredClone(query),language:e.language,retrievedAt:first.retrievedAt,gaps,completionAttempted:false}
 return validReceipt(receipt)?receipt:null
}
function latestReceipt(conversation){const last=conversation?.messages?.at(-1);return last?.role==='assistant'&&validReceipt(last.publicAnswerReceipt)?structuredClone(last.publicAnswerReceipt):null}
const {requestKind}=require('./publicAnswerFollowupIntent')
function reasonText(reason,lang){
 switch(reason){
 case 'unverified_number':return t('publicSearch.checkNumber',{},lang)
 case 'quote_mismatch':return t('publicSearch.checkQuote',{},lang)
 case 'language_mismatch':return t('publicSearch.checkLanguage',{},lang)
 case 'temporal_scope':return t('publicSearch.checkTime',{},lang)
 case 'source_missing':return t('publicSearch.checkSource',{},lang)
 case 'shape_invalid':return t('publicSearch.checkShape',{},lang)
 case 'source_unavailable':return t('publicSearch.sourceUnavailable',{},lang)
 default:return t('publicCompletion.dataMissing',{},lang)
 }
}
function explain(receipt,lang){
 if(!receipt.gaps.length)return t('publicCompletion.noRecordedGap',{},lang)
 const clean=require('../intake/publicProvenance').cleanText
 return [t('publicCompletion.gaps',{},lang),...receipt.gaps.map((g,i)=>`${i+1}. ${reasonText(g.reason,lang)}${g.url?'\n'+g.url:''}${g.quoteVerified?'\n> '+clean(g.quote).replace(/\n/g,'\n> '):''}`),t('publicCompletion.quoteLimit',{},lang)].join('\n\n')
}
function access(env){if(!require('../context/flags').readAccessEnabled(env,'public_knowledge')||!require('../intake/a4Contract').a4SemanticRoutingEnabled(env)||env.PUBLIC_SEARCH_PROVIDER!=='claude-subscription'||!require('../subscription/bridge').validToken(env.CODEX_CHAT_BRIDGE_TOKEN))throw Error('public_completion_unavailable')}
function createService({env=process.env,request}={}){
 return {async complete(receipt,{language,requestId}){
  if(!validReceipt(receipt)||receipt.completionAttempted||!['zh','en'].includes(language))throw Error('public_completion_invalid')
  access(env)
  // Replays only the fixed public query that actually passed the original A4
  // egress planner. No follow-up prose, history or source excerpt leaves here.
  const provider=require('../context/providers/claudeSubscriptionSearchProvider').createClaudeSubscriptionSearchProvider({env,request})
  const adapter=require('../context/adapters/publicKnowledgeRead').createPublicKnowledgeReadAdapter({provider})
  const rows=await adapter.methods.search({...receipt.query,replyLanguage:language,refresh:true,requestId})
  access(env)
  const input={message:t('publicCompletion.result',{},language),itemsBySource:[{source:'public_knowledge',items:rows}]}
  const reply=require('../intake/publicProvenance').publicSummary(input),next=createReceipt(input)
  if(!reply||!next)throw Error('public_completion_unavailable')
  return {reply,receipt:{...next,completionAttempted:true}}
 }}
}
module.exports={validGap,validReceipt,createReceipt,latestReceipt,requestKind,explain,createService,access}
