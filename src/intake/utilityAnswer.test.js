'use strict'

/**
 * utilityAnswer.test.js — the answerer's INTERNALS only.
 *
 * ── WHY THIS FILE IS NOW SHORT ───────────────────────────────────────────────
 * It used to hold 23 tests that called `answerUtility(kind, message, opts)` DIRECTLY, with
 * the `kind` handed in by the test rather than decided by the router. Every one of them
 * passed while 「5磅是多少公斤？」 was live-broken, because the router never classified it as
 * a conversion and the answerer was never reached. The tests proved the answerer could
 * compute; they said nothing about whether anything would ever ask it to.
 *
 * Owner instruction, 2026-08-04: "A utility test that calls the answerer directly proves
 * nothing about whether anything calls it." Those 23 tests are GONE. Every behavioural case
 * they covered now lives in utilityVocabulary.test.js, which routes first through
 * `routeTurn` and answers second, and in utilityRoute.test.js, which goes end to end through
 * `processIntake` and counts connector reads.
 *
 * ── WHAT LEGITIMATELY REMAINS ────────────────────────────────────────────────
 * Only assertions about this module's own internals, where there is no question to route:
 * a pure string helper, a source-level ban, and the defensive contract for a `kind` the
 * router could never produce. Nothing here takes an Owner phrasing and asserts an answer —
 * if you find yourself adding one, it belongs in utilityVocabulary.test.js.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { answerUtility, zoneLabel } = require('./utilityAnswer')
const { routeTurn } = require('./turnRouter')
const { SETTINGS_FILE } = require('../persona/ownerSettings')

function root (tz) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-util-'))
  if (tz) fs.writeFileSync(path.join(d, SETTINGS_FILE), JSON.stringify({ timezone: tz }), 'utf8')
  return d
}

/** Route first, answer second — the same entry point utilityVocabulary.test.js uses. */
function viaRouter (message, opts) {
  const d = routeTurn(message)
  if (d.route !== 'UTILITY') return null
  const a = answerUtility(d.utility, message, opts)
  return a ? a.text : null
}

/* ═══ a pure helper — no question, nothing to route ════════════════════════ */

test('zoneLabel takes the city, never the whole IANA string', () => {
  assert.equal(zoneLabel('America/Winnipeg'), 'Winnipeg')
  assert.equal(zoneLabel('Asia/Tokyo'), 'Tokyo')
  assert.equal(zoneLabel('UTC'), 'UTC')
  assert.equal(zoneLabel('America/Argentina/Buenos_Aires'), 'Buenos Aires', 'underscores and depth')
})

/* ═══ a source-level ban ═══════════════════════════════════════════════════ */

test('*** it never evaluates anything but arithmetic ***', () => {
  // This module parses text the Owner typed. `eval` on that input would be a
  // code-execution path opened to save forty lines of parser.
  const src = fs.readFileSync(path.join(__dirname, 'utilityAnswer.js'), 'utf8')
  assert.equal(/\beval\s*\(|new Function/.test(src), false, 'no eval, ever')
})

/* ═══ the defensive contract for a kind the router cannot produce ══════════ */

test('an unknown or missing kind returns null rather than throwing', () => {
  assert.equal(answerUtility('weather', '今日天氣點？', {}), null)
  assert.equal(answerUtility(null, 'x', {}), null)
  assert.equal(answerUtility(undefined, undefined, {}), null)
})

/* ═══ the clock it cannot name is one it does not state ════════════════════ */

test('*** a malformed timezone DECLINES, through the router, rather than answering wrongly ***', () => {
  const bad = { root: root('Mars/Olympus'), now: new Date('2026-08-04T21:53:00Z') }
  assert.equal(viaRouter('現在是幾點？', bad), null, 'a clock it cannot trust is one it does not state')
  assert.equal(viaRouter('今天幾號？', bad), null)
  // Arithmetic needs no clock, so it is unaffected by a broken timezone.
  assert.equal(viaRouter('2+2', bad), '2 + 2 = 4。')
})
