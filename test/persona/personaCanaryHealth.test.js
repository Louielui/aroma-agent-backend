'use strict'

/**
 * personaCanaryHealth.test.js — R4c.
 *
 * Tests the canary-only health/readiness surface: safe allowlisted responses,
 * mounted only on a canary app (never the primary), readiness reusing R1/R2 rules,
 * fail-closed on unusable state, zero Memory writes, no model call.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const express = require('express')
const H = require('../../src/persona/personaCanaryHealth')
const { createPersonaSource } = require('../../src/persona/personaSource')
const createAppMod = require('../../src/app')
const op = require('../../src/core/memory/shadow/operatingPrinciplesShadow')
const ps = require('../../src/core/memory/shadow/personalityShadow')
const idShadow = require('../../src/core/memory/shadow/identityShadow')
const { PERSONA_IDENTITY: P } = require('../../src/persona/xiangxiang')
const { tmpBase, cleanup, createRev, ev } = require('../core/memory/_helpers')

const ALLOWED_KEYS = ['endpoint', 'processRole', 'personaSourceMode', 'status', 'ready', 'reason', 'hybridComposerReady']

function seedActive (base, storeName, recordId, payload, opts = {}) {
  const rev = createRev(base, storeName, recordId, { revisionId: opts.revisionId, payload })
  ev(base, storeName, recordId, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
  if (opts.stopAt === 'review_ready') return rev
  ev(base, storeName, recordId, rev.revisionId, 'APPROVED', 'review_ready', { approval: { approvedBy: 'Louie', decision: 'approved' } })
  if (opts.stopAt === 'approved') return rev
  ev(base, storeName, recordId, rev.revisionId, 'ACTIVATED', 'approved')
  return rev
}
const idP = () => ({ format: 'verbatim', section: 'identity', text: P.slice(0, 807) })
const noop = () => {}
const src = (mode, base) => createPersonaSource({ env: { PERSONA_SOURCE: mode }, coreDir: base, telemetrySink: noop })
// production-frozen: identity active + OP review_ready + no personality
function seedProdFrozen (base) { seedActive(base, 'identity', idShadow.IDENTITY_RECORD_ID, idP()); seedActive(base, op.OP_STORE, op.OP_RECORD_ID, op.buildOperatingPrinciplesPayload(P), { stopAt: 'review_ready' }) }
function seedTriple (base) { seedActive(base, 'identity', idShadow.IDENTITY_RECORD_ID, idP()); seedActive(base, op.OP_STORE, op.OP_RECORD_ID, op.buildOperatingPrinciplesPayload(P)); seedActive(base, ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID, ps.buildPersonalityPayload(P)) }

function assertAllowlisted (obj) { for (const k of Object.keys(obj)) assert.ok(ALLOWED_KEYS.includes(k), 'unexpected field: ' + k) }
function assertNoLeak (obj) {
  const s = JSON.stringify(obj)
  for (const leak of ['香香', '思考順序', '表達風格', P.slice(0, 807), P.slice(807, 1586), P.slice(1586), 'HUB_TOKEN', 'ANTHROPIC', 'canary-secret', '/Users/', 'AromaCore', 'Error:', 'at Object']) assert.equal(s.includes(leak), false, 'leaked: ' + leak)
}
function httpGet (port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 4000 }, (res) => { let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => resolve({ status: res.statusCode, body: b })) })
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')))
  })
}
async function serveAndGet (app, p) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try { return await httpGet(server.address().port, p) } finally { server.close() }
}

// ---- pure health / readiness ----------------------------------------------
test('health confirms role/config identity only (safe allowlist)', () => {
  const h = H.buildHealth({ processRole: 'persona-canary', personaSourceMode: 'shadow' })
  assert.equal(h.status, 'CANARY_ALIVE'); assert.equal(h.ready, true)
  assert.equal(h.processRole, 'persona-canary'); assert.equal(h.personaSourceMode, 'shadow')
  assertAllowlisted(h); assertNoLeak(h)
})
test('legacy readiness is trivially ready', () => {
  const r = H.buildReadiness({ processRole: 'persona-canary', personaSourceMode: 'legacy' }, () => { throw new Error('should not be called') })
  assert.equal(r.status, 'LEGACY_READY'); assert.equal(r.ready, true); assertAllowlisted(r)
})

// ---- readiness for the production-frozen state (shadow) --------------------
test('shadow readiness in production-frozen state: ready=true, hybridComposerReady=false, safe reason', () => {
  const base = tmpBase()
  try {
    seedProdFrozen(base)
    const s = src('shadow', base)
    const r = H.buildReadiness({ processRole: 'persona-canary', personaSourceMode: 'shadow' }, () => s)
    assert.equal(r.ready, true) // shadow serves legacy regardless
    assert.equal(r.status, 'SHADOW_READY')
    assert.equal(r.hybridComposerReady, false)
    assert.match(r.reason, /NOT_READY|NOT_ACTIVE/) // composer not ready (OP review_ready, personality absent)
    assertAllowlisted(r); assertNoLeak(r)
  } finally { cleanup(base) }
})

// ---- hybrid readiness reuses R1/R2 rules -----------------------------------
test('hybrid readiness READY when the exact active triple is present', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const r = H.buildReadiness({ processRole: 'persona-canary', personaSourceMode: 'hybrid' }, () => src('hybrid', base))
    assert.equal(r.ready, true); assert.equal(r.status, 'HYBRID_READY'); assertAllowlisted(r); assertNoLeak(r)
  } finally { cleanup(base) }
})
test('hybrid readiness NOT_READY (production-frozen) fails closed with a safe reason', () => {
  const base = tmpBase()
  try {
    seedProdFrozen(base)
    const r = H.buildReadiness({ processRole: 'persona-canary', personaSourceMode: 'hybrid' }, () => src('hybrid', base))
    assert.equal(r.ready, false); assert.equal(r.status, 'HYBRID_NOT_READY'); assert.match(r.reason, /NOT_READY|NOT_ACTIVE|PIN_DRIFT/)
    assertAllowlisted(r); assertNoLeak(r)
  } finally { cleanup(base) }
})

// ---- fail-closed on malformed / unexpected --------------------------------
test('getSource throwing -> READINESS_ERROR fail-closed (no stack/detail)', () => {
  const r = H.buildReadiness({ processRole: 'persona-canary', personaSourceMode: 'hybrid' }, () => { throw new Error('boom secret /Users/x') })
  assert.equal(r.ready, false); assert.equal(r.status, 'READINESS_ERROR'); assert.equal(r.reason, 'READINESS_ERROR')
  assertAllowlisted(r); assertNoLeak(r)
})
test('safeReason only echoes uppercase codes; anything else -> NOT_READY', () => {
  assert.equal(H.safeReason('BOTH_DOMAINS_NOT_ACTIVE'), 'BOTH_DOMAINS_NOT_ACTIVE')
  assert.equal(H.safeReason('香香 leaked persona text'), 'NOT_READY')
  assert.equal(H.safeReason(undefined), 'NOT_READY')
  assert.equal(H.safeReason(P.slice(0, 20)), 'NOT_READY')
})

// ---- mounted only on a canary app; primary has NO canary endpoints ---------
test('mounted routes serve on a canary app over localhost (health 200 + readiness 200)', async () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const app = express()
    H.mountCanaryHealth(app, { processRole: 'persona-canary', personaSourceMode: 'hybrid', getSource: () => src('hybrid', base) })
    const h = await serveAndGet(app, '/persona-canary/health')
    assert.equal(h.status, 200); const hj = JSON.parse(h.body); assert.equal(hj.status, 'CANARY_ALIVE'); assertAllowlisted(hj); assertNoLeak(hj)
    const rd = await serveAndGet(app, '/persona-canary/readiness')
    assert.equal(rd.status, 200); const rj = JSON.parse(rd.body); assert.equal(rj.ready, true); assertAllowlisted(rj); assertNoLeak(rj)
  } finally { cleanup(base) }
})
test('primary app (createApp) does NOT gain the canary endpoints (404)', async () => {
  const app = createAppMod.createApp()
  const h = await serveAndGet(app, '/persona-canary/health')
  assert.equal(h.status, 404)
  const r = await serveAndGet(app, '/persona-canary/readiness')
  assert.equal(r.status, 404)
})
test('primary generic /health is unchanged (still 200, open)', async () => {
  const app = createAppMod.createApp()
  const h = await serveAndGet(app, '/health')
  assert.equal(h.status, 200)
})

// ---- zero writes / no model -----------------------------------------------
test('readiness performs zero filesystem writes on the core dir', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const hashTree = (d) => { const out = {}; const walk = (x, rel) => { for (const nm of fs.readdirSync(x)) { const p = path.join(x, nm), rr = rel ? rel + '/' + nm : nm; if (fs.statSync(p).isDirectory()) walk(p, rr); else out[rr] = require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex') } }; walk(d, ''); return out }
    const before = hashTree(base)
    H.buildReadiness({ processRole: 'persona-canary', personaSourceMode: 'hybrid' }, () => src('hybrid', base))
    assert.deepEqual(hashTree(base), before)
  } finally { cleanup(base) }
})
test('readiness response carries no model/provider/token config', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const r = H.buildReadiness({ processRole: 'persona-canary', personaSourceMode: 'shadow' }, () => src('shadow', base))
    const s = JSON.stringify(r)
    for (const k of ['provider', 'model', 'apiKey', 'ANTHROPIC', 'CLAUDE_MODEL', 'LLM_PROVIDER', 'token', 'HUB_TOKEN']) assert.equal(s.toLowerCase().includes(k.toLowerCase()), false)
  } finally { cleanup(base) }
})
