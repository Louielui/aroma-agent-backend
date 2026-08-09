'use strict'
/**
 * textClasses.test.js — the boundary is enforced, not remembered.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Two things are checked, and the second is the one that matters:
 *
 *   ① COVERAGE — every production file carrying quoted Chinese is classified. A new file
 *      carrying Chinese fails the suite until someone decides what kind it is. This is what
 *      stops the classification becoming a snapshot of one afternoon in August.
 *
 *   ② ⛔ NO NON-INTERFACE FILE MAY TRANSLATE. A MODEL file that starts calling `t()` is a
 *      behaviour change; a MATCHING file that does is a guard deleted with no code removed and
 *      nothing reported. Neither would look wrong in a diff.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { CLASS, FILE_CLASS, classOf, mayTranslate } = require('./textClasses')

const SRC = path.join(__dirname, '..')

/**
 * ⛔ THE TWO FILES THAT MAY TOUCH THE RESOLVER DIRECTLY, EACH WITH ITS REASON.
 *
 * Named here rather than special-cased inside a filter, so adding a third is a visible act with
 * a reason attached — an exemption list that grows quietly stops being a fence.
 *
 *   · `i18n/t.js` — THE CALLER'S ENTRANCE. Everything that renders text goes through it, which
 *     is what makes the locale readable at use time in exactly one place.
 *
 *   · `i18n/browserResolver.js` — NOT a caller. It SHIPS the resolver to the page, and it needs
 *     the raw pieces (`createResolver.toString()`, `KEY_SHAPE.source`) precisely because the
 *     alternative — hand-writing a second `t()` in app.js — is the thing being avoided. Going
 *     through `i18n/t.js` would give it a bound locale, which is the opposite of what the page
 *     needs: the page ships BOTH languages and chooses at runtime.
 */
const ENTRANCES = ['i18n/t.js', 'i18n/browserResolver.js']

