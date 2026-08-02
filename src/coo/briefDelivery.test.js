'use strict'

/**
 * briefDelivery.test.js — the gate must actually remove, and it must be provable.
 *
 * The defect this replaces set an audit field called `operational_claim_blocked` and then
 * returned the offending text. Every test here therefore checks the DELIVERED payload, and
 * several check the response BYTES — because "was it removed from the object" and "can the
 * Owner still read it" are different questions, and only the second one matters.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { validateBriefForDelivery, OUTCOME, REASON } = require('./briefDelivery')
const { createBriefingRouter } = require('../routes/briefingRouter')
const { createBriefStore, readAll } = require('./briefStore')

const NOW = '2026-08-02T14:00:00.000Z'
const SECRET = 'SYNTHETIC-SUBJECT-QQQ' // a token that cannot occur by accident

function prov (source, id) {
  return { source, sourceId: id || 'x1', originalDate: { iso: NOW, display: 'Aug 02' }, link: null, retrievedAt: { iso: NOW, display: 'Aug 02' }, usedFallback: false }
}

function fact (id, source, text, scope) {
  return { id, kind: 'fact', text, provenance: prov(source, id), basedOnFactIds: [], scope }
}

function rec (id, text, cites) {
  return { id, kind: 'recommendation', text, provenance: null, basedOnFactIds: cites, scope: 'owner_work_item' }
}

function draft (over = {}) {
  return Object.assign({
    briefId: 'brf_x',
    schemaVersion: 1,
    generatedAt: { iso: NOW, display: 'Aug 02' },
    timezone: 'America/Winnipeg',
    sections: Object.assign({
      today: [], recentActivity: [], risks: [], topPriorities: [], decisionsNeeded: [],
      dataCoverage: [{ source: 'gmail', state: 'live', count: 1, error: null, usedFallback: false, retrievedAt: { iso: NOW } }]
    }, over.sections || {}),
    rejectedItems: []
  }, over.rest || {})
}

/* ── 1. gmail stock subject: shown as source_record, NOT business_state ────── */

test('*** CONTROL 1 — a stock subject survives as source_record ***', () => {
  const f = fact('i1', 'gmail', 'gmail contains a record: "Invoice: 40 cases stock delivered"', 'source_record')
  const v = validateBriefForDelivery(draft({ sections: { recentActivity: [f] } }))
  assert.equal(v.outcome, OUTCOME.OK, 'nothing was withheld')
  assert.equal(v.brief.sections.recentActivity.length, 1, 'the Owner still sees the record')
  assert.match(v.brief.sections.recentActivity[0].text, /40 cases stock delivered/)
})

test('*** CONTROL 1b — the SAME item claiming business_state is removed ***', () => {
  const f = fact('i1', 'gmail', 'gmail contains a record: "Invoice: 40 cases stock delivered"', 'business_state')
  const v = validateBriefForDelivery(draft({ sections: { recentActivity: [f] } }))
  assert.equal(v.brief.sections.recentActivity.length, 0, 'scope did not match its source')
  assert.equal(v.removed[0].reason, REASON.SCOPE_MISMATCH)
  assert.equal(v.outcome, OUTCOME.REMOVED)
})

/* ── 2. business_state from a non-aroma-system source: gone from the BYTES ── */

test('*** CONTROL 2 — a business_state claim never reaches the response bytes ***', async () => {
  const bad = fact('i1', 'gmail', 'Inventory is down to 4 cases of ' + SECRET, 'business_state')
  const good = fact('i2', 'calendar', 'calendar contains a record: "Prep"', 'source_record')

  const built = async () => ({
    brief: draft({ sections: { recentActivity: [bad, good] } }),
    audit: { briefId: 'brf_x', generatedAt: NOW, schemaVersion: 1, sourceStatuses: [], itemCounts: {}, durationMs: 1 }
  })

  const res = await post(routerWith({ buildMorningBriefingFn: built }))
  const raw = JSON.stringify(res.body)

  assert.equal(raw.includes(SECRET), false, 'ZERO occurrences of the withheld text in the payload')
  assert.equal(res.body.brief.sections.recentActivity.length, 1, 'only the legitimate item remains')
  assert.equal(res.body.brief.withheldCounts.recentActivity, 1, 'the Owner is told a COUNT')
  assert.equal(JSON.stringify(res.body.brief.withheldCounts).includes(SECRET), false,
    'and the count carries none of the text')
})

/* ── 3. removing a fact removes what was derived from it ──────────────────── */

