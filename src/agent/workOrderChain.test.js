'use strict'

// workOrderChain.test.js — steps 2-4 of the Agent Bridge chain.
// Deterministic; injected fakes ONLY. NO real repo, NO Claude Code CLI, NO paid call.
// AGENT_BRIDGE stays OFF except where a test explicitly sets it to prove authorization.

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-wo-test-'))

const http = require('node:http')
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const { proposeWorkOrder, mentionedFilesFrom, MAX_ALLOWED_FILES } = require('./workOrderProducer')
const { buildApprovalView } = require('./workOrderView')
const { hashWorkOrder, canonicalWorkOrderJson, validateWorkOrder } = require('./workOrder')
const { createAgentRunner } = require('./agentRunner')
const { createApp } = require('../app')
const { TEST_SERVICE_TOKEN: TOKEN } = require('../api/_serviceTokenFixture')

const CONV = ['我想改 src/context/contextResult.js 加註解', '你可以幫我睇睇 src/context/contextResult.js 嗎?']
const goodProposal = { goal: '為匯出函式加上 JSDoc 註解', candidateFile: 'src/context/contextResult.js', allowedTestCommand: 'node --test src/context/context.test.js' }
const idFn = () => 'appr_canary1'

afterEach(() => { delete process.env.AGENT_BRIDGE; delete process.env.WORKER_INVOCATION; delete process.env.DEVELOP_DISPATCH })

/* ═══════════ STEP 2 — producer ═══════════ */

test('produces a SEALED work order with system-owned fields and a system hash', () => {
  const r = proposeWorkOrder({ proposal: goodProposal, conversation: CONV, newId: idFn })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  const wo = r.workOrder
  assert.deepEqual(wo.allowedFiles, ['src/context/contextResult.js'])
  assert.equal(wo.allowedFiles.length, MAX_ALLOWED_FILES)
  assert.equal(wo.approvalId, 'appr_canary1')
  assert.equal(wo.branch, 'agent/appr_canary1')
  assert.equal(wo.timeoutSec, 120)
  assert.equal(wo.costCapUsd, 0.5)
  for (const a of ['commit', 'push', 'PR', 'merge', 'deploy']) assert.ok(wo.forbiddenActions.includes(a))
  assert.equal(r.hash, hashWorkOrder(wo), 'hash is system-computed from the sealed order')
  assert.equal(validateWorkOrder(wo).ok, true, 'the sealed order satisfies the SAME validator the runner uses')
})

test('the MODEL cannot set system-owned fields (they are overwritten, not trusted)', () => {
  const hostile = Object.assign({}, goodProposal, {
    forbiddenActions: [], timeoutSec: 99999, costCapUsd: 999, approvalId: 'appr_evil', branch: 'main', hash: 'deadbeef'
  })
  const r = proposeWorkOrder({ proposal: hostile, conversation: CONV, newId: idFn })
  assert.equal(r.ok, true)
  assert.equal(r.workOrder.timeoutSec, 120, 'model-supplied timeout ignored')
  assert.equal(r.workOrder.costCapUsd, 0.5, 'model-supplied cost cap ignored')
  assert.equal(r.workOrder.approvalId, 'appr_canary1', 'model-supplied approvalId ignored')
  assert.notEqual(r.workOrder.branch, 'main')
  assert.ok(r.workOrder.forbiddenActions.includes('push'))
  assert.equal(r.workOrder.hash, undefined, 'a model-supplied hash never becomes part of the order')
})

test('LAYER 1: a forbidden target is rejected and NO work order is produced', () => {
  for (const bad of ['.env', '.git/config', 'src/app.js', 'src/agent/audit.js', 'src/agent/agentAuthorization.js', 'src/store/store.js', '.aroma/x.json']) {
    const r = proposeWorkOrder({ proposal: Object.assign({}, goodProposal, { candidateFile: bad }), conversation: [`請改 ${bad}`], newId: idFn })
    assert.equal(r.ok, false, `${bad} must be rejected`)
    assert.equal(r.workOrder, null)
    assert.ok(r.reasonForOwner.length > 0)
  }
})

