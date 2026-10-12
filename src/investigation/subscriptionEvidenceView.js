'use strict'
const {t}=require('../i18n/t')
function renderSubscriptionEvidence(e,locale){
 if(!e||e.state==='UNKNOWN')return null
 const lines=[t('investigation.subscriptionTitle',{},locale)],unknown=t('investigation.briefNotRecorded',{},locale),r=e.receipt
 if(e.state==='CONTRADICTED')lines.push(t('investigation.subscriptionConflict',{},locale))
 else if(!r)lines.push(t('investigation.subscriptionCodexUnavailable',{},locale))
 else{
  const q=r.quota
  if(!q||q.state==='unavailable')lines.push(t('investigation.subscriptionCodexUnavailable',{},locale))
  for(const b of q?.buckets||[]){
   for(const [kind,w]of [['primary',b.primary],['secondary',b.secondary]])if(w)lines.push(t('investigation.subscriptionWindow',{id:b.id,kind:t('investigation.subscriptionWindow.'+kind,{},locale),minutes:w.windowDurationMins??unknown,used:w.usedPercent??unknown,remaining:w.remainingPercent??unknown,reset:w.resetsAt??unknown,at:q.retrievedAt},locale))
   if(b.credits)lines.push(t('investigation.subscriptionBalance',{id:b.id,balance:b.credits.balance??unknown,at:q.retrievedAt},locale))
  }
  if(q?.omitted)lines.push(t('investigation.subscriptionOmitted',{count:q.omitted},locale))
  const a=r.activity
  if(a?.state==='partial'){
   if(a.summary?.lifetimeTokens!==null&&a.summary?.lifetimeTokens!==undefined)lines.push(t('investigation.subscriptionLifetime',{tokens:a.summary.lifetimeTokens,at:a.retrievedAt},locale))
   const d=a.dailyUsageBuckets?.[0]
   if(d)lines.push(t('investigation.subscriptionDay',{date:d.startDate,tokens:d.tokens??unknown,at:a.retrievedAt},locale))
   lines.push(t('investigation.subscriptionDays',{count:a.dailyUsageBuckets.length,omitted:a.omitted??unknown},locale))
  }else lines.push(t('investigation.subscriptionActivityUnavailable',{},locale))
 }
 lines.push(t('investigation.subscriptionBoundary',{},locale))
 return{text:lines.join('\n'),references:e.references}
}
module.exports={renderSubscriptionEvidence}
