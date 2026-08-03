'use strict'

/**
 * ownerApproval.test.js — the MANDATORY PROOF matrix for the server-authoritative Owner
 * approval card.
 *
 * Owner's non-negotiable principle under test: the browser expresses INTENT; it is NEVER
 * the authority source for a Work Order. Execution content comes from the server's sealed
 * record, never from a browser round-trip.
 *
 * Every test below drives the REAL app over HTTP (a real loopback listener, so the socket
 * peer and the headers are genuine) with an INJECTED FAKE agent runner. Nothing real is
 * ever executed: the fake runner only records what it was handed.
 */

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

const { createApp } = require('../app')
const { hashWorkOrder } = require('../agent/workOrder')
const { buildApprovalView } = require('../agent/workOrderView')

const ORIGIN = 'http://127.0.0.1:8090'
const GOOD_HEADERS = { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }

/* ── harness ──────────────────────────────────────────────────────────────── */

function startApp (extra = {}) {
  const runs = []
  const fakeRunner = { run: async (a) => { runs.push(a); return { ok: true, output: { diff: '' } } } }
  const app = createApp(Object.assign({
    runPersistence: false,
    proposalPersistence: false,
    serviceToken: 'test-token',
    agentRunner: fakeRunner,
    workerDeps: { artifactStore: null, runner: null }
  }, extra))
  const server = http.createServer(app)
  return new Promise((resolve) => {
    // Bind 127.0.0.1 so the socket peer is genuinely loopback, then rewrite Host to the
    // expected 127.0.0.1:8090 (the guard checks the header, not the ephemeral port).
    server.listen(0, '127.0.0.1', () => resolve({ app, server, runs, port: server.address().port }))
  })
}

/** Raw request so we control Host / Origin / Sec-Fetch-Site / method / cookie exactly. */
function req (ctx, { method = 'POST', url, headers = {}, body, host = '127.0.0.1:8090' }) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
  const h = Object.assign({}, headers)
  if (payload) h['content-length'] = String(payload.length)
  if (host !== null) h.host = host
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: ctx.port, method, path: url, headers: h, setHost: false }, (res) => {
      let raw = ''
      res.on('data', (d) => { raw += d })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(raw) } catch { /* non-JSON is a valid outcome to assert on */ }
        resolve({ status: res.statusCode, json, raw, headers: res.headers })
      })
    })
    r.on('error', reject)
    if (payload) r.write(payload)
    r.end()
  })
}

function cookieOf (res) {
  const sc = res.headers['set-cookie']
  if (!sc) return null
  return String(sc[0]).split(';')[0] // aroma_owner_sid=...
}

function seedProposal (ctx) {
  // A confirmable Proposal, created through the store the app actually uses. A bridge
  // proposal must reach linkState 'ready' before confirm will accept it (B2-7).
  const store = ctx.app.locals.proposalStore
  const p = store.createBridgeProposal({ task: 'fix the approval card wording', sourceTaskId: 'task_' + crypto.randomBytes(6).toString('hex') })
  store.setLinkState(p.id, 'ready')
  return p.id
}

/** Seal a Work Order the way the page does, returning the sealed card + session cookie. */
async function seal (ctx, over = {}) {
  // A Work Order is always bound to a real, pending Proposal — the chat lane's output.
  const proposalId = over.proposalId !== undefined ? over.proposalId : seedProposal(ctx)
  const res = await req(ctx, {
    url: '/api/v1/owner/work-orders',
    headers: GOOD_HEADERS,
    body: Object.assign({
      goal: '修正 demo 頁的批准卡文字',
      candidateFile: 'src/demo/demoHtml.js',
      conversation: ['請幫我改 src/demo/demoHtml.js 的批准卡文字']
    }, over, { proposalId })
  })
  return { res, cookie: cookieOf(res), proposalId }
}

const approveBody = (sealedBody, over = {}) => Object.assign({
  approvalId: sealedBody.approvalId,
  workOrderHash: sealedBody.workOrderHash,
  nonce: sealedBody.nonce,
  typedConfirmation: 'EXECUTE'
}, over)

async function withApp (fn, extra) {
  const ctx = await startApp(extra)
  try { await fn(ctx) } finally { await new Promise((r) => ctx.server.close(r)) }
}

/* ── 1. the browser is NOT the authority source ───────────────────────────── */

