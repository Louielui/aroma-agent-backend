'use strict'

/**
 * readOnlyEnquiryLane.test.js — the lane, driven through the REAL HTTP approval route.
 *
 * ⛔ NOTHING IS SHORT-CIRCUITED. Every request goes to `POST /api/v1/owner/approve` on a real
 * server: real transport guards, real session cookie, real single-use nonce, real typed
 * confirmation, real sealed order and hash, the real confirm service, the real authorization
 * matrix, the real Run ledger claim, the real enquiry runner, report builder, citation checker
 * and enquiry store — and the result is read back through the real
 * `GET /api/v1/demo/enquiries/:id`.
 *
 * The ONLY substitutions are the two boundaries this chapter is forbidden to cross: the model
 * process (`worker.dispatch`) and the source of the approved revision (`sourceProvider`).
 */

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const { createApp } = require('../app')
const { hashWorkOrder } = require('../agent/workOrder')

const ORIGIN = 'http://127.0.0.1:8090'
const GOOD = { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }

/* ── harness (same shape as ownerApproval.test.js) ────────────────────────── */

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
        try { json = JSON.parse(raw) } catch { /* asserting on non-JSON is valid */ }
        resolve({ status: res.statusCode, json, raw, headers: res.headers })
      })
    })
    r.on('error', reject)
    if (payload) r.write(payload)
    r.end()
  })
}
const cookieOf = (res) => { const sc = res.headers['set-cookie']; return sc ? String(sc[0]).split(';')[0] : null }

/** A source provider that materialises the approved file. Counts its calls. */
function sourceProvider (spy = {}, opts = {}) {
  return async ({ dir, allowedFiles }) => {
    spy.sourceCalls = (spy.sourceCalls || 0) + 1
    if (opts.throws) throw new Error('cannot reach the repository')
    if (opts.refuses) return { ok: false, reason: 'sha_not_found' }
    for (const rel of allowedFiles) {
      const abs = path.join(dir, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, '// line 1\nconst TIMEOUT = 0\nmodule.exports = { TIMEOUT }\n', 'utf8')
    }
    return { ok: true, fileCount: allowedFiles.length }
  }
}

const okReply = async () => ({
  sessionId: 's1',
  payload: {
    answer: 'The timeout is declared in src/agent/enquiryStore.js and defaults to 0.',
    citations: [
      { path: 'src/agent/enquiryStore.js', startLine: 2, endLine: 2, quote: 'const TIMEOUT = 0' },
      { path: 'src/agent/enquiryStore.js', startLine: 1, endLine: 1, quote: 'not present anywhere' }
    ],
    notEstablished: ['Runtime behaviour was not observed.']
  },
  answer: 'The timeout is declared in src/agent/enquiryStore.js and defaults to 0.',
  citations: [
    { path: 'src/agent/enquiryStore.js', status: 'CONFIRMED', startLine: 2, endLine: 2 },
    { path: 'src/agent/enquiryStore.js', status: 'QUOTE_MISMATCH', detail: 'the quoted text is not present at the cited lines' }
  ],
  evidence: [{ source: 'disposable-copy:src/agent/enquiryStore.js', readState: 'OK' }],
  notEstablished: ['Runtime behaviour was not observed.'],
  termination: { terminationRequested: false, killIssued: 'NOT_REQUESTED', directChildExited: true },
  costUsd: 0.12,
  numTurns: 4
})

