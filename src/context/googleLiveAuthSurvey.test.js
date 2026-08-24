'use strict'

/**
 * googleLiveAuthSurvey.test.js — THE CATEGORY RULE, ENFORCED BY A DIRECTORY WALK.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE RULE: **the Owner's Google credentials have exactly one reader, exactly one SDK
 * entry point, and the guard runs before either of them can act.** That names a CATEGORY, so
 * per CLAUDE.md §3 it belongs in a test that walks the DIRECTORY — a file that does not exist
 * yet is covered, and a non-conforming new one is red the day it is written, by an author who
 * never read this rule.
 *
 * ⛔ AND IT PASSES THE FILTER, WHICH IS WHY IT IS REQUIRED RATHER THAN TIDY:
 *
 *   > If this rule were quietly violated, would the Owner get a wrong answer he would believe?
 *
 * YES — and it is not hypothetical, it is what was measured. A green canonical run was making
 * 30 authenticated calls with his refresh token, and one test's result was decided by whether
 * those calls succeeded. Green meant "deterministic" and it was not. Prose did not catch that.
 *
 * ── WHAT THIS DOES **NOT** CLAIM ────────────────────────────────────────────
 * ⚠ It sees a credential path only when the path is a LITERAL in the file. A future connector
 * that ships an SDK authenticating internally, builds a secrets path at runtime, or reads
 * credentials from a source it constructs dynamically would NOT be caught. That residual is
 * real and is stated rather than argued away.
 *
 * ⚠ GitHub, Aroma System, model providers and Google WRITE support are deliberately outside
 * this survey. Different transports, different tranche.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.resolve(__dirname, '..')
const AUTH_FILE = 'context/googleAuth.js'
const DETECTOR_MODULE = 'testProcess'
const OPT_IN = 'RUN_LIVE_GOOGLE_E2E'

/** Every non-test .js under src/, excluding the browser bundle. */
function walk (dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || p.endsWith(path.join('demo', 'assets'))) continue
      walk(p, out)
    } else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p)
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
const AUTH_SRC = read(path.join(SRC, AUTH_FILE))
const AUTH_CODE = codeOnly(AUTH_SRC)

/* ═══ A — ONE READER OF THE CREDENTIAL MATERIAL ════════════════════════ */

test('*** A — only googleAuth.js names the Google credential material ***', () => {
  const NAMES = /(SECRETS_DIR|CLIENT_FILE|TOKEN_FILE|google-oauth-client\.json|google-refresh-token\.json|Aroma\\{1,2}secrets)/
  const naming = FILES.filter((p) => NAMES.test(codeOnly(read(p)))).map(rel).sort()
  assert.deepEqual(naming, [AUTH_FILE],
    '⛔ a second source file names the Google credential material — it can bypass the guard')
})

/* ═══ B — ONE SDK ENTRY POINT ══════════════════════════════════════════ */

