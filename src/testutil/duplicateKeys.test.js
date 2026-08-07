'use strict'
/**
 * duplicateKeys.test.js — a key defined twice in one object literal, anywhere in src/.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「The duplicate key being structurally invisible. Reading the object can never see
 * > it; only reading the source can.」**
 *
 * `briefing.nothingWaiting` was written twice in `i18n/catalogue.js`, with different wording.
 * JavaScript keeps the LAST and discards the earlier one in silence:
 *
 *   · every test passed
 *   · `Object.keys(CATALOGUE).length` was still right
 *   · one of the two sentences simply did not exist
 *
 * ⛔ THE EVIDENCE IS GONE BY THE TIME YOU HAVE THE OBJECT. No assertion written against the
 * value can find this, however careful — the duplicate is resolved before the module finishes
 * loading. Only the FILE still contains both.
 *
 * That is why this is repo-wide rather than a check on the catalogue: the catalogue is simply
 * where it happened first. Any object literal can carry it, and the bigger the literal the more
 * likely — registries, label maps, status tables, fixtures.
 *
 * ⚠ WHAT THIS DOES NOT COVER. Keys assembled at runtime (`obj[a] = 1` twice), spreads that
 * overwrite (`{...a, ...b}`), and `Object.assign` all shadow silently too and are invisible to a
 * source scan. This finds the LITERAL form, which is the one people write by hand.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { codeOnly } = require('./codeOnly')

const SRC = path.join(__dirname, '..')

/** Keys at the start of a line, tracked per brace depth so nesting is not conflated. */
function duplicateKeysIn (src) {
  const stack = [new Map()]
  const found = []
  src.split('\n').forEach((line, i) => {
    const m = /^\s*(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*:/.exec(line)
    if (m) {
      const key = m[2] !== undefined ? m[2] : m[3]
      const scope = stack[stack.length - 1]
      if (scope.has(key)) found.push({ key, first: scope.get(key), second: i + 1 })
      else scope.set(key, i + 1)
    }
    for (const ch of line) {
      if (ch === '{') stack.push(new Map())
      else if (ch === '}' && stack.length > 1) stack.pop()
    }
  })
  return found
}

describe('⛔ no key is defined twice in one object literal', () => {
  test('the whole of src/ is clean', () => {
    const hits = []
    const walk = (d) => {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n)
        const st = fs.statSync(p)
        if (st.isDirectory()) { if (n !== 'node_modules') walk(p); continue }
        if (!/\.js$/.test(n)) continue
        // ⛔ Comments stripped first — this file quotes the shape it forbids.
        for (const h of duplicateKeysIn(codeOnly(fs.readFileSync(p, 'utf8')))) {
          hits.push(path.relative(SRC, p).split(path.sep).join('/') + ':' + h.second +
            " '" + h.key + "' (first defined at line " + h.first + ')')
        }
      }
    }
    walk(SRC)
    assert.deepStrictEqual(hits, [],
      'the earlier definition is silently discarded and no value-level assertion can see it')
  })

  test('⛔ SEEN TO FAIL — on the real case, verbatim', () => {
    /**
     * HR-47: a detector's clean result means nothing until it has been watched to fire, and the
     * probe must be a REAL instance rather than one invented alongside the detector. This is
     * the catalogue as it actually stood.
     */
    const real = [
      'const CATALOGUE = Object.freeze({',
      "  'briefing.nothingWaiting': { zh: 'A', en: 'Nothing waiting on you.' },",
      "  'briefing.updatedAt': { zh: 'B', en: 'Updated {time}' },",
      "  'briefing.nothingWaiting': { zh: 'C', en: 'Nothing needs you.' }",
      '})'
    ].join('\n')
    const found = duplicateKeysIn(real)
    assert.strictEqual(found.length, 1, 'the duplicate must be seen')
    assert.strictEqual(found[0].key, 'briefing.nothingWaiting')
    assert.strictEqual(found[0].first, 2)
    assert.strictEqual(found[0].second, 4)

    // And the point of the whole file: the OBJECT cannot show you this.
    // eslint-disable-next-line no-new-func
    const built = new Function(real + '; return CATALOGUE')()
    assert.strictEqual(Object.keys(built).length, 2, 'two keys, three definitions, no complaint')
    assert.strictEqual(built['briefing.nothingWaiting'].en, 'Nothing needs you.',
      'the FIRST wording is gone and nothing marks its absence')
  })

  test('⛔ AND IT DOES NOT FIRE ON HONEST CODE', () => {
    // A detector that flags correct work gets switched off, and then it protects nothing.
    for (const src of [
      "const a = { x: 1, y: 2 }",
      // the same key name at DIFFERENT nesting levels is not a duplicate
      ['const a = {', '  zh: {', '    id: 1', '  },', '  en: {', '    id: 2', '  }', '}'].join('\n'),
      // two sibling objects may each carry the same key
      ['const a = [{', '  id: 1', '}, {', '  id: 2', '}]'].join('\n')
    ]) {
      assert.deepStrictEqual(duplicateKeysIn(src), [], 'false positive on:\n' + src)
    }
  })

  test('it says what it does not cover', () => {
    // The honesty, checked. A green run here means the LITERAL form is absent — not that no
    // key in this codebase is ever shadowed.
    const self = fs.readFileSync(__filename, 'utf8')
    assert.match(self, /WHAT THIS DOES NOT COVER/)
  })
})
