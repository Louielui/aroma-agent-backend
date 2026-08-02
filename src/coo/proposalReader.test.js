'use strict'

/**
 * proposalReader.test.js — the PRODUCTION default proposal reader, not a double.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * `defaultListProposals()` called `load()` with no path, so it threw a TypeError and the
 * briefing reported `proposals: unavailable` every single time. Decisions Needed could
 * never populate. The bug reached a real canary because EVERY existing test injected a
 * `listPendingProposals` double — the production default had never been executed once.
 * A double that stands in for the code under test does not test it; it hides it.
 *
 * So nothing here injects that seam. Each test points AROMA_DATA_DIR at a real temp
 * directory, drives `createBriefingRouter` with its DEFAULT reader, and reads the verdict
 * out of the brief's own Data Coverage.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createBriefingRouter } = require('../routes/briefingRouter')
const { createBriefStore } = require('./briefStore')
const { resolveProposalFilePath, PROPOSALS_FILENAME } = require('./proposalPersistence')

const PENDING = { id: 'prop_pending', status: 'pending', task: 'Approve the thing', targetProject: 'backend', createdAt: '2026-07-27T18:22:26.144Z' }
const CONFIRMED = { id: 'prop_done', status: 'confirmed', task: 'Already decided', targetProject: 'backend', createdAt: '2026-07-24T02:40:02.082Z' }

function tmpDataDir (contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-store-'))
  if (contents !== undefined) {
    fs.writeFileSync(path.join(dir, PROPOSALS_FILENAME),
      typeof contents === 'string' ? contents : JSON.stringify(contents))
  }
  return dir
}

/** Runs the router with its REAL proposal reader against `dir`. */
async function briefWithDataDir (dir) {
  const prev = process.env.AROMA_DATA_DIR
  if (dir === null) delete process.env.AROMA_DATA_DIR
  else process.env.AROMA_DATA_DIR = dir
  try {
    const router = createBriefingRouter({
      // Only the external connector and the audit store are stubbed. The proposal reader
      // is deliberately NOT — it is the subject.
      buildConnector: () => ({ connector: { read: async () => ({ results: [] }) } }),
      briefStore: createBriefStore({ persist: false })
    })
    return await post(router)
  } finally {
    if (prev === undefined) delete process.env.AROMA_DATA_DIR
    else process.env.AROMA_DATA_DIR = prev
  }
}

const coverage = (res, source) => res.body.brief.sections.dataCoverage.find((c) => c.source === source)

/* ── 1. only pending ──────────────────────────────────────────────────────── */

