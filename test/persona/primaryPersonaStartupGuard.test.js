'use strict'

/**
 * primaryPersonaStartupGuard.test.js — Runtime Guard.
 *
 * Pure decision tests for the hybrid-primary Memory-readiness guard (delegates to the
 * R1/R2 persona-source readiness path; never re-implements the verifier), plus the
 * request-time fail-close contract, the legacy byte-identity/memory-free guarantees,
 * a static reachability assertion, and child-process boot tests. No test points at
 * the real production core dir; child processes are always terminated + cleaned up.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')
const G = require('../../src/persona/primaryPersonaStartupGuard')
const { createPersonaSource, PersonaSourceUnavailableError } = require('../../src/persona/personaSource')
const { evaluateStartupConfig } = require('../../src/persona/processRole')
const { buildPersonaSystem, buildPersonaSystemFromPersona, PERSONA_IDENTITY: P } = require('../../src/persona/xiangxiang')
const { runtimeReachability } = require('../../src/core/memory/shadow/behavioralReconstitution')
const op = require('../../src/core/memory/shadow/operatingPrinciplesShadow')
const ps = require('../../src/core/memory/shadow/personalityShadow')
const idShadow = require('../../src/core/memory/shadow/identityShadow')
const { tmpBase, cleanup, createRev, ev } = require('../core/memory/_helpers')

const BACKEND = path.resolve(__dirname, '../..')
const noop = () => {}

// --- seeding (same shape as personaCanaryHealth.test.js) -------------------
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
function seedIdentity (base, over) { return seedActive(base, 'identity', idShadow.IDENTITY_RECORD_ID, idP(), over) }
function seedOP (base, over) { return seedActive(base, op.OP_STORE, op.OP_RECORD_ID, op.buildOperatingPrinciplesPayload(P), over) }
function seedPS (base, over) { return seedActive(base, ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID, ps.buildPersonalityPayload(P), over) }
function seedTriple (base) { seedIdentity(base); seedOP(base); seedPS(base) }
const hybridSrc = (base) => createPersonaSource({ env: { PERSONA_SOURCE: 'hybrid' }, coreDir: base, telemetrySink: noop })
const legacySrc = () => createPersonaSource({ env: { PERSONA_SOURCE: 'legacy' }, telemetrySink: noop })
const cfg = (processRole, personaSourceMode) => ({ processRole, personaSourceMode })

// ===========================================================================
// 1 + 2 + 14. legacy is allowed WITHOUT touching Memory; byte-identical
// ===========================================================================
test('primary + legacy -> allow, memory-free (getPersonaSource NEVER called)', () => {
  const d = G.evaluatePrimaryPersonaStartup(cfg('primary', 'legacy'), { getPersonaSource: () => { throw new Error('must not be called in legacy') } })
  assert.equal(d.allow, true); assert.equal(d.code, G.LEGACY_CODE); assert.equal(d.memoryRead, false)
})
test('unset PERSONA_SOURCE resolves to primary+legacy -> allow, memory-free', () => {
  const c = evaluateStartupConfig({}) // {} -> primary + legacy
  assert.equal(c.processRole, 'primary'); assert.equal(c.personaSourceMode, 'legacy')
  const d = G.evaluatePrimaryPersonaStartup(c, { getPersonaSource: () => { throw new Error('must not be called') } })
  assert.equal(d.allow, true); assert.equal(d.memoryRead, false)
})
test('guard present but not cut over: legacy output byte-identical + source serves frozen persona', () => {
  assert.equal(buildPersonaSystemFromPersona(P, 'X'), buildPersonaSystem('X')) // byte-identical composition
  const rp = legacySrc().runtimePersona()
  assert.equal(rp.mode, 'legacy'); assert.equal(rp.personaText, P) // legacy serves the frozen persona
})

// ===========================================================================
// 3. all stores active + byte-identical -> allow (READY, memory read)
// ===========================================================================
test('primary + hybrid + all stores active/byte-identical -> allow (READY)', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const src = hybridSrc(base)
    assert.equal(src.ready, true) // composer READY (byte-identical)
    const d = G.evaluatePrimaryPersonaStartup(cfg('primary', 'hybrid'), { getPersonaSource: () => src })
    assert.equal(d.allow, true); assert.equal(d.code, G.READY_CODE); assert.equal(d.memoryRead, true)
  } finally { cleanup(base) }
})

// ===========================================================================
// 4-6 + 10. missing/inactive store, empty/corrupt Memory -> deny (real composer)
// ===========================================================================
test('Identity missing/inactive -> deny (NOT_READY)', () => {
  const base = tmpBase()
  try { seedOP(base); seedPS(base) /* no identity */
    const d = G.evaluatePrimaryPersonaStartup(cfg('primary', 'hybrid'), { getPersonaSource: () => hybridSrc(base) })
    assert.equal(d.allow, false); assert.equal(d.code, G.NOT_READY_CODE)
  } finally { cleanup(base) }
})
test('OP missing/inactive -> deny', () => {
  const base = tmpBase()
  try { seedIdentity(base); seedPS(base); seedOP(base, { stopAt: 'review_ready' }) /* OP not active */
    const d = G.evaluatePrimaryPersonaStartup(cfg('primary', 'hybrid'), { getPersonaSource: () => hybridSrc(base) })
    assert.equal(d.allow, false); assert.equal(d.code, G.NOT_READY_CODE)
  } finally { cleanup(base) }
})
test('Personality missing/inactive -> deny', () => {
  const base = tmpBase()
  try { seedIdentity(base); seedOP(base); seedPS(base, { stopAt: 'approved' }) /* PS approved, not active */
    const d = G.evaluatePrimaryPersonaStartup(cfg('primary', 'hybrid'), { getPersonaSource: () => hybridSrc(base) })
    assert.equal(d.allow, false); assert.equal(d.code, G.NOT_READY_CODE)
  } finally { cleanup(base) }
})
test('Memory unavailable/corrupt (getPersonaSource throws) -> deny (fail-closed)', () => {
  const d = G.evaluatePrimaryPersonaStartup(cfg('primary', 'hybrid'), { getPersonaSource: () => { const e = new Error('boom'); e.code = 'PERSONA_SOURCE_UNAVAILABLE'; throw e } })
  assert.equal(d.allow, false); assert.equal(d.code, G.NOT_READY_CODE); assert.equal(d.reason, 'PERSONA_SOURCE_UNAVAILABLE')
})

