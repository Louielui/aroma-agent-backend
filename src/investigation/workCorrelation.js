'use strict'
// Only structured, exact identities connect work. Titles, dates and prose never do.
const readable = s => ['ok', 'partial'].includes(s?.state)
const sha = v => typeof v === 'string' && /^[a-f0-9]{40}$/i.test(v)
const { passing, buildRepairChain } = require('./repairChain')
function correlateWork (report) {
  if (report?.readOnly !== true || report.focus !== 'work_failure') return null
  const sections = (report.sections || []).filter(s => s.section === 'work' && readable(s))
  const rows = sections.flatMap(s => (s.records || []).map(record => ({ section: s, record })))
  const targetId = report.continuity?.selectedRecordId || sections[0]?.latestFailureId
  const targets = rows.filter(x => x.record.sourceId === targetId)
  const result = { version: 1, targetId: targetId || null, state: 'UNKNOWN', links: [],
    loadedRevision: null, operationRecovery: 'UNKNOWN', repaired: 'UNKNOWN', gaps: [],
    scope: 'exact_work_identity_and_revision_not_title_or_time_similarity' }
  if (!targetId || targets.length !== 1) { result.gaps.push(targets.length > 1 ? 'ambiguous_target' : 'target_not_observed'); result.repairChain=buildRepairChain(result,[],report.sections); return result }
  const { record: target, section } = targets[0]
  result.target = { sourceId: section.sourceId, recordId: targetId, reason: target.reason, state: target.state }
  const bootRows = (report.sections || []).filter(s => s.section === 'configuration' && readable(s))
    .flatMap(s => (s.records || []).filter(r => sha(r.bootCommit)).map(r => ({ sourceId:s.sourceId, recordId:r.sourceId || r.role, revision:r.bootCommit, bootedAt:r.bootedAt || null, retrievedAt:s.retrievedAt })))
  const revisions = [...new Set(bootRows.map(r => r.revision))]
  result.loadedReferences = bootRows
  if (revisions.length === 1) { result.loadedRevision = revisions[0] }
  else result.gaps.push(revisions.length ? 'conflicting_loaded_revisions' : 'loaded_revision_missing')
  const fresh = at => Number.isFinite(Date.parse(at)) && Date.now()-Date.parse(at)>=-5000 && Date.now()-Date.parse(at)<=300000
  const currentBoot = bootRows.length>0 && bootRows.every(r=>fresh(r.retrievedAt))
  if(result.loadedRevision && !currentBoot)result.gaps.push('loaded_revision_not_fresh')
  const duplicates = new Set(rows.filter(x => rows.filter(y => y.record.sourceId === x.record.sourceId).length > 1).map(x => x.record.sourceId))
  // Registrations encode an exact host-issued task ID; unlike titles, this can
  // connect task -> candidate -> adoption. Walk only uniquely read records.
  const connected = new Set([targetId])
  for(let depth=0;depth<3;depth++) for(const {record:r} of rows) {
    if(duplicates.has(r.sourceId))continue
    for(const field of ['workRunId','taskRunId','registeredTaskId','repairOf']) {
      if(connected.has(r.sourceId) && r[field])connected.add(r[field])
      if(r[field] && connected.has(r[field]))connected.add(r.sourceId)
    }
  }
  const workIds = new Set([target.workRunId,...(/project-runs|project-work-runs/.test(target.kind || '')?[targetId]:[])].filter(Boolean))
  for(const {record:r} of rows) if(!duplicates.has(r.sourceId) && /project-runs|project-work-runs/.test(r.kind || '') &&
    (r.registeredTaskId===targetId || r.taskRunId===targetId || r.repairOf===targetId))workIds.add(r.sourceId)
  for (const {record:r, section:s} of rows) {
    if (r === target || duplicates.has(r.sourceId)) continue
    const relationships = []
    for (const field of ['workRunId','taskRunId','registeredTaskId','repairOf']) {
      if (target[field] && target[field] === r.sourceId) relationships.push({ field, direction:'target_to_record', value:target[field] })
      if (r[field] && r[field] === targetId) relationships.push({ field, direction:'record_to_target', value:r[field] })
      if (r[field] && target[field] && r[field] === target[field]) relationships.push({ field, direction:'shared_parent', value:r[field] })
    }
    if (!relationships.length && connected.has(r.sourceId)) relationships.push({field:'exact_identity_path',direction:'transitive',value:targetId})
    if (!relationships.length) continue
    const loaded = currentBoot && fresh(s.retrievedAt) && sha(r.commit) && r.commit === r.loadedCommit && r.commit === result.loadedRevision
    const later = Number.isFinite(Date.parse(r.at)) && Number.isFinite(Date.parse(target.at)) && Date.parse(r.at) > Date.parse(target.at)
    const filesMatch = r.sourceFilesComplete === true && r.sourceFiles?.length > 0 && r.sourceFiles.every(f => /^[a-f0-9]{64}$/i.test(f.candidateHash || '') && f.candidateHash === f.currentHash)
    const verifiedAdoption = r.action === 'adopt' && r.state === 'completed' && r.appliedToLive === true && loaded && passing(r.tests) && filesMatch
    result.links.push({ sourceId:s.sourceId, recordId:r.sourceId, relationships, state:r.state, at:r.at,
      sourceRevision:r.sourceRevision || null, commit:r.commit || null, loadedCommit:r.loadedCommit || null,
      tests:r.tests || null, testsPassing:passing(r.tests), matchesLoadedRevision:!!loaded, currentFilesMatch:!!filesMatch,
      verifiedAdoption:!!verifiedAdoption, sameWorkEligible:workIds.has(r.sourceId)||workIds.has(r.workRunId) })
    // A successful retry of the SAME adoption operation settles its prerequisite
    // failure only. It is not proof of a product regression or unrelated task fix.
    if (verifiedAdoption && later && /adoption/.test(target.kind || '') &&
        target.action === 'adopt' && ['source_dirty','source_changed'].includes(target.reason) &&
        target.workRunId && target.workRunId === r.workRunId) result.operationRecovery = 'CONFIRMED'
  }
  result.state = 'SUPPORTED'
  if (!result.links.length) result.gaps.push('linked_work_not_observed')
  if (!result.links.some(r => r.testsPassing)) result.gaps.push('same_work_passing_tests_missing')
  if (!result.links.some(r => r.verifiedAdoption)) result.gaps.push('same_work_current_adoption_missing')
  result.gaps.push('same_failure_regression_in_loaded_version_missing')
  result.repairChain = buildRepairChain(result, rows.filter(x=>x.record===target ||
    result.links.some(l=>l.recordId===x.record.sourceId&&l.sameWorkEligible)),report.sections)
  if (result.repairChain.conclusion === 'loaded_component_verified') {
    result.componentVerification='CONFIRMED'
    result.repairScope=result.repairChain.scope
    result.gaps=result.gaps.filter(g=>g!=='same_failure_regression_in_loaded_version_missing')
  }
  return result
}
function renderWorkCorrelation (report, message = '') {
  const c = report?.workCorrelation
  if (!c) return null
  const zh = /[\u3400-\u9fff]/.test(message)
  const safe = v => String(v || '').replace(/[<>`\r\n]/g, ' ').slice(0,160)
  const lines = [zh ? '同一任務追查結果：' : 'Same-task investigation:']
  for (const r of c.links.slice(0,5)) lines.push(`${safe(r.recordId)} — ${zh ? '以明確任務編號關聯' : 'linked by exact work identity'}; ${r.testsPassing ? (zh ? '有通過測試紀錄' : 'passing test record') : (zh ? '未取得通過測試證據' : 'passing tests not established')}; ${r.verifiedAdoption ? (zh ? '採納版本與目前載入版本一致' : 'verified adoption matches loaded revision') : (zh ? '尚未證實已採納至目前版本' : 'adoption in current version not established')}. ${safe(r.sourceId)}`)
  if (c.operationRecovery === 'CONFIRMED') lines.push(zh ? '同一採納操作後來已成功，且其測試與目前載入版本吻合。這只證明該次採納前置問題已恢復，不代表產品內的所有故障已修復。' : 'The same adoption operation later succeeded, with passing tests and the currently loaded revision. This verifies recovery of that adoption prerequisite, not every product defect.')
  const labels = { target_not_observed:['未讀到指定任務','target task not observed'], ambiguous_target:['任務編號有重複紀錄','ambiguous task identity'], loaded_revision_missing:['未取得載入版本','loaded revision missing'], conflicting_loaded_revisions:['載入版本證據矛盾','conflicting loaded revisions'], linked_work_not_observed:['未讀到同一任務的後續工作','linked follow-up work not observed'], same_work_passing_tests_missing:['缺少同一工作的通過測試','same-work passing tests missing'], same_work_current_adoption_missing:['缺少同一工作採納至目前版本的證明','same-work current adoption missing'], same_failure_regression_in_loaded_version_missing:['缺少同一故障在目前版本的回歸驗證','same-failure regression in the loaded version missing'] }
  labels.loaded_revision_not_fresh = ['缺少近期載入版本觀察','recent loaded-version observation missing']
  lines.push((zh ? '仍需核對：' : 'Still to verify: ') + c.gaps.map(g => labels[g]?.[zh?0:1] || g).join(zh ? '；' : '; '))
  lines.push(zh ? '建議：沿上述同一工作編號核對缺少的測試及版本紀錄；尚無證據時保留未知，不以相似任務代替。' : 'Recommendation: check the missing tests and revision receipts for these exact work identities; keep the outcome unknown where evidence is absent.')
  return lines.join('\n\n')
}
module.exports = { correlateWork, renderWorkCorrelation }
