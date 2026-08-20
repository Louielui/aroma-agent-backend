'use strict'

/**
 * resultSnapshot.test.js — a finished run must report itself CORRECTLY forever, including
 * long after its sealed Work Order has expired.
 *
 * THE BUG THIS EXISTS TO PREVENT. The result view rebuilt allowedFiles / timeoutSec /
 * costCapUsd from the sealed Work Order at READ time. Sealed orders expire after 10
 * minutes. So reading a finished run 11 minutes later found no order, an empty allowlist,
 * and told the Owner his perfectly in-scope canary had gone OUT OF SCOPE —
 * 「越界…這份結果不應採用」— with caps rendered as US$0.00 / null. The run had been clean;
 * only the report was wrong, and it was wrong in the most alarming possible direction.
 *
 * elapsedMs had the same root: it was computed as now-minus-start at read time, so it
 * grew forever (the real canary read back 769,098ms for a 10.4-second run).
 *
 * This is the THIRD defect of one shape — after the unwired audit store and the wrong
 * result field paths — and the shape is: FACTS RECONSTRUCTED AFTER THE EVENT. Nobody
 * tested the expiry case because every test read the result immediately. This file reads
 * it after expiry, on purpose.
 */

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const crypto = require('node:crypto')

const { createApp } = require('../app')
const { hashWorkOrder } = require('./workOrder')
const { buildAgentResultView } = require('./agentResultView')
const { createOwnerApprovalStore } = require('./ownerApprovalStore')

const ORIGIN = 'http://127.0.0.1:8090'
const GOOD = { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }
const CANARY = 'docs/canary/agent-canary.md'

/* ── harness: a real app over a real loopback socket, fake runner ─────────── */

function startApp (extra = {}) {
  const runs = []
  const fakeRunner = {
    run: async (a) => {
      runs.push(a)
      return {
        ok: true, cost: 0.1233515, latencyMs: 10400,
        output: {
          filesChanged: [CANARY], diffSummary: ' ' + CANARY + ' | 2 +-',
          exit: 0, risks: [], warnings: [], branch: a.workOrder.branch, testResults: null
        }
      }
    }
  }
  const app = createApp(Object.assign({
    runPersistence: false, proposalPersistence: false, serviceToken: 'snap-test',
    agentRunner: fakeRunner, workerDeps: { artifactStore: null, runner: null }
  }, extra))
  const server = http.createServer(app)
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ app, server, runs, port: server.address().port })))
}

function req (ctx, { method = 'POST', url, headers = {}, body }) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
  const h = Object.assign({ host: '127.0.0.1:8090' }, headers)
  if (payload) h['content-length'] = String(payload.length)
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: ctx.port, method, path: url, headers: h, setHost: false }, (res) => {
      let raw = ''
      res.on('data', (d) => { raw += d })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(raw) } catch {}
        resolve({ status: res.statusCode, json, headers: res.headers })
      })
    })
    r.on('error', reject)
    if (payload) r.write(payload)
    r.end()
  })
}

function seedProposal (ctx) {
  const s = ctx.app.locals.proposalStore
  const p = s.createBridgeProposal({ task: 'canary', sourceTaskId: 'task_' + crypto.randomBytes(6).toString('hex') })
  s.setLinkState(p.id, 'ready')
  return p.id
}

/** Approve the canary end to end and return the approvalId. A controllable clock lets the
 *  sealed order expire on demand, which is the whole point. */
async function runCanary (ctx) {
  const seal = await req(ctx, {
    url: '/api/v1/owner/work-orders',
    headers: GOOD,
    body: {
      proposalId: seedProposal(ctx),
      goal: '改 canary 一行字',
      candidateFile: CANARY,
      intendedChange: 'line 2',
      conversation: ['請改 ' + CANARY]
    }
  })
  assert.equal(seal.status, 201, JSON.stringify(seal.json))
  const cookie = String(seal.headers['set-cookie'][0]).split(';')[0]
  const ok = await req(ctx, {
    url: '/api/v1/owner/approve',
    headers: Object.assign({ cookie }, GOOD),
    body: {
      approvalId: seal.json.approvalId,
      workOrderHash: seal.json.workOrderHash,
      nonce: seal.json.nonce,
      typedConfirmation: 'EXECUTE'
    }
  })
  assert.equal(ok.status, 201, JSON.stringify(ok.json))
  assert.equal(ok.json.dispatchStatus, 'agent_execute_accepted')
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r))
  return seal.json.approvalId
}

/* ── THE REGRESSION: read a finished result AFTER the order expires ───────── */

