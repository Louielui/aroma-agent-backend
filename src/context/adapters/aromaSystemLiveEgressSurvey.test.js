'use strict'

/**
 * aromaSystemLiveEgressSurvey.test.js — THE CATEGORY RULE, ENFORCED BY A DIRECTORY WALK.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE RULE THIS EXISTS FOR: **the production Aroma System default network path has exactly
 * one adapter boundary, and nothing else in `src/` may open a second one.** That names a
 * CATEGORY, so per CLAUDE.md §3 it belongs in a test that walks the DIRECTORY — a file that
 * does not exist yet is covered, and a non-conforming new file is red the day it is written,
 * by an author who never read the rule.
 *
 * ⛔ AND IT PASSES THE FILTER, WHICH IS WHY IT IS REQUIRED RATHER THAN TIDY:
 *
 *   > If this rule were quietly violated, would the Owner get a wrong answer he would believe?
 *
 * YES — measured, not hypothetical (TEST_AROMA_SYSTEM_AMBIENT_CREDENTIAL Phase 0.5): a test
 * calling the production restaurant system through an unfenced default transport stayed GREEN
 * throughout, because the adapter's own fail-soft made the failure indistinguishable from a
 * real outage. A second, unguarded transport anywhere in `src/` would recreate exactly that.
 *
 * ── WHAT THIS DOES **NOT** CLAIM ────────────────────────────────────────────
 * ⚠ It sees a destination only when the destination is a LITERAL in the file. A hidden SDK
 * that constructs the host from parts, or a dynamically-built URL, would not be caught here —
 * the same honestly-stated residual `liveEgressSurvey.test.js` and `googleLiveAuthSurvey.test.js`
 * carry for their own transports.
 *
 * ⚠ `scripts/verify/captureShapes.js` (and its consumer `src/errands/shapeDriftRunner.js`,
 * which imports only the pure `readOne` function from it) holds its OWN independent `fetch()`
 * call to the same production host. It sits OUTSIDE `src/` — this walk, like
 * `liveEgressSurvey.test.js`'s, covers `src/` only — and Phase 0 (TEST_AROMA_SYSTEM_AMBIENT_
 * CREDENTIAL) established it is not reachable from any `.test.js` file (`shapeDriftRunner.js`
 * itself has zero test callers). Recorded, not fixed — a manual/errand script is a different
 * transport class from the automated-test tranche this fence closes.
 *
 * ⚠ Google, GitHub and the model-provider fences are each their own tranche and are not
 * re-verified here.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.resolve(__dirname, '..', '..')
const ADAPTER_FILE = 'context/adapters/aromaSystemRead.js'
const DETECTOR_MODULE = 'testProcess'
const OPT_IN = 'RUN_LIVE_AROMA_SYSTEM_E2E'

/** Every non-test .js file under src/, excluding the browser bundle in demo/assets. */
function walk (dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || p.endsWith(path.join('demo', 'assets'))) continue
      walk(p, out)
    } else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

const rel = (p) => path.relative(SRC, p).split(path.sep).join('/')
const read = (p) => fs.readFileSync(p, 'utf8')