/** Comments are documentation, not text he reads. Strip before judging. */
function stripComments (src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Production files (not tests, not fixtures-under-test) with Chinese inside a quoted string. */
function filesWithQuotedHan (root) {
  const out = []
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      const st = fs.statSync(p)
      if (st.isDirectory()) { if (n !== 'node_modules') walk(p); continue }
      if (!/\.(js|html)$/.test(n) || /\.test\.js$/.test(n)) continue
      const stripped = stripComments(fs.readFileSync(p, 'utf8'))
      const quoted = stripped.split('\n').some((l) => /(['"`])[^'"`]*[一-鿿][^'"`]*\1/.test(l))
      // ⛔ A MULTI-LINE TEMPLATE LITERAL IS A STRING TOO, and the line-by-line test could not
      // see one: neither backtick shares a line with the Chinese between them. That is not an
      // edge case here — it is the exact shape every model-facing system prompt uses, so the
      // fence was blind to the highest-consequence text in the codebase. Found when a new MODEL
      // file was classified correctly and the staleness check asked for the entry to be REMOVED.
      // Measured when added: it newly covers publicQueryEgressPlanner.js and confirms
      // readResultView.js, which was already classified. No other file changes.
      const templated = /`[^`]*[一-鿿][^`]*`/.test(stripped)
      if (quoted || templated) out.push(path.relative(root, p).split(path.sep).join('/'))
    }
  }
  walk(root)
  return out
}

/**
 * Files that translate — by importing the resolver, OR by calling `t('a.b')`.
 *
 * ⛔ THE IMPORT ALONE WAS THE WRONG DEFINITION, and `demo/assets/app.js` is the file that
 * proved it. The browser asset has no `require`: the resolver is inlined above it in the page.
 * It translates more than any other file in the codebase and this function could not see it —
 * so once app.js was fully extracted it looked like a file that carries nothing and translates
 * nothing, and the staleness check asked for its classification to be DELETED. The rule that
 * keeps MODEL and MATCHING files away from the resolver would have stopped covering the one
 * file with the most interface text in it.
 *
 * A call site is what rule ② is actually about. The import was a proxy for it.
 */
const CALLS_T = /\bt\('[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+'/
const IMPORTS_RESOLVER = /require\((['"])[^'"]*\/(i18n\/t|textResolver)\1\)/

function translatingFiles () {
  const out = []
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      const st = fs.statSync(p)
      if (st.isDirectory()) { if (n !== 'node_modules') walk(p); continue }
      if (!/\.js$/.test(n) || /\.test\.js$/.test(n)) continue
      const src = stripComments(fs.readFileSync(p, 'utf8'))
      if (IMPORTS_RESOLVER.test(src) || CALLS_T.test(src)) {
        out.push(path.relative(SRC, p).split(path.sep).join('/'))
      }
    }
  }
  walk(SRC)
  return out
}

describe('⛔ ① every file carrying Chinese has been classified', () => {
  test('nothing is unclassified — a new one fails the suite until someone decides', () => {
    const unclassified = filesWithQuotedHan(SRC).filter((f) => classOf(f) === null)
    assert.deepStrictEqual(unclassified, [],
      'these carry Chinese and nobody has said what kind it is. INTERFACE means it may be ' +
      'translated; MODEL means translating it changes her behaviour; MATCHING means translating ' +
      'it deletes a guard silently. Decide, then add it to textClasses.js.')
  })

  test('the classification does not keep entries for files that carry nothing and translate nothing', () => {
    /**
     * ⛔ THE FIRST VERSION OF THIS TEST WAS WRONG, AND IT FAILED ON THE FIRST TWO FILES THAT
     * WERE FULLY EXTRACTED.
     *
     * It asked 「does this file still contain Chinese」 and called the answer staleness. But a
     * finished INTERFACE file has NO Chinese left — every string became a key. That is success,
     * not staleness, and the file must stay classified precisely because it still calls `t()`.
     *
     * An entry is stale only when the file carries no Chinese AND translates nothing: then it
     * really has left the subject, and a lingering entry reads as coverage it no longer gives.
     */
    const carries = new Set(filesWithQuotedHan(SRC))
    const translates = new Set(translatingFiles())
    const stale = Object.keys(FILE_CLASS).filter((f) => !carries.has(f) && !translates.has(f))
    assert.deepStrictEqual(stale, [], 'stale entries in FILE_CLASS — remove them')
  })

  test('every class used is a real one', () => {
    for (const [f, c] of Object.entries(FILE_CLASS)) {
      assert.ok(Object.values(CLASS).includes(c), f + ' has an unknown class: ' + c)
    }
  })
})

describe('⛔ ② only INTERFACE files may reach the resolver', () => {
  test('⛔ no MODEL, MATCHING or FROZEN file calls t()', () => {
    const violations = translatingFiles().filter((f) => !ENTRANCES.includes(f) && !mayTranslate(f))
    assert.deepStrictEqual(violations, [],
      'translating one of these does not change the language of the interface — it changes what ' +
      'she is told, or what her words are matched against: ' + JSON.stringify(violations))
  })

  test('⛔ SEEN TO FAIL — the rule really rejects each non-interface class', () => {
    // A probe never observed failing is not evidence.
    assert.strictEqual(mayTranslate('home/briefing.js'), true, 'an INTERFACE file may')
    for (const f of [
      'persona/conversationContract.js', // MODEL — translating it changes her behaviour
      'intake/scopeNotes.js', // MATCHING — translating it deletes a guard
      'core/memory/shadow/identityShadow.js' // FROZEN — not ours to edit at all
    ]) {
      assert.strictEqual(mayTranslate(f), false, f + ' must never be translatable')
    }
    // And an unclassified file is NOT translatable by default — silence is not permission.
    assert.strictEqual(mayTranslate('some/file/nobody/classified.js'), false)
  })

  test('the resolver is reachable ONLY through the two named entrances', () => {
    // One entrance for callers, one for the file that ships it to the page. Anything else
    // would bind a locale at require() time, or be a second implementation.
    const direct = []
    const walk = (d) => {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n)
        const st = fs.statSync(p)
        if (st.isDirectory()) { if (n !== 'node_modules') walk(p); continue }
        if (!/\.js$/.test(n) || /\.test\.js$/.test(n)) continue
        const rel = path.relative(SRC, p).split(path.sep).join('/')
        if (ENTRANCES.includes(rel) || rel.startsWith('governance/textResolver')) continue
        if (/require\((['"])[^'"]*textResolver\1\)/.test(stripComments(fs.readFileSync(p, 'utf8')))) direct.push(rel)
      }
    }
    walk(SRC)
    assert.deepStrictEqual(direct, [], 'these bypass i18n/t and would freeze the locale at require() time')
  })
})