test('*** a finished run reports correctly AFTER its sealed order has expired ***', async () => {
  process.env.AGENT_BRIDGE = 'on'
  let clock = 1_000_000
  const ctx = await startApp({ ownerApprovalStoreOptions: { now: () => clock, sessionTtlMs: 60 * 60 * 1000 } })
  try {
    const approvalId = await runCanary(ctx)

    // sanity: correct WHILE the order is still alive
    const fresh = await req(ctx, { method: 'GET', url: '/api/v1/owner/results/' + approvalId, headers: GOOD })
    assert.equal(fresh.json.status, 'done')
    assert.ok(!fresh.json.lines.join('\n').includes('越界'), 'in scope while the order lives')

    // ...now let the sealed order expire, exactly as it did for the real canary
    clock += 11 * 60 * 1000
    assert.equal(ctx.app.locals.ownerApprovalStore.loadSealed(approvalId).ok, false, 'the order really has expired')

    const after = await req(ctx, { method: 'GET', url: '/api/v1/owner/results/' + approvalId, headers: GOOD })
    assert.equal(after.status, 200)
    const txt = after.json.lines.join('\n')

    // 1. SCOPE — the accusation that started this
    assert.ok(!txt.includes('越界'), 'must NOT report out-of-scope after expiry')
    assert.ok(!txt.includes('不應採用'), 'must NOT tell the Owner to discard a clean result')
    assert.ok(txt.includes('有守住範圍'), 'reports in-scope, from the snapshot')
    assert.ok(txt.includes(CANARY), 'and names the file it was allowed to touch')

    // 2. CAPS — were rendering as US$0.00 / null
    assert.ok(txt.includes('US$0.50'), 'the real cost cap survives expiry')
    assert.ok(txt.includes('120 秒'), 'the real timeout cap survives expiry')
    assert.ok(!txt.includes('US$0.00'), 'no phantom zero cap')
    assert.ok(!/null 秒/.test(txt), 'no null timeout')
    assert.equal(after.json.capSec, 120, 'capSec comes from the snapshot')

    // 3. DURATION — was growing forever
    assert.ok(after.json.elapsedMs < 60_000, 'elapsed is the MEASURED duration, not now-minus-start: ' + after.json.elapsedMs)
    assert.equal(after.json.finished, true)

    // 4. and the result itself is still fully populated
    assert.ok(txt.includes('US$0.12'), 'cost reported')
    assert.ok(txt.includes('2 +-'), 'diff summary reported')
    assert.ok(!txt.includes('執行器沒有提供這項資料'), 'nothing falsely reported as missing')
  } finally {
    await new Promise((r) => ctx.server.close(r))
    delete process.env.AGENT_BRIDGE
  }
})

test('the reported duration STOPS at completion instead of growing', async () => {
  process.env.AGENT_BRIDGE = 'on'
  let clock = 1_000_000
  const ctx = await startApp({ ownerApprovalStoreOptions: { now: () => clock, sessionTtlMs: 60 * 60 * 1000 } })
  try {
    const approvalId = await runCanary(ctx)
    const first = await req(ctx, { method: 'GET', url: '/api/v1/owner/results/' + approvalId, headers: GOOD })
    clock += 60 * 60 * 1000 // an hour later
    const later = await req(ctx, { method: 'GET', url: '/api/v1/owner/results/' + approvalId, headers: GOOD })
    assert.equal(later.json.elapsedMs, first.json.elapsedMs, 'the same run cannot take longer just because time passed')
  } finally {
    await new Promise((r) => ctx.server.close(r))
    delete process.env.AGENT_BRIDGE
  }
})

/* ── the snapshot itself ──────────────────────────────────────────────────── */

test('the store snapshots scope + caps at hand-off and measures duration once', () => {
  let clock = 1000
  const s = createOwnerApprovalStore({ now: () => clock })
  s.recordExecutionStart('a1', { allowedFiles: [CANARY], timeoutSec: 120, costCapUsd: 0.5, branch: 'agent/a1' })
  clock += 10_400
  s.recordResult('a1', { ok: true })

  const rec = s.getResult('a1').record
  assert.deepEqual(rec.facts.allowedFiles, [CANARY])
  assert.equal(rec.facts.timeoutSec, 120)
  assert.equal(rec.facts.costCapUsd, 0.5)
  assert.equal(rec.durationMs, 10_400, 'measured once, at completion')

  clock += 999_999 // the record does not drift
  assert.equal(s.getResult('a1').record.durationMs, 10_400)

  // write-once, like every other record the Owner may have read
  assert.equal(s.recordResult('a1', { ok: false }).reason, 'already_recorded')
  assert.equal(s.recordExecutionStart('a1', {}).reason, 'already_started')
})

