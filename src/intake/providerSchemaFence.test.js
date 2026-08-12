'use strict'

/**
 * providerSchemaFence.test.js — no production schema may use a keyword Anthropic rejects.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THIS RULE EXISTED, IN A COMMENT, IN ONE FILE, AND DID NOT TRAVEL.
 *
 * `a4Contract.js` fixed exactly this at 237b732 — 「anyOf, not a union type carrying an enum —
 * the field that 400s Claude」 — and wrote the reason into its own header. B was built in
 * parallel, repeated BOTH mistakes, and 400'd 100% of production turns for 265ms each while
 * every harness run passed, because the harness ran on OpenAI and OpenAI accepts them.
 *
 * That is HR-66's fourth instance and the first one caught by the DEFECT rather than by
 * anybody reading the sibling file. A comment is not a mechanism. This is the mechanism.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ IT WALKS A DIRECTORY, SO FILES THAT DO NOT EXIST YET ARE COVERED ──────
 * The point of a survey test (HR-69): a schema written six months from now by someone who
 * never read a4Contract.js is red on the day it is written.
 *
 * ── MEASURED, BOTH OF THEM, AGAINST THE REAL API ────────────────────────────
 *   maxItems      → 400 「For 'array' type, property 'maxItems' is not supported」
 *   union+enum    → 400 「Enum value 'aroma_system.inventory' does not match declared
 *                        type '['string', 'null']'」
 * Not reasoned from the spec. Both were real requests that failed.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.resolve(__dirname, '..')

function productionFiles (dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n)
    if (fs.statSync(p).isDirectory()) { if (n !== 'node_modules') productionFiles(p, out); continue }
    if (/\.js$/.test(n) && !/\.test\.js$/.test(n)) out.push(p)
  }
  return out
}

/** Comments carry the explanation of these very keywords, so they are stripped before matching. */
function codeOnly (src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
}

/** Only files that actually build a provider schema are in scope. */
function buildsASchema (code) {
  return /responseFormat|json_schema|Schema\s*\(|SCHEMA\s*=/.test(code) && /type:\s*'(object|array)'/.test(code)
}

test('*** ⛔ no production schema uses maxItems — Anthropic rejects the request ***', () => {
  /**
   * ⛔ `maxItems` ONLY. THE FIRST VERSION OF THIS TEST ALSO BANNED `minItems`, AND THAT WAS AN
   * ASSERTION BEYOND THE EVIDENCE.
   *
   * The measured 400 named `maxItems` and nothing else. Banning its neighbour was me inferring
   * a family from one member — the exact move this file exists to stop. It immediately flagged
   * `intake/answerPlan.js`, whose `minItems: 1` is live and correct.
   *
   * So both were measured separately against the real API rather than reasoned about:
   *     minItems only  → ACCEPTED
   *     maxItems only  → REJECTED  「For 'array' type, property 'maxItems' is not supported」
   *
   * A fence that fires on a healthy file teaches people to ignore fences (HR-63).
   */
  const offenders = []
  for (const f of productionFiles(SRC)) {
    const code = codeOnly(fs.readFileSync(f, 'utf8'))
    if (!buildsASchema(code)) continue
    if (/\bmaxItems\s*:/.test(code)) offenders.push(path.relative(SRC, f).replace(/\\/g, '/'))
  }
  assert.deepEqual(offenders, [],
    '⛔ Anthropic 400s the whole request: 「For \'array\' type, property \'maxItems\' is not ' +
    'supported」. Bound the array in the SERVER-SIDE judge instead — that is the authoritative ' +
    'check anyway, and it is the half that travels.')
})

test('*** ⛔ no production schema pairs a union type with an enum — use anyOf ***', () => {
  // `type: ['string','null']` beside `enum:` on the same property. Anthropic rejects it;
  // OpenAI accepts it, which is precisely why this cannot be left to whichever provider the
  // harness happened to use.
  const offenders = []
  const UNION_WITH_ENUM = /type:\s*\[\s*'[^']+'\s*,\s*'[^']+'\s*\][^}]{0,120}?\benum\s*:/
  for (const f of productionFiles(SRC)) {
    const code = codeOnly(fs.readFileSync(f, 'utf8'))
    if (!buildsASchema(code)) continue
    if (UNION_WITH_ENUM.test(code)) offenders.push(path.relative(SRC, f).replace(/\\/g, '/'))
  }
  assert.deepEqual(offenders, [],
    '⛔ 「Enum value X does not match declared type [\'string\',\'null\']」. Spell it:\n' +
    '    anyOf: [{ type: \'string\', enum: [...] }, { type: \'null\' }]\n' +
    'Plain JSON Schema, accepted by both providers, same accepted values.')
})

test('*** ⛔ the fence can see the shapes it is built for ***', () => {
  // A fence that matches nothing is a fence that proves nothing. Both patterns are checked
  // against the exact source text that was measured failing.
  const bad1 = "const s = { responseFormat: 1, type: 'array', maxItems: 4 }"
  const okMin = "const s = { responseFormat: 1, type: 'array', minItems: 1 }"
  const bad2 = "const s = { responseFormat: 1, type: 'object', operation: { type: ['string', 'null'], enum: names() } }"
  assert.ok(/\bmaxItems\s*:/.test(bad1), 'maxItems is detectable')
  // ⛔ AND ITS NEIGHBOUR IS NOT. `minItems` was MEASURED accepted; flagging it would fire on
  // answerPlan.js, which is healthy. The control asserts the fence's restraint, not only its reach.
  assert.equal(/\bmaxItems\s*:/.test(okMin), false, 'minItems is measured ACCEPTED and stays unflagged')
  assert.ok(/type:\s*\[\s*'[^']+'\s*,\s*'[^']+'\s*\][^}]{0,120}?\benum\s*:/.test(bad2), 'union+enum is detectable')
  // And the accepted spelling must NOT trip it.
  const good = "operation: { anyOf: [{ type: 'string', enum: names() }, { type: 'null' }] }"
  assert.equal(/type:\s*\[\s*'[^']+'\s*,\s*'[^']+'\s*\][^}]{0,120}?\benum\s*:/.test(good), false,
    'anyOf is not flagged')
})
