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
    /**
     * ⛔ MISSING AND DELIBERATELY EMPTY ARE NOT THE SAME THING, and the first version of this
     * test treated them as one. `punct.sentenceSep` is zh:'' and en:' ' — Chinese needs no
     * space between sentences and English does, so the empty string IS the value.
     *
     * The guard that matters is 「nobody wrote the other language yet」, which shows up as a
     * MISSING key, not as an empty one. So: both must be strings, and an entry may not be
     * empty in BOTH — that would be an entry saying nothing in any language.
     */
    for (const [key, e] of Object.entries(CATALOGUE)) {
      for (const loc of LOCALES) {
        assert.strictEqual(typeof e[loc], 'string', key + ' is missing ' + loc)
      }
      assert.ok(LOCALES.some((loc) => e[loc].length > 0), key + ' is empty in every language')
    }
  })

  test('⛔ no key is defined twice — the object cannot show you this, so the SOURCE is scanned', () => {
    /**
     * A duplicate key in an object literal keeps the LAST and discards the earlier one in
     * silence. Every test still passes, the entry count is still right, and one of the two
     * sentences simply does not exist. This happened: `briefing.nothingWaiting` was written in
     * the proof set and again in the briefing block, with different words.
     *
     * By the time you have the object, the evidence is gone. So this reads the file.
     */
    const src = fs.readFileSync(path.join(SRC, 'i18n', 'catalogue.js'), 'utf8')
    const seen = new Map()
    const dupes = []
    for (const m of src.matchAll(/^ {2}'([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)':/gm)) {
      if (seen.has(m[1])) dupes.push(m[1])
      seen.set(m[1], true)
    }
    assert.deepStrictEqual(dupes, [], 'defined twice; the earlier one is silently discarded')
    assert.strictEqual(seen.size, Object.keys(CATALOGUE).length,
      'the scan must see every key the object has, or it is not covering the file')
  })

  test('every key is key-shaped, so data can never collide with one', () => {
    for (const key of Object.keys(CATALOGUE)) assert.match(key, KEY_SHAPE, key)
  })

  test('⛔ no English entry is punctuated in Chinese', () => {
    /**
     * ⛔ FIFTH INSTANCE OF ONE FAMILY: THE GAP BETWEEN THE LANGUAGES IS NOT ONLY IN THE WORDS.
     *
     *   1. 「、」「；」 — list separators, outside the Han range every count used.
     *   2. number agreement — 「{n} of them were」 is wrong at n=1 and renders anyway.
     *   3. sentence joining — 「…run daily.Still run by hand」, no space between sentences.
     *   4. 「／」「·」 — more separators, found the same way as the first.
     *   5. THIS — an English sentence quoting with 「」: `do not read that as 「no recalls」`.
     *
     * Every one of them renders. Every one of them was found by a person reading output. Four
     * were fixed and left as writing advice; the fifth is where that stops being enough, so
     * the mechanical half of the family — punctuation that simply does not belong in English —
     * is checked here. The plural rule still is not, and `catalogue.js` says why: a regex for
     * one agreement would look like a guard and miss every other.
     */
    /**
     * ⛔ AND THE FIRST VERSION OF THIS SET WAS WRONG — it included 「—」 and 「…」, which are
     * ordinary English punctuation, and failed on `{ingredient} — new recall: {items}`. A
     * detector that flags correct work gets switched off, and then it protects nothing
     * (HR-47's other half). Only unambiguously CJK and fullwidth forms belong here.
     */
    const CJK_PUNCT = /[「」『』【】〔〕〈〉《》、。，；：？！～＂＇（）［］｛｝／＼｜]/
    for (const [key, e] of Object.entries(CATALOGUE)) {
      // The separator entries ARE punctuation — their English value is chosen deliberately.
      if (key.startsWith('punct.')) continue
      const bad = e.en.match(CJK_PUNCT)
      assert.strictEqual(bad, null,
        key + '/en is punctuated in Chinese (' + (bad && bad[0]) + '): ' + e.en)
    }
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