test('a browser-supplied workOrder / allowedFiles / caps is REJECTED, not silently ignored', async () => {
  await withApp(async (ctx) => {
    const { res: sres, cookie } = await seal(ctx)
    assert.equal(sres.status, 201)

    const evil = {
      workOrder: { goal: 'x', allowedFiles: ['src/store/store.js'], timeoutSec: 99999, costCapUsd: 999, branch: 'main', approvalId: sres.json.approvalId },
      allowedFiles: ['src/store/store.js'],
      timeoutSec: 99999,
      costCapUsd: 999,
      branch: 'main',
      forbiddenActions: [],
      approvedHash: 'deadbeef',
      who: 'not-louie'
    }
    for (const [k, v] of Object.entries(evil)) {
      const r = await req(ctx, {
        url: '/api/v1/owner/approve',
        headers: Object.assign({ cookie }, GOOD_HEADERS),
        body: approveBody(sres.json, { [k]: v })
      })
      assert.equal(r.status, 400, 'field ' + k + ' must be refused')
      assert.equal(r.json.reason, 'forbidden_body_fields', 'field ' + k)
    }
    assert.equal(ctx.runs.length, 0, 'nothing was ever handed to the runner')
  })
})

test('what EXECUTES is the sealed record — the runner receives the server order, byte-for-byte', async () => {
  process.env.AGENT_BRIDGE = 'on'
  try {
    await withApp(async (ctx) => {
      const { res: sres, cookie } = await seal(ctx)
      const r = await req(ctx, {
        url: '/api/v1/owner/approve',
        headers: Object.assign({ cookie }, GOOD_HEADERS),
        body: approveBody(sres.json)
      })
      assert.equal(r.status, 201, JSON.stringify(r.json))
      assert.equal(r.json.dispatchStatus, 'agent_execute_accepted')
      await new Promise((res) => setImmediate(res)) // the hand-off is fire-and-forget

      assert.equal(ctx.runs.length, 1, 'EXACTLY ONE hand-off')
      const handed = ctx.runs[0]
      // the order handed over is the SEALED one, and its hash is the one displayed
      assert.equal(handed.approvedHash, sres.json.workOrderHash, 'hash = what the Owner saw')
      assert.equal(hashWorkOrder(handed.workOrder), sres.json.workOrderHash, 'order matches the hash')
      assert.equal(handed.workOrder.approvalId, sres.json.approvalId)
      assert.equal(handed.who, 'louie', 'owner comes from the server, never the browser')
      // and it is NOT anything the browser could have influenced
      assert.deepEqual(handed.workOrder.allowedFiles, ['src/demo/demoHtml.js'])
      assert.notEqual(handed.workOrder.branch, 'main')
    })
  } finally { delete process.env.AGENT_BRIDGE }
})

/* ── 2. WYSIWYA — the displayed hash is enforced ──────────────────────────── */

test('a hash that does not match what was displayed is refused (no execution)', async () => {
  process.env.AGENT_BRIDGE = 'on'
  try {
    await withApp(async (ctx) => {
      const { res: sres, cookie } = await seal(ctx)
      const r = await req(ctx, {
        url: '/api/v1/owner/approve',
        headers: Object.assign({ cookie }, GOOD_HEADERS),
        body: approveBody(sres.json, { workOrderHash: crypto.randomBytes(32).toString('hex') })
      })
      assert.equal(r.status, 403)
      assert.equal(r.json.reason, 'nonce_hash_mismatch', 'the nonce is BOUND to the displayed hash')
      assert.equal(ctx.runs.length, 0)
    })
  } finally { delete process.env.AGENT_BRIDGE }
})

test('the sealed record is WRITE-ONCE — it cannot be amended after the Owner has seen it', async () => {
  const { createOwnerApprovalStore } = require('../agent/ownerApprovalStore')
  const store = createOwnerApprovalStore()
  const wo = { approvalId: 'a1', goal: 'g', allowedFiles: ['src/app.js'] }
  assert.equal(store.seal({ workOrder: wo }).ok, true)
  const second = store.seal({ workOrder: { approvalId: 'a1', goal: 'TAMPERED', allowedFiles: ['src/store/store.js'] } })
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'already_sealed')
  assert.equal(store.loadSealed('a1').record.workOrder.goal, 'g', 'the original survives')
  // and there is no update/patch/amend seam at all
  assert.deepEqual(Object.keys(store).filter((k) => /update|patch|amend|set|delete|mutate/i.test(k)), [])
})

/* ── 3. the nonce: single-use, bound, and burnt on every outcome ───────────── */

