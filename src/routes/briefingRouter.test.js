'use strict'

/**
 * briefingRouter.test.js — the route's own promises, exercised through a real Express app.
 *
 * These are the guarantees a reviewer would otherwise have to take on trust: that the
 * browser cannot steer a read, that pressing the button twice does not fan out twice,
 * that no write-shaped connector method exists to be called, and that the brief body
 * never reaches the audit store or the Conversation Archive.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const http = require('node:http')

const { createBriefingRouter } = require('./briefingRouter')
const { createBriefStore } = require('../coo/briefStore')
const { WRITE_RE, createReadConnector } = require('../context/readConnector')

const NOW = '2026-08-02T14:00:00.000Z'

function serve (router, before) {
  const app = express()
  app.use(express.json())
  if (before) app.use(before)
  app.use(router)
  return http.createServer(app)
}

function request (server, method, path) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
        let d = ''
        res.on('data', (c) => { d += c })
        res.on('end', () => {
          server.close()
          let body = null
          try { body = JSON.parse(d) } catch (_) { body = d }
          resolve({ status: res.statusCode, body })
        })
      })
      req.on('error', (e) => { server.close(); reject(e) })
      req.end()
    })
  })
}

/** A briefing builder double that records how many times it ran. */
function countingBuilder (counter, delayMs) {
  return async () => {
    counter.n++
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    return {
      brief: {
        briefId: 'brf_test01',
        schemaVersion: 1,
        generatedAt: { iso: NOW, display: 'Aug 02, 2026' },
        sections: {
          today: [{ id: 'i1', kind: 'fact', text: 'Dinner service prep', provenance: { source: 'calendar', sourceId: 'c1' }, basedOnFactIds: [] }],
          recentActivity: [], risks: [], topPriorities: [], decisionsNeeded: [],
          dataCoverage: [{ source: 'gmail', state: 'live', count: 1, error: null, usedFallback: false, retrievedAt: { iso: NOW } }]
        }
      },
      audit: {
        briefId: 'brf_test01', generatedAt: NOW, schemaVersion: 1,
        sourceStatuses: [{ source: 'gmail', state: 'live', count: 1 }],
        itemCounts: { today: 1 }, durationMs: 5, outcome: 'ok'
      }
    }
  }
}

function router (opts = {}) {
  return createBriefingRouter(Object.assign({
    buildConnector: () => ({ connector: { read: async () => ({ results: [] }) } }),
    listPendingProposals: async () => [],
    buildDecisionRecall: async () => ({ count: 0 }),
    // A NON-PERSISTING STORE, ALWAYS. Without this the router falls back to its
    // production default and the suite appends to the real audit file — which is exactly
    // what happened once, and an audit that a test run can write to is not an audit.
    briefStore: createBriefStore({ persist: false })
  }, opts))
}

/* ── 1. the page and the call ─────────────────────────────────────────────── */

test('*** GET /briefing serves one self-contained page ***', async () => {
  const res = await request(serve(router({ buildMorningBriefingFn: countingBuilder({ n: 0 }) })), 'GET', '/briefing')
  assert.equal(res.status, 200)
  assert.match(String(res.body), /Aroma Morning Briefing/)
  assert.match(String(res.body), /Generate Briefing/)
  // No external host may be referenced — the page must not fetch anything from anywhere.
  const external = (String(res.body).match(/(?:src|href)="https?:\/\/[^"]+"/g) || [])
  assert.deepEqual(external, [], 'the page loads nothing from off-origin: ' + external.join(', '))
})

test('*** the page shows the Aroma System gap in the Owner\'s words ***', async () => {
  const res = await request(serve(router({ buildMorningBriefingFn: countingBuilder({ n: 0 }) })), 'GET', '/briefing')
  assert.match(String(res.body), /Aroma System 未接線/, 'the gap is stated on the page itself')
})

test('*** POST generate returns a brief ***', async () => {
  const counter = { n: 0 }
  const res = await request(serve(router({ buildMorningBriefingFn: countingBuilder(counter) })), 'POST', '/api/v1/briefing/generate')
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.brief.briefId, 'brf_test01')
  assert.equal(counter.n, 1, 'one press, one build')
})

/* ── 2. one press, one brief ──────────────────────────────────────────────── */

test('*** two overlapping presses produce ONE build, not two ***', async () => {
  const counter = { n: 0 }
  const r = router({ buildMorningBriefingFn: countingBuilder(counter, 40) })
  const app = express()
  app.use(express.json())
  app.use(r)
  const server = http.createServer(app)

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const hit = () => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/v1/briefing/generate', method: 'POST' }, (res) => {
      let d = ''; res.on('data', (c) => { d += c }); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject); req.end()
  })

  const [a, b] = await Promise.all([hit(), hit()])
  server.close()

  assert.equal(counter.n, 1, 'the external sources were read ONCE, not twice')
  assert.equal(a.brief.briefId, b.brief.briefId, 'and both callers got the same brief')
  assert.ok(a.coalesced === true || b.coalesced === true, 'the second press is marked as coalesced')
})

/* ── 3. the browser cannot steer a read ───────────────────────────────────── */