test('the view uses the SNAPSHOT and never needs a Work Order', () => {
  // Given only facts + a result — no sealed order anywhere — the report is complete.
  const v = buildAgentResultView({
    approvalId: 'a1',
    facts: { allowedFiles: [CANARY], timeoutSec: 120, costCapUsd: 0.5, allowedTestCommand: null, branch: 'agent/a1' },
    durationMs: 10_400,
    result: { ok: true, cost: 0.1233515, output: { filesChanged: [CANARY], diffSummary: ' 1 file changed', exit: 0, risks: [], warnings: [] } }
  })
  assert.equal(v.status, 'done')
  assert.equal(v.scope.inScope, true)
  const txt = v.lines.join('\n')
  assert.ok(txt.includes('有守住範圍'))
  assert.ok(txt.includes('US$0.12 · 10.4 秒'))
  assert.ok(txt.includes('US$0.50'))
  assert.ok(txt.includes('120 秒'))
})

test('an out-of-scope run is STILL flagged — the fix must not blunt the real warning', () => {
  const v = buildAgentResultView({
    approvalId: 'a1',
    facts: { allowedFiles: [CANARY], timeoutSec: 120, costCapUsd: 0.5 },
    durationMs: 1000,
    result: { ok: true, cost: 0.01, output: { filesChanged: [CANARY, 'src/app.js'], risks: [], warnings: [] } }
  })
  assert.equal(v.scope.inScope, false)
  assert.deepEqual(v.scope.outside, ['src/app.js'])
  const txt = v.lines.join('\n')
  assert.ok(txt.includes('越界'), 'a genuine breach is still called out')
  assert.ok(txt.includes('不應採用'))
})

test('missing facts stay honestly unknown rather than becoming a false accusation', () => {
  // If a result somehow arrives with no snapshot, the report must not claim a breach.
  const v = buildAgentResultView({
    approvalId: 'a1',
    facts: { allowedFiles: [], timeoutSec: null, costCapUsd: null },
    result: { ok: true, output: { risks: [], warnings: [] } } // no filesChanged reported
  })
  const txt = v.lines.join('\n')
  assert.ok(!txt.includes('越界'), 'no scope accusation without evidence of a breach')
  assert.ok(txt.includes('執行器沒有提供這項資料'), 'unknown is stated as unknown')
})

/* ── the audit record answers "how long" on its own ───────────────────────── */

test('the audit record now carries duration', () => {
  const { createAuditLog } = require('./audit')
  const written = []
  const log = createAuditLog({ artifactStore: { write: (kind, rec) => written.push(rec) } })
  log.append({
    approvalId: 'a1', workOrderHash: 'h', who: 'louie', durationMs: 10_400,
    result: { ok: true, cost: 0.12, latencyMs: 9800, output: { filesChanged: [CANARY], risks: [], exit: 0, branch: 'agent/a1' } }
  })
  const rec = written[0]
  assert.equal(rec.durationMs, 10_400, 'the whole run, measured by the runner')
  assert.equal(rec.workerLatencyMs, 9800, 'and the worker spawn figure, which answers a different question')
  assert.equal(rec.cost, 0.12)
  // absent duration stays null rather than becoming 0
  written.length = 0
  log.append({ approvalId: 'a2', workOrderHash: 'h', who: 'louie', result: { ok: false, output: {} } })
  assert.equal(written[0].durationMs, null)
  assert.equal(written[0].workerLatencyMs, null)
})

/* ── the patch section is rendered ONCE ───────────────────────────────────── */

/**
 * THE BUG THIS EXISTS TO PREVENT. `secPatch` was built twice: once unconditionally in the
 * sections array, and once again by the conditional splice below it. A delivered result
 * therefore showed 「改動去了哪裡」 TWICE, and a result with no patch at all showed it once
 * with a body of `null` — printed to the Owner as the bare word "null" — even though the
 * comment above patchLine promises that an absent patch means an absent section.
 *
 * Same shape as the rest of this file: the report was wrong while the run was fine.
 */

const PATCH_TITLE = '改動去了哪裡'
const HOUSE = 'docs/HOUSE-RULES.md'
const titles = (v) => v.sections.map((s) => s.title)
const countTitle = (v, title) => titles(v).filter((x) => x === title).length

// The accepted Canary B shape: one approved file, one file really changed, patch written.
function deliveredResult (output = {}) {
  return buildAgentResultView({
    approvalId: 'appr_1b9d0877',
    facts: { allowedFiles: [HOUSE], timeoutSec: 120, costCapUsd: 0.5, allowedTestCommand: null, branch: 'agent/a1' },
    durationMs: 10_400,
    result: {
      ok: true,
      cost: 0.1233515,
      output: {
        filesChanged: [HOUSE],
        diffSummary: 'docs/HOUSE-RULES.md | 1 +',
        exit: 0,
        risks: [],
        warnings: [],
        patchStatus: 'written',
        patchFile: 'C:/Aroma/AgentPatches/fixture.patch',
        applyHint: 'git apply "C:/Aroma/AgentPatches/fixture.patch"',
        ...output
      }
    }
  })
}