test('nonce is single-use: replay, double-click and reload all fail after the first use', async () => {
  process.env.AGENT_BRIDGE = 'on'
  try {
    await withApp(async (ctx) => {
      const { res: sres, cookie } = await seal(ctx)
      const h = Object.assign({ cookie }, GOOD_HEADERS)

      const first = await req(ctx, { url: '/api/v1/owner/approve', headers: h, body: approveBody(sres.json) })
      assert.equal(first.status, 201)

      for (const label of ['replay', 'double-click', 'reload-and-resubmit']) {
        const again = await req(ctx, { url: '/api/v1/owner/approve', headers: h, body: approveBody(sres.json) })
        assert.equal(again.status, 403, label)
        assert.equal(again.json.reason, 'nonce_already_used', label)
      }
      await new Promise((res) => setImmediate(res))
      assert.equal(ctx.runs.length, 1, 'still exactly ONE hand-off after three replays')
    })
  } finally { delete process.env.AGENT_BRIDGE }
})

test('a FAILED attempt also burns the nonce — a refusal is not a free retry', async () => {
  await withApp(async (ctx) => {
    const { res: sres, cookie } = await seal(ctx)
    const h = Object.assign({ cookie }, GOOD_HEADERS)
    const bad = await req(ctx, { url: '/api/v1/owner/approve', headers: h, body: approveBody(sres.json, { typedConfirmation: 'execute' }) })
    assert.equal(bad.status, 400)
    assert.equal(bad.json.reason, 'typed_confirmation_mismatch')
    const retry = await req(ctx, { url: '/api/v1/owner/approve', headers: h, body: approveBody(sres.json) })
    assert.equal(retry.json.reason, 'nonce_already_used', 'the burnt nonce cannot be reused with a correct typing')
    assert.equal(ctx.runs.length, 0)
  })
})

test('a nonce from a DIFFERENT session cannot be used', async () => {
  await withApp(async (ctx) => {
    const a = await seal(ctx)
    const b = await seal(ctx) // separate seal → separate session cookie
    assert.notEqual(a.cookie, b.cookie, 'two distinct sessions')
    const r = await req(ctx, {
      url: '/api/v1/owner/approve',
      headers: Object.assign({ cookie: b.cookie }, GOOD_HEADERS), // B's session, A's nonce
      body: approveBody(a.res.json)
    })
    assert.equal(r.status, 403)
    assert.equal(r.json.reason, 'nonce_session_mismatch')
    assert.equal(ctx.runs.length, 0)
  })
})

test('no session cookie at all ⇒ refused', async () => {
  await withApp(async (ctx) => {
    const { res: sres } = await seal(ctx)
    const r = await req(ctx, { url: '/api/v1/owner/approve', headers: GOOD_HEADERS, body: approveBody(sres.json) })
    assert.equal(r.status, 403)
    assert.equal(r.json.reason, 'no_session')
  })
})

/* ── 4. CSRF / transport bar ──────────────────────────────────────────────── */

test('CSRF matrix: method, Origin, Host and Sec-Fetch-Site are ALL enforced, fail-closed', async () => {
  await withApp(async (ctx) => {
    const { res: sres, cookie } = await seal(ctx)
    const base = Object.assign({ cookie }, GOOD_HEADERS)
    const body = approveBody(sres.json)

    const cases = [
      ['GET instead of POST', { method: 'GET', headers: base }, 403],
      ['no Origin', { headers: omit(base, 'origin') }, 403],
      ['cross-site Origin', { headers: Object.assign({}, base, { origin: 'https://evil.example' }) }, 403],
      ['http://localhost:8090 (not the exact expected origin)', { headers: Object.assign({}, base, { origin: 'http://localhost:8090' }) }, 403],
      ['wrong Host', { headers: base, host: 'evil.example' }, 403],
      ['no Sec-Fetch-Site (absent ⇒ refuse)', { headers: omit(base, 'sec-fetch-site') }, 403],
      ['Sec-Fetch-Site: cross-site', { headers: Object.assign({}, base, { 'sec-fetch-site': 'cross-site' }) }, 403],
      ['Sec-Fetch-Site: same-site (still not same-origin)', { headers: Object.assign({}, base, { 'sec-fetch-site': 'same-site' }) }, 403],
      ['Sec-Fetch-Site: none (address-bar navigation)', { headers: Object.assign({}, base, { 'sec-fetch-site': 'none' }) }, 403]
    ]
    for (const [label, over, want] of cases) {
      const r = await req(ctx, Object.assign({ url: '/api/v1/owner/approve', body }, over))
      assert.equal(r.status, want, label + ' → expected ' + want + ', got ' + r.status)
    }
    // the nonce was never consumed by any of them, so the legitimate approval still works
    const ok = await req(ctx, { url: '/api/v1/owner/approve', headers: base, body })
    assert.equal(ok.status, 201, 'the transport bar refuses BEFORE consuming the nonce')
    assert.equal(ctx.runs.length, 0, 'AGENT_BRIDGE is OFF here, so still zero execution')
  })
})

