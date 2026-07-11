'use strict'

/**
 * executionResultView.test.js — B2-1d read model (unit). Proves the ALLOWLIST
 * projection (a poisoned artifact cannot leak), id validation (traversal), the
 * status distinctions, provenance fallback, and robust malformed scanning.
 *
 *   Run: node --test src/api/executionResultView.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createArtifactStore } = require('../store/artifactStore')
const {
  validateProposalId, findExecutionByProposalId, findResultByTaskId, buildResultView
} = require('./executionResultView')

const ALLOWED_KEYS = [
  'proposalId', 'executionId', 'status', 'ok', 'worker', 'provider',
  'startedAt', 'finishedAt', 'elapsedMs', 'exitCode', 'resultSummary',
  'cost', 'error', 'relay', 'proposal'
].sort()

// --- id validation (traversal / malformed) ---------------------------------

test('validateProposalId accepts safe ids and rejects traversal/malformed', () => {
  assert.equal(validateProposalId('prop_1a2b3c4d'), true)
  assert.equal(validateProposalId('a-b_C9'), true)
  for (const bad of ['../../etc/passwd', 'prop/../x', 'a/b', 'a\\b', 'a.b', '', '   ', 'x'.repeat(65), null, 42, {}]) {
    assert.equal(validateProposalId(bad), false, `must reject ${JSON.stringify(bad)}`)
  }
})

// --- ALLOWLIST: a poisoned artifact cannot leak ----------------------------

test('buildResultView is an ALLOWLIST — poisoned artifact fields never appear', () => {
  const execution = {
    id: 'task_x', proposalId: 'prop_x', createdAt: '2026-07-11T12:00:00.000Z',
    task: 'PROMPT_SENTINEL_must_not_leak',              // the prompt — must be excluded
    sandbox: 'C:/Temp/SANDBOX_SENTINEL',                // fs path — must be excluded
    approval: { confirmedBy: 'louie', confirmedAt: '2026-07-11T11:59:00.000Z' },
    secretField: 'SECRET_SENTINEL'                      // future/unknown field
  }
  const result = {
    id: 'result_x', taskId: 'task_x', proposalId: 'prop_x', createdAt: '2026-07-11T12:00:07.000Z',
    ok: true, exit: 0, result: 'created hello.txt and committed', cost: 0.12,
    relay: { toUser: 0, fromUser: 0, manual: 0, EXTRA: 'RELAY_SENTINEL' },
    sandbox: 'C:/Temp/SANDBOX_SENTINEL',
    task: 'ANOTHER_PROMPT_SENTINEL', apiKey: 'KEY_SENTINEL'
  }
  const view = buildResultView({ proposalId: 'prop_x', execution, result, proposal: null })

  // keys are EXACTLY the allowlist
  assert.deepEqual(Object.keys(view).sort(), ALLOWED_KEYS)
  assert.deepEqual(Object.keys(view.relay).sort(), ['fromUser', 'manual', 'toUser'])

  const serialized = JSON.stringify(view)
  for (const sentinel of ['PROMPT_SENTINEL', 'SANDBOX_SENTINEL', 'SECRET_SENTINEL', 'ANOTHER_PROMPT', 'KEY_SENTINEL', 'RELAY_SENTINEL', 'sandbox', 'apiKey', 'secretField']) {
    assert.ok(!serialized.includes(sentinel), `must NOT leak "${sentinel}"`)
  }
  // it DOES carry the intended data
  assert.equal(view.resultSummary, 'created hello.txt and committed')
  assert.equal(view.proposal.confirmedBy, 'louie')
})

// --- status distinctions ---------------------------------------------------

test('status: succeeded / failed / running / pending', () => {
  const exec = { id: 'task_1', proposalId: 'p', createdAt: '2026-07-11T12:00:00.000Z', approval: { confirmedBy: 'louie', confirmedAt: 't' } }
  const okRes = { id: 'r1', taskId: 'task_1', createdAt: '2026-07-11T12:00:05.000Z', ok: true, exit: 0, result: 'done', cost: 0.1, relay: { toUser: 0, fromUser: 0, manual: 0 } }
  const failRes = { id: 'r2', taskId: 'task_1', createdAt: '2026-07-11T12:00:05.000Z', ok: false, error: 'boom', relay: { toUser: 0, fromUser: 0, manual: 0 } }

  assert.equal(buildResultView({ proposalId: 'p', execution: exec, result: okRes, proposal: null }).status, 'succeeded')
  const failView = buildResultView({ proposalId: 'p', execution: exec, result: failRes, proposal: null })
  assert.equal(failView.status, 'failed')
  assert.equal(failView.ok, false)
  assert.equal(failView.error, 'boom')
  assert.equal(failView.exitCode, null)
  assert.equal(buildResultView({ proposalId: 'p', execution: exec, result: null, proposal: null }).status, 'running')
  assert.equal(buildResultView({ proposalId: 'p', execution: null, result: null, proposal: null }).status, 'pending')
})

test('elapsedMs is finish - start; provenance falls back to the execution snapshot', () => {
  const exec = { id: 'task_1', proposalId: 'p', createdAt: '2026-07-11T12:00:00.000Z', approval: { confirmedBy: 'louie', confirmedAt: '2026-07-11T11:59:00.000Z' } }
  const res = { id: 'r', taskId: 'task_1', createdAt: '2026-07-11T12:00:07.000Z', ok: true, exit: 0, result: 'x', cost: 0, relay: { toUser: 0, fromUser: 0, manual: 0 } }
  const view = buildResultView({ proposalId: 'p', execution: exec, result: res, proposal: null })
  assert.equal(view.elapsedMs, 7000)
  assert.equal(view.proposal.confirmedBy, 'louie') // from execution.approval (no live proposal)
  assert.equal(view.proposal.status, 'confirmed')
})

test('a live proposal takes precedence for provenance', () => {
  const exec = { id: 'task_1', proposalId: 'p', createdAt: '2026-07-11T12:00:00.000Z', approval: { confirmedBy: 'stale', confirmedAt: 'x' } }
  const proposal = { confirmedBy: 'louie', confirmedAt: '2026-07-11T11:59:00.000Z', status: 'confirmed' }
  const view = buildResultView({ proposalId: 'p', execution: exec, result: null, proposal })
  assert.equal(view.proposal.confirmedBy, 'louie')
})

// --- robust finders (malformed handling) -----------------------------------

test('finders scan robustly: match by field, count malformed, never throw', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-view-'))
  try {
    const store = createArtifactStore({ baseDir: base })
    store.write('tasks', { id: 'task_1', createdAt: '2026-07-11T12:00:00.000Z', proposalId: 'prop_1', approval: { confirmedBy: 'louie' } })
    store.write('results', { id: 'res_1', createdAt: '2026-07-11T12:00:05.000Z', taskId: 'task_1', ok: true })
    // corrupt a results file
    const resultsDir = store.dirFor('results')
    fs.writeFileSync(path.join(resultsDir, '2026-07-11T12-00-09-000Z-res_bad.json'), '{ not json')

    const e = findExecutionByProposalId(store, 'prop_1')
    assert.equal(e.execution.id, 'task_1')

    const r = findResultByTaskId(store, 'task_1')
    assert.equal(r.result.id, 'res_1') // found the good one
    assert.equal(r.malformed, 1)        // and reported the corrupt one, without throwing

    assert.equal(findExecutionByProposalId(store, 'nope').execution, null)
  } finally { fs.rmSync(base, { recursive: true, force: true }) }
})
