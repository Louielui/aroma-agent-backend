'use strict'
// Official account metadata only; never starts a thread or a model turn.
const integer=v=>Number.isSafeInteger(v)&&v>=0?v:null
const percent=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100?v:null
const label=v=>typeof v==='string'&&/^[a-z0-9_.:-]{1,100}$/i.test(v)?v:null
const bool=v=>typeof v==='boolean'?v:null
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null
function window(v,at){
 if(!object(v))return null
 const usedPercent=percent(v.usedPercent),minutes=integer(v.windowDurationMins),sec=integer(v.resetsAt)
 const resetsAt=sec&&sec<=253402300799?new Date(sec*1000).toISOString():null
 const current=!!(resetsAt&&stamp(at)&&Date.parse(resetsAt)>Date.parse(at))
 return{usedPercent,remainingPercent:current&&usedPercent!==null?100-usedPercent:null,windowDurationMins:minutes>0?minutes:null,resetsAt,current,evidenceState:usedPercent!==null&&minutes>0&&resetsAt?'CONFIRMED':'UNKNOWN'}
}
function quota(v,at){
 const map=object(v?.rateLimitsByLimitId)?v.rateLimitsByLimitId:null
 const entries=map?Object.entries(map):object(v?.rateLimits)?[[label(v.rateLimits.limitId)||'legacy',v.rateLimits]]:[]
 const buckets=entries.slice(0,16).filter(([k,b])=>label(k)&&object(b)).map(([id,b])=>({id,planType:label(b.planType),primary:window(b.primary,at),secondary:window(b.secondary,at),
  spendControlReached:bool(b.spendControlReached),individualLimit:object(b.individualLimit)?{usedPercent:percent(b.individualLimit.usedPercent),remainingPercent:percent(b.individualLimit.remainingPercent)}:null,
  credits:object(b.credits)?{hasCredits:bool(b.credits.hasCredits),unlimited:bool(b.credits.unlimited),balance:typeof b.credits.balance==='string'&&/^\d{1,24}(?:\.\d{1,12})?$/.test(b.credits.balance)?b.credits.balance:null,unit:'provider_credits_not_currency'}:null}))
 return{state:buckets.some(b=>[b.primary,b.secondary].some(w=>w?.evidenceState==='CONFIRMED'))?'partial':'unavailable',buckets,omitted:Math.max(0,entries.length-16),basis:'account/rateLimits/read',retrievedAt:stamp(at),scope:'signed_in_chatgpt_account_not_xiangxiang_only',provesCharge:false}
}
function usage(v,at){
 const summary=object(v?.summary)?Object.fromEntries(['lifetimeTokens','peakDailyTokens','longestRunningTurnSec','currentStreakDays','longestStreakDays'].map(k=>[k,integer(v.summary[k])])):null
 const byDay=new Map();let invalid=0
 for(const r of Array.isArray(v?.dailyUsageBuckets)?v.dailyUsageBuckets:[]){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(r?.startDate||'')||!stamp(r.startDate)||new Date(r.startDate).toISOString().slice(0,10)!==r.startDate||integer(r.tokens)===null){invalid++;continue}
  const old=byDay.get(r.startDate);byDay.set(r.startDate,old&&old.tokens!==r.tokens?{startDate:r.startDate,tokens:null,evidenceState:'CONTRADICTED'}:old?.evidenceState==='CONTRADICTED'?old:{startDate:r.startDate,tokens:r.tokens,evidenceState:'CONFIRMED'})
 }
 const days=[...byDay.values()].sort((a,b)=>b.startDate.localeCompare(a.startDate))
 return{state:summary&&Object.values(summary).some(v=>v!==null)||days.some(d=>d.tokens!==null)?'partial':'unavailable',summary,dailyUsageBuckets:days.slice(0,60),omitted:Math.max(0,days.length-60),invalidRecords:invalid,
  basis:'account/usage/read',retrievedAt:stamp(at),scope:'signed_in_chatgpt_account_not_xiangxiang_only',dayTimezone:'provider_unspecified',provesCharge:false}
}
function unavailable(basis){return{state:'unavailable',basis,retrievedAt:null,scope:'signed_in_chatgpt_account_not_xiangxiang_only',provesCharge:false}}
async function readCodexEvidence(options={}){
 const clock=options.clock||(()=>new Date().toISOString())
 try{return await require('./codexClient').withClient(options,async rpc=>{
  const before=await rpc.request('account/read',{refreshToken:false})
  if(before?.account?.type!=='chatgpt')throw Error('subscription_auth_unavailable')
  const read=async(method,project)=>{try{return project(await rpc.request(method,{}),clock())}catch(_){return unavailable(method)}}
  const limits=await read('account/rateLimits/read',quota),activity=await read('account/usage/read',usage)
  // Never combine snapshots across an account switch during collection.
  const after=await rpc.request('account/read',{refreshToken:false})
  if(JSON.stringify(before.account)!==JSON.stringify(after?.account))throw Error('account_changed')
  return{state:'partial',records:[{sourceId:'codex-account-snapshot',provider:'gpt',evidenceBasis:'official_subscription_account_metadata',at:clock(),quota:limits,activity}],provesCharge:false,coverage:{codexQuota:limits.state,codexActivity:activity.state,claudeQuota:'unconnected',billing:'unconnected'},
   note:'Claude automated subscription quota is not connected; interactive /usage is available to the owner. Account snapshots include other applications. Tokens and credit balance are not charges or per-job billing. No inference or reset-credit consumption is dispatched.'}
 })}catch(_){return{state:'unavailable',records:[],provesCharge:false,coverage:{codexQuota:'unavailable',codexActivity:'unavailable',claudeQuota:'unconnected',billing:'unconnected'},note:'Official account source unavailable; not zero usage. Claude automated quota and billing are unconnected.'}}
}
module.exports={readCodexEvidence,quota,usage}