test('path escapes / absolute paths are rejected', () => {
  for (const bad of ['../secret.js', '/etc/passwd.conf', 'C:/x/y.js']) {
    const r = proposeWorkOrder({ proposal: Object.assign({}, goodProposal, { candidateFile: bad }), conversation: [`改 ${bad}`], newId: idFn })
    assert.equal(r.ok, false, bad)
  }
})

test('two paths, a wildcard, or a directory are rejected', () => {
  const two = proposeWorkOrder({ proposal: Object.assign({}, goodProposal, { candidateFile: ['src/a.js', 'src/b.js'] }), conversation: ['src/a.js src/b.js'], newId: idFn })
  assert.equal(two.ok, false); assert.ok(two.errors.join(' ').includes('一個檔案'))
  for (const bad of ['src/**/*.js', 'src/*.js', 'src/context/', 'src/context']) {
    const r = proposeWorkOrder({ proposal: Object.assign({}, goodProposal, { candidateFile: bad }), conversation: [`改 ${bad}`], newId: idFn })
    assert.equal(r.ok, false, bad)
  }
})

test('OPTION B: a file NOT mentioned in the conversation is rejected', () => {
  const r = proposeWorkOrder({ proposal: Object.assign({}, goodProposal, { candidateFile: 'src/context/flags.js' }), conversation: CONV, newId: idFn })
  assert.equal(r.ok, false)
  assert.ok(r.errors.join(' ').includes('未在對話中提及過'))
  assert.equal(r.workOrder, null)
  // and with no conversation at all, nothing can be produced
  assert.equal(proposeWorkOrder({ proposal: goodProposal, conversation: [], newId: idFn }).ok, false)
})

test('mentionedFilesFrom extracts only path-shaped tokens (never invents)', () => {
  const m = mentionedFilesFrom(['改 src/context/flags.js 同 README.md', '唔關事嘅字'])
  assert.ok(m.includes('src/context/flags.js') && m.includes('readme.md'))
  assert.equal(mentionedFilesFrom(['完全冇提到檔案']).length, 0)
})

/* ═══════════ STEP 3 — WYSIWYA ═══════════ */

test('WYSIWYA: the displayed object IS the hashed object (same serialization)', () => {
  const { workOrder } = proposeWorkOrder({ proposal: goodProposal, conversation: CONV, newId: idFn })
  const view = buildApprovalView(workOrder)
  // 1. the view's canonical serialization is byte-identical to what the hash digests
  assert.equal(view.canonicalJson, canonicalWorkOrderJson(workOrder))
  // 2. the hash shown equals the hash of that exact serialization
  const crypto = require('node:crypto')
  assert.equal(view.hash, crypto.createHash('sha256').update(view.canonicalJson).digest('hex'))
  assert.equal(view.hash, hashWorkOrder(workOrder))
  // 3. every field the Owner is shown is present in the canonical (hashed) object
  assert.equal(view.display.goal, view.canonical.goal)
  assert.equal(view.display.allowedFile, view.canonical.allowedFiles[0])
  assert.equal(view.display.allowedTestCommand, view.canonical.allowedTestCommand)
  assert.deepEqual(view.display.forbiddenActions, view.canonical.forbiddenActions)
  assert.equal(view.display.timeoutSec, view.canonical.timeoutSec)
  assert.equal(view.display.costCapUsd, view.canonical.costCapUsd)
  assert.equal(view.display.branch, view.canonical.branch)
  assert.equal(view.display.approvalId, view.canonical.approvalId)
  // 4. changing ANY displayed field changes the hash (nothing shown is outside the hash)
  for (const mut of [{ goal: 'x' }, { allowedFiles: ['src/other.js'] }, { allowedTestCommand: 'rm -rf /' }, { timeoutSec: 121 }, { costCapUsd: 9 }, { branch: 'main' }, { approvalId: 'appr_other' }, { forbiddenActions: ['commit'] }]) {
    assert.notEqual(hashWorkOrder(Object.assign({}, workOrder, mut)), view.hash, `mutating ${Object.keys(mut)[0]} must change the hash`)
  }
})

