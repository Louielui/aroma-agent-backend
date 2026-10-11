'use strict'
const { loadedProof } = require('./gapService')
const {PROFILES,READ_PROFILES,validatePacket} = require('../core/taskPlanner/contract')
const {ID} = require('../core/operating/runStore')
const SHA=/^[a-f0-9]{64}$/
const sameNames=(values,expected)=>Array.isArray(values) && values.length===expected.length &&
  JSON.stringify(values.slice().sort())===JSON.stringify(expected.slice().sort())
function createLoadedVerifier ({ bootCommit, env=process.env, request=require('../adapters/CodexSubscriptionAdapter').localRequest }) {
  const check=()=>{if(env.READ_ACCESS!=='on')throw Error('read_access_disabled')}
  return async ({workRunId,scope}) => {
    check()
    // The owner bridge owns adoption receipts. The backend store is a different
    // directory and must never stand in for that authoritative read path.
    if(!ID.test(workRunId || '') || !['context','seven_shifts'].includes(scope?.profile) ||
        !sameNames(scope.files,PROFILES[scope.profile]))return null
    const signal=AbortSignal.timeout(15000)
    const value=await request('/project-adoption',{op:'list'},env,signal);check()
    if(!Array.isArray(value?.runs))throw Error('adoption_unavailable')
    const rows=value.runs.filter(r=>r.workRunId===workRunId && r.state==='completed')
      .sort((a,b)=>String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')))
    const row=rows[0]
    if(!row || !loadedProof([row],workRunId,row.commit))return null
    const changes=row.change?.files, dependencies=READ_PROFILES[scope.profile].filter(n=>!scope.files.includes(n))
    const originals=row.source?.evidence
    if(!sameNames(changes?.map(c=>c.file),scope.files) ||
        !sameNames(originals?.sourceFiles?.map(f=>f.path),scope.files) ||
        !sameNames((originals?.dependencyFiles || []).map(f=>f.path),dependencies) ||
        changes.some(c=>!SHA.test(c.afterHash || '') || row.loaded.sourceHashes?.[c.file]!==c.afterHash))return null
    const expected=new Map(changes.map(c=>[c.file,c.afterHash]))
    for(const f of originals?.dependencyFiles || []) {
      if(!SHA.test(f.sha256 || ''))return null
      expected.set(f.path,f.sha256)
    }
    // A later host-only delivery does not inherit approval for different reader
    // bytes. Prove the current boot, committed clean files, and every protected
    // dependency still match the measured, approved patch before continuation.
    const packet=await request('/task-plan-source',{bootCommit,profile:scope.profile},env,signal);check()
    const evidence=validatePacket(packet,scope.profile)
    if(evidence.bootCommit!==bootCommit)throw Error('evidence_changed')
    if(evidence.files.some(f=>expected.get(f.path)!==f.sha256))return null
    return {state:'verified',workRunId,bootCommit,adoptionCommit:row.commit,sourceHashesVerified:true}
  }
}
module.exports = { createLoadedVerifier }
