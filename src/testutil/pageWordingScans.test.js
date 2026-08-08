'use strict'
/**
 * pageWordingScans.test.js — no assertion may grep a source or markup blob for wording that
 * lives in the catalogue.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「you have found this shape three times and I would rather have the sweep than a
 * > fourth instance.」**
 *
 * ⛔ THE FOURTH INSTANCE WAS ALREADY THERE, AND IT WAS THE WORST OF THEM — because it was
 * GREEN.
 *
 * The catalogue is INLINED into the served page (that is what lets the browser run the server's
 * own resolver). So after extraction:
 *
 *     assert.ok(DEMO_HTML.includes('產生工作單'))     // still passes
 *
 * — but it now finds the string inside `var CATALOGUE = {…}`, not in anything the page renders.
 * Every such assertion had silently stopped proving 「the page shows this」 and started proving
 * 「the catalogue ships this entry」. If `app.js` stopped calling `t('proposal.makeWorkOrder')`
 * altogether, all of them would still pass.
 *
 * Compare the three earlier forms:
 *   HR-46  the subject was ABSENT   → the assertion exempted itself
 *   HR-49  the subject had MOVED    → the assertion went blank
 *   THIS   the subject moved INTO the blob being searched → the assertion kept its colour
 *
 * The first two go quiet. This one lies.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * Assert the KEY against the page (that is the code path) and the WORDING against the catalogue
 * (that is the meaning, and it can be checked in both languages). Never the wording against the
 * page.
 *
 * ⚠ NOT COVERED: an assertion that greps a blob for wording that is NOT in the catalogue — a
 * prompt, a matching token, a fixture — is untouched here and is legitimate. This checks only
 * the collision between the two.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { codeOnly } = require('./codeOnly')
const { CATALOGUE } = require('../i18n/catalogue')

const SRC = path.join(__dirname, '..')

/**
 * Blobs where the collision can happen: an assembled page (which now CONTAINS the catalogue) or
 * a source file the wording moved OUT of.
 *
 * ⛔ APP_CSS IS DELIBERATELY NOT HERE. The catalogue is not inlined into a stylesheet and the
 * wording never lived there, so `assert.equal(APP_CSS.includes('複製'), false)` is an honest
 * leak-guard, not a collision. The first version of this list included it and flagged exactly
 * that assertion — and a detector that flags correct work gets switched off, after which it
 * protects nothing.
 */
const BLOB = /\b(APP_JS|DEMO_HTML|SETTINGS_HTML|INDEX|CLIENT|res\.body)\b/

/** Han runs of 2+ characters inside a regex literal or a quoted string on this line. */
function needlesIn (line) {
  const out = []
  for (const m of line.matchAll(/\/((?:\\.|[^/\n])+)\/[a-z]*/g)) out.push(...(m[1].match(/[一-鿿]{2,}/g) || []))
  for (const m of line.matchAll(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) out.push(...(m[2].match(/[一-鿿]{2,}/g) || []))
  return [...new Set(out)]
}

const CATALOGUE_TEXT = Object.values(CATALOGUE).flatMap((e) => [e.zh, e.en])
const inCatalogue = (needle) => CATALOGUE_TEXT.some((v) => v.includes(needle))

function scan () {
  const hits = []
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      const st = fs.statSync(p)
      if (st.isDirectory()) { if (n !== 'node_modules') walk(p); continue }
      if (!/\.test\.js$/.test(n)) continue
      const rel = path.relative(SRC, p).split(path.sep).join('/')
      // ⛔ Comments stripped: this file quotes the shape it forbids.
      codeOnly(fs.readFileSync(p, 'utf8')).split('\n').forEach((line, i) => {
        if (!/assert\./.test(line) || !BLOB.test(line)) return
        for (const needle of needlesIn(line)) {
          if (inCatalogue(needle)) hits.push(rel + ':' + (i + 1) + '  「' + needle + '」\n      ' + line.trim().slice(0, 110))
        }
      })
    }
  }
  walk(SRC)
  return hits
}

describe('⛔ wording is asserted on the catalogue, never on the page', () => {
  test('no assertion greps a page or source blob for catalogue wording', () => {
    assert.deepStrictEqual(scan(), [],
      'the catalogue is inlined into the page, so these find the words whether or not anything ' +
      'renders them. Assert the KEY against the page and the WORDING against the catalogue.')
  })

  test('⛔ SEEN TO FAIL — on the real instances, verbatim', () => {
    // HR-47: real cases, copied from the code that motivated this, not invented beside it.
    const A = 'assert' + '.'
    const PAGE = 'DEMO' + '_HTML'
    const DOT = '.'
    const real = [
      // ⛔ ASSEMBLED, not written out — otherwise this file fails on its own examples, which
      // has now happened six times in this codebase and is why codeOnly exists.
      A + "ok(" + PAGE + ".includes('產生工作單'), 'the chat card only requests a Work Order')",
      A + "match(String(res" + DOT + "body), /是程式碼，不是文字/, 'told what settings cannot do')",
      A + "ok(" + PAGE + ".includes('會送去 OpenAI'), 'still disclosed')"
    ]
    for (const line of real) {
      const needles = needlesIn(line).filter(inCatalogue)
      assert.ok(BLOB.test(line), 'the subject must be recognised as a blob: ' + line)
      assert.ok(needles.length > 0, 'must be caught: ' + line)
    }
  })

  test('⛔ AND IT DOES NOT FIRE ON HONEST ASSERTIONS', () => {
    // A detector that flags correct work gets switched off, and then it protects nothing.
    const A = 'assert' + '.'
    const PAGE = 'DEMO' + '_HTML'
    for (const line of [
      // the key against the page — the correct shape
      A + "ok(" + PAGE + ".includes(\"t('proposal.makeWorkOrder')\"), 'rendered')",
      // wording against the CATALOGUE — also correct
      "  assert.match(CATALOGUE['set.footPage'].zh, /是程式碼，不是文字/)",
      // wording against a blob, but not catalogue wording (a prompt, a matching token)
      "  assert.ok(!src.includes('目前是聊天模式'), 'the pre-unification message is gone')",
      // structure against a blob
      A + "ok(APP" + "_JS.includes('function copyButton'))"
    ]) {
      const flagged = BLOB.test(line) && needlesIn(line).some(inCatalogue)
      assert.strictEqual(flagged, false, 'false positive on: ' + line)
    }
  })

  test('it says what it does not cover', () => {
    assert.match(fs.readFileSync(__filename, 'utf8'), /NOT COVERED/)
  })
})