test('the display states the consequence in plain language (diff only, worst case, no amend)', () => {
  const { workOrder } = proposeWorkOrder({ proposal: goodProposal, conversation: CONV, newId: idFn })
  const v = buildApprovalView(workOrder)
  // Owner Decision Card v2 says the same things in the Owner's own language. The English
  // constants ("不會 commit", "remote") moved into the collapsed technical section; the
  // visible face states the consequence as a decision, not as a field dump.
  assert.ok(v.display.whatWillHappen.includes('不會提交、不會上傳、不會合併、不會部署。'))
  assert.ok(v.display.whatWillHappen.includes('丟棄式副本'))
  assert.ok(v.display.worstCase.includes('你的真實程式庫不受影響'))
  const tech = v.technicalLines.join('\n')
  assert.ok(tech.includes('已移除所有 remote'), 'the isolation mechanism is still disclosed')
  assert.ok(tech.includes('無法回到 main'))
  assert.ok(tech.includes('必須重新建立一張新的工作單'), 'no-amend rule still stated to the Owner')
  assert.ok(v.lines.join('\n').includes(v.hash))
})

/* ═══════════ STEP 4 — hash enforcement, no amend ═══════════ */

function fakeWorkspace (calls) {
  return { prepare: () => { calls.prep++; return { dir: '/tmp/aroma-sandbox-agent-x', branch: 'agent/appr_canary1' } }, containmentCheck: (t) => t, permissionMode: () => 'acceptEdits', filesChanged: () => ['src/context/contextResult.js'], diffStat: () => ' 1 file changed', remotes: () => [], currentBranch: () => 'agent/appr_canary1', cleanup: () => {} }
}

test('approved hash === executed hash -> the run proceeds', async () => {
  const calls = { prep: 0, invoke: 0 }
  const audit = []
  const { workOrder, hash } = proposeWorkOrder({ proposal: goodProposal, conversation: CONV, newId: idFn })
  const runner = createAgentRunner({ checkCredentials: () => ({ canRun: true, state: 'ok', refusal: null, warning: null, refreshExpiresAt: null, daysLeft: null, accessTokenValid: true, subscription: null }), writePatch: () => ({ ok: false, reason: 'no_changes' }),  workspace: fakeWorkspace(calls), auditLog: { append: (e) => audit.push(e) }, worker: { invoke: async () => { calls.invoke++; return { ok: true, cost: 0.01, output: { exit: 0, branch: 'agent/appr_canary1', filesChanged: ['src/context/contextResult.js'], risks: [] } } } } })
  const r = await runner.run({ workOrder, approvedHash: hash, who: 'louie' })
  assert.equal(r.ok, true)
  assert.equal(calls.invoke, 1)
  assert.equal(audit.length, 1)
  assert.equal(audit[0].workOrderHash, hash)
})

