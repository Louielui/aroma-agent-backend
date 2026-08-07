'use strict'
/**
 * settingsRegistry.test.js — Layer 1. Only things he would say in his own words.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「Hold your own boundary as the design constraint, not as a note … And hold R1.3 —
 * > if the registry grows past one screen, that is the signal it has become the abstraction
 * > layer I ruled out, not a sign it is going well.」**
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { ENTRIES, APPLIES, MAX_ENTRIES, entry, defaults, validate } = require('./settingsRegistry')

describe('⛔ the boundary is a test, not a note', () => {
  test('it stays under one screen — R1.3', () => {
    assert.ok(ENTRIES.length <= MAX_ENTRIES,
      'past this it is the abstraction layer he ruled out: ' + ENTRIES.length + ' entries')
  })

  test('⛔ every entry says what he would SAY, not what the variable is called', () => {
    for (const e of ENTRIES) {
      assert.ok(typeof e.say === 'string' && e.say.length >= 4,
        e.id + ' has no Owner-facing sentence — the admission test is the label, not the value')
      // the label must not be the identifier wearing a translation
      assert.ok(!/[A-Za-z_]{6,}/.test(e.say), e.id + ': 「' + e.say + '」 reads like a variable name')
    }
  })

  test('⛔ the things he would never say are ABSENT, and named as absent', () => {
    const ids = ENTRIES.map((e) => e.id)
    for (const never of ['maxLines', 'maxRowsShown', 'knockLogMaxRows', 'timeoutMs', 'retries', 'maxNodes']) {
      assert.ok(!ids.includes(never), never + ' is a constant, not a setting')
    }
    // and the reasoning is written where the next person will look
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'settingsRegistry.js'), 'utf8')
    assert.match(src, /DELIBERATELY NOT HERE/, 'exclusions must be stated or they read as oversights')
    assert.match(src, /MAX_LINES/, 'and named individually')
  })

  test('every entry declares HOW a change takes effect', () => {
    for (const e of ENTRIES) {
      assert.ok(Object.values(APPLIES).includes(e.appliesOn),
        e.id + ' must say whether it applies live — a setting that silently does not apply is worse than one he cannot change')
    }
  })

  test('⛔ anything not LIVE says how to apply it', () => {
    for (const e of ENTRIES.filter((x) => x.appliesOn !== APPLIES.LIVE)) {
      assert.ok(typeof e.howToApply === 'string' && e.howToApply.length > 20,
        e.id + ' does not apply live and must carry the instruction, or he will believe it took')
    }
  })
})

describe('⛔ the ranges are fences, not suggestions', () => {
  test('the pacing floor cannot be removed from a settings screen', () => {
    // HR-34, measured: six back-to-back searches broke the register.
    const r = validate('pauseBetweenMs', 0)
    assert.strictEqual(r.ok, false)
    assert.match(r.saying, /籬笆/, 'the refusal must say it is a fence, not a preference')
    assert.strictEqual(validate('pauseBetweenMs', 5000).ok, true)
  })

  test('the run interval cannot be set to zero either', () => {
    assert.strictEqual(validate('minRunIntervalMs', 0).ok, false)
    assert.strictEqual(validate('minRunIntervalMs', 60 * 60 * 1000).ok, true)
  })

  test('⛔ the ingredient list is capped, with the cost as the reason', () => {
    const many = Array.from({ length: 20 }, (_, i) => 'x' + i)
    const r = validate('recallIngredients', many)
    assert.strictEqual(r.ok, false)
    assert.match(r.saying, /12 秒|限流/, 'the cap must state what it costs, not just refuse')
  })

  test('an empty ingredient list is refused — it would look like a working errand with nothing to do', () => {
    assert.strictEqual(validate('recallIngredients', []).ok, false)
  })

  test('⛔ an unknown setting is REFUSED, never stored', () => {
    const r = validate('somethingInvented', 1)
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.reason, 'unknown_setting')
  })

  test('a non-integer is refused rather than coerced', () => {
    assert.strictEqual(validate('recallShownPerIngredient', 6.5).ok, false)
    assert.strictEqual(validate('recallShownPerIngredient', 'six').ok, false)
    assert.strictEqual(validate('recallShownPerIngredient', 6).ok, true)
  })

  test('the list is trimmed and blanks dropped, and the result is what gets stored', () => {
    const r = validate('recallIngredients', ['  beef ', '', 'romaine'])
    assert.deepStrictEqual(r.value, ['beef', 'romaine'])
  })
})

describe('defaults match what the code did before the registry existed', () => {
  test('⛔ the defaults are the CURRENT constants, so introducing this changes no behaviour', () => {
    const d = defaults()
    assert.deepStrictEqual(d.recallIngredients, ['mushrooms', 'chicken', 'cheese', 'beef', 'romaine', 'green onion'])
    assert.strictEqual(d.recallShownPerIngredient, 6, 'MAX_SHOWN was 6')
    assert.strictEqual(d.pauseBetweenMs, 5000, 'PAUSE_BETWEEN_MS was 5000')
    assert.strictEqual(d.minRunIntervalMs, 60 * 60 * 1000)
    assert.strictEqual(d.recallEveryMs, 24 * 60 * 60 * 1000, 'the kind was daily')
    assert.strictEqual(d.recallGraceMs, 6 * 60 * 60 * 1000)
  })

  test('entry() is the one lookup, and an unknown id returns null rather than throwing', () => {
    assert.ok(entry('pauseBetweenMs'))
    assert.strictEqual(entry('nope'), null)
  })
})

describe('⛔ the definitions are governance; the values are not', () => {
  test('the registry file is inside the protected path', () => {
    const { isForbiddenFile } = require('../agent/workOrder')
    assert.strictEqual(isForbiddenFile('src/governance/settingsRegistry.js'), true,
      'the RANGES are fences — a settable 0ms pause would defeat HR-34 from a screen')
  })
})