test('*** a delivered result shows 改動去了哪裡 exactly ONCE, not twice ***', () => {
  const v = deliveredResult()
  assert.equal(countTitle(v, PATCH_TITLE), 1, 'the patch section was rendered twice')
  // and once in the RENDERED lines too — the card the Owner actually reads
  const heads = v.lines.filter((l) => l === PATCH_TITLE)
  assert.equal(heads.length, 1, 'the rendered card repeats the section heading')
})

test('the deduplicated patch section still carries the apply hint', () => {
  const v = deliveredResult()
  const sec = v.sections.filter((s) => s.title === PATCH_TITLE)
  assert.equal(sec.length, 1)
  assert.equal(sec[0].body, 'git apply "C:/Aroma/AgentPatches/fixture.patch"',
    'dedup must keep the surviving section INFORMATIVE, not just single')
  assert.ok(v.lines.join('\n').includes('C:/Aroma/AgentPatches/fixture.patch'), 'the path reaches the card')
})

test('an honest no-patch MESSAGE is still shown — dedup must not silence it', () => {
  // These three all produce a truthy patchLine and therefore a real section to read.
  for (const [status, expect] of [
    ['no_changes', '沒有改動，所以沒有 patch。'],
    ['patch_too_large', 'patch 太大，沒有寫入'],
    ['write_failed', 'write_failed']
  ]) {
    const v = deliveredResult({ patchStatus: status, applyHint: null, patchFile: null })
    assert.equal(countTitle(v, PATCH_TITLE), 1, status + ': expected exactly one patch section')
    assert.ok(v.sections.find((s) => s.title === PATCH_TITLE).body.includes(expect),
      status + ': the honest message must survive')
  }
})

test('a result with NO patch fields keeps the section absent rather than printing "null"', () => {
  const v = buildAgentResultView({
    approvalId: 'a1',
    facts: { allowedFiles: [HOUSE], timeoutSec: 120, costCapUsd: 0.5 },
    durationMs: 1000,
    result: { ok: true, cost: 0.01, output: { filesChanged: [HOUSE], risks: [], warnings: [] } }
  })
  assert.equal(countTitle(v, PATCH_TITLE), 0, 'ABSENT STAYS ABSENT — see the comment above patchLine')
  assert.ok(!v.lines.includes('null'), 'the Owner must never be shown the bare word "null"')
  assert.equal(v.sections.filter((s) => s.body === null).length, 0, 'no section may carry a null body')
})

test('dedup changes ONLY the patch section — order and the other sections are untouched', () => {
  const withPatch = titles(deliveredResult())
  assert.deepEqual(withPatch, [
    '結果', '實際改動了甚麼', '有沒有超出批准範圍', '測試',
    '改動內容（diff）', '用了多少', PATCH_TITLE, '你的真實程式庫'
  ], 'the intended single-section order is pinned here')
  // no section title repeats, for either shape
  for (const v of [deliveredResult(), deliveredResult({ patchStatus: 'no_changes', applyHint: null })]) {
    assert.equal(new Set(titles(v)).size, titles(v).length, 'a section title is duplicated')
  }
  // the no-patch card is the same list minus the patch section — nothing reordered
  const noPatch = titles(buildAgentResultView({
    approvalId: 'a1',
    facts: { allowedFiles: [HOUSE], timeoutSec: 120, costCapUsd: 0.5 },
    result: { ok: true, cost: 0.01, output: { filesChanged: [HOUSE], risks: [], warnings: [] } }
  }))
  assert.deepEqual(noPatch, withPatch.filter((x) => x !== PATCH_TITLE))
})

test('failed and refused results still lead with their reason, patch section aside', () => {
  const failed = buildAgentResultView({
    approvalId: 'a1',
    facts: { allowedFiles: [HOUSE], timeoutSec: 120, costCapUsd: 0.5 },
    result: { ok: false, output: { filesChanged: [], risks: [], warnings: ['no_delivery_change'], patchStatus: 'no_changes' } }
  })
  assert.equal(failed.status, 'failed')
  assert.equal(titles(failed)[1], '失敗原因', 'the reason stays directly under the result')
  assert.equal(countTitle(failed, PATCH_TITLE), 1)

  const refused = buildAgentResultView({
    approvalId: 'a1',
    facts: { allowedFiles: [HOUSE], timeoutSec: 120, costCapUsd: 0.5 },
    result: { ok: false, error: 'refuse: not_a_work_request', output: { risks: [], warnings: [] } }
  })
  assert.equal(refused.status, 'refused')
  assert.equal(countTitle(refused, PATCH_TITLE), 0, 'a refusal produced no patch, so it says nothing about one')
})
