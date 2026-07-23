'use strict'

/**
 * hybridPersonaComposer.test.js — R1.
 *
 * Isolated tests for the read-only Hybrid Persona Composer. All active fixtures are
 * built in temp dirs with generic M1 primitives; no production AROMA_CORE_DIR, no
 * writes outside temp dirs. The composer is never wired to runtime and its output
 * is never sent to a model.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const C = require('../../src/persona/hybridPersonaComposer')
const op = require('../../src/core/memory/shadow/operatingPrinciplesShadow')
const ps = require('../../src/core/memory/shadow/personalityShadow')
const idShadow = require('../../src/core/memory/shadow/identityShadow')
const store = require('../../src/core/memory/store')
const { PERSONA_IDENTITY: P, buildPersonaSystem } = require('../../src/persona/xiangxiang')
const { tmpBase, cleanup, createRev, ev } = require('../core/memory/_helpers')

const S = C.STATUS
const NR = C.NOT_READY
const sha = (s) => require('crypto').createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex')
const clone = (x) => JSON.parse(JSON.stringify(x))

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
const seedId = (base, opts = {}) => seedActive(base, 'identity', idShadow.IDENTITY_RECORD_ID, opts.payload || idPayload(), opts)
const seedOp = (base, opts = {}) => seedActive(base, op.OP_STORE, op.OP_RECORD_ID, opts.payload || op.buildOperatingPrinciplesPayload(P), opts)
const seedPs = (base, opts = {}) => seedActive(base, ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID, opts.payload || ps.buildPersonalityPayload(P), opts)
const compose = (base) => C.composeHybridPersona(base, { personaIdentity: P })
function seedTriple (base) { seedId(base); seedOp(base); seedPs(base) }

// ---- READY ----------------------------------------------------------------
test('exact active triple -> READY / 0 / byte-identical full persona', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const r = compose(base)
    assert.equal(r.status, S.HYBRID_PERSONA_READY); assert.equal(r.ready, true); assert.equal(C.exitCodeFor(r.status), 0)
    // full persona byte-identical
    assert.equal(r.personaText, P)
    assert.equal(r.personaText.length, P.length)
    assert.equal(r.personaSha256, sha(P))
    // identity [0,807), behavioral [807,1586), tail [1586,end)
    assert.equal(r.personaText.slice(0, 807), P.slice(0, 807))
    assert.equal(r.personaText.slice(807, 1586), P.slice(807, 1586))
    assert.equal(r.personaText.slice(1586), P.slice(1586))
    assert.equal(r.safeMetadata.tailSource, 'legacy-frozen'); assert.equal(r.safeMetadata.tailStartCodeUnit, 1586)
    assert.equal(r.safeMetadata.byteIdentical, true)
  } finally { cleanup(base) }
})
test('pin contains exact three revision IDs, mapping commit, and component hashes', () => {
  const base = tmpBase()
  try {
    const rid = seedId(base); const ro = seedOp(base); const rp = seedPs(base)
    const r = compose(base)
    assert.equal(r.pin.identityRevisionId, rid.revisionId)
    assert.equal(r.pin.operatingPrinciplesRevisionId, ro.revisionId)
    assert.equal(r.pin.personalityRevisionId, rp.revisionId)
    assert.equal(r.pin.mappingSourceCommit, 'e90cb5bbf73203053b1f67c4a6d1468db67edbff')
    assert.equal(r.pin.identityPayloadSha256, sha(P.slice(0, 807)))
    assert.equal(r.pin.behavioralSectionSha256, sha(P.slice(807, 1586)))
    assert.equal(r.pin.legacyTailSha256, sha(P.slice(1586)))
    assert.equal(r.pin.hybridPersonaSha256, sha(P))
  } finally { cleanup(base) }
})

// ---- NOT_READY (exit 4) ---------------------------------------------------
test('production-like: OP review_ready + personality absent (identity active) -> NOT_READY / 4', () => {
  const base = tmpBase()
  try {
    seedId(base); seedOp(base, { stopAt: 'review_ready' })
    const r = compose(base)
    assert.equal(r.status, S.HYBRID_PERSONA_NOT_READY); assert.equal(C.exitCodeFor(r.status), 4)
    assert.equal(r.personaText, undefined)
  } finally { cleanup(base) }
})
test('identity not active -> NOT_READY / IDENTITY_NOT_ACTIVE', () => {
  const base = tmpBase()
  try { seedId(base, { stopAt: 'review_ready' }); seedOp(base); seedPs(base); const r = compose(base); assert.equal(r.reason, NR.IDENTITY_NOT_ACTIVE); assert.equal(C.exitCodeFor(r.status), 4) } finally { cleanup(base) }
})
test('OP absent -> NOT_READY', () => {
  const base = tmpBase(); try { seedId(base); seedPs(base); const r = compose(base); assert.equal(r.status, S.HYBRID_PERSONA_NOT_READY); assert.equal(C.exitCodeFor(r.status), 4) } finally { cleanup(base) }
})
test('OP review_ready / approved -> NOT_READY', () => {
  let base = tmpBase(); try { seedId(base); seedOp(base, { stopAt: 'review_ready' }); seedPs(base); assert.equal(compose(base).status, S.HYBRID_PERSONA_NOT_READY) } finally { cleanup(base) }
  base = tmpBase(); try { seedId(base); seedOp(base, { stopAt: 'approved' }); seedPs(base); assert.equal(compose(base).status, S.HYBRID_PERSONA_NOT_READY) } finally { cleanup(base) }
})
test('personality absent / review_ready / approved -> NOT_READY', () => {
  let base = tmpBase(); try { seedId(base); seedOp(base); const r = compose(base); assert.equal(r.status, S.HYBRID_PERSONA_NOT_READY); assert.equal(r.reason, 'PERSONALITY_STORE_ABSENT') } finally { cleanup(base) }
  base = tmpBase(); try { seedId(base); seedOp(base); seedPs(base, { stopAt: 'review_ready' }); assert.equal(compose(base).reason, 'PERSONALITY_NOT_ACTIVE') } finally { cleanup(base) }
  base = tmpBase(); try { seedId(base); seedOp(base); seedPs(base, { stopAt: 'approved' }); assert.equal(compose(base).reason, 'PERSONALITY_NOT_ACTIVE') } finally { cleanup(base) }
})

// ---- verification failures (exit 2) ---------------------------------------
test('identity drift (tampered identity text) -> IDENTITY_VERIFICATION_FAILED / 2', () => {
  const base = tmpBase()
  try {
    seedId(base, { payload: { format: 'verbatim', section: 'identity', text: P.slice(0, 807) + 'X' } }); seedOp(base); seedPs(base)
    const r = compose(base); assert.equal(r.status, S.IDENTITY_VERIFICATION_FAILED); assert.equal(C.exitCodeFor(r.status), 2)
  } finally { cleanup(base) }
})
test('OP payload drift -> OP_VERIFICATION_FAILED / 2', () => {
  const base = tmpBase()
  try {
    const bad = clone(op.buildOperatingPrinciplesPayload(P)); bad.fragments[0].text += 'X'; bad.aggregateSha256 = op.computeAggregateSha256(bad)
    seedId(base); seedOp(base, { payload: bad }); seedPs(base)
    assert.equal(C.exitCodeFor(compose(base).status), 2)
  } finally { cleanup(base) }
})
test('personality payload drift -> PERSONALITY_VERIFICATION_FAILED / 2', () => {
  const base = tmpBase()
  try {
    const bad = clone(ps.buildPersonalityPayload(P)); bad.fragments[0].text += 'X'; bad.aggregateSha256 = ps.computeAggregateSha256(bad)
    seedId(base); seedOp(base); seedPs(base, { payload: bad })
    assert.equal(C.exitCodeFor(compose(base).status), 2)
  } finally { cleanup(base) }
})
test('ambiguous identity / OP / personality -> AMBIGUOUS_ACTIVE_STATE / 2', () => {
  let base = tmpBase()
  try { seedId(base, { revisionId: 'a' }); seedId(base, { revisionId: 'b', supersedes: 'a' }); seedOp(base); seedPs(base); assert.equal(compose(base).status, S.AMBIGUOUS_ACTIVE_STATE) } finally { cleanup(base) }
  base = tmpBase()
  try { seedId(base); seedOp(base, { revisionId: 'a' }); seedOp(base, { revisionId: 'b', supersedes: 'a' }); seedPs(base); assert.equal(compose(base).status, S.AMBIGUOUS_ACTIVE_STATE) } finally { cleanup(base) }
  base = tmpBase()
  try { seedId(base); seedOp(base); seedPs(base, { revisionId: 'a' }); seedPs(base, { revisionId: 'b', supersedes: 'a' }); assert.equal(compose(base).status, S.AMBIGUOUS_ACTIVE_STATE) } finally { cleanup(base) }
})
test('corrupt store -> STORE_CORRUPT / 2', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const dir = path.join(base, op.OP_STORE, 'records', op.OP_RECORD_ID); const f = fs.readdirSync(dir).find((n) => n.endsWith('.json')); fs.writeFileSync(path.join(dir, f), '{ broken')
    assert.equal(compose(base).status, S.STORE_CORRUPT)
  } finally { cleanup(base) }
})
test('broken M3a mapping -> MAPPING_CONTRACT_ERROR / 3', () => {
  const base = tmpBase()
  try { seedTriple(base); const r = C.composeHybridPersona(base, { personaIdentity: 'not-persona' }); assert.equal(r.status, S.MAPPING_CONTRACT_ERROR); assert.equal(C.exitCodeFor(r.status), 3) } finally { cleanup(base) }
})

// ---- safe output / zero-write / runtime isolation -------------------------
test('safe metadata never leaks persona / tail / behavioral / fragment text', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const r = compose(base)
    const s = JSON.stringify(r.safeMetadata)
    for (const leak of ['香香', '思考順序', '表達風格', P.slice(0, 807), P.slice(807, 1586), P.slice(1586)]) assert.equal(s.includes(leak), false)
  } finally { cleanup(base) }
})
test('compose performs no filesystem writes', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const hashTree = (d) => { const out = {}; const walk = (x, rel) => { for (const nm of fs.readdirSync(x)) { const p = path.join(x, nm), rr = rel ? rel + '/' + nm : nm; if (fs.statSync(p).isDirectory()) walk(p, rr); else out[rr] = require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex') } }; walk(d, ''); return out }
    const before = hashTree(base); compose(base); assert.deepEqual(hashTree(base), before)
  } finally { cleanup(base) }
})
test('PERSONA_IDENTITY unchanged; buildPersonaSystem byte-identical; runtime reachability 0', () => {
  assert.equal(P.length, 3116)
  assert.equal(buildPersonaSystem('X'), buildPersonaSystem('X')); assert.ok(buildPersonaSystem('X').includes(P))
  const SRC = path.resolve(__dirname, '../../src')
  const resolveReq = (d, rel) => { const b = path.resolve(d, rel); for (const c of [b, b + '.js', path.join(b, 'index.js')]) { try { if (fs.statSync(c).isFile()) return c } catch (e) {} } return null }
  const reach = (entry) => { const seen = new Set(); const st = [path.resolve(entry)]; while (st.length) { const f = st.pop(); if (seen.has(f)) continue; seen.add(f); let s; try { s = fs.readFileSync(f, 'utf8') } catch (e) { continue } const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g; let m; while ((m = re.exec(s))) { const t = resolveReq(path.dirname(f), m[1]); if (t) st.push(t) } } return seen }
  for (const e of ['index.js', 'app.js']) assert.deepEqual([...reach(path.join(SRC, e))].filter((f) => /[\\/]core[\\/]memory[\\/]/.test(f)), [])
})

// ---- CLI ------------------------------------------------------------------
function runCli (base, env = {}) {
  const cli = path.resolve(__dirname, '../../scripts/persona/verifyHybridPersona.js')
  const res = cp.spawnSync(process.execPath, [cli], { env: Object.assign({}, process.env, { AROMA_CORE_DIR: base }, env), encoding: 'utf8' })
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') }
}
test('CLI exit 4 (production-like), exit 0 (triple active, no leak), exit 3 (no AROMA_CORE_DIR)', () => {
  const base = tmpBase()
  try {
    seedId(base); seedOp(base, { stopAt: 'review_ready' })
    assert.equal(runCli(base).code, 4)
  } finally { cleanup(base) }
  const b2 = tmpBase()
  try {
    seedTriple(b2)
    const ok = runCli(b2); assert.equal(ok.code, 0); assert.ok(ok.out.includes('HYBRID_PERSONA_READY'))
    for (const leak of ['香香', '思考順序', P.slice(0, 807), P.slice(1586)]) assert.equal(ok.out.includes(leak), false)
  } finally { cleanup(b2) }
  const cli = path.resolve(__dirname, '../../scripts/persona/verifyHybridPersona.js')
  const env = Object.assign({}, process.env); delete env.AROMA_CORE_DIR
  assert.equal(cp.spawnSync(process.execPath, [cli], { env, encoding: 'utf8' }).status, 3)
})
test('CLI exit 2 (OP payload drift while triple active)', () => {
  const base = tmpBase()
  try { const bad = clone(op.buildOperatingPrinciplesPayload(P)); bad.fragments[0].text += 'X'; bad.aggregateSha256 = op.computeAggregateSha256(bad); seedId(base); seedOp(base, { payload: bad }); seedPs(base); assert.equal(runCli(base).code, 2) } finally { cleanup(base) }
})

// ---- regressions ----------------------------------------------------------
test('Identity / OP / Personality verifiers still consistent under a valid triple', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    assert.equal(idShadow.verifyIdentityShadow(base, P).status, 'PASS')
    assert.equal(op.verifyOperatingPrinciplesShadow(base, P).status, op.REASON.PASS)
    assert.equal(ps.verifyPersonalityShadow(base, P).status, ps.REASON.PASS)
  } finally { cleanup(base) }
})
