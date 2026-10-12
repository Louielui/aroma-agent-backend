'use strict'
// A diagnosis is a chain of independently graded observations. Read-only
// consumption never runs tests, changes a work receipt, or links by prose.
const passing = v => Number.isSafeInteger(v?.total) && v.total > 0 && v.passed === v.total && v.failed === 0 && v.exitCode === 0 && v.skipped === 0 && v.cancelled === 0
const failing = v => Number.isSafeInteger(v?.total) && v.total > 0 && Number.isSafeInteger(v.passed) && v.passed >= 0 && Number.isSafeInteger(v.failed) && v.failed > 0 && v.passed + v.failed === v.total && v.exitCode === 1 && v.skipped === 0 && v.cancelled === 0
function buildRepairChain (correlation, rows, sections=[]) {
  const refs = (entries, field) => entries.map(x => ({sourceId:x.section.sourceId,recordId:x.record.sourceId,field,value:x.record[field] ?? null}))
  const target = rows.find(x=>x.record.sourceId===correlation.targetId)
  const stage = (key, state, references = [], reason = null) => ({key,state,references,reason})
  const linked = rows.filter(x=>correlation.links.some(l=>l.recordId===x.record.sourceId && l.sourceId===x.section.sourceId))
  const tested = linked.filter(x=>passing(x.record.tests))
  const adopted = linked.filter(x=>x.record.action==='adopt' && x.record.state==='completed' && x.record.appliedToLive===true)
  const loaded = adopted.filter(x=>correlation.links.some(l=>l.recordId===x.record.sourceId && l.verifiedAdoption))
  // A failing baseline and later passing candidate must use the SAME protected
  // test package, source/dependency input hashes and exact work identity.
  const regressions=[]
  for(const a of loaded) for(const c of linked) {
    if(c.record.state!=='completed' || c.record.reviewVerdict!=='pass' || c.record.sourceId !== a.record.workRunId || !failing(c.record.baseline) || !passing(c.record.tests) ||
      c.record.baseline.total !== c.record.tests.total || c.record.tests.total !== a.record.tests.total ||
      !c.record.testBinding?.baseline || !c.record.testBinding.candidate || !a.record.testBinding?.candidate ||
      !c.record.testBinding.dependenciesMatch || !a.record.testBinding.dependenciesMatch ||
      ![c.record.testBinding.protectedTestsHash,a.record.testBinding.protectedTestsHash,c.record.testBinding.baseline.inputHash,c.record.testBinding.candidate.inputHash,a.record.testBinding.candidate.inputHash].every(h=>/^[a-f0-9]{64}$/.test(h || '')) ||
      c.record.testBinding.baseline.inputHash === c.record.testBinding.candidate.inputHash ||
      c.record.testBinding.protectedTestsHash !== a.record.testBinding.protectedTestsHash ||
      c.record.testBinding.candidate.inputHash !== a.record.testBinding.candidate.inputHash) continue
    regressions.push(c,a)
  }
  // Positive proof is deliberately limited to one registered component. The
  // original failure, correction baseline and adopted observation must all use
  // the same fixed checks and exact source versions. A later successful probe
  // alone cannot repair a failed worker operation or rewrite legacy history.
  const probe=require('../core/projectWork/liveVerification'), verified=[]
  const baseline=target?.record.liveBaseline
  const originals=target?.record.sourceFiles || []
  for(const a of loaded) for(const c of linked) {
    const before=c.record.liveBaseline, after=a.record.liveVerification
    if([target?.record.recipe,c.record.recipe,a.record.recipe].some(r=>r!==require('../core/projectWork/contract').RECIPE) || !['failed','timed_out','needs_attention'].includes(target?.record.state) || !probe.valid(baseline) || !probe.valid(before) || !probe.valid(after) || baseline.failed<1 || before.failed<1 || after.failed!==0 ||
      baseline.workRunId!==correlation.targetId || before.workRunId!==c.record.sourceId || after.workRunId!==c.record.sourceId ||
      c.record.repairOf!==correlation.targetId || c.record.sourceId!==a.record.workRunId || c.record.state!=='completed' || c.record.reviewVerdict!=='pass' ||
      !regressions.includes(c) || !regressions.includes(a) ||
      baseline.bootCommit!==target.record.sourceRevision || before.bootCommit!==c.record.sourceRevision || after.bootCommit!==a.record.loadedCommit ||
      baseline.sourceHash!==before.sourceHash || baseline.sourceHash===after.sourceHash ||
      !originals.some(f=>f.path===probe.FILE && f.originalHash===baseline.sourceHash) ||
      !c.record.sourceFiles.some(f=>f.path===probe.FILE && f.originalHash===before.sourceHash && f.candidateHash===after.sourceHash) ||
      !a.record.sourceFiles.some(f=>f.path===probe.FILE && f.candidateHash===after.sourceHash && f.currentHash===after.sourceHash) ||
      !baseline.checks.some((v,i)=>!v.passed && before.checks[i]?.passed===false && after.checks[i]?.passed===true) ||
      Date.parse(before.at)<Date.parse(baseline.at) || Date.parse(after.at)<=Date.parse(before.at) ||
      !correlation.loadedReferences?.length || correlation.loadedReferences.some(r=>r.bootedAt!==after.bootedAt || Date.parse(after.at)>Date.parse(r.retrievedAt)+5000))continue
    verified.push(c,a)
  }
  const stages=[
    stage('failure',correlation.gaps.includes('ambiguous_target')?'CONTRADICTED':target&&['failed','timed_out','needs_attention'].includes(target.record.state)?'CONFIRMED':sections.some(s=>s.section==='work'&&!['ok','partial'].includes(s.state))?'UNAVAILABLE':'UNKNOWN',target?refs([target],'reason'):[],'exact_failed_record'),
    stage('linked_correction',linked.length?'SUPPORTED':'UNKNOWN',refs(linked,'workRunId'),linked.length?'exact_identity_links_not_proof_of_repair':'same_task_link_missing'),
    stage('passing_tests',tested.length?'CONFIRMED':'UNKNOWN',refs(tested,'tests'),tested.length?'historical_test_receipt':'same_work_passing_tests_missing'),
    stage('adoption',adopted.length?'CONFIRMED':'UNKNOWN',refs(adopted,'commit'),adopted.length?'historical_adoption_receipt':'same_work_adoption_missing'),
    stage('current_version',correlation.gaps.includes('conflicting_loaded_revisions')?'CONTRADICTED':loaded.length?'CONFIRMED':sections.some(s=>s.section==='configuration'&&!['ok','partial'].includes(s.state))?'UNAVAILABLE':'UNKNOWN',[...refs(loaded,'loadedCommit'),...(correlation.loadedReferences||[]).map(r=>({sourceId:r.sourceId,recordId:r.recordId,field:'bootCommit',value:r.revision}))],loaded.length?'exact_loaded_revision_and_current_registered_files':'same_work_current_adoption_missing'),
    stage('registered_regression',regressions.length?'SUPPORTED':'UNKNOWN',refs(regressions,'testBinding'),regressions.length?'same_protected_tests_and_inputs_match_loaded_source_not_live_path':'baseline_or_test_input_binding_missing'),
    stage('live_failure_verification',verified.length?'CONFIRMED':loaded.some(a=>a.record.liveVerification?.state==='unavailable')?'UNAVAILABLE':'UNKNOWN',refs(verified.length?verified:loaded,'liveVerification'),verified.length?'same_failed_checks_pass_in_loaded_component':'same_failure_live_path_not_observed')
  ]
  // Recovering an adoption prerequisite and passing source-level acceptance
  // are narrower conclusions than a repaired live application failure.
  const conclusion=verified.length?'loaded_component_verified':correlation.operationRecovery==='CONFIRMED'?'operation_recovered':regressions.length?'registered_source_supported':'not_established'
  const firstGap=stages.find(s=>['UNKNOWN','UNAVAILABLE','CONTRADICTED'].includes(s.state))?.key || null
  return {version:1,targetId:correlation.targetId,conclusion,stages,firstGap,readOnly:true,
    scope:verified.length?probe.SCOPE:'exact_identity_receipts_historical_tests_loaded_source_not_live_regression'}
}
module.exports={buildRepairChain,passing,failing}
