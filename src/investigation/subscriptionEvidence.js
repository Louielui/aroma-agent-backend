'use strict'
const {quota,usage}=require('../subscription/subscriptionEvidence')
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null
const window=v=>v?{...v,resetsAt:date(v.resetsAt)?Date.parse(v.resetsAt)/1000:null}:null
function buildSubscriptionEvidence(sections){
 const sources=sections.filter(s=>s.section==='usage'),rows=sources.filter(s=>['ok','partial'].includes(s.state)).flatMap(s=>(s.records||[]).filter(r=>r?.provider==='gpt'&&r.evidenceBasis==='official_subscription_account_metadata'&&r.sourceId==='codex-account-snapshot'&&date(r.at)).map(r=>({s,r})))
 rows.sort((a,b)=>Date.parse(b.r.at)-Date.parse(a.r.at))
 const latest=rows[0],same=latest?rows.filter(x=>Date.parse(x.r.at)===Date.parse(latest.r.at)):[]
 const conflict=new Set(same.map(x=>JSON.stringify({quota:x.r.quota,activity:x.r.activity}))).size>1
 const references=same.map(({s,r})=>({sourceId:s.sourceId,recordId:r.sourceId,fields:{at:r.at,evidenceBasis:r.evidenceBasis}}))
 let receipt=null
 if(latest&&!conflict){
  const r=latest.r,q=r.quota,a=r.activity
  const buckets=Array.isArray(q?.buckets)?q.buckets.slice(0,16):[]
  const limits=q?.basis==='account/rateLimits/read'&&date(q.retrievedAt)?quota({rateLimitsByLimitId:Object.fromEntries(buckets.map(b=>[b.id,{...b,primary:window(b.primary),secondary:window(b.secondary)}]))},q.retrievedAt):null
  const activity=a?.basis==='account/usage/read'&&date(a.retrievedAt)?usage(a,a.retrievedAt):null
  if(limits)limits.omitted=Number.isSafeInteger(q.omitted)&&q.omitted>=0?q.omitted:null
  if(activity){
   const conflicts=(Array.isArray(a.dailyUsageBuckets)?a.dailyUsageBuckets:[]).filter(d=>d?.evidenceState==='CONTRADICTED'&&d.tokens===null&&/^\d{4}-\d{2}-\d{2}$/.test(d.startDate||'')&&date(d.startDate)&&new Date(d.startDate).toISOString().slice(0,10)===d.startDate).map(d=>({startDate:d.startDate,tokens:null,evidenceState:'CONTRADICTED'}))
   activity.dailyUsageBuckets=[...conflicts,...activity.dailyUsageBuckets.filter(d=>!conflicts.some(c=>c.startDate===d.startDate))].sort((a,b)=>b.startDate.localeCompare(a.startDate)).slice(0,60)
   activity.omitted=Number.isSafeInteger(a.omitted)&&a.omitted>=0?a.omitted:null;activity.invalidRecords=Number.isSafeInteger(a.invalidRecords)&&a.invalidRecords>=0?a.invalidRecords:null
  }
  receipt={at:r.at,quota:limits,activity}
  for(const ref of references)Object.assign(ref.fields,{quota:limits,activity})
 }
 return{state:conflict?'CONTRADICTED':receipt?'SUPPORTED':sources.length?'UNAVAILABLE':'UNKNOWN',receipt,references,claudeQuota:'UNAVAILABLE',billingConfirmed:false,perJobCharge:null,scope:'signed_in_chatgpt_account_not_xiangxiang_only',accountToInvocationLink:'UNKNOWN'}
}
module.exports={buildSubscriptionEvidence}