/** Start the real app with the flag on and only the two boundaries faked. */
function startApp (over = {}) {
  const spy = { dispatches: 0, workers: 0 }
  const enquiryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-store-'))
  const prev = process.env.READONLY_ENQUIRY
  process.env.READONLY_ENQUIRY = over.flag === undefined ? 'on' : over.flag
  if (over.agentBridge) process.env.AGENT_BRIDGE = over.agentBridge
  const app = createApp(Object.assign({
    runPersistence: false,
    proposalPersistence: false,
    serviceToken: 'test-token',
    workerDeps: { artifactStore: null, runner: null },
    enquirySourceProvider: over.sourceProvider || sourceProvider(spy),
    enquiryStoreDir: enquiryDir,
    enquiryStore: over.enquiryStore,
    // injected like agentRunner: the model process is the only thing faked
    enquiryWorkerFactory: (o) => {
      spy.workers++
      spy.cwd = o.cwd
      spy.maxTurns = o.maxTurns
      spy.timeoutMs = o.timeoutMs
      if (over.workerThrows) throw new Error('worker refused to construct')
      return { dispatch: async (a) => { spy.dispatches++; spy.goal = a.goal; return (over.reply || okReply)(a) } }
    }
  }, over.appOpts || {}))
  const server = http.createServer(app)
  // ⛔ THE FLAGS STAY SET WHILE THE APP LIVES. resolveExecutionAuthorization reads them at USE
  // time, exactly like the other lanes, so restoring the environment before the approval would
  // silently test a different configuration from the one that was assembled.
  const restore = () => {
    process.env.READONLY_ENQUIRY = prev === undefined ? '' : prev
    if (over.agentBridge) delete process.env.AGENT_BRIDGE
  }
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ app, server, spy, enquiryDir, restore, port: server.address().port }))
  })
}