// ===========================================================================
// 7 + 8 + 9. pin drift / payload-hash / behavioral mismatch -> deny
//   (the composer maps all of these to ready:false; the guard denies on ready!==true
//    or drift. Fakes isolate the guard's contract; the composer's own tests cover the
//    specific mismatch->not-ready mapping.)
// ===========================================================================
test('resolver/pin drift (ready but driftReason set) -> deny', () => {
  const d = G.evaluatePrimaryPersonaStartup(cfg('primary', 'hybrid'), { getPersonaSource: () => ({ ready: true, driftReason: () => 'PERSONA_SOURCE_PIN_DRIFT' }) })
  assert.equal(d.allow, false); assert.equal(d.code, G.NOT_READY_CODE); assert.equal(d.reason, 'PERSONA_SOURCE_PIN_DRIFT')
})
test('payload/hash mismatch (composer not ready) -> deny', () => {
  const d = G.evaluatePrimaryPersonaStartup(cfg('primary', 'hybrid'), { getPersonaSource: () => ({ ready: false, initStatus: 'FULL_PERSONA_HASH_MISMATCH' }) })
  assert.equal(d.allow, false); assert.equal(d.code, G.NOT_READY_CODE); assert.equal(d.reason, 'FULL_PERSONA_HASH_MISMATCH')
})
test('behavioral reconstruction mismatch (composer not ready) -> deny', () => {
  const d = G.evaluatePrimaryPersonaStartup(cfg('primary', 'hybrid'), { getPersonaSource: () => ({ ready: false, initStatus: 'BEHAVIORAL_RECONSTITUTION_FAILED' }) })
  assert.equal(d.allow, false); assert.equal(d.code, G.NOT_READY_CODE); assert.equal(d.reason, 'BEHAVIORAL_RECONSTITUTION_FAILED')
})