test('no CORS header is ever emitted, and the session cookie is HttpOnly + SameSite=Strict', async () => {
  await withApp(async (ctx) => {
    const { res } = await seal(ctx)
    for (const h of Object.keys(res.headers)) {
      assert.ok(!/^access-control-/i.test(h), 'no CORS header: ' + h)
    }
    const sc = String(res.headers['set-cookie'][0])
    assert.match(sc, /HttpOnly/)
    assert.match(sc, /SameSite=Strict/)
    assert.match(sc, /^aroma_owner_sid=/)
  })
})

function omit (obj, key) { const o = Object.assign({}, obj); delete o[key]; return o }

/* ── 5. typed confirmation is verified SERVER-SIDE ────────────────────────── */

test('the typed confirmation is checked on the SERVER — every near-miss is refused', async () => {
  process.env.AGENT_BRIDGE = 'on'
  try {
    await withApp(async (ctx) => {
      for (const typed of ['execute', 'EXECUTE ', ' EXECUTE', 'EXEC', '', null, undefined, 'YES', 'EXECUTE\n', true, 1]) {
        const { res: sres, cookie } = await seal(ctx)
        const r = await req(ctx, {
          url: '/api/v1/owner/approve',
          headers: Object.assign({ cookie }, GOOD_HEADERS),
          body: approveBody(sres.json, { typedConfirmation: typed })
        })
        assert.equal(r.status, 400, 'typed=' + JSON.stringify(typed))
        assert.equal(r.json.reason, 'typed_confirmation_mismatch', 'typed=' + JSON.stringify(typed))
      }
      await new Promise((res) => setImmediate(res))
      assert.equal(ctx.runs.length, 0, 'zero execution across every near-miss')
    })
  } finally { delete process.env.AGENT_BRIDGE }
})

/* ── 6. TTL — an abandoned tab cannot be approved later ───────────────────── */

test('an EXPIRED sealed record + nonce cannot be approved', async () => {
  process.env.AGENT_BRIDGE = 'on'
  try {
    let clock = 1_000_000
    await withApp(async (ctx) => {
      const { res: sres, cookie } = await seal(ctx)
      clock += 10 * 60 * 1000 + 1 // just past APPROVAL_TTL_MS
      const r = await req(ctx, {
        url: '/api/v1/owner/approve',
        headers: Object.assign({ cookie }, GOOD_HEADERS),
        body: approveBody(sres.json)
      })
      assert.equal(r.status, 403)
      assert.equal(r.json.reason, 'nonce_expired', 'the nonce expires WITH the order')
      assert.equal(ctx.runs.length, 0)
    }, { ownerApprovalStoreOptions: { now: () => clock, sessionTtlMs: 60 * 60 * 1000 } })
  } finally { delete process.env.AGENT_BRIDGE }
})

/* ── 7. ONE shared confirm service — both entry points ────────────────────── */

test('both entry points reach the runner through the SAME service (one hash check, one gate)', async () => {
  process.env.AGENT_BRIDGE = 'on'
  try {
    await withApp(async (ctx) => {
      // (a) local Owner card
      const { res: sres, cookie } = await seal(ctx)
      const viaCard = await req(ctx, { url: '/api/v1/owner/approve', headers: Object.assign({ cookie }, GOOD_HEADERS), body: approveBody(sres.json) })
      assert.equal(viaCard.status, 201)
      assert.equal(viaCard.json.dispatchStatus, 'agent_execute_accepted')

      // (b) Bearer machine entry, with the SAME sealed order
      const sealedOrder = ctx.app.locals.ownerApprovalStore.loadSealed(sres.json.approvalId).record.workOrder
      const pid = seedProposal(ctx)
      const viaToken = await req(ctx, {
        url: '/api/v1/proposals/' + pid + '/confirm',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
        body: { agentExecute: true, workOrder: sealedOrder, approvedWorkOrderHash: hashWorkOrder(sealedOrder) }
      })
      assert.equal(viaToken.status, 201)
      assert.equal(viaToken.json.dispatchStatus, 'agent_execute_accepted', 'identical decision from the shared service')
      await new Promise((res) => setImmediate(res))

      assert.equal(ctx.runs.length, 2, 'one hand-off per entry point, both through the one service')
      assert.equal(ctx.runs[0].approvedHash, ctx.runs[1].approvedHash, 'the same hash check for both')
      assert.equal(ctx.runs[0].who, ctx.runs[1].who, 'the same server-resolved owner for both')
    })
  } finally { delete process.env.AGENT_BRIDGE }
})