test('*** CONTROL 3 — a recommendation citing a removed fact is removed too ***', () => {
  const bad = fact('f1', 'gmail', 'Sales up 12 percent', 'business_state') // scope mismatch → removed
  const derived = rec('r1', 'Act on it', ['f1'])
  const v = validateBriefForDelivery(draft({ sections: { recentActivity: [bad], topPriorities: [derived] } }))

  assert.equal(v.brief.sections.recentActivity.length, 0, 'the fact is gone')
  assert.equal(v.brief.sections.topPriorities.length, 0, 'and so is everything standing on it')
  assert.ok(v.removed.some((r) => r.id === 'r1' && r.reason === REASON.DANGLING_CITATION))
})

test('*** CONTROL 3b — the cascade runs to a FIXPOINT, not one pass ***', () => {
  // r1 cites the removed fact; r2 cites r1. One pass would leave r2 standing.
  const bad = fact('f1', 'gmail', 'Revenue is up', 'business_state')
  const r1 = rec('r1', 'first', ['f1'])
  const r2 = rec('r2', 'second', ['r1'])
  const v = validateBriefForDelivery(draft({ sections: { recentActivity: [bad], topPriorities: [r1, r2] } }))
  assert.equal(v.brief.sections.topPriorities.length, 0, 'both derived items fell')
})

test('*** POSITIVE CONTROL — a recommendation on a SURVIVING fact is kept ***', () => {
  const ok = fact('f1', 'gmail', 'gmail contains a record: "Hello"', 'source_record')
  const r1 = rec('r1', 'read it', ['f1'])
  const v = validateBriefForDelivery(draft({ sections: { recentActivity: [ok], topPriorities: [r1] } }))
  assert.equal(v.brief.sections.topPriorities.length, 1, 'a well-founded recommendation survives')
  assert.equal(v.outcome, OUTCOME.OK)
})

/* ── 4. a section bypassing makeItem is still caught ──────────────────────── */

test('*** CONTROL 4 — an item that never went through makeItem is caught ***', () => {
  // Exactly what a future section builder would produce if it constructed items by hand:
  // no scope, no basedOnFactIds, no provenance.
  const raw = { id: 'z1', kind: 'fact', text: 'invented from nowhere' }
  const v = validateBriefForDelivery(draft({ sections: { today: [raw] } }))
  assert.equal(v.brief.sections.today.length, 0, 'the final validator does not trust the builder')
  assert.equal(v.removed[0].reason, REASON.SHAPE)
})

test('*** CONTROL 4b — an unknown source is removed, and duplicate ids too ***', () => {
  const unknown = fact('u1', 'some-new-connector', 'anything', 'source_record')
  const a = fact('d1', 'gmail', 'gmail contains a record: "one"', 'source_record')
  const b = fact('d1', 'gmail', 'gmail contains a record: "two"', 'source_record')
  const v = validateBriefForDelivery(draft({ sections: { today: [unknown, a, b] } }))

  assert.ok(v.removed.some((r) => r.reason === REASON.UNKNOWN_SOURCE), 'closed, not open')
  assert.ok(v.removed.some((r) => r.reason === REASON.DUP_ID), 'ids must be unique')
  assert.equal(v.brief.sections.today.length, 1)
})

test('*** the narrative backstop removes an unquoted business claim ***', () => {
  const sneaky = fact('n1', 'gmail', 'Inventory is down to four cases', 'source_record')
  const v = validateBriefForDelivery(draft({ sections: { today: [sneaky] } }))
  assert.equal(v.brief.sections.today.length, 0)
  assert.equal(v.removed[0].reason, REASON.NARRATIVE_CLAIM)
})

test('*** coverage rows with an illegal state are removed ***', () => {
  const d = draft()
  d.sections.dataCoverage = [
    { source: 'gmail', state: 'live', count: 1 },
    { source: 'drive', state: 'sort-of', count: 1 },
    { source: 'github', state: 'live_zero', count: 'many' }
  ]
  const v = validateBriefForDelivery(d)
  assert.equal(v.brief.sections.dataCoverage.length, 1)
  assert.equal(v.withheldCounts.dataCoverage, 2)
})

test('*** draft-time bookkeeping never leaves the process ***', () => {
  const v = validateBriefForDelivery(draft())
  assert.equal('rejectedItems' in v.brief, false)
  assert.equal('operationalClaimViolations' in v.brief, false,
    'the field that recorded a danger and shipped it anyway is gone entirely')
})

/* ── 5. audit survives a restart; no content is persisted ────────────────── */

