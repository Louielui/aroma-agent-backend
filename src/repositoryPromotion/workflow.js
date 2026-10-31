'use strict'
const {randomUUID}=require('node:crypto')
const {promotionDecision}=require('./policy')
function createWorkflow ({adapter,save,id=randomUUID(),initial=null}) {
  let busy=false,spent=false
  const row=initial ? structuredClone(initial) : {id,workflow:'repository_promotion',state:'new',startedAt:new Date().toISOString(),steps:[]}
  if(initial && !['new','awaiting_administrator','awaiting_idle','awaiting_reload_idle'].includes(row.state)) throw Error('promotion_recovery_requires_inspection')
  function record(stage,facts={}){row.state=stage;row.steps.push({stage,at:new Date().toISOString(),facts});save(structuredClone(row))}
  async function rollback (failure) {
    row.failure=failure;record('verification_failed',failure)
    try{
      row.rollbackResult=await adapter.rollback(row);record('rollback_executed',{commit:row.rollbackResult.commit})
      const check=await adapter.verifyRollback(row)
      if(check?.verified!==true)throw Error('rollback_verification_failed')
      row.rollbackVerification=check;record('rolled_back');return row
    }catch(error){row.rollbackFailure={reason:error.message==='rollback_verification_failed'?'rollback_verification_failed':'rollback_failed'};row.reason='rollback_failed';record('needs_attention',{reason:row.reason});return row}
  }
  async function deployAndVerify () {
    try{
      row.deployment=await adapter.deploy(row)
      if(row.deployment?.state==='administrator_required'&&row.deployment.applied===false){record('awaiting_administrator');return row}
      if(row.deployment?.state==='idle_required'&&row.deployment.applied===false){record('awaiting_idle');return row}
      record('deployed')
      row.runtime=await adapter.verify(row)
      if(row.runtime?.verified!==true)return rollback({reason:row.runtime?.reason || 'runtime_verification_failed'})
      record('complete',{runtime:row.runtime});return row
    }catch(error){
      if(error.message==='administrator_required'){record('awaiting_administrator');return row}
      return rollback({reason:'runtime_verification_unavailable',stage:row.checkout?'reload':'deployment',boundary:['local_reload_failed','reload_control_changed','reload_control_unbound','runtime_mismatch','material_runtime_overlay_conflict'].includes(error.message)?error.message:'deployment_unavailable',diagnostics:error.safeDiagnostics||null})
    }
  }
  async function finish () {
    if(busy)throw Error('promotion_busy')
    if(spent)throw Error('promotion_already_finished')
    busy=true;spent=true
    try{
      const before=await adapter.inspect(row);row.preflight=before
      record('preflight',before)
      if(before.next==='blocked'){
        if(before.preservationAllowed===true){
          row.preservation=await adapter.preserve(row);record('preserved',row.preservation)
          if(row.preservation?.verified!==true)throw Error('preservation_unconfirmed')
        }
        row.reason=before.reason;record('needs_attention',{reason:row.reason});return row
      }
      row.preservation=await adapter.preserve(row);record('preserved',row.preservation)
      if(row.preservation?.verified!==true)throw Error('preservation_unconfirmed')
      if(before.next==='preserve_then_reconcile'){row.reconciliation=await adapter.reconcile(row);record('needs_reconciliation',row.reconciliation);return row}
      if(adapter.acceptCommitted){
        const accepted=await adapter.acceptCommitted(row)
        for(const key of ['committed','tests','publication','pr','review','reviewPacket','runtimeSnapshot','evidenceSourceRunId','authorizationId','approvalMaterial'])row[key]=accepted[key]
        record('accepted_committed',{commit:row.committed?.commit,evidenceSourceRunId:row.evidenceSourceRunId})
      }else{
      row.prepared=await adapter.prepare(row);record('prepared',row.prepared)
      row.tests=await adapter.test(row);record('tested',row.tests)
      if(row.tests?.exitCode!==0)throw Error('tests_unresolved')
      row.committed=await adapter.commit(row);record('committed',row.committed)
      row.publication=await adapter.publish(row);record('published',row.publication)
      if(row.publication?.verified!==true)throw Error('preservation_unconfirmed')
      row.pr=await adapter.pullRequest(row);record('pr_prepared',row.pr)
      row.review=await adapter.review(row);record('reviewed',row.review)
      if(row.review?.verdict!=='pass')throw Error('review_changes_requested')
      }
      row.evidence=await adapter.evidence(row)
      row.gate=(adapter.decide || promotionDecision)(row.evidence);record('gated',row.gate)
      if(row.gate?.allowed!==true)throw Error('policy_exception')
      if(await adapter.recheck(row)!==true)throw Error('head_or_base_changed')
      row.merge=await adapter.merge(row);record('merged',row.merge)
      return await deployAndVerify()
    }catch(error){
      const known=['tests_unresolved','review_changes_requested','head_or_base_changed','policy_exception','preservation_unconfirmed','review_invalid_output','review_model_unavailable','review_scope_too_large','review_unavailable','claude_login_required','subscription_limit_reached','worker_timeout','claude_unavailable','material_runtime_overlay_conflict','credential_secret_change','merged_tree_mismatch','working_tree_changed','unaccounted_working_changes','accepted_commit_unconfirmed','deployment_authorization_expired','approval_material_changed','committed_candidate_changed','committed_evidence_unavailable','committed_tests_unconfirmed','committed_review_unconfirmed']
      row.reason=known.includes(error.message)?error.message:'promotion_unavailable'
      row.failure={stage:row.state,reason:row.reason,at:new Date().toISOString()}
      record('needs_attention',{reason:row.reason,failure:row.failure});return row
    }
    finally{busy=false}
  }
  async function resume () {
    if(busy)throw Error('promotion_busy')
    if(!['awaiting_administrator','awaiting_idle','awaiting_reload_idle'].includes(row.state))throw Error('promotion_recovery_requires_inspection')
    busy=true
    try{
      if(row.state==='awaiting_idle'){
        if(await adapter.recheckPending(row)!==true){row.reason='runtime_mismatch';record('needs_attention',{reason:row.reason});return row}
        return await deployAndVerify()
      }
      if(await adapter.recheckDeployed(row)!==true){row.reason='runtime_mismatch';record('needs_attention',{reason:row.reason});return row}
      if(adapter.restartPending){
        const restarted=await adapter.restartPending(row)
        if(restarted.state==='administrator_required'){record('awaiting_administrator');return row}
        if(restarted.state==='idle_required'){record('awaiting_reload_idle');return row}
      }
      row.runtime=await adapter.verify(row)
      if(row.runtime?.verified!==true)return await rollback({reason:row.runtime?.reason || 'runtime_verification_failed'})
      record('complete',{runtime:row.runtime});return row
    }finally{busy=false}
  }
  return {finish,resume,get:()=>structuredClone(row)}
}
async function waitForIdle (row,{coordinator,attempts=180,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  if(!Number.isSafeInteger(attempts)||attempts<0||attempts>180)throw Error('invalid_idle_wait')
  for(let attempt=0;['awaiting_idle','awaiting_reload_idle'].includes(row.state)&&attempt<attempts;attempt++){
    if((await coordinator.runtime.idle()).state==='idle_verified')row=await coordinator.resume(row.id)
    if(['awaiting_idle','awaiting_reload_idle'].includes(row.state))await sleep(5000)
  }
  return row
}
module.exports={createWorkflow,waitForIdle}
