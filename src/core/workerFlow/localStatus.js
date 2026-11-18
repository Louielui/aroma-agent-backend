'use strict'
// Read-only status. Neither a provider inference nor an execution authorization.
const profile=require('../../localBrain/deploymentProfile.json')
async function readLocalStatus({env=process.env,bootCommit=require('../../governance/bootCommit').BOOT_COMMIT,request=require('../../adapters/ControlledDispatchAdapter').controlledRequest,check=require('../../workers/execution/windowsSandbox').readiness,now=Date.now}={}){
 const result={mode:'local',enabled:false,runs:[],executionAuthorized:false,subscriptionVerified:false,localCoding:{state:'unavailable',model:'local:'+profile.model},isolation:{ready:null,boundaryVerified:false,reason:'sandbox_status_unavailable'}}
 await Promise.all([
  (async()=>{try{
   const v=await request({op:'status'},env,AbortSignal.timeout(5000)),l=v.localCoding
   if(!/^[a-f0-9]{40}$/.test(bootCommit||'')||v.component!=='controlled-dispatch'||v.protocol!=='controlled-repository-dispatch-v1'||v.bootCommit!==bootCommit||!Number.isFinite(Date.parse(v.checkedAt))||Math.abs(now()-Date.parse(v.checkedAt))>30000||v.inferenceStarted!==false||v.requiresScopeApproval!==true||v.requiresUsageApproval!==true||v.requiresCodingApproval!==true||v.cloudFallback!==false||v.automaticDeployment!==false||v.workerInference!=='explicit_subscription_work_only'||l?.enabled!==true||l.state!=='connected'||l.requiresSeparateApproval!==true||l.automaticFallback!==false||l.selection?.model!=='local:'+profile.model||l.selection?.digest!==profile.digest)throw Error('unconfirmed')
   result.localCoding.state='connected'
  }catch{}})(),
  (async()=>{try{const v=await check();if(typeof v.ready!=='boolean')return;result.isolation={ready:v.ready,boundaryVerified:false,reason:v.ready?null:'sandbox_prerequisites_unavailable'}}catch{}})()
 ])
 return result
}
module.exports={readLocalStatus}
