'use strict'
// Only the existing authenticated Bridge status is read. Never probe the OS
// from the fenced backend or substitute metadata for execution authorization.
const profile=require('../../localBrain/deploymentProfile.json'),{parsePrerequisiteStatus}=require('../../workers/execution/sandboxPrerequisites')
async function readLocalStatus({env=process.env,bootCommit=require('../../governance/bootCommit').BOOT_COMMIT,request=require('../../adapters/ControlledDispatchAdapter').controlledRequest,now=Date.now}={}){
 const result={mode:'local',enabled:false,runs:[],executionAuthorized:false,subscriptionVerified:false,localCoding:{state:'unavailable',model:'local:'+profile.model},isolation:{ready:null,boundaryVerified:false,reason:'sandbox_status_unavailable'}}
 try{
  const v=await request({op:'status'},env,AbortSignal.timeout(5000)),l=v.localCoding,age=now()-Date.parse(v.checkedAt)
  if(!/^[a-f0-9]{40}$/.test(bootCommit||'')||v.component!=='controlled-dispatch'||v.protocol!=='controlled-repository-dispatch-v1'||v.bootCommit!==bootCommit||!Number.isFinite(age)||age<0||age>30000||v.inferenceStarted!==false||v.requiresScopeApproval!==true||v.requiresUsageApproval!==true||v.requiresCodingApproval!==true||v.cloudFallback!==false||v.automaticDeployment!==false||v.workerInference!=='explicit_subscription_work_only'||l?.enabled!==true||l.state!=='connected'||l.requiresSeparateApproval!==true||l.automaticFallback!==false||l.selection?.model!=='local:'+profile.model||l.selection?.digest!==profile.digest)throw Error('unconfirmed')
  result.localCoding.state='connected'
  result.isolation=parsePrerequisiteStatus(l.isolation,bootCommit,now())||{ready:null,boundaryVerified:false,reason:'sandbox_metadata_unconfirmed'}
 }catch{}
 return result
}
module.exports={readLocalStatus}