test('the Bearer confirm route has NO confirm logic of its own — it only calls the service', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
  const m = src.match(/router\.post\('\/proposals\/:id\/confirm'[\s\S]*?\n  \}\)/)
  assert.ok(m, 'the confirm route was found')
  const handler = m[0]
  assert.ok(handler.includes('confirmService.confirmProposalAction('), 'delegates to the shared service')
  // none of the duplicated decision logic may survive in the route
  for (const dup of ['agentRunner.run(', 'scheduleWorker(', 'dispatchStatus =', 'agentBridgeAuthorized', 'proposalStore.confirmProposal(']) {
    assert.ok(!handler.includes(dup), 'the route must not re-implement: ' + dup)
  }
})

test('the server never self-HTTPs and HUB_TOKEN never reaches the browser', async () => {
  const svc = fs.readFileSync(path.join(__dirname, '..', 'agent', 'confirmService.js'), 'utf8')
  const owner = fs.readFileSync(path.join(__dirname, 'ownerApprovalRouter.js'), 'utf8')
  const { DEMO_HTML } = require('../demo/demoHtml')
  // Comment lines are documentation, not behaviour — strip them before scanning, so a
  // doc line that NAMES the token is not mistaken for a read of it.
  const codeOnly = (src) => src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  for (const [name, src] of [['confirmService', codeOnly(svc)], ['ownerApprovalRouter', codeOnly(owner)]]) {
    assert.ok(!/HUB_TOKEN/.test(src), name + ' must not read HUB_TOKEN')
    assert.ok(!/require\('axios'\)|fetch\(|http\.request\(|https\.request\(/.test(src), name + ' must not make an HTTP call')
  }
  assert.ok(!/HUB_TOKEN|Bearer|Authorization/i.test(DEMO_HTML), 'the page carries no token')

  // and no response from either owner endpoint may contain a token-shaped value
  await withApp(async (ctx) => {
    const { res } = await seal(ctx)
    assert.ok(!/HUB_TOKEN|Bearer /i.test(res.raw), 'the sealed card response carries no token')
    assert.ok(!('authorization' in res.headers), 'no Authorization echoed back')
  })
})

/* ── 8. still NOT executable: AGENT_BRIDGE OFF is byte-identical ───────────── */

test('with AGENT_BRIDGE OFF a fully correct approval confirms but executes NOTHING', async () => {
  delete process.env.AGENT_BRIDGE
  await withApp(async (ctx) => {
    const { res: sres, cookie } = await seal(ctx)
    const r = await req(ctx, { url: '/api/v1/owner/approve', headers: Object.assign({ cookie }, GOOD_HEADERS), body: approveBody(sres.json) })
    assert.equal(r.status, 201)
    assert.equal(r.json.dispatchStatus, 'agent_execute_not_authorized', 'honest: approved, NOT dispatched')
    assert.equal(r.json.proposalStatus, 'confirmed')
    await new Promise((res) => setImmediate(res))
    assert.equal(ctx.runs.length, 0, 'ZERO execution with the flag off')
  })
})

test('an ORDINARY confirm (no EXECUTE triple) can never start the agent, even with the flag on', async () => {
  process.env.AGENT_BRIDGE = 'on'
  try {
    await withApp(async (ctx) => {
      const pid = seedProposal(ctx)
      const r = await req(ctx, {
        url: '/api/v1/proposals/' + pid + '/confirm',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
        body: {}
      })
      assert.equal(r.status, 201)
      assert.equal(r.json.dispatchStatus, 'not_authorized')
      await new Promise((res) => setImmediate(res))
      assert.equal(ctx.runs.length, 0)
    })
  } finally { delete process.env.AGENT_BRIDGE }
})

/* ── 9. every attempt is audited ───────────────────────────────────────────── */

test('EVERY approval attempt is audited — accepted, refused and expired alike', async () => {
  process.env.AGENT_BRIDGE = 'on'
  try {
    await withApp(async (ctx) => {
      const audit = () => ctx.app.locals.approvalAuditLog
      const { res: sres, cookie } = await seal(ctx)
      const h = Object.assign({ cookie }, GOOD_HEADERS)

      await req(ctx, { url: '/api/v1/owner/approve', headers: omit(h, 'origin'), body: approveBody(sres.json) }) // refused
      await req(ctx, { url: '/api/v1/owner/approve', headers: h, body: approveBody(sres.json) }) // accepted
      await req(ctx, { url: '/api/v1/owner/approve', headers: h, body: approveBody(sres.json) }) // replay

      const log = audit()
      const outcomes = log.map((e) => e.outcome)
      assert.ok(outcomes.includes('sealed'), 'the seal is recorded')
      assert.ok(outcomes.includes('refused'), 'refusals are recorded')
      assert.ok(outcomes.includes('handed_off'), 'the hand-off is recorded')
      assert.ok(outcomes.includes('approved'), 'the approval is recorded')
      assert.ok(log.every((e) => e.entryPoint && e.at), 'every entry names its entry point and time')
      // reasons are enums/ids only — never content, never a secret
      const blob = JSON.stringify(log)
      assert.ok(!/HUB_TOKEN|Bearer|sk-|cookie/i.test(blob), 'the audit trail carries no secret')
      assert.ok(!/demoHtml\.js/.test(blob), 'the audit trail carries no Work Order content')
    })
  } finally { delete process.env.AGENT_BRIDGE }
})

/* ── 10. the sealed order still obeys the Allowed Files governance contract ── */

test('the seal endpoint refuses a forbidden file and a multi-file request — no card is issued', async () => {
  await withApp(async (ctx) => {
    for (const candidate of ['src/store/store.js', 'src/agent/*.js', 'src/app.js src/index.js', '../../etc/passwd', '']) {
      const { res } = await seal(ctx, { candidateFile: candidate, conversation: ['請改 ' + candidate] })
      assert.equal(res.status, 422, 'candidate=' + JSON.stringify(candidate))
      assert.equal(res.json.error, 'work_order_rejected')
      assert.ok(!res.json.approvalId, 'no approvalId is minted for a rejected order')
    }
  })
})

test('a Work Order cannot be sealed without a real, pending Proposal', async () => {
  await withApp(async (ctx) => {
    // entirely absent from the body
    const absent = await req(ctx, {
      url: '/api/v1/owner/work-orders',
      headers: GOOD_HEADERS,
      body: { goal: 'g', candidateFile: 'src/app.js', conversation: ['改 src/app.js'] }
    })
    assert.equal(absent.status, 404, 'no proposalId at all')
    assert.equal(absent.json.reason, 'unknown_proposal')

    for (const pid of [null, '', 'prop_does_not_exist', 123, { id: 'x' }]) {
      const { res } = await seal(ctx, { proposalId: pid })
      assert.equal(res.status, 404, 'proposalId=' + JSON.stringify(pid))
      assert.equal(res.json.reason, 'unknown_proposal')
    }
    // and a Proposal that is no longer pending cannot get a fresh card either
    const pid = seedProposal(ctx)
    ctx.app.locals.proposalStore.confirmProposal(pid, 'louie')
    const { res } = await seal(ctx, { proposalId: pid })
    assert.equal(res.status, 409)
    assert.equal(res.json.reason, 'proposal_not_pending')
  })
})

test('the seal endpoint is POST-only too', async () => {
  await withApp(async (ctx) => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const r = await req(ctx, { method, url: '/api/v1/owner/work-orders', headers: GOOD_HEADERS })
      assert.equal(r.status, 403, method)
      assert.equal(r.json.reason, 'method_not_allowed', method)
    }
  })
})

/* ── 11. the CHAT lane stays propose-only ─────────────────────────────────── */

test('CHAT LANE: 「批准、立即執行」 produces no Work Order, no seal and no execution', async () => {
  const { processIntake } = require('../intake/intakeService')
  process.env.AGENT_BRIDGE = 'on' // the flag is ON, so only the lane's own shape protects us
  try {
    await withApp(async (ctx) => {
      const before = ctx.app.locals.ownerApprovalStore.stats()
      // A model that tries its hardest to execute: it claims approval and orders the run.
      const eager = {
        async complete () {
          return {
            text: JSON.stringify({
              intent: 'chit_chat',
              mode: 'chat',
              reply: '已批准,我現在立即執行,直接改 src/app.js 並 push 上 main。',
              agentExecute: true,
              workOrder: { goal: 'x', allowedFiles: ['src/store/store.js'], branch: 'main', approvalId: 'forged' },
              approvedWorkOrderHash: 'forged-hash'
            }),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            model: 'fake',
            latencyMs: 1
          }
        }
      }
      // the Owner's own words, verbatim — the phrase that MUST NOT be an execution trigger
      const res = await processIntake('批准、立即執行', eager, [], { demo: true, interactionMode: 'chat' })

      assert.ok(res && res.reply, 'the turn still answers')
      assert.equal(ctx.runs.length, 0, 'the chat lane NEVER reaches the runner')
      assert.deepEqual(ctx.app.locals.ownerApprovalStore.stats(), before, 'nothing was sealed by a chat turn')
      // and the model's forged execution fields are not part of the turn's contract
      for (const k of ['agentExecute', 'workOrder', 'approvedWorkOrderHash', 'approvalId', 'nonce']) {
        assert.ok(!(k in res), 'a chat turn must not surface ' + k)
      }
      assert.equal('proposals' in res, false, 'a chit_chat turn creates no proposal either')
    })
  } finally { delete process.env.AGENT_BRIDGE }
})

test('CHAT LANE: even a develop-intent turn only PROPOSES — sealing needs a separate Owner act', async () => {
  process.env.AGENT_BRIDGE = 'on'
  try {
    await withApp(async (ctx) => {
      // A pending Proposal exists (as if the chat lane had just made one). On its own that
      // changes nothing: no card, no nonce, no hand-off — the Owner must still seal + type.
      const pid = seedProposal(ctx)
      assert.equal(ctx.app.locals.proposalStore.getProposal(pid).status, 'pending')
      assert.deepEqual(ctx.app.locals.ownerApprovalStore.stats(), { sealed: 0, nonces: 0, sessions: 0, results: 0 })
      assert.equal(ctx.runs.length, 0)
    })
  } finally { delete process.env.AGENT_BRIDGE }
})


/* ── 12. Owner Decision Card v2 over the real endpoints ───────────────────── */

const CANARY_FILE = 'docs/canary/agent-canary.md'

async function sealCanary (ctx, over = {}) {
  const proposalId = over.proposalId !== undefined ? over.proposalId : seedProposal(ctx)
  const res = await req(ctx, {
    url: '/api/v1/owner/work-orders',
    headers: GOOD_HEADERS,
    body: Object.assign({
      goal: 'Title: 改 canary 檔\n\nDetails: 由 line 1 改成 line 2',
      candidateFile: CANARY_FILE,
      intendedChange: 'canary target — safe to modify. line 2.',
      conversation: ['請改 ' + CANARY_FILE + ' 一行文字']
    }, over, { proposalId })
  })
  return { res, cookie: cookieOf(res), proposalId }
}

test('v2: the sealed response carries the Owner card, and it matches the sealed order', async () => {
  await withApp(async (ctx) => {
    const { res } = await sealCanary(ctx)
    assert.equal(res.status, 201, JSON.stringify(res.json))
    const b = res.json
    // The face carries the three facts the decision needs; everything else is collapsed
    // but still delivered, so the browser never has to ask for a second payload.
    assert.equal(b.card.heading, '香香想改一個檔案')
    assert.equal(b.card.sections.length, 3)
    assert.ok(b.card.details.some((d) => d.title === '影響範圍'), 'the rest still travels, collapsed')

    // WYSIWYA over HTTP: rebuild the view from the SEALED record and compare byte-for-byte
    const sealed = ctx.app.locals.ownerApprovalStore.loadSealed(b.approvalId).record.workOrder
    const view = buildApprovalView(sealed)
    assert.deepEqual(b.card, view.card, 'the card the browser got IS the projection of the sealed order')
    assert.deepEqual(b.technicalLines, view.technicalLines)
    assert.equal(b.workOrderHash, view.hash)
    assert.equal(hashWorkOrder(sealed), b.workOrderHash)

    // the TTL the Owner reads is the TTL that is actually enforced
    assert.equal(sealed.approvalTtlSec, b.expiresInSec)
    assert.ok(b.technicalLines.join('\n').includes('10 分鐘'))

    // the goal was normalized at seal time — no brief structure reaches the Owner
    assert.ok(!/Title:|Details:/.test(JSON.stringify(b.card)), 'no worker-brief structure on the card')
    assert.equal(sealed.goal, '改 canary 檔（由 line 1 改成 line 2）')

    // 現時內容 is the real file
    const real = fs.readFileSync(path.join(__dirname, '..', '..', CANARY_FILE), 'utf8').replace(/\r\n/g, '\n')
    assert.ok(real.startsWith(sealed.currentExcerpt.split('\n')[0]), 'the excerpt is the real file head')
  })
})

test('v2: a non-existent file is REFUSED at seal — no card, no approvalId', async () => {
  await withApp(async (ctx) => {
    const { res } = await sealCanary(ctx, {
      candidateFile: 'docs/canary/not-here.md',
      conversation: ['請改 docs/canary/not-here.md']
    })
    assert.equal(res.status, 422)
    assert.equal(res.json.error, 'work_order_rejected')
    assert.ok(res.json.reasonForOwner.includes('不存在'))
    assert.ok(!res.json.approvalId)
    assert.equal(ctx.app.locals.ownerApprovalStore.stats().sealed, 0, 'nothing was sealed')
  })
})

test('v2: approving still carries only four fields, and the card adds no new authority', async () => {
  process.env.AGENT_BRIDGE = 'on'
  try {
    await withApp(async (ctx) => {
      const { res: sres, cookie } = await sealCanary(ctx)
      // the collapsed section is presentation: sending its values back is still a protocol error
      const withTech = await req(ctx, {
        url: '/api/v1/owner/approve',
        headers: Object.assign({ cookie }, GOOD_HEADERS),
        body: approveBody(sres.json, { branch: 'main', timeoutSec: 999 })
      })
      assert.equal(withTech.status, 400)
      assert.equal(withTech.json.reason, 'forbidden_body_fields')

      const ok = await req(ctx, {
        url: '/api/v1/owner/approve',
        headers: Object.assign({ cookie }, GOOD_HEADERS),
        body: approveBody(sres.json)
      })
      assert.equal(ok.status, 201)
      await new Promise((r) => setImmediate(r))
      assert.equal(ctx.runs.length, 1)
      // what the runner got is the sealed order, including the v2 fields
      assert.equal(ctx.runs[0].workOrder.currentExcerpt != null, true)
      assert.equal(ctx.runs[0].approvedHash, sres.json.workOrderHash)
    })
  } finally { delete process.env.AGENT_BRIDGE }
})

/* ── 13. Layer 2 — the result view over HTTP (read-only) ──────────────────── */

test('LAYER 2: the result view reports the runner outcome, and is a pure read', async () => {
  process.env.AGENT_BRIDGE = 'on'
  try {
    await withApp(async (ctx) => {
      const { res: sres, cookie } = await sealCanary(ctx)
      const id = sres.json.approvalId

      // before anything runs there is honestly no result
      const before = await req(ctx, { method: 'GET', url: '/api/v1/owner/results/' + id, headers: GOOD_HEADERS })
      assert.equal(before.status, 404)
      assert.equal(before.json.error, 'no_result')

      await req(ctx, { url: '/api/v1/owner/approve', headers: Object.assign({ cookie }, GOOD_HEADERS), body: approveBody(sres.json) })
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)) // fire-and-forget chain

      const after = await req(ctx, { method: 'GET', url: '/api/v1/owner/results/' + id, headers: GOOD_HEADERS })
      assert.equal(after.status, 200)
      assert.equal(after.json.status, 'done')
      assert.ok(after.json.lines.join('\n').includes('完全沒有被改動'), 'the real repo is stated untouched')

      // reading it again changes nothing and never re-runs
      const again = await req(ctx, { method: 'GET', url: '/api/v1/owner/results/' + id, headers: GOOD_HEADERS })
      assert.deepEqual(again.json, after.json)
      assert.equal(ctx.runs.length, 1, 'reading a result never triggers another run')
    })
  } finally { delete process.env.AGENT_BRIDGE }
})

