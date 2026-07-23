'use strict'

/**
 * intakeActivation.test.js — B2-2 Activation slice. Real HTTP (supertest-style
 * via fetch) against createApp:
 *   - OFF: /api/v1/intake response contract unchanged (no demo fields);
 *   - ON: an execution turn creates an OFFICIAL pending Proposal in the SAME
 *     governance store (persistIntake's taskId → promote → prop_xxx), visible via
 *     GET /api/v1/proposals, with NO new Run and NO new dispatch.
 *
 * Isolation: a throwaway AROMA_DATA_DIR (the in-process file store) set BEFORE the
 * app is required, and removed after — never touches the real/shared
 * aroma-truth.json. LLM_PROVIDER=mock so classification is deterministic; the mock
 * returns a single-task commit for a long non-greeting message.
 *
 *   Run: node --test src/intake/intakeActivation.test.js
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

// Isolated store dir BEFORE requiring the app (store.js reads AROMA_DATA_DIR at load).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-activation-'))
process.env.AROMA_DATA_DIR = TMP
process.env.LLM_PROVIDER = 'mock'

const { test, after } = require('node:test')
const assert = require('node:assert/strict')

const appMod = require('../app')

// Stub worker deps so createApp never touches the real .aroma dir.
const stubWorkerDeps = { artifactStore: { dirFor: () => path.join(os.tmpdir(), 'aroma-nonexistent-activation') } }

function buildApp (demoOn) {
  process.env.CONVERSATION_DEMO = demoOn ? 'on' : 'off'
  return appMod.createApp({ dispatcher: async () => {}, workerDeps: stubWorkerDeps, proposalPersistence: false, runPersistence: false })
}

async function jpost (server, p, body) {
  const { port } = server.address()
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}
async function jget (server, p) {
  const { port } = server.address()
  const r = await fetch(`http://127.0.0.1:${port}${p}`)
  let body = null
  try { body = await r.json() } catch (_) {}
  return { status: r.status, body }
}
const len = (v) => (Array.isArray(v) ? v.length : 0)

const EXEC_MSG = '把 Timeline 到終止狀態後的輪詢停掉' // mock → single-task commit

after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (_) {} })

test('OFF: /api/v1/intake response carries NO demo fields (contract unchanged)', async () => {
  const server = buildApp(false).listen(0)
  try {
    const res = await jpost(server, '/api/v1/intake', { message: EXEC_MSG })
    assert.equal(res.status, 200)
    assert.equal('demoOutcome' in res.body, false)
    assert.equal('proposals' in res.body, false)
    assert.equal('contextCardWarnings' in res.body, false)
    assert.equal(res.body.mode, 'commit') // existing commit contract intact
  } finally { server.close() }
})

test('ON: execution → official pending Proposal in the SAME store; visible in GET /proposals; NO new Run/dispatch', async () => {
  const server = buildApp(true).listen(0)
  try {
    const before = {
      dispatches: len((await jget(server, '/api/v1/dispatches')).body),
      runs: len((await jget(server, '/api/v1/runs')).body)
    }

    const res = await jpost(server, '/api/v1/intake', { message: EXEC_MSG })
    assert.equal(res.status, 200)
    assert.equal(res.body.demoOutcome, 'execution_proposal')
    assert.equal(res.body.proposals.length, 1)
    const p = res.body.proposals[0]
    assert.ok(typeof p.id === 'string' && p.id.startsWith('prop_'), 'official prop_ id')
    assert.equal(p.status, 'pending', 'status comes from the official record')
    assert.equal(p.linkState, 'ready')
    assert.ok(p.runId == null, 'pending proposal has no runId → no Run was started')
    assert.deepEqual(res.body.promoteErrors, [])
    // no invented top-level state
    assert.equal('status' in res.body, false)
    assert.equal('dispatchStatus' in res.body, false)

    // STORE SAME-SOURCE: the same official id is visible in the governance list.
    const list = (await jget(server, '/api/v1/proposals')).body
    assert.ok(Array.isArray(list) && list.some((x) => x.id === p.id && x.status === 'pending'), 'proposal visible in GET /proposals')

    // NO new Run / dispatch — confirm was never called (sole startRun path).
    const afterState = {
      dispatches: len((await jget(server, '/api/v1/dispatches')).body),
      runs: len((await jget(server, '/api/v1/runs')).body)
    }
    assert.equal(afterState.dispatches, before.dispatches, 'no new dispatch created')
    assert.equal(afterState.runs, before.runs, 'no new run created')
  } finally { server.close() }
})

test('ON: a conversational turn (chat) gets demoOutcome but creates no Proposal', async () => {
  const server = buildApp(true).listen(0)
  try {
    const res = await jpost(server, '/api/v1/intake', { message: '你好' }) // mock → greeting/chat
    assert.equal(res.status, 200)
    assert.equal(res.body.demoOutcome, 'speech')
    assert.equal('proposals' in res.body, false)
    assert.deepEqual(res.body.contextCardWarnings, [])
  } finally { server.close() }
})
