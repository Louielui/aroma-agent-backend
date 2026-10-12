'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { validateAccepted, createAdoption } = require('../projectWork/adoption'), { recipe, FAILURE_RECIPE, FAILURE_WORK_ORDER, FILE, GATEWAY } = require('../projectWork/contract'), { hash } = require('./contract'), { createMemoryRunStore } = require('../operating/runStore')
const HEAD = 'a'.repeat(40), OWNER = { id: 'owner', role: 'owner' }
function accepted () {
  const definitions = recipe(FAILURE_RECIPE), dependency = "'use strict'\nmodule.exports={snapshotValue:structuredClone}\n", before = 'original', after = 'candidate', changes = [{ file: GATEWAY, before, after, beforeHash: hash(before), afterHash: hash(after) }]
  const evidence = passed => ({ engine: 'windows-sandbox-offline-v1', total: 8, passed, failed: 8 - passed, skipped: 0, cancelled: 0, exitCode: passed === 8 ? 0 : 1, boundary: Object.fromEntries(['noExternalInterfaces', 'hostReadDenied', 'hostWriteDenied', 'readonlyInputDenied', 'readonlyToolsDenied', 'loopbackDenied', 'ipv6LoopbackDenied', 'internetDenied', 'cleanIdentity', 'secretsAbsent'].map(k => [k, true])) })
  const isolated = { id: randomUUID(), state: 'accepted_isolated', changes, patchHash: hash(JSON.stringify(changes)), effort: 'high', tests: evidence(8), baseline: evidence(1), workOrder: { sourceRevision: HEAD, files: { [GATEWAY]: before, [FILE]: dependency, ...definitions.tests }, editable: [GATEWAY], expectedTests: 8, effort: 'high' } }
  const run = { id: randomUUID(), state: 'completed', workOrder: FAILURE_WORK_ORDER, appliedToLive: false, review: { verdict: 'pass', billing: 'claude-subscription' }, source: { evidence: { revision: HEAD, sourceFiles: [{ path: GATEWAY, sha256: hash(before) }], dependencyFiles: [{ path: FILE, sha256: hash(dependency) }], acceptanceFiles: Object.entries(definitions.tests).map(([path, text]) => ({ path, sha256: hash(text) })) } }, result: { changes, isolatedRunId: isolated.id, patchHash: isolated.patchHash, effort: 'high', baseline: isolated.baseline, tests: isolated.tests, appliedToLive: false, model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' } }
  return { run, isolated, dependency, before, after, definitions, evidence }
}
test('accepted read-only dependency is hash-bound; altered, omitted or extra dependencies reject adoption', () => {
  const f = accepted(); assert.equal(validateAccepted(f.run, f.isolated).dependencies[FILE], f.dependency)
  for (const mutate of [v => { v.isolated.workOrder.files[FILE] += '//changed' }, v => { v.run.source.evidence.dependencyFiles = [] }, v => { v.isolated.workOrder.files['.env'] = 'secret' }]) { const v = accepted(); mutate(v); assert.throws(() => validateAccepted(v.run, v.isolated), /accepted_evidence_changed/) }
})
test('fresh dependency drift blocks adoption; accepted dependency enters the fresh isolated test package', async () => {
  for (const changed of [true, false]) {
    const f = accepted(); let tested = 0, writes = 0
    const snapshot = { evidence: { revision: HEAD, bootCommit: HEAD, recipe: FAILURE_RECIPE }, order: { files: { [GATEWAY]: f.before, [FILE]: f.dependency + (changed ? '//drift' : ''), ...f.definitions.tests } } }
    const flow = createAdoption({ source: { read: async () => snapshot, verify: async () => {} }, enabled: () => true, isolated: async () => f.isolated, work: { get: () => f.run }, store: createMemoryRunStore(), executor: { isBusy: () => false, run: async p => { tested++; assert.equal(p.files[FILE], f.dependency); return f.evidence(8) } }, repository: { apply: async () => { writes++; return { commit: 'b'.repeat(40) } } }, loader: async () => {} })
    const input = { action: 'adopt', bootCommit: HEAD, runId: f.run.id, requestId: randomUUID() }
    if (changed) { await assert.rejects(flow.prepare(OWNER, input), /source_changed/); assert.equal(tested, 0); assert.equal(writes, 0) } else { const p = await flow.prepare(OWNER, input); flow.approve(OWNER, { id: p.approval.id, hash: p.approval.hash, nonce: p.approval.nonce }); await flow.settled(); assert.equal(tested, 1); assert.equal(writes, 1) }
  }
})