test('*** B — require("googleapis") appears at exactly one site, inside googleAuth.js ***', () => {
  const sites = []
  for (const p of FILES) {
    const hits = (codeOnly(read(p)).match(/require\(\s*['"]googleapis['"]\s*\)/g) || []).length
    if (hits) sites.push(rel(p) + ' x' + hits)
  }
  assert.deepEqual(sites, [AUTH_FILE + ' x1'],
    '⛔ a second googleapis entry point could build an authorised client without the guard')
})

/* ═══ C — NOBODY CALLS THE LOADER FROM OUTSIDE ═════════════════════════ */

test('*** C — loadGoogleapis() is invoked only inside googleAuth.js ***', () => {
  const callers = []
  for (const p of FILES) {
    if (rel(p) === AUTH_FILE) continue
    // Any invocation shape: destructured, member access, or via require(...).
    if (/loadGoogleapis\s*\(/.test(codeOnly(read(p)))) callers.push(rel(p))
  }
  assert.deepEqual(callers, [],
    '⛔ loadGoogleapis() outside googleAuth.js hands out the raw SDK and bypasses createOAuthClient')
})

/* ═══ D — ORDERING IS LOAD-BEARING, NOT PRESENCE ═══════════════════════ */

/**
 * ⛔ PRESENCE ALONE IS NOT THE PROPERTY, AND THIS IS THE ASSERTION THAT SAYS SO.
 *
 * A guard placed after `readFileSync` still blocks the socket — and still pulls the Owner's
 * refresh token into a test process's memory, where a later edit could log or serialise it.
 * So the guard must be the FIRST executable action of the function, ahead of the existence
 * checks, the SDK load, both reads, the OAuth2 construction and setCredentials.
 */
test('*** D — the guard is the FIRST executable action of createOAuthClient ***', () => {
  const start = AUTH_CODE.indexOf('function createOAuthClient')
  assert.ok(start > -1, 'createOAuthClient must exist')
  // Body of the function: from its opening brace to the matching close, by brace depth.
  const open = AUTH_CODE.indexOf('{', start)
  let depth = 0; let end = -1
  for (let i = open; i < AUTH_CODE.length; i++) {
    if (AUTH_CODE[i] === '{') depth++
    else if (AUTH_CODE[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  assert.ok(end > open, 'createOAuthClient body must be parseable')
  const body = AUTH_CODE.slice(open + 1, end)

  const guardAt = body.search(/assertGoogleLiveAuthAllowed\s*\(/)
  assert.ok(guardAt > -1, '⛔ createOAuthClient does not invoke the guard at all')

  for (const [label, re] of [
    ['existsSync', /existsSync\s*\(/],
    ['loadGoogleapis', /loadGoogleapis\s*\(/],
    ['readFileSync', /readFileSync\s*\(/],
    ['OAuth2 construction', /new\s+google\.auth\.OAuth2/],
    ['setCredentials', /setCredentials\s*\(/]
  ]) {
    const at = body.search(re)
    if (at === -1) continue
    assert.ok(guardAt < at,
      '⛔ the guard runs AFTER ' + label + ' — a token that is read has already left the fence')
  }

  // And nothing executable may precede it: everything before the guard must be blank.
  assert.equal(body.slice(0, guardAt).trim(), '',
    '⛔ an executable statement precedes the guard in createOAuthClient')
})

/* ═══ E / F — ONE DETECTOR, ONE HOME ═══════════════════════════════════ */

test('*** E — googleAuth imports the shared detector and implements no second one ***', () => {
  assert.match(AUTH_CODE, new RegExp('require\\([\'"][^\'"]*' + DETECTOR_MODULE + '[\'"]\\)'),
    '⛔ the guard must take isTestProcess from its one home')
  for (const tok of ['NODE_TEST_CONTEXT', "'--test'", '.test.js']) {
    assert.equal(AUTH_CODE.includes(tok), false, '⛔ «' + tok + '» is a SECOND detector growing inside googleAuth')
  }
})

test('*** F — isTestProcess is DEFINED in exactly one source module ***', () => {
  const defining = FILES.filter((p) => /function\s+isTestProcess\s*\(/.test(codeOnly(read(p)))).map(rel)
  assert.deepEqual(defining, [DETECTOR_MODULE + '.js'],
    '⛔ two components establishing the same fact is a coincidence waiting to diverge')
})

/* ═══ G — GOOGLE'S AUTHORITY IS ITS OWN, AND IT IS LITERAL ═════════════ */

test('*** G — the Google opt-in is RUN_LIVE_GOOGLE_E2E, compared literally to "1" ***', () => {
  assert.ok(AUTH_CODE.includes(OPT_IN), '⛔ googleAuth must name its own authority')
  assert.equal(AUTH_CODE.includes('RUN_PAID_E2E'), false,
    '⛔ the model-provider paid switch must not grant access to the Owner\'s Google identity')
  assert.match(AUTH_CODE, /===\s*GOOGLE_OPT_IN_VALUE|===\s*'1'/,
    '⛔ the opt-in must be compared literally — anything truthy is not consent')
})