test('*** a store with one pending and one confirmed yields ONLY the pending ***', async () => {
  const dir = tmpDataDir({ order: [PENDING.id, CONFIRMED.id], proposals: { [PENDING.id]: PENDING, [CONFIRMED.id]: CONFIRMED } })
  try {
    const res = await briefWithDataDir(dir)
    assert.equal(res.status, 200)

    const cov = coverage(res, 'proposals')
    assert.equal(cov.state, 'live', 'the store was READ — this is the regression that shipped')
    assert.equal(cov.count, 1, 'exactly the pending one')

    const decisions = res.body.brief.sections.decisionsNeeded
    assert.equal(decisions.length, 1)
    assert.match(decisions[0].text, /Approve the thing/, 'the pending proposal is on screen')
    assert.equal(decisions[0].provenance.source, 'proposals')
    assert.equal(decisions[0].provenance.sourceId, 'prop_pending')
    assert.equal(JSON.stringify(res.body.brief).includes('Already decided'), false,
      'and the confirmed one is not')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

/* ── 2-3. absent and empty are live_zero, never unavailable ───────────────── */

test('*** a MISSING proposal file is live_zero, and does not throw ***', async () => {
  const dir = tmpDataDir() // directory exists, file does not
  try {
    const res = await briefWithDataDir(dir)
    assert.equal(res.status, 200, 'no throw reached the route')
    const cov = coverage(res, 'proposals')
    assert.equal(cov.state, 'live_zero', 'nothing to decide is not a failure to read')
    assert.equal(cov.errorCode, null)
    assert.deepEqual(res.body.brief.sections.decisionsNeeded, [])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('*** a store with NO pending proposals is live_zero ***', async () => {
  const dir = tmpDataDir({ order: [CONFIRMED.id], proposals: { [CONFIRMED.id]: CONFIRMED } })
  try {
    const res = await briefWithDataDir(dir)
    const cov = coverage(res, 'proposals')
    assert.equal(cov.state, 'live_zero')
    assert.equal(cov.count, 0)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

/* ── 4-5. a damaged store is unavailable, never live_zero ─────────────────── */

test('*** CORRUPT JSON degrades to unavailable, NOT live_zero ***', async () => {
  const dir = tmpDataDir('{ this is not json')
  try {
    const res = await briefWithDataDir(dir)
    assert.equal(res.status, 200, 'the brief still arrives')
    const cov = coverage(res, 'proposals')
    assert.equal(cov.state, 'unavailable',
      'a damaged store must never read as "nothing to decide"')
    assert.ok(cov.errorCode, 'with a projected code')
    assert.equal(JSON.stringify(res.body).includes(dir), false,
      'and the path is not leaked into the response')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('*** a WRONG ENVELOPE SHAPE degrades to unavailable ***', async () => {
  // Valid JSON, invalid store: `order` names an id that has no record.
  const dir = tmpDataDir({ order: ['prop_ghost'], proposals: {} })
  try {
    const res = await briefWithDataDir(dir)
    const cov = coverage(res, 'proposals')
    assert.equal(cov.state, 'unavailable')
    assert.notEqual(cov.state, 'live_zero')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('*** POSITIVE CONTROL — these states are genuinely different ***', async () => {
  // Without this, all five tests above could be passing on one constant.
  const good = tmpDataDir({ order: [PENDING.id], proposals: { [PENDING.id]: PENDING } })
  const missing = tmpDataDir()
  const broken = tmpDataDir('{{{')
  try {
    const a = coverage(await briefWithDataDir(good), 'proposals').state
    const b = coverage(await briefWithDataDir(missing), 'proposals').state
    const c = coverage(await briefWithDataDir(broken), 'proposals').state
    assert.deepEqual([a, b, c], ['live', 'live_zero', 'unavailable'],
      'three inputs, three distinct outcomes')
  } finally {
    for (const d of [good, missing, broken]) fs.rmSync(d, { recursive: true, force: true })
  }
})

/* ── 6. one resolver, one path ────────────────────────────────────────────── */

test('*** the briefing and the Proposal Store resolve to the SAME file ***', async () => {
  const dir = tmpDataDir({ order: [PENDING.id], proposals: { [PENDING.id]: PENDING } })
  try {
    const viaResolver = resolveProposalFilePath({ AROMA_DATA_DIR: dir })
    assert.equal(viaResolver, path.join(dir, PROPOSALS_FILENAME))

    // The Proposal Store uses the same resolver for its default file.
    const proposalSrc = fs.readFileSync(path.join(__dirname, 'proposal.js'), 'utf8')
    assert.match(proposalSrc, /resolveProposalFilePath\(process\.env\)/,
      'the Proposal Store resolves through the shared function')
    assert.equal(/AROMA_DATA_DIR/.test(proposalSrc), false,
      'and no longer carries a second copy of the rule')

    const routerSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'briefingRouter.js'), 'utf8')
    assert.match(routerSrc, /load\(resolveProposalFilePath\(process\.env\)\)/,
      'the briefing reads the resolved path, not a bare load()')
    assert.equal(/aroma-proposals\.json/.test(routerSrc), false,
      'and does not name the file itself')

    // And the override really is honoured end to end.
    const res = await briefWithDataDir(dir)
    assert.equal(coverage(res, 'proposals').count, 1, 'AROMA_DATA_DIR reached the reader')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('*** with no override, the resolver points at the repo data directory ***', () => {
  const p = resolveProposalFilePath({})
  assert.equal(path.basename(p), PROPOSALS_FILENAME)
  assert.equal(path.basename(path.dirname(p)), 'data')
})

/* ── harness ─────────────────────────────────────────────────────────────── */

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
