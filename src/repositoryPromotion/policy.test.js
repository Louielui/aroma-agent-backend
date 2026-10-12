'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { preflightDecision, promotionDecision, complete, classifyChanges, VERSION } = require('./policy')
const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), TREE = 'c'.repeat(40)
function evidence () {
  return { policyVersion: VERSION, commit: HEAD, tree: TREE, base: BASE,
    workingTree: { accounted: true, snapshotHash: 'd'.repeat(64) },
    preservation: { commit: HEAD, verified: true, remoteRef: 'refs/heads/feature/example' },
    rollback: { commit: BASE, remoteVerified: true, checkpoint: BASE },
    tests: { commit: HEAD, tree: TREE, exitCode: 0, passed: 12, failed: 0, cancelled: 0, skipped: 0, total: 12, logHash: 'e'.repeat(64) },
    review: { commit: HEAD, tree: TREE, verdict: 'pass', findings: [], reviewedDiffHash: 'f'.repeat(64), producer: 'claude-subscription', actualModel: 'claude-sonnet', securityRegression: false, permissionRegression: false, exceptionCategories: [] },
    conflicts: [], changes: ['src/demo/assets/sidebar.css'], authorizedExceptions: [],
    pr: { number: 65, head: HEAD, base: BASE, state: 'open', mergeable: true, unresolvedThreads: 0, checksState: 'success' },
    runtimeImpact: 'local_assistant_only', expectedRuntime: BASE, observedRuntime: BASE }
}
test('preflight distinguishes unpublished work, stale tracking refs and real divergence', () => {
  const f = { branch: 'feature/example', head: HEAD, originMain: BASE, remoteMain: BASE, ahead: 2, behind: 0, unpublished: [HEAD], dirty: [], runtimeExpected: BASE, runtimeObserved: BASE, remoteInventoryComplete: true }
  assert.equal(preflightDecision(f).next, 'preserve_then_develop')
  assert.equal(preflightDecision({ ...f, behind: 1 }).next, 'preserve_then_reconcile')
  assert.equal(preflightDecision({ ...f, originMain: HEAD }).reason, 'tracking_ref_stale')
  assert.equal(preflightDecision({ ...f, runtimeObserved: HEAD }).reason, 'runtime_mismatch')
  assert.equal(preflightDecision({ ...f, remoteInventoryComplete: false }).reason, 'remote_inventory_unavailable')
})
test('unknown or absent facts cannot pass a promotion gate', () => {
  assert.equal(promotionDecision(evidence()).allowed, true)
  for (const key of ['tests', 'review', 'preservation', 'rollback', 'workingTree', 'pr']) {
    const e = evidence(); delete e[key]; assert.equal(promotionDecision(e).allowed, false, key)
  }
})
test('tests and independent review bind exact commit and tested tree, not a passed label', () => {
  for (const change of [e=>e.tests.commit=BASE, e=>e.tests.tree=BASE, e=>e.tests.failed=1,
    e=>e.tests.cancelled=1, e=>e.tests.passed=0, e=>e.tests.total=99,
    e=>e.review.commit=BASE, e=>e.review.tree=BASE, e=>e.review.findings.push({ severity: 'high' }),
    e=>e.review.permissionRegression=true, e=>delete e.review.securityRegression]) {
    const e=evidence();change(e);assert.equal(promotionDecision(e).allowed,false)
  }
})
test('skips require recorded exact test identities and cannot hide an unrun suite', () => {
  const e=evidence();e.tests.skipped=1;e.tests.total=13
  assert.equal(promotionDecision(e).allowed,false)
  e.tests.skipNames=['paid live E2E'];e.tests.authorizedSkipNames=['paid live E2E']
  assert.equal(promotionDecision(e).allowed,true)
  e.tests.authorizedSkipNames=['unrelated'];assert.equal(promotionDecision(e).allowed,false)
})
test('PR head/base races, unresolved conflicts, pending checks and rollback gaps block merge', () => {
  for (const change of [e=>e.pr.head=BASE,e=>e.pr.base=HEAD,e=>e.pr.mergeable=null,
    e=>e.pr.unresolvedThreads=1,e=>e.pr.checksState='pending',e=>e.conflicts=['material'],
    e=>e.rollback.remoteVerified=false,e=>e.preservation.commit=BASE,
    e=>e.observedRuntime=HEAD,e=>e.runtimeImpact='restaurant_production']) {
    const e=evidence();change(e);assert.equal(promotionDecision(e).allowed,false)
  }
})
test('security, secret, migration and external write changes are exceptions; fixture text is not a permission grant', () => {
  assert.deepEqual(classifyChanges(['src/demo/assets/sidebar.css']), [])
  assert.ok(classifyChanges(['src/governance/ownerAuth.js']).includes('security_permission_change'))
  assert.ok(classifyChanges(['.env']).includes('credential_secret_change'))
  assert.ok(classifyChanges(['migrations/drop.sql']).includes('destructive_database_migration'))
  assert.ok(classifyChanges(['src/company/mailSend.js']).includes('business_data_write'))
  const e=evidence();e.changes=['src/repositoryPromotion/policy.js']
  assert.equal(promotionDecision(e).allowed,false)
  e.authorizedExceptions=[{ category:'security_permission_change',commit:HEAD,policyVersion:VERSION,actor:'owner',source:'authenticated_owner',id:'bootstrap-owner-grant' }]
  assert.equal(promotionDecision(e).allowed,true)
  e.authorizedExceptions[0].commit=BASE;assert.equal(promotionDecision(e).allowed,false)
})
test('complete requires a known merge and verified live commit, never only tests or worker success', () => {
  const e=evidence();assert.equal(complete(e).complete,false)
  e.pr={...e.pr,state:'merged',mergeCommit:HEAD};e.runtime={state:'verified',expectedCommit:HEAD,bootCommit:HEAD,smokePassed:true,regressionPassed:true,sourceVerified:true}
  assert.equal(complete(e).complete,true)
  for (const key of ['smokePassed','regressionPassed','sourceVerified']) {
    const x=structuredClone(e);x.runtime[key]=false;assert.equal(complete(x).complete,false)
  }
  e.runtime.bootCommit=BASE;assert.equal(complete(e).complete,false)
})