// ===========================================================================
// 11 + 12. primary+shadow (should be config-forbidden; guard denies) ; non-primary
// ===========================================================================
test('primary + shadow reaching the guard -> deny (config guard error)', () => {
  const d = G.evaluatePrimaryPersonaStartup(cfg('primary', 'shadow'), { getPersonaSource: () => { throw new Error('must not be called') } })
  assert.equal(d.allow, false); assert.equal(d.code, G.GUARD_ERROR_CODE)
})
test('non-primary role (persona-canary) -> allow (not this guard concern), memory-free', () => {
  const d = G.evaluatePrimaryPersonaStartup(cfg('persona-canary', 'hybrid'), { getPersonaSource: () => { throw new Error('must not be called') } })
  assert.equal(d.allow, true); assert.equal(d.code, G.NON_PRIMARY_CODE); assert.equal(d.memoryRead, false)
})
test('safeReason collapses non-opaque values (no leak)', () => {
  assert.equal(G.safeReason('HYBRID_PERSONA_NOT_READY'), 'HYBRID_PERSONA_NOT_READY')
  assert.equal(G.safeReason('香香 persona text /Users/x'), 'NOT_READY')
  assert.equal(G.safeReason(undefined), 'NOT_READY')
})

// ===========================================================================
// 13. request-time pin drift -> typed fail-close BEFORE any model call, no fallback
// ===========================================================================
test('request-time drift: hybrid runtimePersona() throws typed error (no legacy fallback)', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const src = hybridSrc(base)
    assert.equal(src.runtimePersona().mode, 'hybrid') // ready before drift
    // cause drift: deprecate the active personality revision -> resolver no longer ACTIVE
    const psRev = require('../../src/core/memory/store').resolveActiveRecord(base, ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID).revisionId
    ev(base, ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID, psRev, 'DEPRECATED', 'active')
    assert.throws(() => src.runtimePersona(), (e) => e instanceof PersonaSourceUnavailableError, 'must fail closed, never return legacy')
  } finally { cleanup(base) }
})

// ===========================================================================
// 15. static reachability index.js/app.js -> core/memory stays 0
// ===========================================================================
test('static reachability from index.js/app.js to core/memory remains 0', () => {
  assert.equal(runtimeReachability(), 0)
})

// ===========================================================================
// 16. child-process boot: ready hybrid boots; (legacy boot + not-ready exit are in
//     processRole.test.js). Always terminate + cleanup; never leave a process/port.
// ===========================================================================
test('child boot: primary+hybrid with an all-active core reaches "Listening", then is stopped', async () => {
  const base = tmpBase()
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r5rg-data-'))
  seedTriple(base)
  const env = Object.assign({}, process.env, {
    HUB_TOKEN: 'test-token', PORT: '18191', AROMA_DATA_DIR: dataDir, AROMA_CORE_DIR: base,
    PERSONA_SOURCE: 'hybrid', CONVERSATION_DEMO: 'off'
  })
  delete env.AROMA_PROCESS_ROLE // default -> primary
  const child = cp.spawn(process.execPath, ['src/index.js'], { cwd: BACKEND, env })
  try {
    const ok = await new Promise((resolve) => {
      let out = ''
      const on = (d) => { out += String(d); if (out.includes('Listening on 127.0.0.1:') && out.includes('PRIMARY_HYBRID_READY')) resolve({ listening: true, out }) }
      child.stdout.on('data', on); child.stderr.on('data', on)
      child.on('exit', () => resolve({ listening: out.includes('Listening on 127.0.0.1:'), out }))
      setTimeout(() => resolve({ listening: out.includes('Listening on 127.0.0.1:'), out }), 15000)
    })
    assert.equal(ok.listening, true, ok.out)
    assert.ok(ok.out.includes('persona startup guard: PRIMARY_HYBRID_READY (memory read)'), ok.out)
  } finally {
    child.kill('SIGKILL')
    fs.rmSync(dataDir, { recursive: true, force: true }); cleanup(base)
  }
})