test('*** CONTROL 5 — audit metadata survives a FRESH store instance ***', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-audit-'))
  try {
    // The ACL check is exercised in briefHardening.test.js; here the subject is
    // PERSISTENCE, so provisioning is stubbed as satisfied rather than half-faked.
    const store = createBriefStore({ dir, verifyAuditDir: () => ({ ok: true }) })
    const bad = fact('i1', 'gmail', 'Inventory of ' + SECRET, 'business_state')
    const good = fact('i2', 'gmail', 'gmail contains a record: "' + SECRET + '"', 'source_record')
    const built = async () => ({
      brief: draft({ sections: { recentActivity: [bad, good] } }),
      audit: { briefId: 'brf_persist', generatedAt: NOW, schemaVersion: 1, sourceStatuses: [{ source: 'gmail', state: 'live', count: 1 }], itemCounts: {}, durationMs: 3 }
    })

    const res = await post(routerWith({ buildMorningBriefingFn: built, briefStore: store }))
    assert.equal(res.body.stored, true)

    // A DIFFERENT store object, as a restarted process would have.
    const fresh = createBriefStore({ dir, verifyAuditDir: () => ({ ok: true }) })
    const rows = fresh.list()
    assert.equal(rows.length, 1, 'the record is on disk, not in a dead process')
    assert.equal(rows[0].briefId, 'brf_persist')
    assert.equal(rows[0].outcome, OUTCOME.REMOVED, 'and the outcome is what actually happened')

    // ZERO occurrences of ANY brief text — delivered or withheld — in the file bytes.
    const bytes = fs.readFileSync(path.join(dir, 'brief-audit.jsonl'), 'utf8')
    assert.equal(bytes.includes(SECRET), false, 'no third-party text persisted, delivered or withheld')
    assert.equal(bytes.includes('contains a record'), false, 'and no brief text at all')
    assert.match(JSON.parse(bytes.split('\n')[0]).contentHash, /^[0-9a-f]{64}$/)
    assert.equal(readAll(dir).length, 1, 'the reader agrees')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

/* ── 6. raw adapter errors reach neither the browser nor the log ─────────── */

test('*** CONTROL 6 — a raw adapter error never reaches the browser ***', async () => {
  const leaky = 'read failed: https://gmail.googleapis.com/v1/users/me?q=' + SECRET
  const built = async () => { throw new Error(leaky) }

  const logged = []
  const orig = console.log
  console.log = (...a) => { logged.push(a.map(String).join(' ')) }
  let res
  try { res = await post(routerWith({ buildMorningBriefingFn: built })) } finally { console.log = orig }

  const raw = JSON.stringify(res.body)
  assert.equal(res.status, 500)
  assert.equal(res.body.error, 'briefing_failed', 'a FIXED code')
  assert.equal('detail' in res.body, false, 'and no detail field at all')
  assert.equal(raw.includes(SECRET), false, 'the query is not in the response')
  assert.equal(raw.includes('googleapis'), false, 'nor the endpoint')

  const line = logged.join('\n')
  assert.ok(line.includes('BRIEFING_FAILED'), 'the failure IS recorded')
  assert.equal(line.includes(SECRET), false, 'but scrubbed of the query')
  assert.equal(line.includes('https://'), false, 'and of the URL')
})

test('*** a validator crash is fail-closed: no payload at all ***', async () => {
  const built = async () => ({
    brief: draft({ sections: { today: [fact('i1', 'gmail', 'gmail contains a record: "x"', 'source_record')] } }),
    audit: { briefId: 'b', generatedAt: NOW, schemaVersion: 1, sourceStatuses: [], itemCounts: {}, durationMs: 1 }
  })
  const res = await post(routerWith({
    buildMorningBriefingFn: built,
    validateBriefForDeliveryFn: () => { throw new Error('not_a_brief') }
  }))
  assert.equal(res.status, 500)
  assert.equal(res.body.error, 'delivery_validation_failed', 'named as what it was')
  assert.equal('brief' in res.body, false, 'an unvalidated payload is never sent')
})

/* ── harness ─────────────────────────────────────────────────────────────── */

function routerWith (opts) {
  return createBriefingRouter(Object.assign({
    buildConnector: () => ({ connector: { read: async () => ({ results: [] }) } }),
    listPendingProposals: async () => [],
    buildDecisionRecall: async () => ({ count: 0 }),
    briefStore: createBriefStore({ persist: false })
  }, opts))
}

function post (router) {
  const app = express()
  app.use(express.json())
  app.use(router)
  const server = http.createServer(app)
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      const req = http.request({ host: '127.0.0.1', port, path: '/api/v1/briefing/generate', method: 'POST' }, (r) => {
        let d = ''
        r.on('data', (c) => { d += c })
        r.on('end', () => { server.close(); resolve({ status: r.statusCode, body: JSON.parse(d) }) })
      })
      req.on('error', (e) => { server.close(); reject(e) })
      req.end()
    })
  })
}
