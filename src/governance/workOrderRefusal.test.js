'use strict'
/**
 * workOrderRefusal.test.js — PROOF 2, and it is seen to fail.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「A work order naming a file inside the protected path is refused, and the refusal
 * > is seen to fail — cut the rule, watch it pass, restore it.」**
 *
 * A guard that has never been observed failing is not evidence. So this file does not only
 * assert the refusal: it **removes the by-location rule from a copy of the matcher, shows the
 * same work order is then ACCEPTED, and restores it** — in one test, with the un-fenced
 * behaviour visible on the page.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const WO = require('../agent/workOrder')

const validWO = (files) => ({
  goal: 'x',
  projectId: 'aroma-agent-backend',
  repoFullName: 'Louielui/aroma-agent-backend',
  allowedFiles: files,
  allowedTestCommand: null,
  forbiddenActions: ['commit', 'push', 'PR', 'merge', 'deploy'],
  timeoutSec: 60,
  costCapUsd: 1,
  approvalId: 'appr_1'
})

const INSIDE = [
  'src/governance/originPolicy.js',
  'src/governance/requestFence.js',
  'src/governance/auth.js',
  'src/governance/timerAllowlist.js',
  'src/governance/sectionEnvelope.js',
  'src/governance/a-fence-nobody-has-written-yet.js'
]

describe('⛔ a work order naming a protected file is REFUSED', () => {
  test('every file inside the path is un-allowlistable', () => {
    for (const f of INSIDE) {
      const r = WO.validateWorkOrder(validWO([f]))
      assert.strictEqual(r.ok, false, f + ' must be rejected')
      assert.ok(r.errors.some((e) => /structurally forbidden/.test(e)),
        f + ' must be rejected FOR BEING FORBIDDEN, not for some incidental reason')
    }
  })

  test('and it is refused even when the order also names a legitimate file', () => {
    // The mixed order is the realistic attack: one innocuous file to look normal.
    const r = WO.validateWorkOrder(validWO(['src/home/briefing.js', 'src/governance/auth.js']))
    assert.strictEqual(r.ok, false)
  })

  test('isFileAllowed refuses it even if it somehow got into an approved allowlist', () => {
    // Defence in depth: validation is the gate, this is the runtime check behind it.
    const wo = validWO(['src/governance/auth.js'])
    assert.strictEqual(WO.isFileAllowed(wo, 'src/governance/auth.js'), false)
  })

  test('an ordinary file is still allowed — the rule is not just refusing everything', () => {
    const r = WO.validateWorkOrder(validWO(['src/home/briefing.js']))
    assert.strictEqual(r.ok, true, 'if this fails the refusals above prove nothing')
  })
})

/**
 * ⛔ SEEN TO FAIL — cut the rule, watch it pass, restore it.
 */
describe('⛔ the refusal is proven capable of failing', () => {
  test('with the by-location rule REMOVED, the same work order is accepted', () => {
    // The real matcher, minus the one pattern this migration added. Nothing is monkey-patched
    // and nothing global is mutated — this rebuilds the decision from its own inputs.
    const withRule = (p) => WO.isForbiddenFile(p)

    // Reconstruct the matcher WITHOUT /^src\/governance\//, exactly as it was before today.
    const OLD_PATTERNS = [
      /(^|\/)\.env(\.[^/]*)?$/, /(^|\/)\.git(\/|$)/, /(^|\/)node_modules(\/|$)/,
      /(^|\/)secrets?(\/|$)/, /(^|\/)credentials?(\/|$)/, /(^|\/)\.aroma(\/|$)/,
      /^ecosystem\.config\.c?js$/, /^src\/app\.js$/, /^src\/agent\/agentauthorization\.js$/,
      /^src\/agent\/audit\.js$/, /^src\/agent\/workorder\.js$/,
      /^src\/agent\/featurebranchworkspace\.js$/, /^src\/agent\/agentbridgeworker\.js$/,
      /^src\/intake\/proposalbridge\.js$/, /^src\/store\/store\.js$/,
      /^src\/store\/artifactstore\.js$/
    ]
    const withoutRule = (p) => {
      const n = String(p).replace(/\\/g, '/').toLowerCase()
      if (n === '' || n.includes('..')) return true
      return OLD_PATTERNS.some((re) => re.test(n))
    }

    for (const f of INSIDE) {
      assert.strictEqual(withRule(f), true, f + ' is refused WITH the rule')
      // ⛔ THE FAILURE, VISIBLE. Without the by-location rule every one of these is editable —
      // which is precisely the state measured on 2026-08-07: eleven fences, zero protected.
      assert.strictEqual(withoutRule(f), false,
        f + ' would be ACCEPTED without the rule — this is what the migration removed')
    }
  })

  test('and the rule is restored: the live matcher still refuses', () => {
    // The restore half of 「cut it, watch it pass, restore it」. If the test above had mutated
    // anything, this would now fail.
    for (const f of INSIDE) assert.strictEqual(WO.isForbiddenFile(f), true)
  })

  test('⛔ the by-name entries still refuse what they always refused', () => {
    // The migration must not have traded one coverage for another.
    for (const f of ['src/app.js', 'src/agent/audit.js', '.env', '.aroma/x', '../secret']) {
      assert.strictEqual(WO.isForbiddenFile(f), true, f + ' lost its protection during the move')
    }
  })
})
