'use strict'

/**
 * personaSourceIntegration.test.js — R2 narrow runtime integration.
 *
 * Drives processIntake in demo mode with a fake adapter that CAPTURES the system
 * prompt then stops the pipeline, proving:
 *   - legacy demo system prompt is byte-identical to buildPersonaSystem(distill);
 *   - hybrid READY yields the same bytes (behavior-neutral) and hybrid text reaches
 *     the model only via the persona slot;
 *   - hybrid fail-closed never calls the adapter;
 *   - shadow always sends legacy; hybrid text is never sent;
 *   - the non-demo path is unchanged.
 * Fixtures are isolated temp dirs.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { processIntake } = require('../../src/intake/intakeService')
const { buildDistillPrompt } = require('../../src/intake/distillPrompt')
const { buildPersonaSystemFromPersona, ACTION_HONESTY_GUARD, PERSONA_IDENTITY: P } = require('../../src/persona/xiangxiang')

// B2-2 reply grounding (Change C): the demo path injects the trusted
// ACTION_HONESTY_GUARD between the data-boundary guard and the classifier. The
// expected demo system prompt mirrors exactly what intakeService composes.
const expectedDemoSystem = (distillSystem) => buildPersonaSystemFromPersona(P, distillSystem, { extraGuards: [ACTION_HONESTY_GUARD] })
const PSsel = require('../../src/persona/personaSource')
const op = require('../../src/core/memory/shadow/operatingPrinciplesShadow')
const ps = require('../../src/core/memory/shadow/personalityShadow')
const idShadow = require('../../src/core/memory/shadow/identityShadow')
const { tmpBase, cleanup, createRev, ev } = require('../core/memory/_helpers')

const MSG = 'hello'

function seedActive (base, storeName, recordId, payload) {
  const rev = createRev(base, storeName, recordId, { payload })
  ev(base, storeName, recordId, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
  ev(base, storeName, recordId, rev.revisionId, 'APPROVED', 'review_ready', { approval: { approvedBy: 'Louie', decision: 'approved' } })
  ev(base, storeName, recordId, rev.revisionId, 'ACTIVATED', 'approved')
  return rev
}
function seedTriple (base) {
  seedActive(base, 'identity', idShadow.IDENTITY_RECORD_ID, { format: 'verbatim', section: 'identity', text: P.slice(0, 807) })
  seedActive(base, op.OP_STORE, op.OP_RECORD_ID, op.buildOperatingPrinciplesPayload(P))
  seedActive(base, ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID, ps.buildPersonalityPayload(P))
}

// A fake adapter that captures the system prompt then stops the pipeline.
function capturingAdapter () {
  const state = { captured: null, calls: 0 }
  const adapter = { async complete (prompt, o) { state.calls++; state.captured = o.system; throw new Error('STOP_AFTER_CAPTURE') } }
  return { adapter, state }
}

async function driveDemo (personaSource) {
  const { adapter, state } = capturingAdapter()
  let error = null
  try { await processIntake(MSG, adapter, [], { demo: true, personaSource }) } catch (e) { error = e }
  return { state, error }
}

test('legacy demo: system prompt == persona + guards(incl. honesty) + distill', async () => {
  const src = PSsel.createPersonaSource({ env: { PERSONA_SOURCE: 'legacy' } })
  const { state } = await driveDemo(src)
  assert.equal(state.calls, 1)
  const { system } = buildDistillPrompt(MSG, [])
  assert.equal(state.captured, expectedDemoSystem(system))
})

test('hybrid READY: system prompt byte-identical to legacy (behavior-neutral)', async () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const src = PSsel.createPersonaSource({ env: { PERSONA_SOURCE: 'hybrid' }, coreDir: base })
    const { state } = await driveDemo(src)
    assert.equal(state.calls, 1)
    const { system } = buildDistillPrompt(MSG, [])
    assert.equal(state.captured, expectedDemoSystem(system)) // hybrid persona === legacy PERSONA_IDENTITY (same guards)
  } finally { cleanup(base) }
})

test('hybrid NOT_READY: adapter NEVER called, fail-closed error (no persona text)', async () => {
  const base = tmpBase()
  try {
    // OP review_ready only -> hybrid not ready
    seedActive(base, 'identity', idShadow.IDENTITY_RECORD_ID, { format: 'verbatim', section: 'identity', text: P.slice(0, 807) })
    const rev = createRev(base, op.OP_STORE, op.OP_RECORD_ID, { payload: op.buildOperatingPrinciplesPayload(P) })
    ev(base, op.OP_STORE, op.OP_RECORD_ID, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
    const src = PSsel.createPersonaSource({ env: { PERSONA_SOURCE: 'hybrid' }, coreDir: base })
    const { state, error } = await driveDemo(src)
    assert.equal(state.calls, 0) // model never called
    assert.ok(error && error.code === 'PERSONA_SOURCE_UNAVAILABLE')
    assert.equal(/香香|思考順序/.test(JSON.stringify(error.reason || '')), false)
  } finally { cleanup(base) }
})

test('shadow: adapter receives legacy system; hybrid text never sent', async () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const src = PSsel.createPersonaSource({ env: { PERSONA_SOURCE: 'shadow' }, coreDir: base })
    const { state } = await driveDemo(src)
    assert.equal(state.calls, 1)
    const { system } = buildDistillPrompt(MSG, [])
    assert.equal(state.captured, expectedDemoSystem(system)) // legacy persona text (also byte-identical to hybrid here); honesty guard present
  } finally { cleanup(base) }
})

test('non-demo path is unchanged: system is the raw distill system (no persona)', async () => {
  const { adapter, state } = capturingAdapter()
  try { await processIntake(MSG, adapter, [], {}) } catch (e) { /* STOP */ }
  const { system } = buildDistillPrompt(MSG, [])
  assert.equal(state.captured, system) // no persona slot at all
})
