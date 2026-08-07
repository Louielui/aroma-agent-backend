'use strict'
/**
 * textResolver.test.js — the three rules that keep data out of the translator.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「Literal keys only, enforced by a test that fails on a dynamic key. That is the
 * > one structural line that keeps data out of the translator, and it will be tempting to break
 * > the first time something looks repetitive.」**
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { createResolver, KEY_SHAPE, LOCALES, DEFAULT_LOCALE, isLiteralKeyArg } = require('./textResolver')
const { CATALOGUE } = require('../i18n/catalogue')
const { isForbiddenFile } = require('../agent/workOrder')

const SRC = path.join(__dirname, '..')
const t = createResolver({ catalogue: CATALOGUE })
const tEn = createResolver({ catalogue: CATALOGUE, locale: 'en' })

describe('⛔ the resolver is governance; the words are not', () => {
  test('the rules are in the protected path', () => {
    assert.strictEqual(isForbiddenFile('src/governance/textResolver.js'), true)
  })
  test('the catalogue is NOT — he must be able to reword without a work order', () => {
    assert.strictEqual(isForbiddenFile('src/i18n/catalogue.js'), false)
  })
})

/** ⛔ RULE ① — LITERAL KEYS ONLY. */
describe('⛔ a dynamic key cannot reach the translator', () => {
  /**
   * Every `t(` call site under `root`, with its first argument.
   * Parameterised by root ON PURPOSE: the same walker is pointed at a fixture below, so what is
   * proved to fail is the walker that actually guards the source — not a re-description of it.
   */
  function callSites (root) {
    const { codeOnly } = require('../testutil/codeOnly')
    const out = []
    const walk = (d) => {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n)
        const st = fs.statSync(p)
        if (st.isDirectory()) { if (n !== 'node_modules') walk(p) } else if (/\.js$/.test(n) && !/\.test\.js$/.test(n)) {
          const src = codeOnly(fs.readFileSync(p, 'utf8'))
          for (const m of src.matchAll(/\bt\(\s*([^)]{0,80})/g)) {
            out.push({ file: path.relative(root, p).split(path.sep).join('/'), arg: m[1].trim() })
          }
        }
      }
    }
    walk(root)
    return out
  }

  test('⛔ every t() call site in the source passes a STRING LITERAL', () => {
    const bad = callSites(SRC).filter((c) => !isLiteralKeyArg(c.arg))
    assert.deepStrictEqual(bad, [],
      'a dynamic key is a path for data to enter the translator: ' + JSON.stringify(bad.slice(0, 5)))
  })

  test('⛔ SEEN TO FAIL — the WHOLE scan catches a dynamic key in a real file', () => {
    // Not the predicate in isolation: file discovery + comment stripping + match + verdict.
    // The source tree currently has no t() call sites at all, so a green scan over it proves
    // nothing on its own. This is what makes the green above worth reading.
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tkeys-'))
    try {
      fs.writeFileSync(path.join(dir, 'good.js'), "const a = t('briefing.nothingWaiting')\nconst b = t('errand.recallNone', { ingredient: x })\n")
      fs.writeFileSync(path.join(dir, 'bad.js'), "const c = t('supplier.' + name)\n")
      const found = callSites(dir)
      assert.strictEqual(found.length, 3, 'the walker must see all three call sites')
      const bad = found.filter((c) => !isLiteralKeyArg(c.arg))
      assert.strictEqual(bad.length, 1, 'exactly the dynamic one must be rejected')
      assert.strictEqual(bad[0].file, 'bad.js')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('⛔ the shapes data would arrive in are each rejected', () => {
    assert.strictEqual(isLiteralKeyArg("'briefing.nothingWaiting'"), true, 'a bare literal must pass')
    assert.strictEqual(isLiteralKeyArg("'errand.recallNone', slots"), true, 'a literal plus slots must pass')
    for (const dynamic of [
      "'supplier.' + name", // ⛔ the one that got through first time: it BEGINS with a literal
      'key',
      '`errand.${kind}`',
      'keys[i]',
      'KEYS.supplier',
      "cond ? 'a.b' : 'c.d'"
    ]) {
      assert.strictEqual(isLiteralKeyArg(dynamic), false, dynamic + ' must be rejected')
    }
  })

  test('AND AT RUNTIME: a data-derived key cannot resolve', () => {
    // The second half. Even if the static scan were bypassed, a key built from data is not in
    // the catalogue — so the data is not translated, it is reported missing.
    const out = t('supplier.SUNCO FOODS')
    assert.match(out, /⟦\?/, 'an unknown key must be visible, never silently the key itself')
    assert.ok(!out.includes('SUNCO FOODS') || out.startsWith('⟦?'), 'and it must not look like a label')
  })

  test('a key that is not key-shaped is refused before any lookup', () => {
    assert.match(t('SUNCO FOODS'), /⟦\?/)
    assert.match(t(''), /⟦\?/)
    assert.match(t(null), /⟦\?/)
  })
})

/** ⛔ RULE ② — TEMPLATES, NOT SENTENCES. */
describe('⛔ slot values are inserted VERBATIM and never translated', () => {
  const title = 'Highline brand Organic Mini Bella Mushrooms Sliced recalled due to Listeria'

  test('the mushroom line: data survives the frame changing language', () => {
    const slots = { ingredient: 'mushrooms', narrowing: '詞組搜尋', count: 51, shown: 6, items: '2026-08-04 ' + title }
    const zh = t('errand.recallAnswer', slots)
    const en = tEn('errand.recallAnswer', Object.assign({}, slots, { narrowing: 'phrase search' }))
    // The FRAME changed.
    assert.notStrictEqual(zh, en)
    // ⛔ The DATA did not.
    for (const out of [zh, en]) {
      assert.ok(out.includes('mushrooms'), 'the ingredient is data')
      assert.ok(out.includes(title), 'the register wrote this title; a translated product name is an order for the wrong thing')
      assert.ok(out.includes('51'))
    }
  })

  test('⛔ a slot value that looks like a key is STILL data', () => {
    // The tempting bug: resolving slot contents. A supplier literally named 「briefing.calm」
    // would be translated. Slots are never looked up.
    const out = t('errand.recallNone', { ingredient: 'briefing.calm', narrowing: 'x' })
    assert.ok(out.includes('briefing.calm'), 'a slot is inserted, never resolved')
  })

  test('an unfilled slot is VISIBLE, not silently empty', () => {
    // An empty slot produces a sentence that reads complete and says less than it should.
    const out = t('errand.recallNone', { ingredient: 'beef' })
    assert.match(out, /⟦\?narrowing⟧/)
  })

  test('⛔ no catalogue entry contains a sentence that should have been slots', () => {
    // The flattening test: a template holding a bare digit run or a Latin-script proper-noun
    // phrase is data that escaped into a translatable string.
    for (const [key, e] of Object.entries(CATALOGUE)) {
      for (const loc of LOCALES) {
        const v = e[loc]
        if (typeof v !== 'string') continue
        assert.doesNotMatch(v, /\b\d{4}-\d{2}-\d{2}\b/, key + '/' + loc + ' contains a DATE — that is data')
        assert.doesNotMatch(v, /\b[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+/, key + '/' + loc + ' contains a proper-noun phrase — that is data')
      }
    }
  })
})

/** ⛔ RULE ③ — HER REPLIES NEVER PASS THROUGH. */
describe('⛔ her replies are not interface text', () => {
  test('nothing in the reply path calls the resolver', () => {
    // If you are here because 「the interface is bilingual, why is her answer not」 — her answer
    // is model output. There is no key for it, so nothing here can translate it either way.
    //
    // ⛔ NAMED FILES, NOT THE WHOLE FOLDER, AND EACH ONE ASSERTED TO EXIST.
    // Not the folder, because `traditionalGuard.js` appends a note that IS interface text and
    // will legitimately gain a key — a blanket ban would have to be broken, and a rule that gets
    // broken once gets broken twice. Existence is asserted because a guard that silently skips a
    // renamed file is a guard that has stopped guarding without saying so.
    for (const f of ['intake/intakeService.js', 'intake/groundedReply.js']) {
      const p = path.join(SRC, f)
      assert.ok(fs.existsSync(p), f + ' no longer exists — this guard must be re-pointed, not left green')
      const src = require('../testutil/codeOnly').codeOnly(fs.readFileSync(p, 'utf8'))
      assert.doesNotMatch(src, /textResolver|createResolver/,
        f + ' must not translate her replies — that is the contract plus traditionalGuard, not the catalogue')
    }
  })

  test('the rule is written where a future reader would ask', () => {
    const src = fs.readFileSync(path.join(__dirname, 'textResolver.js'), 'utf8')
    assert.match(src, /HER REPLIES NEVER PASS THROUGH/)
    assert.match(src, /traditionalGuard/, 'and it must point at where her language IS governed')
  })
})

describe('the catalogue is written in both languages at once', () => {
  test('⛔ every entry has zh AND en — a half-written entry is a future second pass', () => {
    for (const [key, e] of Object.entries(CATALOGUE)) {
      for (const loc of LOCALES) {
        assert.strictEqual(typeof e[loc], 'string', key + ' is missing ' + loc)
        assert.ok(e[loc].length > 0, key + '/' + loc + ' is empty')
      }
    }
  })

  test('every key is key-shaped, so data can never collide with one', () => {
    for (const key of Object.keys(CATALOGUE)) assert.match(key, KEY_SHAPE, key)
  })

  test('the same slots appear in both languages', () => {
    const slotsOf = (s) => (s.match(/\{[a-zA-Z][a-zA-Z0-9]*\}/g) || []).sort().join(',')
    for (const [key, e] of Object.entries(CATALOGUE)) {
      assert.strictEqual(slotsOf(e.zh), slotsOf(e.en), key + ': the two languages carry different slots')
    }
  })

  test('an unknown locale falls back to the default rather than to nothing', () => {
    const weird = createResolver({ catalogue: CATALOGUE, locale: 'fr' })
    assert.strictEqual(weird.locale, DEFAULT_LOCALE)
    assert.strictEqual(weird('briefing.nothingWaiting'), CATALOGUE['briefing.nothingWaiting'].zh)
  })
})
