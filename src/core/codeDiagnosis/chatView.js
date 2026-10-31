'use strict'
const {t}=require('../../i18n/t')
// Receipt presentation only; command matching lives in chat.js and is never translated.
function report(run){
 if(!run)return t('dispatchChat.noRun')
 const facts={id:run.id,state:run.state,stage:run.steps?.at(-1)?.stage||run.state}
 if(run.state==='completed'&&run.result&&run.verification?.matched===true&&run.verification?.citationsVerified===true){
  const summary=run.result.summary.length>240?run.result.summary.slice(0,240)+'…':run.result.summary
  return t('dispatchChat.completed',{...facts,summary})
 }
 if(['failed','timed_out','cancelled','interrupted','needs_attention'].includes(run.state))return t('dispatchChat.failed',{...facts,reason:run.reason||run.state})
 return t('dispatchChat.progress',facts)
}
function healthReply(status){
 return t('dispatchChat.health',{transport:status.transport.state,enabled:String(status.dispatch.enabled),reason:status.dispatch.reason||'ready',capability:'CodeDiagnosis v1 / dispatch-v1',worker:status.worker.state,legacyLane:'Agent Bridge',legacy:String(status.legacyAgentBridge.enabled),backend:status.backend.bootCommit,bridge:status.transport.bootCommit||'unknown'})
}
module.exports={report,healthReply}