test('LAYER 2: with AGENT_BRIDGE OFF a correct approval produces NO result at all', async () => {
  delete process.env.AGENT_BRIDGE
  await withApp(async (ctx) => {
    const { res: sres, cookie } = await sealCanary(ctx)
    const ok = await req(ctx, { url: '/api/v1/owner/approve', headers: Object.assign({ cookie }, GOOD_HEADERS), body: approveBody(sres.json) })
    assert.equal(ok.json.dispatchStatus, 'agent_execute_not_authorized')
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
    const r = await req(ctx, { method: 'GET', url: '/api/v1/owner/results/' + sres.json.approvalId, headers: GOOD_HEADERS })
    assert.equal(r.status, 404, 'nothing ran, so there is nothing to show')
    assert.equal(ctx.runs.length, 0)
  })
})

test('LAYER 2: a result is write-once and the route is loopback + same-origin bound', async () => {
  const { createOwnerApprovalStore } = require('../agent/ownerApprovalStore')
  const s = createOwnerApprovalStore()
  assert.equal(s.recordResult('a1', { ok: true }).ok, true)
  assert.equal(s.recordResult('a1', { ok: false }).reason, 'already_recorded', 'a read result is never replaced')
  assert.equal(s.getResult('a1').record.result.ok, true)
  assert.equal(s.getResult('nope').reason, 'no_result')

  await withApp(async (ctx) => {
    const r = await req(ctx, {
      method: 'GET',
      url: '/api/v1/owner/results/anything',
      headers: Object.assign({}, GOOD_HEADERS, { 'sec-fetch-site': 'cross-site' })
    })
    assert.equal(r.status, 403)
    assert.equal(r.json.reason, 'bad_sec_fetch_site')
  })
})
