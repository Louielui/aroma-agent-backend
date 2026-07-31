'use strict'

/**
 * personaTelemetry.test.js — R3.
 *
 * Isolated tests for safe persona-source telemetry: startup / readiness-change /
 * pin-drift events with whitelisted metadata, process-local dedup, non-authoritative
 * over routing, logger-failure safety, and the dynLoad allowlist hardening.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const tel = require('../../src/persona/personaTelemetry')
const PSsel = require('../../src/persona/personaSource')
const op = require('../../src/core/memory/shadow/operatingPrinciplesShadow')
const ps = require('../../src/core/memory/shadow/personalityShadow')
const idShadow = require('../../src/core/memory/shadow/identityShadow')
const { PERSONA_IDENTITY: P } = require('../../src/persona/xiangxiang')
const { tmpBase, cleanup, createRev, ev } = require('../core/memory/_helpers')

function seedActive (base, storeName, recordId, payload, opts = {}) {
  const rev = createRev(base, storeName, recordId, { revisionId: opts.revisionId, supersedes: opts.supersedes || null, payload })
  ev(base, storeName, recordId, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
  if (opts.stopAt === 'review_ready') return rev
  ev(base, storeName, recordId, rev.revisionId, 'APPROVED', 'review_ready', { approval: { approvedBy: 'Louie', decision: 'approved' } })
  if (opts.stopAt === 'approved') return rev
  ev(base, storeName, recordId, rev.revisionId, 'ACTIVATED', 'approved')
  return rev
}
const idPayload = () => ({ format: 'verbatim', section: 'identity', text: P.slice(0, 807) })
const seedId = (b, o = {}) => seedActive(b, 'identity', idShadow.IDENTITY_RECORD_ID, o.payload || idPayload(), o)
const seedOp = (b, o = {}) => seedActive(b, op.OP_STORE, op.OP_RECORD_ID, o.payload || op.buildOperatingPrinciplesPayload(P), o)
const seedPs = (b, o = {}) => seedActive(b, ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID, o.payload || ps.buildPersonalityPayload(P), o)
const seedTriple = (b) => { seedId(b); seedOp(b); seedPs(b) }

function capture () { const rows = []; return { sink: (tag, json) => rows.push({ tag, e: JSON.parse(json) }), rows } }
function mk (mode, base, sink) { tel._resetForTests(); return PSsel.createPersonaSource({ env: { PERSONA_SOURCE: mode }, coreDir: base, telemetrySink: sink }) }

// ---- dynLoad hardening ----------------------------------------------------
test('dynLoad allows ONLY the fixed internal modules; unapproved paths fail closed', () => {
  assert.ok(PSsel.dynLoad('core/memory/store'))
  assert.ok(PSsel.dynLoad('hybridPersonaComposer'))
  for (const bad of ['fs', 'path', 'child_process', '../../etc/passwd', './xiangxiang', 'core/memory/shadow/identityShadow', '']) {
    assert.throws(() => PSsel.dynLoad(bad), (e) => e.code === 'PERSONA_SOURCE_CONFIG_ERROR', `should reject ${bad}`)
  }
  assert.deepEqual(Object.keys(PSsel.ALLOWED_MODULES).sort(), ['core/memory/store', 'hybridPersonaComposer'])
})

// ---- telemetry module unit ------------------------------------------------
test('safeEntry whitelists fields; fallbackUsed always false; no arbitrary keys', () => {
  const e = tel.safeEntry('startup', { personaSourceMode: 'hybrid', status: 'HYBRID_READY', ready: true, modelPersonaSource: 'hybrid', pinState: 'CURRENT', identityRevisionId: 'i1', secret: 'LEAK', personaText: P })
  assert.equal(e.fallbackUsed, false)
  assert.equal(e.secret, undefined); assert.equal(e.personaText, undefined)
  assert.equal(JSON.stringify(e).includes('LEAK'), false)
  assert.equal(JSON.stringify(e).includes(P.slice(0, 40)), false)
})
test('readiness-change dedup by fingerprint (no timestamp); different fingerprint logs', () => {
  tel._resetForTests(); const c = capture()
  const m = { personaSourceMode: 'shadow', status: 'SHADOW_READY', pinState: 'CURRENT', identityRevisionId: 'i1', operatingPrinciplesRevisionId: 'o1', personalityRevisionId: 'p1', mappingSourceCommit: 'c1' }
  tel.recordStartup(m, c.sink)
  assert.equal(tel.recordReadinessChange(m, c.sink).deduped, true) // same fingerprint as startup
  const m2 = Object.assign({}, m, { operatingPrinciplesRevisionId: 'o2' })
  assert.equal(tel.recordReadinessChange(m2, c.sink).ok, true) // different fingerprint -> logs
  assert.equal(c.rows.filter((r) => r.e.phase === 'readiness-change').length, 1)
})
test('emit never throws and returns TELEMETRY_EMIT_FAILED on sink failure', () => {
  const r = tel.emit('startup', { personaSourceMode: 'legacy', status: 'LEGACY_ACTIVE' }, () => { throw new Error('sink down') })
  assert.equal(r.ok, false); assert.equal(r.status, 'TELEMETRY_EMIT_FAILED')
})

// ---- legacy ---------------------------------------------------------------
test('legacy: startup logged exactly once; per-request adds nothing; safe fields', () => {
  const c = capture(); const s = mk('legacy', undefined, c.sink)
  assert.equal(c.rows.length, 1)
  const e = c.rows[0].e
  assert.equal(e.phase, 'startup'); assert.equal(e.personaSourceMode, 'legacy'); assert.equal(e.status, 'LEGACY_ACTIVE')
  assert.equal(e.memoryReadAttempted, false); assert.equal(e.pinState, 'NOT_APPLICABLE'); assert.equal(e.modelPersonaSource, 'legacy'); assert.equal(e.fallbackUsed, false)
  s.runtimePersona(); s.runtimePersona(); s.runtimePersona()
  assert.equal(c.rows.length, 1) // no per-request log
})
test('legacy loads NO composer and NO core/memory even with telemetry (child process)', () => {
  const backendDir = path.resolve(__dirname, '../..')
  const script = `
    process.env.PERSONA_SOURCE='legacy'
    const sel = require(${JSON.stringify(path.join(backendDir, 'src/persona/personaSource'))})
    const s = sel.createPersonaSource()
    s.runtimePersona()
    console.log(JSON.stringify({ composer: Object.keys(require.cache).some(k=>k.includes('hybridPersonaComposer')), mem: Object.keys(require.cache).some(k=>/core[\\\\/]+memory/.test(k)) }))
  `
  const out = JSON.parse((cp.spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' }).stdout || '').trim())
  assert.equal(out.composer, false); assert.equal(out.mem, false)
})

// ---- shadow ---------------------------------------------------------------
test('shadow READY: startup SHADOW_READY, model legacy, pin CURRENT, byteIdentical', () => {
  const base = tmpBase()
  try {
    const c = capture(); const s = seedTriple(base); const src = mk('shadow', base, c.sink)
    const e = c.rows.find((r) => r.e.phase === 'startup').e
    assert.equal(e.status, 'SHADOW_READY'); assert.equal(e.modelPersonaSource, 'legacy'); assert.equal(e.memoryReadAttempted, true)
    assert.equal(e.pinState, 'CURRENT'); assert.equal(e.byteIdentical, true); assert.ok(e.hybridPersonaSha256); assert.ok(e.identityRevisionId)
    assert.equal(src.runtimePersona().personaText, P) // model still legacy
    assert.ok(s === undefined) // seedTriple returns undefined; silence lint
  } finally { cleanup(base) }
})
test('shadow NOT_READY: startup SHADOW_NOT_READY, model legacy; request continues on legacy', () => {
  const base = tmpBase()
  try {
    const c = capture(); seedId(base); seedOp(base, { stopAt: 'review_ready' }); const src = mk('shadow', base, c.sink)
    const e = c.rows.find((r) => r.e.phase === 'startup').e
    assert.equal(e.status, 'SHADOW_NOT_READY'); assert.equal(e.modelPersonaSource, 'legacy'); assert.equal(e.pinState, 'UNAVAILABLE')
    assert.equal(src.runtimePersona().personaText, P)
  } finally { cleanup(base) }
})
test('shadow verification FAIL: startup SHADOW_VERIFICATION_FAILED', () => {
  const base = tmpBase()
  try {
    const bad = JSON.parse(JSON.stringify(op.buildOperatingPrinciplesPayload(P))); bad.fragments[0].text += 'X'; bad.aggregateSha256 = op.computeAggregateSha256(bad)
    const c = capture(); seedId(base); seedOp(base, { payload: bad }); seedPs(base); mk('shadow', base, c.sink)
    assert.equal(c.rows.find((r) => r.e.phase === 'startup').e.status, 'SHADOW_VERIFICATION_FAILED')
  } finally { cleanup(base) }
})
test('shadow pin drift: logged once per transition; model stays legacy; no auto-repin', () => {
  const base = tmpBase()
  try {
    const c = capture(); seedTriple(base); const src = mk('shadow', base, c.sink); const pinnedOp = src.pin.operatingPrinciplesRevisionId
    assert.equal(src.runtimePersona().drift, false) // PIN_CURRENT
    ev(base, op.OP_STORE, op.OP_RECORD_ID, pinnedOp, 'SUPERSEDED', 'active') // drift
    const r1 = src.runtimePersona(); assert.equal(r1.drift, true); assert.equal(r1.personaText, P)
    src.runtimePersona(); src.runtimePersona() // repeated drift
    assert.equal(c.rows.filter((r) => r.e.phase === 'pin-drift').length, 1) // deduped
    assert.equal(src.pin.operatingPrinciplesRevisionId, pinnedOp) // no auto-repin
  } finally { cleanup(base) }
})

// ---- hybrid ---------------------------------------------------------------
test('hybrid READY: startup HYBRID_READY, model hybrid, pin CURRENT; runtime uses hybrid', () => {
  const base = tmpBase()
  try {
    const c = capture(); seedTriple(base); const src = mk('hybrid', base, c.sink)
    const e = c.rows.find((r) => r.e.phase === 'startup').e
    assert.equal(e.status, 'HYBRID_READY'); assert.equal(e.modelPersonaSource, 'hybrid'); assert.equal(e.pinState, 'CURRENT')
    assert.equal(src.runtimePersona().personaText, P)
  } finally { cleanup(base) }
})
test('hybrid NOT_READY: startup HYBRID_NOT_READY, model none; runtime fails closed', () => {
  const base = tmpBase()
  try {
    const c = capture(); seedId(base); seedOp(base, { stopAt: 'review_ready' }); const src = mk('hybrid', base, c.sink)
    assert.equal(c.rows.find((r) => r.e.phase === 'startup').e.status, 'HYBRID_NOT_READY')
    assert.equal(c.rows.find((r) => r.e.phase === 'startup').e.modelPersonaSource, 'none')
    assert.throws(() => src.runtimePersona(), (e) => e.code === 'PERSONA_SOURCE_UNAVAILABLE')
  } finally { cleanup(base) }
})
test('hybrid pin drift: logged once; runtime keeps failing closed; no auto-repin', () => {
  const base = tmpBase()
  try {
    const c = capture(); seedTriple(base); const src = mk('hybrid', base, c.sink); const pinnedPs = src.pin.personalityRevisionId
    ev(base, ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID, pinnedPs, 'SUPERSEDED', 'active') // drift
    assert.throws(() => src.runtimePersona(), (e) => e.reason === 'PERSONA_SOURCE_PIN_DRIFT')
    assert.throws(() => src.runtimePersona(), (e) => e.reason === 'PERSONA_SOURCE_PIN_DRIFT')
    assert.equal(c.rows.filter((r) => r.e.phase === 'pin-drift').length, 1)
    assert.equal(src.pin.personalityRevisionId, pinnedPs)
  } finally { cleanup(base) }
})

// ---- non-authoritative / no-leak ------------------------------------------
test('a throwing telemetry sink never changes routing and never recurses', () => {
  const base = tmpBase()
  try {
    const throwing = () => { throw new Error('sink down') }
    // hybrid READY still returns hybrid persona despite telemetry failure
    seedTriple(base); tel._resetForTests()
    const src = PSsel.createPersonaSource({ env: { PERSONA_SOURCE: 'hybrid' }, coreDir: base, telemetrySink: throwing })
    assert.equal(src.runtimePersona().personaText, P)
    // drift path still fails closed despite telemetry failure
    ev(base, op.OP_STORE, op.OP_RECORD_ID, src.pin.operatingPrinciplesRevisionId, 'SUPERSEDED', 'active')
    assert.throws(() => src.runtimePersona(), (e) => e.code === 'PERSONA_SOURCE_UNAVAILABLE')
  } finally { cleanup(base) }
})
test('telemetry emits no persona / tail / fragment / prompt text across all phases', () => {
  const base = tmpBase()
  try {
    const c = capture(); seedTriple(base); const src = mk('hybrid', base, c.sink)
    ev(base, op.OP_STORE, op.OP_RECORD_ID, src.pin.operatingPrinciplesRevisionId, 'SUPERSEDED', 'active')
    try { src.runtimePersona() } catch (e) { /* drift */ }
    const all = JSON.stringify(c.rows)
    for (const leak of ['香香', '思考順序', '表達風格', P.slice(0, 807), P.slice(807, 1586), P.slice(1586)]) assert.equal(all.includes(leak), false)
  } finally { cleanup(base) }
})
test('telemetry writes nothing to the filesystem', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const hashTree = (d) => { const out = {}; const walk = (x, rel) => { for (const nm of fs.readdirSync(x)) { const p = path.join(x, nm), rr = rel ? rel + '/' + nm : nm; if (fs.statSync(p).isDirectory()) walk(p, rr); else out[rr] = require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex') } }; walk(d, ''); return out }
    const before = hashTree(base); const c = capture(); const src = mk('hybrid', base, c.sink); src.runtimePersona()
    assert.deepEqual(hashTree(base), before)
  } finally { cleanup(base) }
})
test('process re-init (new source) can emit a fresh startup', () => {
  const base = tmpBase()
  try {
    const c1 = capture(); seedTriple(base); mk('hybrid', base, c1.sink); assert.equal(c1.rows.filter((r) => r.e.phase === 'startup').length, 1)
    const c2 = capture(); PSsel.createPersonaSource({ env: { PERSONA_SOURCE: 'hybrid' }, coreDir: base, telemetrySink: c2.sink }); assert.equal(c2.rows.filter((r) => r.e.phase === 'startup').length, 1)
  } finally { cleanup(base) }
})
