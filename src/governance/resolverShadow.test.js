'use strict'
/**
 * resolverShadow.test.js — nothing may declare a local named `t` in a file that translates.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ IT HAS HAPPENED TWICE, IN TWO FILES, DURING ONE PIECE OF WORK.
 *
 *   errands/recallCheck.js    `const t = await session.type(…)`
 *   intake/readResultView.js  `const t = fieldOf(item.content, 'total')`
 *
 * Both predate the extraction — `t` was a perfectly reasonable local name before `t` meant
 * the resolver. Add `const { t } = require('../i18n/t')` at the top and every `t('key')` inside
 * that scope silently calls the LOCAL instead: a DOM node, a string, whatever it happens to be.
 *
 * ⛔ AND NEITHER OF THE EXISTING FENCES SEES IT. The literal-key scan checks the ARGUMENT is a
 * literal — it is. The position fence checks WHERE the call stands — it stands somewhere fine.
 * Both are satisfied by a call that will throw or return nonsense at runtime, because both ask
 * about the call and neither asks what `t` is bound to.
 *
 * The first instance (recallCheck) was caught by a rename that forced line-by-line reading — the
 * one defect in twenty that reading found, and only because skimming was not an option (HR-53).
 * The second was caught by reading the file for another reason. Twice by luck is the signal to
 * stop relying on it.
 *
 * ⚠ WHAT THIS DOES NOT COVER: a parameter named `t`, a `catch (t)`, or a destructured `{ t }`
 * from something that is not the resolver. Those are rarer and would need a parser; this catches
 * the declaration form, which is how both real instances looked.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { codeOnly } = require('../testutil/codeOnly')

const SRC = path.join(__dirname, '..')

/** `const t = …` / `let t = …` / `var t = …` — but NOT the resolver import itself. */
const DECLARES_T = /\b(?:const|let|var)\s+t\s*=/
/**
 * The two legitimate ways to bind `t`: importing the shared one, or — in a browser asset, which
 * cannot `require` — building it from the SAME `createResolver` the server ships into the page.
 */
const IS_IMPORT = /\b(?:const|let|var)\s+\{[^}]*\bt\b[^}]*\}\s*=\s*require|=\s*createResolver\(/

/** The file translates: it imports the shared `t`, or it calls `t('a.b')`. */
const TRANSLATES = /require\((['"])[^'"]*\/i18n\/t\1\)|\bt\('[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+'/

function scan () {
  const hits = []
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      const st = fs.statSync(p)
      if (st.isDirectory()) { if (n !== 'node_modules') walk(p); continue }
      if (!/\.js$/.test(n) || /\.test\.js$/.test(n)) continue
      const src = codeOnly(fs.readFileSync(p, 'utf8'))
      if (!TRANSLATES.test(src)) continue
      const rel = path.relative(SRC, p).split(path.sep).join('/')
      src.split('\n').forEach((line, i) => {
        if (!DECLARES_T.test(line) || IS_IMPORT.test(line)) return
        hits.push(rel + ':' + (i + 1) + '\n      ' + line.trim().slice(0, 100))
      })
    }
  }
  walk(SRC)
  return hits
}

describe('⛔ `t` is the resolver, so nothing may shadow it', () => {
  test('no translating file declares a local named t', () => {
    assert.deepStrictEqual(scan(), [],
      'a local `t` shadows the resolver, and every t(\'key\') in that scope calls the local instead')
  })

  test('⛔ SEEN TO FAIL — on both real instances, verbatim', () => {
    // HR-47: real cases from the two files this was built for, not examples invented beside it.
    for (const line of [
      "  const t = await session.type({ ref: box.ref, text: asked })",
      "  const t = fieldOf(item.content, 'total')",
      '  let t = el(\'div\', \'brief-text\')',
      '  var t = turn(\'bot\', conv)'
    ]) {
      assert.ok(DECLARES_T.test(line) && !IS_IMPORT.test(line), 'must be caught: ' + line)
    }
  })

  test('⛔ AND IT DOES NOT FIRE ON THE IMPORT, OR ON OTHER NAMES', () => {
    // A detector that flags correct work gets switched off, and then it protects nothing.
    for (const line of [
      "const { t } = require('../i18n/t')",
      "const { t, currentLocale } = require('./t')",
      "  const total = fieldOf(item.content, 'total')",
      '  const typed = await session.type({ text: asked })',
      '  const tEl = el(\'div\', \'brief-text\')'
    ]) {
      assert.ok(!DECLARES_T.test(line) || IS_IMPORT.test(line), 'false positive on: ' + line)
    }
  })

  test('it says what it cannot see', () => {
    assert.match(fs.readFileSync(__filename, 'utf8'), /DOES NOT COVER/)
  })
})
