'use strict'
const VERSION = 'autonomous-repository-promotion-v1'
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/
const EXCEPTIONS = Object.freeze(['material_merge_conflict','tests_unresolved','security_permission_change','credential_secret_change','destructive_database_migration','business_data_write','rollback_failed','runtime_mismatch'])
const LOW_RISK_PATHS=Object.freeze([
  /^src\/demo\/assets\/(?:sidebar|app)\.(?:css|js)$/,
  /^src\/demo\/assets\/index\.html$/,
  /^src\/i18n\/catalogue\.js$/,
  /^src\/topics\/departments\.js$/,
  /^src\/context\/contextResult\.js$/,
  /^docs\/(?!HOUSE-RULES\.md$|AUTONOMOUS-REPOSITORY-PROMOTION\.md$).+\.md$/,
  /\.(?:test|e2e)\.[cm]?js$/
])
function preflightDecision (f = {}) {
  if (f.remoteInventoryComplete !== true) return { next:'blocked',reason:'remote_inventory_unavailable' }
  if (!SHA.test(f.head || '') || !SHA.test(f.remoteMain || '') || !f.branch) return { next:'blocked',reason:'repository_identity_unavailable' }
  if (f.originMain !== f.remoteMain) return { next:'blocked',reason:'tracking_ref_stale' }
  if (!SHA.test(f.runtimeExpected || '') || f.runtimeObserved !== f.runtimeExpected) return { next:'blocked',reason:'runtime_mismatch' }
  if (!Number.isSafeInteger(f.ahead) || !Number.isSafeInteger(f.behind) || f.ahead < 0 || f.behind < 0) return { next:'blocked',reason:'ancestry_unavailable' }
  if (f.ahead > 0 && f.behind > 0) return { next:'preserve_then_reconcile',reason:'divergence' }
  if (!Array.isArray(f.unpublished) || !Array.isArray(f.dirty)) return { next:'blocked',reason:'working_tree_unaccounted' }
  return { next:f.unpublished.length || f.dirty.length ? 'preserve_then_develop' : 'develop',reason:null }
}
function classifyChanges (paths = [], addedText = '') {
  if (!Array.isArray(paths) || paths.some(p=>typeof p!=='string'||p.includes('..')||p.startsWith('/')||p.includes('\\'))) return ['security_permission_change']
  const risks = new Set()
  for (const p of paths) {
    if (/(^|\/)(?:\.env(?:\.|$)|browser-profile|password\.txt|credentials?(?:\.|\/)|[^/]+\.creds$)/i.test(p)) risks.add('credential_secret_change')
    if (/(^|\/)(migrations?|database-schema)(\/|\.)|\.sql$/i.test(p)) risks.add('destructive_database_migration')
    if (/^(?:src\/(?:governance|policy|repositoryPromotion|workers\/execution|actions|auth)|scripts\/(?:service|repository))\//.test(p) || /^src\/agent\/(?:owner|agentAuthorization)/.test(p) || /^(?:AGENTS|CLAUDE)\.md$/.test(p)) risks.add('security_permission_change')
    if(!LOW_RISK_PATHS.some(pattern=>pattern.test(p))||/^(?:src\/(?:adapters|store)|scripts|\.github)\//.test(p))risks.add('security_permission_change')
    if (/^src\/company\/.*(?:send|write|delete|payroll|payment)/i.test(p)) risks.add('business_data_write')
  }
  if (/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(addedText)) risks.add('business_data_write')
  if (/\b(?:DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i.test(addedText)) risks.add('destructive_database_migration')
  return [...risks].sort()
}
function promotionDecision (e = {}) {
  const reasons=[];const requireFact=(ok,reason)=>{if(!ok)reasons.push(reason)}
  requireFact(e.policyVersion===VERSION && SHA.test(e.commit || '') && SHA.test(e.tree || '') && SHA.test(e.base || ''),'identity_unbound')
  requireFact(e.workingTree?.accounted===true && HASH.test(e.workingTree.snapshotHash || ''),'working_tree_unaccounted')
  requireFact(e.preservation?.verified===true && e.preservation.commit===e.commit && /^refs\/heads\/(?!main$)[A-Za-z0-9_./-]+$/.test(e.preservation.remoteRef || ''),'remote_preservation_unconfirmed')
  requireFact(SHA.test(e.rollback?.commit || '') && SHA.test(e.rollback?.checkpoint || '') && e.rollback.remoteVerified===true,'rollback_unconfirmed')
  const t=e.tests
  requireFact(t?.commit===e.commit && t?.tree===e.tree && t?.exitCode===0 && t?.failed===0 && t?.cancelled===0 && Number.isSafeInteger(t?.passed) && t.passed>0 && Number.isSafeInteger(t?.total) && Number.isSafeInteger(t?.skipped) && t.skipped>=0 && t.total===t.passed+t.skipped && HASH.test(t?.logHash || ''),'tests_unconfirmed')
  if(t?.skipped>0)requireFact(Array.isArray(t.skipNames)&&Array.isArray(t.authorizedSkipNames)&&t.skipNames.length===t.skipped&&new Set(t.skipNames).size===t.skipped&&t.skipNames.every(n=>t.authorizedSkipNames.includes(n)),'unapproved_skips')
  const r=e.review
  requireFact(r?.commit===e.commit&&r?.tree===e.tree&&r?.verdict==='pass'&&Array.isArray(r?.findings)&&r.findings.length===0&&HASH.test(r?.reviewedDiffHash || '')&&r?.producer==='claude-subscription'&&typeof r.actualModel==='string'&&r.actualModel.length>0,'review_unconfirmed')
  requireFact(r?.securityRegression===false&&r?.permissionRegression===false,'security_or_permission_regression')
  requireFact(Array.isArray(e.conflicts)&&e.conflicts.length===0,'material_merge_conflict')
  requireFact(e.pr?.head===e.commit&&e.pr?.base===e.base&&e.pr?.state==='open'&&Number.isSafeInteger(e.pr?.number)&&e.pr?.mergeable===true&&e.pr?.unresolvedThreads===0&&e.pr?.checksState==='success','pr_state_unconfirmed')
  requireFact(e.runtimeImpact==='local_assistant_only','runtime_impact_outside_policy')
  requireFact(SHA.test(e.expectedRuntime || '')&&e.observedRuntime===e.expectedRuntime,'runtime_mismatch')
  const risks=[...new Set([...classifyChanges(e.changes,e.addedText || ''),...(Array.isArray(r?.exceptionCategories)?r.exceptionCategories:['security_permission_change'])])]
  for(const category of risks){
    const allowed=Array.isArray(e.authorizedExceptions)&&e.authorizedExceptions.some(a=>a?.category===category&&a.commit===e.commit&&a.policyVersion===VERSION&&a.actor==='owner'&&a.source==='authenticated_owner'&&typeof a.id==='string'&&a.id.length>0)
    requireFact(allowed,'owner_exception:'+category)
  }
  return {allowed:reasons.length===0,reasons:[...new Set(reasons)],exceptions:risks,policyVersion:VERSION}
}
function complete (e = {}) {
  const prior=promotionDecision({...e,pr:{...e.pr,state:'open',mergeable:true}})
  const runtime=e.runtime
  const verified=prior.allowed && e.pr?.state==='merged' && SHA.test(e.pr?.mergeCommit || '') && runtime?.state==='verified' && runtime?.expectedCommit===e.pr.mergeCommit && runtime.bootCommit===runtime.expectedCommit && runtime.smokePassed===true && runtime.regressionPassed===true && runtime.sourceVerified===true
  return {complete:Boolean(verified),reasons:verified?[]:[...prior.reasons,'completion_evidence_incomplete']}
}
module.exports={VERSION,SHA,HASH,EXCEPTIONS,LOW_RISK_PATHS,preflightDecision,promotionDecision,complete,classifyChanges}
