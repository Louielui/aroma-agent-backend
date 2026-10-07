'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { projectWorkRecord, selectWorkSample } = require('./workEvidence')
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
test('work source comparison only reads registered files and never promotes a matching candidate to a confirmed repair', () => {
  const reads = [], name = 'src/demo/assets/sidebar.css'
  const r = projectWorkRecord({ state: 'completed', source: { evidence: { revision: 'a'.repeat(40), sourceFiles: [{ path: name, sha256: hash('old') }, { path: '../../.env', sha256: hash('secret') }] } }, result: { changes: [{ file: name, afterHash: hash('new'), before: 'PRIVATE_CODE', after: 'PRIVATE_CODE' }], tests: { total: 3, passed: 3, failed: 0, exitCode: 0 } }, review: { verdict: 'pass', findings: [{ message: 'PRIVATE_TOKEN' }] }, appliedToLive: false }, { kind: 'worker/project-runs', readSource: name => { reads.push(name); return 'new' } })
  assert.deepEqual(reads, [name])
  assert.equal(r.sourceFiles[0].comparison, 'matches_candidate')
  assert.equal(r.sourceFiles[0].currentHash, hash('new'))
  assert.equal(r.tests.passed, 3)
  assert.equal(r.appliedToLive, false)
  assert.equal(r.fixedInCurrentVersion, null)
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE|\.env/)
})
test('work sampling retains the newest failure and explicit related records before unrelated recent tasks', () => {
  const rows = [
    { sourceId: 'failed', kind: 'project-task-runs', state: 'failed', at: '2026-10-01', workRunId: 'work' },
    { sourceId: 'work', kind: 'worker/project-runs', state: 'completed', at: '2026-10-02' },
    { sourceId: 'adoption', kind: 'worker/adoptions', state: 'completed', at: '2026-10-03', workRunId: 'work' },
    ...Array.from({ length: 20 }, (_, i) => ({ sourceId: 'noise-' + i, kind: 'task-plan-runs', state: 'completed', at: '2026-10-07' }))
  ]
  const r = selectWorkSample(rows)
  assert.equal(r.records.length, 5)
  assert.equal(r.latestFailureId, 'failed')
  assert.deepEqual(r.records.slice(0,3).map(r => r.sourceId), ['failed', 'work', 'adoption'])
  assert.equal(r.omitted, 18)
})
test('unrecorded work diagnostics and test outcomes stay unknown rather than becoming passing values', () => {
  const r = projectWorkRecord({ state: 'failed', error: 'raw secret account text', result: {} }, { kind: 'worker/project-runs' })
  assert.equal(r.reason, null)
  assert.equal(r.tests, null)
  assert.equal(r.failureDiagnostic, null)
  assert.equal(r.currentRunningState, 'unknown')
  assert.equal(r.sourceRevision, null)
})