test('*** the route exposes NO parameter naming a source, method or query ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, 'briefingRouter.js'), 'utf8')

  // Nothing from the request may reach the read layer.
  assert.equal(/req\.query/.test(src), false, 'no query parameter is read')
  assert.equal(/req\.params/.test(src), false, 'no path parameter is read')
  assert.equal(/req\.body/.test(src), false, 'and the POST body is never consulted')

  // And the page must not call the context routes itself.
  const page = fs.readFileSync(path.join(__dirname, '..', 'demo', 'assets', 'briefing.js'), 'utf8')
  assert.equal(/api\/v1\/context/.test(page), false, 'the browser never touches /api/v1/context/*')
  assert.match(page, /\/api\/v1\/briefing\/generate/, 'it calls only its own endpoint')
})

test('*** the page asks for no credentials and sends none of its own ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const page = fs.readFileSync(path.join(__dirname, '..', 'demo', 'assets', 'briefing.js'), 'utf8')
  assert.equal(/password|token|Authorization|HUB_TOKEN/i.test(page), false,
    'the existing owner session is the only authentication')
  assert.match(page, /credentials: 'same-origin'/, 'and the session cookie is what carries it')
})

/* ── 4. no write surface exists at all ────────────────────────────────────── */

test('*** no write-shaped connector method can even be registered ***', () => {
  const c = createReadConnector({ env: { READ_ACCESS: 'on', CONTEXT_GMAIL: 'on' } })
  assert.throws(() => c.register({ source: 'gmail', methods: { sendMessage: async () => ({}) } }),
    /refuses write-shaped method/)
  assert.equal(c.hasWriteMethod(), false)
})

test('*** the briefing calls ONLY read methods, and only listPullRequests by name ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const raw = fs.readFileSync(path.join(__dirname, '..', 'coo', 'morningBriefing.js'), 'utf8')

  const calls = [...raw.matchAll(/connector\.read\(\s*'([^']+)'\s*,\s*'([^']+)'/g)].map((m) => m[1] + '.' + m[2])
  assert.deepEqual(calls, ['github.listPullRequests'], 'exactly one direct connector call: ' + calls.join(', '))
  for (const c of calls) assert.equal(WRITE_RE.test(c.split('.')[1]), false, c + ' is read-shaped')

  // CODE ONLY. The first version scanned the raw file and tripped on the word "dispatches"
  // in the module's own header — the guard was reading prose as if it were behaviour. The
  // fix is to strip comments, not to reword a comment that was telling the truth.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal(code.includes('never dispatches'), false, 'the comment really was removed')

  // Nothing in the assembler may reach a mutation, a dispatch, or the Computer Operator.
  for (const forbidden of ['dispatch', 'persistIntake', 'createDispatch', 'computerExecutor', 'sendMail', 'insertEvent']) {
    assert.equal(code.includes(forbidden), false, 'the briefing must not reference ' + forbidden)
  }
})

/* ── 5. what is persisted, and what is not ────────────────────────────────── */

test('*** only audit metadata is stored — the brief body never is ***', async () => {
  const written = []
  const store = createBriefStore({ sink: (rec) => written.push(rec) })
  const res = await request(
    serve(router({ buildMorningBriefingFn: countingBuilder({ n: 0 }), briefStore: store })),
    'POST', '/api/v1/briefing/generate')

  assert.equal(res.body.stored, true, 'the metadata record was accepted')
  assert.equal(written.length, 1)

  const rec = written[0]
  assert.deepEqual(Object.keys(rec).sort(), [
    'briefId', 'contentHash', 'durationMs', 'generatedAt', 'itemCounts',
    'model', 'outcome', 'provider', 'schemaVersion', 'sourceStatuses'
  ], 'exactly the permitted fields')

  // The brief said "Dinner service prep". That string must exist nowhere in the record.
  const serialized = JSON.stringify(written)
  assert.equal(serialized.includes('Dinner service prep'), false, 'no third-party text was persisted')
  assert.equal(serialized.includes('sections'), false, 'and no part of the body')
  assert.match(rec.contentHash, /^[0-9a-f]{64}$/, 'the body is represented by a digest only')
})

test('*** a store refusal does not cost the Owner the brief ***', async () => {
  const refusing = { write: () => ({ ok: false, reason: 'forbidden field', field: 'subject' }) }
  const res = await request(
    serve(router({ buildMorningBriefingFn: countingBuilder({ n: 0 }), briefStore: refusing })),
    'POST', '/api/v1/briefing/generate')

  assert.equal(res.body.ok, true, 'the brief is still returned')
  assert.equal(res.body.stored, false, 'and the failure to store is reported honestly')
  assert.equal(res.body.storeRefusal, 'forbidden field')
})

test('*** the briefing never writes to the Conversation Archive ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const FORBIDDEN = ['conversationArchive', 'labArchiveHook', 'XIANGXIANG_ARCHIVE']
  for (const f of ['../coo/morningBriefing.js', '../coo/briefStore.js', './briefingRouter.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
    for (const t of FORBIDDEN) assert.equal(src.includes(t), false, f + ' must not touch ' + t)
  }
})