/** Comments stripped with the repo's own pattern — the ':' guard keeps 'https://' intact. */
function codeOnly (src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const FILES = walk(SRC)
const ADAPTER_CODE = codeOnly(read(path.join(SRC, ADAPTER_FILE)))

/* ═══ A/B — THE PRODUCTION DEFAULT PATH IS CONFINED TO ONE FILE ════════ */

/**
 * ⛔ THE HOST. Deliberately the production literal itself, not a loose token — a survey that
 * matched on the word `fetch` alone would flag every one of the other six connectors and every
 * unrelated caller in the codebase, which is precisely the false-positive class the Owner
 * warned against ("do not flag unrelated globalThis.fetch usage ... merely because the token
 * string appears").
 */
const AROMA_HOST_RE = /aromabistro741\.com/
const KEY_LITERAL_RE = /'AROMA_SYSTEM_KEY'/

/**
 * ⛔ ONE NAMED, DOCUMENTED EXCEPTION: `governance/selfDescription.js` surfaces the SAME base
 * URL as informational metadata ("what can she say about herself") — never as a fetch target.
 * It is governance/capability display, explicitly out of this tranche's scope to edit (Owner
 * ruling), and re-declaring the literal there is a DRY nit, not a transport. The test below
 * does not merely allowlist it — it PROVES the file cannot open a socket at all, so the
 * allowlist cannot silently grow to cover a real second transport later.
 */
const SELF_DESCRIPTION_FILE = 'governance/selfDescription.js'

test('*** A — exactly one file can OPEN the production Aroma System host, and it is the adapter ***', () => {
  const naming = FILES.filter((p) => AROMA_HOST_RE.test(codeOnly(read(p)))).map(rel).sort()
  assert.deepEqual(naming, [ADAPTER_FILE, SELF_DESCRIPTION_FILE].sort(),
    '⛔ a new file names the production host — either it is a transport (add the fence, then add ' +
    'it to the adapter side of this list) or it is descriptive metadata (prove it below, as ' +
    SELF_DESCRIPTION_FILE + ' does)')
})

test('*** A — the one named exception performs NO network call of any shape ***', () => {
  const code = codeOnly(read(path.join(SRC, SELF_DESCRIPTION_FILE)))
  for (const re of [/\bfetch\s*\(/, /\baxios\b/, /\.request\s*\(/, /\bhttps?\.\w+\s*\(/]) {
    assert.equal(re.test(code), false,
      '⛔ ' + SELF_DESCRIPTION_FILE + ' names the production host AND can open a socket — it is a second unguarded transport, not descriptive metadata')
  }
})

test('*** B — exactly one file declares the AROMA_SYSTEM_KEY env-var literal ***', () => {
  const naming = FILES.filter((p) => KEY_LITERAL_RE.test(codeOnly(read(p)))).map(rel).sort()
  assert.deepEqual(naming, [ADAPTER_FILE],
    '⛔ a second file declaring the key literal is a second place the credential could be read from')
})

test('*** B — every OTHER production file reaches the key only through the adapter\'s own export ***', () => {
  // liveClients.js is the one legitimate consumer, and it imports KEY_ENV rather than
  // re-declaring the string — proving the single-declaration property is load-bearing, not
  // merely true by coincidence.
  const liveClients = codeOnly(read(path.join(SRC, 'context', 'liveClients.js')))
  assert.match(liveClients, /KEY_ENV\s*:\s*AROMA_KEY_ENV/, 'liveClients.js must import the constant, not restate it')
})

/* ═══ C/D — ONE DETECTOR, ONE HOME, SAME AS EVERY OTHER FENCE ══════════ */

test('*** C — the adapter imports the shared isTestProcess and implements no second one ***', () => {
  assert.match(ADAPTER_CODE, new RegExp('require\\([\'"][^\'"]*' + DETECTOR_MODULE + '[\'"]\\)'),
    '⛔ the fence must take isTestProcess from its one home')
})

test('*** D — no second detector is growing inside the adapter ***', () => {
  for (const tok of ['NODE_TEST_CONTEXT', "'--test'", '.test.js']) {
    assert.equal(ADAPTER_CODE.includes(tok), false, '⛔ «' + tok + '» is a SECOND detector inside aromaSystemRead.js')
  }
  // And isTestProcess itself is defined nowhere but its one home, repo-wide.
  const defining = FILES.filter((p) => /function\s+isTestProcess\s*\(/.test(codeOnly(read(p)))).map(rel)
  assert.deepEqual(defining, [DETECTOR_MODULE + '.js'])
})

/* ═══ E — THE OPT-IN IS THE LITERAL AROMA SYSTEM HAS ITS OWN AUTHORITY FOR ═══ */

test('*** E — the opt-in is RUN_LIVE_AROMA_SYSTEM_E2E === "1", and no borrowed switch ***', () => {
  assert.ok(ADAPTER_CODE.includes("'" + OPT_IN + "'"), '⛔ the adapter must declare its own opt-in name')
  assert.match(ADAPTER_CODE, /===\s*AROMA_OPT_IN_VALUE|===\s*'1'/, '⛔ the check must be against the literal value')
  for (const borrowed of ['RUN_PAID_E2E', 'RUN_LIVE_GOOGLE_E2E']) {
    // The borrowed names may appear only in the REGRESSION-TEST file (proving they grant
    // nothing), never as a literal the PRODUCTION adapter itself checks against.
    assert.equal(ADAPTER_CODE.includes(borrowed), false,
      '⛔ ' + borrowed + ' must not appear in the production adapter — Aroma System has its own authority')
  }
})

/* ═══ F — THE INJECTED-FETCHFN BYPASS IS STRUCTURALLY PRESENT ══════════ */

test('*** F — an injected fetchFn structurally bypasses the fence ***', () => {
  assert.match(ADAPTER_CODE, /typeof\s+options\.fetchFn\s*!==\s*['"]function['"]/,
    '⛔ the usesDefaultFetch condition must exist — without it the fence cannot tell injected from default')
  assert.match(ADAPTER_CODE, /options\.fetchFn/,
    '⛔ the non-default branch must still resolve to the caller\'s own fetchFn')
})

/* ═══ G — THE GUARD DOMINATES DEFAULT FETCH EXECUTION ═══════════════════ */

/**
 * ⛔ PRESENCE ALONE IS NOT THE PROPERTY. A guard placed after the fetch call still lets the
 * request start. So the guard must be the FIRST executable statement of the function that
 * performs the default fetch — brace-depth parsed, the same proof `googleLiveAuthSurvey`
 * uses for `createOAuthClient`.
 */
test('*** G — the guard is the FIRST executable action of the default-transport function ***', () => {
  const start = ADAPTER_CODE.indexOf('function fencedDefaultAromaFetch')
  assert.ok(start > -1, 'fencedDefaultAromaFetch must exist')
  const open = ADAPTER_CODE.indexOf('{', start)
  let depth = 0; let end = -1
  for (let i = open; i < ADAPTER_CODE.length; i++) {
    if (ADAPTER_CODE[i] === '{') depth++
    else if (ADAPTER_CODE[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  assert.ok(end > open, 'fencedDefaultAromaFetch body must be parseable')
  const body = ADAPTER_CODE.slice(open + 1, end)

  const guardAt = body.search(/assertAromaSystemLiveEgressAllowed\s*\(/)
  assert.ok(guardAt > -1, '⛔ fencedDefaultAromaFetch does not invoke the guard at all')

  const fetchAt = body.search(/globalThis\.fetch\s*\(/)
  assert.ok(fetchAt > -1, '⛔ fencedDefaultAromaFetch does not call the default transport at all')
  assert.ok(guardAt < fetchAt, '⛔ the guard runs AFTER the default fetch — a request that started has already left the fence')

  // Nothing executable may precede the guard.
  assert.equal(body.slice(0, guardAt).trim(), '', '⛔ an executable statement precedes the guard')
})

test('*** G — the constructor selects the fenced function for the default path, never a bare reference ***', () => {
  assert.match(ADAPTER_CODE, /usesDefaultFetch\s*\?\s*\(typeof\s+globalThis\.fetch[^:]*fencedDefaultAromaFetch[^:]*:\s*undefined\)\s*:\s*options\.fetchFn/,
    '⛔ the default branch must resolve to the FENCED function, not globalThis.fetch directly')
})

/* ═══ H — RESIDUAL LIMITATIONS, STATED RATHER THAN ARGUED AWAY ══════════
 *
 * This survey proves the LITERAL host and the LITERAL key name have exactly one home in
 * `src/`, and that the one home's default-transport function is guarded first. It does not
 * and cannot prove: a future file that builds the host from string concatenation or template
 * interpolation; a dynamically constructed Authorization scheme; or a second SDK hidden behind
 * an opaque client object. Those residuals are the same class `liveEgressSurvey.test.js` and
 * `googleLiveAuthSurvey.test.js` already carry, stated rather than silently assumed away.
 */
