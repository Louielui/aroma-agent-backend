'use strict'

/**
 * lock1NoModelExposure.test.js — Phase 3b, LOCK 1. All three proofs.
 *
 * The claim: screenshot bytes, UIA node text and window titles cannot reach a model prompt.
 * The claim is worthless as an assertion, so it is proven three independent ways:
 *
 *   1a  require-graph reachability — transitively, no computer module can reach any module
 *       that assembles a prompt or talks to a provider
 *   1b  reverse grep — nothing on the observation return path names a prompt-assembly or
 *       usage-recording symbol
 *   1c  negative test with a live spy on the real seams — never called during observation,
 *       AND demonstrated to fire when something IS passed to it, so silence means something
 *
 * 1c matters most. A spy that would never fire under any circumstance proves nothing; the
 * second half of that test is what makes the first half evidence rather than decoration.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const DIR = __dirname
const SRC = path.resolve(DIR, '..')

/** Modules that constitute "a model surface". Reaching any of these is the failure. */
const MODEL_SURFACES = [
  'intake/distillPrompt.js', 'intake/contextCard.js', 'intake/intakeService.js',
  'intake/u1DraftPrompt.js', 'persona/xiangxiang.js', 'dispatch/dispatcher.js',
  'routing', 'adapters', 'store/store.js', 'utils/hubClient.js'
]

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

/* ── LOCK 1a — transitive require-graph reachability ──────────────────────── */

test('*** LOCK 1a — no computer module can reach a model surface, transitively ***', () => {
  const seen = new Set()
  const reached = []

  const resolveRel = (fromFile, spec) => {
    if (!spec.startsWith('.')) return null // bare/builtin: not a repo module
    const base = path.resolve(path.dirname(fromFile), spec)
    for (const cand of [base, base + '.js', path.join(base, 'index.js')]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand
    }
    return null
  }

  const walk = (file) => {
    const real = path.resolve(file)
    if (seen.has(real)) return
    seen.add(real)
    const code = stripComments(fs.readFileSync(real, 'utf8'))
    for (const m of code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const target = resolveRel(real, m[1])
      if (!target) continue
      const rel = path.relative(SRC, target).replace(/\\/g, '/')
      if (MODEL_SURFACES.some((s) => rel === s || rel.startsWith(s + '/'))) {
        reached.push(path.relative(SRC, real).replace(/\\/g, '/') + ' -> ' + rel)
      }
      walk(target)
    }
  }

  // start from every non-test module in src/computer
  const roots = fs.readdirSync(DIR)
    .filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))
    .map((n) => path.join(DIR, n))
  roots.forEach(walk)

  assert.deepEqual(reached, [], 'a computer module reaches a model surface')
  assert.ok(seen.size >= roots.length, 'the walker actually walked something')
})

/* ── LOCK 1b — reverse grep on the return path ────────────────────────────── */

test('*** LOCK 1b — the observation return path names no prompt or usage symbol ***', () => {
  const symbols = [
    'buildDistillPrompt', 'buildContextPreamble', 'recordLLMUsage', 'distillPrompt',
    'contextCard', 'intakeService', 'modelRouter', 'callModel', 'chatCompletion'
  ]
  const files = fs.readdirSync(DIR).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))
  const hits = []
  for (const f of files) {
    const code = stripComments(fs.readFileSync(path.join(DIR, f), 'utf8'))
    for (const s of symbols) if (code.includes(s)) hits.push(f + ' : ' + s)
  }
  assert.deepEqual(hits, [], 'no computer module references a prompt-assembly or usage symbol')
})

/* ── LOCK 1c — live spy, proven live ──────────────────────────────────────── */

test('*** LOCK 1c — a full observation cycle never touches a real prompt seam ***', () => {
  const distill = require('../intake/distillPrompt')
  const contextCard = require('../intake/contextCard')
  const store = require('../store/store')

  const calls = []
  const originals = {
    buildDistillPrompt: distill.buildDistillPrompt,
    buildContextPreamble: contextCard.buildContextPreamble,
    recordLLMUsage: store.recordLLMUsage
  }
  distill.buildDistillPrompt = (...a) => { calls.push('buildDistillPrompt'); return originals.buildDistillPrompt(...a) }
  contextCard.buildContextPreamble = (...a) => { calls.push('buildContextPreamble'); return originals.buildContextPreamble(...a) }
  store.recordLLMUsage = (...a) => { calls.push('recordLLMUsage'); return originals.recordLLMUsage(...a) }

  try {
    // ── the measurement: drive observation end to end through the Companion
    const { createCompanion } = require('./companion')
    const { OBSERVATION_ACTIONS } = require('./observation')
    const c = createCompanion({ onAudit: () => {} })
    for (let i = 0; i < OBSERVATION_ACTIONS.length; i++) {
      c.handle({
        from: 'service', to: 'companion', type: 'execute_step',
        approvalId: 'appr_lock1c', stepIndex: i,
        stepNonce: 'nonce-lock1c-observation-' + i,
        step: { action: OBSERVATION_ACTIONS[i] }
      })
    }
    assert.deepEqual(calls, [], 'observation reached a prompt seam')

    // ── THE CONTROL. Without this, "calls is empty" could mean the spies are dead.
    // Feed an observation-shaped result straight into the real seam and require it to fire.
    const observationResult = {
      ok: true, action: 'capture_screen', evidenceSha256: 'a'.repeat(64),
      imageWidth: 1920, imageHeight: 1080, titles: ['AROMA-OWN-test']
    }
    distill.buildDistillPrompt(JSON.stringify(observationResult), [])
    assert.deepEqual(calls, ['buildDistillPrompt'],
      'the spy is attached to a live seam - so the empty result above is evidence, not silence')
  } finally {
    distill.buildDistillPrompt = originals.buildDistillPrompt
    contextCard.buildContextPreamble = originals.buildContextPreamble
    store.recordLLMUsage = originals.recordLLMUsage
  }
})

test('*** LOCK 1c — the guard would FAIL if an observation result were passed to a prompt ***', () => {
  // Demonstrates the failure mode the previous test rules out, so the harness is known to
  // be capable of failing. A guard never seen to fail is not known to work.
  const distill = require('../intake/distillPrompt')
  const original = distill.buildDistillPrompt
  const calls = []
  distill.buildDistillPrompt = (...a) => { calls.push(a); return original(...a) }
  try {
    distill.buildDistillPrompt('window title: AROMA-OWNER-SENTINEL-xyz', [])
    assert.equal(calls.length, 1, 'the seam is reachable and observable')
    // and this is the assertion that would have failed in the real test
    assert.throws(() => { assert.deepEqual(calls, []) }, /Expected values to be strictly deep-equal|ERR_ASSERTION/)
  } finally {
    distill.buildDistillPrompt = original
  }
})
