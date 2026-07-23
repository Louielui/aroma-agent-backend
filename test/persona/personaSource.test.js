'use strict'

/**
 * personaSource.test.js — R2.
 *
 * Isolated tests for the runtime persona source selector. Active fixtures live in
 * temp dirs. Legacy mode must load no Memory dependency (verified in a child
 * process with a fresh require cache). Non-legacy composes + pins once; drift is
 * detected per-request and never auto-re-pinned.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const cp = require('node:child_process')
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
const seedId = (base, o = {}) => seedActive(base, 'identity', idShadow.IDENTITY_RECORD_ID, o.payload || idPayload(), o)
const seedOp = (base, o = {}) => seedActive(base, op.OP_STORE, op.OP_RECORD_ID, o.payload || op.buildOperatingPrinciplesPayload(P), o)
const seedPs = (base, o = {}) => seedActive(base, ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID, o.payload || ps.buildPersonalityPayload(P), o)
function seedTriple (base) { seedId(base); seedOp(base); seedPs(base) }
const src = (mode, base) => PSsel.createPersonaSource({ env: { PERSONA_SOURCE: mode }, coreDir: base })

// ---- mode parsing ---------------------------------------------------------
test('env unset -> legacy; explicit legacy/shadow/hybrid; unknown -> fail closed', () => {
  assert.equal(PSsel.parseMode({}), 'legacy')
  assert.equal(PSsel.parseMode({ PERSONA_SOURCE: '' }), 'legacy')
  assert.equal(PSsel.parseMode({ PERSONA_SOURCE: 'legacy' }), 'legacy')
  assert.equal(PSsel.parseMode({ PERSONA_SOURCE: 'shadow' }), 'shadow')
  assert.equal(PSsel.parseMode({ PERSONA_SOURCE: 'hybrid' }), 'hybrid')
  assert.throws(() => PSsel.parseMode({ PERSONA_SOURCE: 'memory' }), (e) => e.code === 'PERSONA_SOURCE_CONFIG_ERROR')
  assert.throws(() => PSsel.parseMode({ PERSONA_SOURCE: 'bogus' }), (e) => e.code === 'PERSONA_SOURCE_CONFIG_ERROR')
})

// ---- legacy ---------------------------------------------------------------
test('legacy runtime persona = frozen PERSONA_IDENTITY; no pin', () => {
  const s = src('legacy')
  const rp = s.runtimePersona()
  assert.equal(rp.mode, 'legacy'); assert.equal(rp.personaText, P); assert.equal(rp.drift, false)
  assert.equal(s.safeMetadata().mode, 'legacy')
})

test('legacy loads NO composer and NO core/memory (fresh require cache, child process)', () => {
  const backendDir = path.resolve(__dirname, '../..')
  const script = `
    process.env.PERSONA_SOURCE='legacy'
    const sel = require(${JSON.stringify(path.join(backendDir, 'src/persona/personaSource'))})
    const s = sel.createPersonaSource()
    const rp = s.runtimePersona()
    const composerLoaded = Object.keys(require.cache).some(k => k.includes('hybridPersonaComposer'))
    const memLoaded = Object.keys(require.cache).some(k => /core[\\\\/]+memory/.test(k))
    console.log(JSON.stringify({ len: rp.personaText.length, composerLoaded, memLoaded }))
  `
  const res = cp.spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' })
  const out = JSON.parse((res.stdout || '').trim())
  assert.equal(out.len, 3116)
  assert.equal(out.composerLoaded, false)
  assert.equal(out.memLoaded, false)
})

// ---- shadow ---------------------------------------------------------------
test('shadow READY: model uses legacy persona; pin current; hybrid text never returned', () => {
  const base = tmpBase()
  try {
    seedTriple(base); const s = src('shadow', base)
    assert.equal(s.ready, true); assert.ok(s.pin)
    const rp = s.runtimePersona()
    assert.equal(rp.mode, 'shadow'); assert.equal(rp.personaText, P) // legacy, not hybrid
    assert.equal(rp.pinStatus, 'PIN_CURRENT'); assert.equal(rp.drift, false)
  } finally { cleanup(base) }
})
test('shadow NOT_READY (production-like): model uses legacy; no pin', () => {
  const base = tmpBase()
  try {
    seedId(base); seedOp(base, { stopAt: 'review_ready' }); const s = src('shadow', base)
    assert.equal(s.ready, false); assert.equal(s.pin, null)
    const rp = s.runtimePersona()
    assert.equal(rp.personaText, P); assert.equal(rp.ready, false)
  } finally { cleanup(base) }
})
test('shadow pin drift: still legacy persona, drift flagged, no auto-repin', () => {
  const base = tmpBase()
  try {
    seedTriple(base); const s = src('shadow', base)
    const before = s.pin.operatingPrinciplesRevisionId
    // supersede the active OP revision -> resolver NONE -> drift
    ev(base, op.OP_STORE, op.OP_RECORD_ID, before, 'SUPERSEDED', 'active')
    const rp = s.runtimePersona()
    assert.equal(rp.personaText, P); assert.equal(rp.drift, true); assert.equal(rp.driftReason, 'PERSONA_SOURCE_PIN_DRIFT')
    assert.equal(s.pin.operatingPrinciplesRevisionId, before) // pin unchanged (no auto-repin)
  } finally { cleanup(base) }
})

// ---- hybrid ---------------------------------------------------------------
test('hybrid exact active triple: uses Hybrid Persona (byte-identical to legacy)', () => {
  const base = tmpBase()
  try {
    seedTriple(base); const s = src('hybrid', base)
    assert.equal(s.ready, true)
    const rp = s.runtimePersona()
    assert.equal(rp.mode, 'hybrid'); assert.equal(rp.personaText, P); assert.equal(rp.pinStatus, 'PIN_CURRENT')
  } finally { cleanup(base) }
})
test('hybrid NOT_READY -> fail closed (throws, no persona text)', () => {
  const base = tmpBase()
  try {
    seedId(base); seedOp(base, { stopAt: 'review_ready' }); const s = src('hybrid', base)
    assert.throws(() => s.runtimePersona(), (e) => e.code === 'PERSONA_SOURCE_UNAVAILABLE' && !/香香|思考順序/.test(String(e.reason)))
  } finally { cleanup(base) }
})
test('hybrid verification FAIL -> fail closed', () => {
  const base = tmpBase()
  try {
    const bad = JSON.parse(JSON.stringify(op.buildOperatingPrinciplesPayload(P))); bad.fragments[0].text += 'X'; bad.aggregateSha256 = op.computeAggregateSha256(bad)
    seedId(base); seedOp(base, { payload: bad }); seedPs(base); const s = src('hybrid', base)
    assert.throws(() => s.runtimePersona(), (e) => e.code === 'PERSONA_SOURCE_UNAVAILABLE')
  } finally { cleanup(base) }
})
test('hybrid pin drift on each store -> fail closed (identity / OP / personality)', () => {
  for (const target of ['identity', 'op', 'ps']) {
    const base = tmpBase()
    try {
      seedTriple(base); const s = src('hybrid', base)
      const map = { identity: ['identity', idShadow.IDENTITY_RECORD_ID], op: [op.OP_STORE, op.OP_RECORD_ID], ps: [ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID] }
      const [storeName, recordId] = map[target]
      const store = require('../../src/core/memory/store')
      const active = store.resolveActiveRecord(base, storeName, recordId)
      ev(base, storeName, recordId, active.revisionId, 'SUPERSEDED', 'active') // -> resolver NONE
      assert.throws(() => s.runtimePersona(), (e) => e.code === 'PERSONA_SOURCE_UNAVAILABLE' && e.reason === 'PERSONA_SOURCE_PIN_DRIFT', `drift on ${target}`)
    } finally { cleanup(base) }
  }
})
test('hybrid resolver NONE and ambiguous -> fail closed', () => {
  // NONE
  let base = tmpBase()
  try {
    seedTriple(base); const s = src('hybrid', base)
    ev(base, ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID, s.pin.personalityRevisionId, 'SUPERSEDED', 'active')
    assert.throws(() => s.runtimePersona(), (e) => e.reason === 'PERSONA_SOURCE_PIN_DRIFT')
  } finally { cleanup(base) }
  // AMBIGUOUS (second active OP revision)
  base = tmpBase()
  try {
    seedTriple(base); const s = src('hybrid', base)
    seedOp(base, { revisionId: 'b', supersedes: s.pin.operatingPrinciplesRevisionId })
    assert.throws(() => s.runtimePersona(), (e) => e.reason === 'PERSONA_SOURCE_PIN_DRIFT')
  } finally { cleanup(base) }
})
test('no auto-repin: after drift, a NEW createPersonaSource is required to re-pin', () => {
  const base = tmpBase()
  try {
    seedTriple(base); const s = src('hybrid', base); const oldPin = s.pin.operatingPrinciplesRevisionId
    ev(base, op.OP_STORE, op.OP_RECORD_ID, oldPin, 'SUPERSEDED', 'active')
    seedOp(base, { revisionId: 'r2' }) // a fresh active OP revision
    assert.throws(() => s.runtimePersona(), (e) => e.code === 'PERSONA_SOURCE_UNAVAILABLE') // old source still fails closed
    assert.equal(s.pin.operatingPrinciplesRevisionId, oldPin) // pin never moved
    const s2 = src('hybrid', base) // explicit re-init picks up the new snapshot
    assert.equal(s2.pin.operatingPrinciplesRevisionId, 'r2')
    assert.equal(s2.runtimePersona().personaText, P)
  } finally { cleanup(base) }
})

// ---- safe output ----------------------------------------------------------
test('safeMetadata carries revision ids only — no persona / fragment / tail text', () => {
  const base = tmpBase()
  try {
    seedTriple(base); const s = src('shadow', base)
    const m = JSON.stringify(s.safeMetadata())
    for (const leak of ['香香', '思考順序', '表達風格', P.slice(0, 807), P.slice(1586)]) assert.equal(m.includes(leak), false)
    assert.ok(m.includes(s.pin.identityRevisionId))
  } finally { cleanup(base) }
})