test('approved hash !== executed hash -> REFUSED, audited, ZERO workspace prep and ZERO worker call', async () => {
  const calls = { prep: 0, invoke: 0 }
  const audit = []
  const { workOrder, hash } = proposeWorkOrder({ proposal: goodProposal, conversation: CONV, newId: idFn })
  const runner = createAgentRunner({ checkCredentials: () => ({ canRun: true, state: 'ok', refusal: null, warning: null, refreshExpiresAt: null, daysLeft: null, accessTokenValid: true, subscription: null }), writePatch: () => ({ ok: false, reason: 'no_changes' }),  workspace: fakeWorkspace(calls), auditLog: { append: (e) => audit.push(e) }, worker: { invoke: async () => { calls.invoke++; return { ok: true, output: {} } } } })

  // the classic attack: a SECOND file smuggled in after approval
  const widened = Object.assign({}, workOrder, { allowedFiles: [workOrder.allowedFiles[0], 'src/context/flags.js'] })
  const r = await runner.run({ workOrder: widened, approvedHash: hash, who: 'louie' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'hash_mismatch')
  assert.equal(calls.prep, 0, 'no workspace was prepared')
  assert.equal(calls.invoke, 0, 'the worker was never invoked')
  assert.equal(audit.length, 1, 'the refusal is audited, never silent')

  // widened caps are caught the same way
  const richer = Object.assign({}, workOrder, { costCapUsd: 50 })
  assert.equal((await runner.run({ workOrder: richer, approvedHash: hash, who: 'louie' })).error, 'hash_mismatch')
  assert.equal(calls.invoke, 0)
})

test('a missing approved hash is refused (execution always requires an explicit approval)', async () => {
  const calls = { prep: 0, invoke: 0 }
  const { workOrder } = proposeWorkOrder({ proposal: goodProposal, conversation: CONV, newId: idFn })
  const runner = createAgentRunner({ checkCredentials: () => ({ canRun: true, state: 'ok', refusal: null, warning: null, refreshExpiresAt: null, daysLeft: null, accessTokenValid: true, subscription: null }), writePatch: () => ({ ok: false, reason: 'no_changes' }),  workspace: fakeWorkspace(calls), worker: { invoke: async () => { calls.invoke++; return {} } } })
  assert.equal((await runner.run({ workOrder })).error, 'missing_approved_hash')
  assert.equal(calls.prep, 0); assert.equal(calls.invoke, 0)
})

test('NO AMEND PATH: adding a file requires a NEW order (different approvalId AND hash)', () => {
  const a = proposeWorkOrder({ proposal: goodProposal, conversation: CONV, newId: () => 'appr_one' })
  const b = proposeWorkOrder({ proposal: Object.assign({}, goodProposal, { candidateFile: 'src/context/flags.js' }), conversation: ['改 src/context/flags.js'], newId: () => 'appr_two' })
  assert.equal(a.ok, true); assert.equal(b.ok, true)
  assert.notEqual(a.workOrder.approvalId, b.workOrder.approvalId)
  assert.notEqual(a.hash, b.hash)
  // and there is no exported way to mutate a sealed order
  const producer = require('./workOrderProducer')
  assert.deepEqual(Object.keys(producer).filter((k) => /amend|extend|addFile|widen/i.test(k)), [])
  const runner = require('./agentRunner')
  assert.deepEqual(Object.keys(runner).filter((k) => /amend|extend|addFile|widen/i.test(k)), [])
})

/* ═══════════ STEP 4 — EXECUTE vs ordinary confirm, through the real route ═══════════ */

function postJson (app, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const data = JSON.stringify(body || {})
      const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
      if (token) headers.authorization = 'Bearer ' + token
      const req = http.request({ port: server.address().port, path: urlPath, method: 'POST', headers }, (r) => {
        let b = ''; r.on('data', (d) => { b += d }); r.on('end', () => { server.close(); resolve({ status: r.statusCode, body: b ? JSON.parse(b) : {} }) })
      })
      req.on('error', (e) => { server.close(); reject(e) })
      req.end(data)
    })
  })
}
function appWithProposal (extra = {}) {
  const app = createApp(Object.assign({ serviceToken: TOKEN, proposalPersistence: false, runPersistence: false }, extra))
  const p = app.locals.proposalStore.createBridgeProposal({ task: 'Title: t\n\nDetails: d', sourceTaskId: 'task_x' })
  app.locals.proposalStore.setLinkState(p.id, 'ready')
  return { app, proposalId: p.id }
}

test('an ORDINARY confirm never authorizes agent execution (flag ON, runner present)', async () => {
  process.env.AGENT_BRIDGE = 'on'
  let runnerCalls = 0
  const { app, proposalId } = appWithProposal({ agentRunner: { run: async () => { runnerCalls++; return { ok: true, output: {} } } } })
  const res = await postJson(app, `/api/v1/proposals/${proposalId}/confirm`, {}, TOKEN) // NO agentExecute triple
  assert.equal(res.status, 201)
  assert.equal(res.body.proposalStatus, 'confirmed')
  assert.notEqual(res.body.dispatchStatus, 'agent_execute_accepted')
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(runnerCalls, 0, 'approving a normal Proposal must NEVER start the agent')
})