function seedProposal (ctx) {
  const store = ctx.app.locals.proposalStore
  const p = store.createBridgeProposal({
    repositoryIdentity: { projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' },
    task: 'where is the timeout decided?',
    sourceTaskId: 'task_' + crypto.randomBytes(6).toString('hex')
  })
  store.setLinkState(p.id, 'ready')
  return p.id
}

/** Seal a READ-ONLY order through the real seal route. */
async function seal (ctx, over = {}) {
  const proposalId = seedProposal(ctx)
  const res = await req(ctx, {
    url: '/api/v1/owner/work-orders',
    headers: GOOD,
    body: Object.assign({
      goal: 'Where is the request timeout decided, and what is its default?',
      candidateFile: 'src/agent/enquiryStore.js',
      taskKind: 'read_only_enquiry',
      conversation: ['where is the timeout decided in src/agent/enquiryStore.js?']
    }, over, { proposalId })
  })
  return { res, cookie: cookieOf(res), proposalId }
}

async function approve (ctx, sealed, over = {}) {
  const card = sealed.res.json
  return req(ctx, {
    url: '/api/v1/owner/approve',
    headers: Object.assign({}, GOOD, { cookie: sealed.cookie }),
    body: Object.assign({
      approvalId: card.approvalId,
      nonce: card.nonce,
      workOrderHash: card.workOrderHash,
      typedConfirmation: 'EXECUTE'
    }, over)
  })
}

const settle = () => new Promise((r) => setTimeout(r, 60))

/* ── the tests ────────────────────────────────────────────────────────────── */

test('the seal route can produce a read-only card, and taskKind is inside the hash', async () => {
  const ctx = await startApp()
  try {
    const s = await seal(ctx)
    assert.strictEqual(s.res.status, 201, JSON.stringify(s.res.json).slice(0, 300))
    // the hash the card shows must be the hash of an order whose taskKind is the read-only one
    assert.ok(s.res.json.workOrderHash, 'a card must carry a hash')
    // ⛔ the card must describe the grant it actually carries
    assert.match(s.res.json.card.heading, /讀|read/, 'a read-only card must not say 「想改」: ' + s.res.json.card.heading)
    assert.ok(!/想改一個檔案/.test(s.res.json.card.heading))
    assert.strictEqual(s.res.json.display.branch, null, 'a read-only order has no branch')
    assert.strictEqual(s.res.json.display.allowedTestCommand, null)
    assert.ok(s.res.json.approvalId)
  } finally { ctx.server.close(); ctx.restore() }
})

test('⛔ an UNCONFIRMED approval never runs — no typed confirmation, no dispatch', async () => {
  const ctx = await startApp()
  try {
    const s = await seal(ctx)
    const r = await approve(ctx, s, { typedConfirmation: 'GO' })
    assert.strictEqual(r.status, 400)
    assert.strictEqual(r.json.reason, 'typed_confirmation_mismatch')
    await settle()
    assert.strictEqual(ctx.spy.dispatches, 0, 'no model call')
    assert.strictEqual(ctx.spy.workers, 0, 'no worker constructed')
    assert.strictEqual(ctx.spy.sourceCalls, undefined, 'no source prepared')
  } finally { ctx.server.close(); ctx.restore() }
})

test('⛔ a REUSED nonce is refused, and the second attempt runs nothing', async () => {
  const ctx = await startApp()
  try {
    const s = await seal(ctx)
    const first = await approve(ctx, s)
    assert.strictEqual(first.status, 201, JSON.stringify(first.json))
    await settle()
    const before = ctx.spy.dispatches
    const second = await approve(ctx, s)
    assert.strictEqual(second.status, 403)
    assert.strictEqual(second.json.reason, 'nonce_already_used')
    await settle()
    assert.strictEqual(ctx.spy.dispatches, before, 'the replay must not dispatch again')
  } finally { ctx.server.close(); ctx.restore() }
})

test('⛔ CONCURRENT duplicate submits produce at most one dispatch', async () => {
  const ctx = await startApp()
  try {
    const s = await seal(ctx)
    const [a, b] = await Promise.all([approve(ctx, s), approve(ctx, s)])
    await settle()
    const accepted = [a, b].filter((r) => r.status === 201).length
    assert.strictEqual(accepted, 1, 'exactly one of the two may be accepted')
    assert.ok(ctx.spy.dispatches <= 1, 'at most one model call, got ' + ctx.spy.dispatches)
  } finally { ctx.server.close(); ctx.restore() }
})

test('⛔ a FLAG CONFLICT authorizes nothing — two lanes on means zero execution', async () => {
  const ctx = await startApp({ agentBridge: 'on' })
  try {
    const s = await seal(ctx)
    const r = await approve(ctx, s)
    assert.strictEqual(r.status, 201)
    assert.strictEqual(r.json.dispatchStatus, 'configuration_conflict')
    await settle()
    assert.strictEqual(ctx.spy.dispatches, 0)
    assert.strictEqual(ctx.spy.workers, 0)
    assert.strictEqual(ctx.spy.sourceCalls, undefined, 'not even the source is prepared')
  } finally { ctx.server.close(); ctx.restore() }
})

test('⛔ with the flag OFF the lane is not authorized and nothing is constructed', async () => {
  const ctx = await startApp({ flag: 'off' })
  try {
    assert.strictEqual(ctx.app.locals.readOnlyEnquiryService, null, 'no service is built at all')
    const s = await seal(ctx)
    const r = await approve(ctx, s)
    assert.strictEqual(r.json.dispatchStatus, 'read_only_enquiry_not_authorized')
    await settle()
    assert.strictEqual(ctx.spy.dispatches, 0)
  } finally { ctx.server.close(); ctx.restore() }
})

test('the TURN CAP is the service\'s fixed one — an order field cannot raise it', async () => {
  const ctx = await startApp()
  try {
    // maxTurns is not a Work Order field; sealing one must not carry it into the run
    const s = await seal(ctx, { maxTurns: 500 })
    await approve(ctx, s)
    await settle()
    assert.strictEqual(ctx.spy.maxTurns, 25, 'the service cap, not an unapproved number')
  } finally { ctx.server.close(); ctx.restore() }
})

test('a source that cannot be prepared stops the lane and still settles the card', async () => {
  for (const opts of [{ throws: true }, { refuses: true }]) {
    const spy = {}
    const ctx = await startApp({ sourceProvider: sourceProvider(spy, opts) })
    try {
      const s = await seal(ctx)
      const r = await approve(ctx, s)
      assert.strictEqual(r.json.dispatchStatus, 'read_only_enquiry_accepted')
      await settle()
      assert.strictEqual(ctx.spy.dispatches, 0, 'no model call when the source failed')
      const got = await req(ctx, { method: 'GET', url: '/api/v1/owner/results/' + s.res.json.approvalId, headers: {} })
      assert.strictEqual(got.status, 200, 'the card must answer, not hang in flight')
      assert.strictEqual(got.json.enquiry.saved, false, 'nothing was stored')
      assert.strictEqual(got.json.enquiry.saved, false)
      assert.ok(got.json.enquiry.stoppedAt, 'the phase it stopped at is recorded')
    } finally { ctx.server.close(); ctx.restore() }
  }
})

test('a worker that will not construct is contained the same way', async () => {
  const ctx = await startApp({ workerThrows: true })
  try {
    const s = await seal(ctx)
    await approve(ctx, s)
    await settle()
    assert.strictEqual(ctx.spy.dispatches, 0)
    const got = await req(ctx, { method: 'GET', url: '/api/v1/owner/results/' + s.res.json.approvalId, headers: {} })
    assert.strictEqual(got.json.enquiry.saved, false)
    assert.strictEqual(got.json.enquiry.reason, 'worker_construction_failed')
  } finally { ctx.server.close(); ctx.restore() }
})

test('⛔ a SAVE FAILURE is never reported as a delivery', async () => {
  // A store that cannot write, injected at the composition root exactly like agentRunner.
  // Everything else in the lane is the real thing.
  const brokenStore = { save () { throw new Error('disk is full') }, get: () => null, list: () => [] }
  const ctx = await startApp({ enquiryStore: brokenStore })
  try {
    const s = await seal(ctx)
    await approve(ctx, s)
    await settle()
    assert.strictEqual(ctx.spy.dispatches, 1, 'it did run')
    const got = await req(ctx, { method: 'GET', url: '/api/v1/owner/results/' + s.res.json.approvalId, headers: {} })
    const r = got.json.enquiry
    assert.ok(r, 'the card must carry the enquiry facts')
    assert.strictEqual(r.saved, false)
    assert.ok(r.saveError, 'the save failure is named')
    assert.strictEqual(r.enquiryId, null, '⛔ no id is offered that would resolve to nothing')
    assert.strictEqual(r.outcome, 'CONCLUDED', 'the enquiry outcome is reported separately and honestly')
  } finally { ctx.server.close(); ctx.restore() }
})

test('SUCCESS: one dispatch, and the same result reads back through the existing GET', async () => {
  const ctx = await startApp()
  try {
    ctx.app.locals.conversationDemo = true // the enquiry read surface is behind the demo guard
    const s = await seal(ctx)
    const r = await approve(ctx, s)
    assert.strictEqual(r.json.dispatchStatus, 'read_only_enquiry_accepted')
    await settle()
    assert.strictEqual(ctx.spy.dispatches, 1)

    const card = await req(ctx, { method: 'GET', url: '/api/v1/owner/results/' + s.res.json.approvalId, headers: {} })
    const res = card.json.enquiry
    assert.ok(res, 'the card carries the enquiry facts')
    assert.strictEqual(res.saved, true)
    assert.strictEqual(res.outcome, 'CONCLUDED')
    assert.strictEqual(res.verification.allConfirmed, false, '⛔ 1 of 2 confirmed is not 「all checked」')
    assert.ok(res.enquiryId)

    // the owner gate admits a caller presenting the service token; the demo guard is set above
    const back = await req(ctx, { method: 'GET', url: '/api/v1/demo/enquiries/' + res.enquiryId, headers: { authorization: 'Bearer test-token' } })
    assert.strictEqual(back.status, 200, JSON.stringify(back.json))
    const e = back.json.enquiry
    assert.strictEqual(e.enquiryId, res.enquiryId, 'the SAME result, by the id the card gave')
    assert.strictEqual(e.taskKind, 'read_only_enquiry')
    assert.strictEqual(e.question, 'Where is the request timeout decided, and what is its default?')
    assert.strictEqual(e.verification.cited, 2)
    assert.strictEqual(e.verification.confirmed, 1)
    assert.strictEqual(e.verification.allConfirmed, false)
    assert.ok(e.citations.some((c) => c.status === 'QUOTE_MISMATCH'), 'the unconfirmed one is kept and marked')
    assert.strictEqual(e.costUsd, 0.12)
    assert.strictEqual(e.costKnown, true)
    assert.strictEqual(e.limits.turnCapSource, 'service_fixed')
    assert.strictEqual(e.limits.costCapKind, 'pre_round_check_only')
  } finally { ctx.server.close(); ctx.restore() }
})
