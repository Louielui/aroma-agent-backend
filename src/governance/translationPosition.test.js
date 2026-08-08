'use strict'
/**
 * translationPosition.test.js — no `t()` call may sit where MODEL or MATCHING text belongs.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「comments in the file are exactly the shape HR-48 warns about, and 「the ⛔ is
 * > right there」 is an argument, not a fence.」**
 *
 * He is right, and this is the fence.
 *
 * ⛔ THE MEASUREMENT THAT MADE IT NECESSARY. `answerPlan.js` turned out to hold all three
 * classes at once, and the obvious question was whether it was an outlier. Scanned the 34
 * remaining interface files:
 *
 *     8 of 34 are MIXED — 24% — carrying 20 of the 232 remaining lines.
 *
 * So no. Roughly a quarter of what is left has the same hazard, and `textClasses.js` gives a
 * file exactly one class. Its ⛔ notes are documentation; documentation does not fail a build.
 *
 * ── WHY THIS AND NOT A PER-REGION REGISTRY ──────────────────────────────────
 * A per-region classification would be a second list, maintained by hand, consulted by someone
 * who remembers to — which is the thing HR-48 exists about. This checks the FAILURE instead of
 * cataloguing the territory: the failure is a `t()` call standing where model-facing or
 * matching text used to stand. That is visible in the source and needs no registry.
 *
 * ⚠ WHAT IT CANNOT SEE, stated so the green is not read as more than it is:
 *   · a key extracted from a MULTI-LINE prompt template (the signal is on another line)
 *   · a word list whose comparison happens far from the `t()` call
 *   · anything where the usage is only knowable at runtime
 * It catches the same-line case, which is how every instance so far has actually looked.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { codeOnly } = require('../testutil/codeOnly')

const SRC = path.join(__dirname, '..')

/** A `t('a.b')` call — the literal form rule ① requires. */
const T_CALL = /\bt\('[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+'/

/** She is TOLD it: a schema description, a system field, a prompt. */
const MODEL_POSITION = /\bdescription\s*:|\bsystem\s*:|\bprompt\b|PROMPT|SAFETY_HEADER|_PREAMBLE/

/**
 * It is COMPARED against something — and the `t()` call must be INSIDE the comparison, not
 * merely on the same line.
 *
 * ⛔ THE FIRST VERSION LOOKED FOR THE COMPARISON ANYWHERE ON THE LINE, and flagged
 *
 *     missing.indexOf('file') >= 0 ? t('proposal.askFileLabel') : t('proposal.askIntentLabel')
 *
 * where the `indexOf` is on an array of FIELD NAMES and the `t()` calls are the ternary's
 * result — honest rendering. A detector that flags correct work gets switched off, and then it
 * protects nothing (HR-47's other half). The OPERAND is what matters, not the proximity.
 */
const MATCHING_POSITION = /(?:\.includes|\.test|\.indexOf|\.match|\.startsWith|\.endsWith|new RegExp)\(\s*t\('/

function scan () {
  const hits = []
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      const st = fs.statSync(p)
      if (st.isDirectory()) { if (n !== 'node_modules') walk(p); continue }
      if (!/\.js$/.test(n) || /\.test\.js$/.test(n)) continue
      const rel = path.relative(SRC, p).split(path.sep).join('/')
      // The catalogue IS the words; a description field there describes an entry, not a task.
      if (rel === 'i18n/catalogue.js') continue
      codeOnly(fs.readFileSync(p, 'utf8')).split('\n').forEach((line, i) => {
        if (!T_CALL.test(line)) return
        const why = MODEL_POSITION.test(line) ? 'MODEL' : (MATCHING_POSITION.test(line) ? 'MATCHING' : null)
        if (why) hits.push(rel + ':' + (i + 1) + '  ' + why + '\n      ' + line.trim().slice(0, 110))
      })
    }
  }
  walk(SRC)
  return hits
}

describe('⛔ a translated string may not stand where model or matching text belongs', () => {
  test('no t() call sits in a MODEL or MATCHING position', () => {
    assert.deepStrictEqual(scan(), [],
      'translating one of these does not change the language of the interface — it changes what ' +
      'she is told, or what her words are matched against, with no code removed and nothing reported')
  })

  test('⛔ SEEN TO FAIL — on the shapes that would actually appear', () => {
    // HR-47: real shapes, taken from the files this was built for.
    const A = 't' + '('
    const cases = [
      // answerPlan's schema — she is TOLD this
      ["    directAnswer: { type: 'string', description: " + A + "'plan.directAnswer') },", 'MODEL'],
      // dispatcher's task prompt
      ['    const prompt = ' + A + "'dispatch.taskPrompt', { task })", 'MODEL'],
      // readStateGuard's comparison against his own words
      ["    if (!between.includes(" + A + "'guard.de')) return false", 'MATCHING'],
      // utilityAnswer's time parser
      ["    re: new RegExp(" + A + "'utility.nowWords'))", 'MATCHING']
    ]
    for (const [line, expected] of cases) {
      assert.ok(T_CALL.test(line), 'the t() call must be recognised: ' + line)
      const why = MODEL_POSITION.test(line) ? 'MODEL' : (MATCHING_POSITION.test(line) ? 'MATCHING' : null)
      assert.strictEqual(why, expected, 'must be caught as ' + expected + ': ' + line)
    }
  })

  test('⛔ AND IT DOES NOT FIRE ON HONEST RENDERING', () => {
    // A detector that flags correct work gets switched off, and then it protects nothing.
    const A = 't' + '('
    for (const line of [
      "  const heading = " + A + "'card.heading')",
      "  row.appendChild(el('span', 'name', " + A + "'set.readDrive')))",
      "  line: " + A + "'freshness.neverRun', { title: kind.title })",
      // a join is rendering, not comparing
      "  ingredients: unchecked.map((u) => u.ingredient).join(" + A + "'punct.listSep'))"
    ]) {
      const why = MODEL_POSITION.test(line) ? 'MODEL' : (MATCHING_POSITION.test(line) ? 'MATCHING' : null)
      assert.strictEqual(why, null, 'false positive on: ' + line)
    }
  })

  test('it says what it cannot see', () => {
    assert.match(fs.readFileSync(__filename, 'utf8'), /WHAT IT CANNOT SEE/)
  })
})