test('a PARTIAL execute triple never authorizes (all three fields required)', async () => {
  process.env.AGENT_BRIDGE = 'on'
  const { workOrder, hash } = proposeWorkOrder({ proposal: goodProposal, conversation: CONV, newId: idFn })
  for (const body of [
    { agentExecute: true }, // no order, no hash
    { agentExecute: true, workOrder }, // no hash
    { workOrder, approvedWorkOrderHash: hash }, // no explicit execute
    { agentExecute: 'yes', workOrder, approvedWorkOrderHash: hash } // not strictly true
  ]) {
    let runnerCalls = 0
    const { app, proposalId } = appWithProposal({ agentRunner: { run: async () => { runnerCalls++; return {} } } })
    const res = await postJson(app, `/api/v1/proposals/${proposalId}/confirm`, body, TOKEN)
    assert.equal(res.status, 201)
    assert.notEqual(res.body.dispatchStatus, 'agent_execute_accepted', JSON.stringify(Object.keys(body)))
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(runnerCalls, 0)
  }
})

test('a full EXECUTE triple with the flag ON hands off exactly once, with the approved hash', async () => {
  process.env.AGENT_BRIDGE = 'on'
  const { workOrder, hash } = proposeWorkOrder({ proposal: goodProposal, conversation: CONV, newId: idFn })
  const seen = []
  const { app, proposalId } = appWithProposal({ agentRunner: { run: async (a) => { seen.push(a); return { ok: true, output: {} } } } })
  const res = await postJson(app, `/api/v1/proposals/${proposalId}/confirm`, { agentExecute: true, workOrder, approvedWorkOrderHash: hash }, TOKEN)
  assert.equal(res.body.dispatchStatus, 'agent_execute_accepted')
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].approvedHash, hash)
  assert.equal(seen[0].who, 'louie', 'the approver is server-supplied, never from the body')
  assert.deepEqual(seen[0].workOrder.allowedFiles, ['src/context/contextResult.js'])
})

test('AGENT_BRIDGE OFF: a full EXECUTE triple is NOT authorized and no runner exists', async () => {
  delete process.env.AGENT_BRIDGE
  const { workOrder, hash } = proposeWorkOrder({ proposal: goodProposal, conversation: CONV, newId: idFn })
  const { app, proposalId } = appWithProposal()
  assert.equal(app.agentRunnerConfigured, false)
  assert.equal(app.agentRunner, null)
  const res = await postJson(app, `/api/v1/proposals/${proposalId}/confirm`, { agentExecute: true, workOrder, approvedWorkOrderHash: hash }, TOKEN)
  assert.equal(res.status, 201)
  assert.equal(res.body.dispatchStatus, 'agent_execute_not_authorized')
})

test('two-of-three flags + a full EXECUTE triple -> conflict, ZERO execution', async () => {
  process.env.AGENT_BRIDGE = 'on'; process.env.WORKER_INVOCATION = 'on'
  const { workOrder, hash } = proposeWorkOrder({ proposal: goodProposal, conversation: CONV, newId: idFn })
  let runnerCalls = 0
  const { app, proposalId } = appWithProposal({ agentRunner: { run: async () => { runnerCalls++; return {} } } })
  const res = await postJson(app, `/api/v1/proposals/${proposalId}/confirm`, { agentExecute: true, workOrder, approvedWorkOrderHash: hash }, TOKEN)
  assert.equal(res.body.dispatchStatus, 'configuration_conflict')
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(runnerCalls, 0)
})

test('confirm remains TOKEN-GATED: no token -> 401 and no hand-off', async () => {
  process.env.AGENT_BRIDGE = 'on'
  const { workOrder, hash } = proposeWorkOrder({ proposal: goodProposal, conversation: CONV, newId: idFn })
  let runnerCalls = 0
  const { app, proposalId } = appWithProposal({ agentRunner: { run: async () => { runnerCalls++; return {} } } })
  const res = await postJson(app, `/api/v1/proposals/${proposalId}/confirm`, { agentExecute: true, workOrder, approvedWorkOrderHash: hash }, null)
  assert.equal(res.status, 401)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(runnerCalls, 0)
})
