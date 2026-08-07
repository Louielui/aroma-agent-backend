'use strict'
/**
 * browserResolver.test.js — the page and the server cannot disagree, and here is the evidence.
 *
 * ⛔ Shared source is the MECHANISM. This is the PROOF, and the difference matters: a
 * `.toString()` that silently dropped a closed-over constant would still look like sharing.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const vm = require('node:vm')
const { createResolver, LOCALES } = require('../governance/textResolver')
const { CATALOGUE } = require('./catalogue')
const { browserI18nSource, browserResolverSource } = require('./browserResolver')

/** Run the generated source the way the page would, and hand back its resolver factory. */
function pageContext () {
  const sandbox = {}
  vm.createContext(sandbox)
  vm.runInContext(browserI18nSource(), sandbox)
  return sandbox
}

/**
 * Slots that exercise the shapes real data arrives in — a name with punctuation, a number, a
 * value that looks like a key, and an empty string.
 */
const SLOT_VALUES = [
  'Highline brand Organic Mini Bella Mushrooms Sliced recalled due to Listeria',
  51,
  'briefing.nothingWaiting',
  '',
  'green onion、beef'
]

const slotsFor = (template, offset) => {
  const out = {}
  const names = (template.match(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g) || []).map((s) => s.slice(1, -1))
  names.forEach((n, i) => { out[n] = SLOT_VALUES[(i + offset) % SLOT_VALUES.length] })
  return out
}

describe('⛔ the page runs the server\'s own resolver', () => {
  test('the generated source really is the server function, not a copy of it', () => {
    const src = browserResolverSource()
    assert.ok(src.includes(createResolver.toString()),
      'the function object itself must be serialised — a hand-written equivalent is the thing this avoids')
    // The constants it closes over must travel with it, or it throws in the page on first call.
    for (const name of ['LOCALES', 'DEFAULT_LOCALE', 'KEY_SHAPE', 'SLOT', 'missingMark']) {
      assert.match(src, new RegExp('var ' + name + ' ='), name + ' is closed over and must be shipped')
    }
  })

  test('⛔ EVERY key, BOTH locales, identical output', () => {
    const page = pageContext()
    let checked = 0
    for (const locale of LOCALES) {
      const server = createResolver({ catalogue: CATALOGUE, locale })
      const client = page.createResolver({ catalogue: page.CATALOGUE, locale })
      for (const [key, entry] of Object.entries(CATALOGUE)) {
        for (let offset = 0; offset < SLOT_VALUES.length; offset++) {
          const slots = slotsFor(entry[locale], offset)
          assert.strictEqual(client(key, slots), server(key, slots), key + ' / ' + locale)
          checked++
        }
      }
    }
    assert.ok(checked > 0, 'a green run over nothing is not evidence')
  })

  test('⛔ AND THE CASES A SECOND IMPLEMENTATION WOULD GET WRONG', () => {
    // These are where two plausible implementations diverge, and each divergence is silent.
    const page = pageContext()
    const server = createResolver({ catalogue: CATALOGUE, locale: 'en' })
    const client = page.createResolver({ catalogue: page.CATALOGUE, locale: 'en' })
    const cases = [
      ['conclusion.calm', undefined], //                       no slots object at all
      ['conclusion.calm', {}], //                              slot declared, not supplied
      ['conclusion.gap', { ingredients: 'beef' }], //          one of two supplied
      ['conclusion.calm', { n: 0 }], //                        a falsy value is still a value
      ['conclusion.calm', { n: null }], //                     and so is null
      ['nope.missing', {}], //                                 unknown key
      ['NOT A KEY', {}], //                                    not key-shaped
      ['punct.sentenceSep', {}] //                             legitimately empty in zh
    ]
    for (const [key, slots] of cases) {
      assert.strictEqual(client(key, slots), server(key, slots), key + ' with ' + JSON.stringify(slots))
    }
    // And the one that would be a real bug: an unfilled slot must be VISIBLE in both.
    assert.match(client('conclusion.calm', {}), /⟦\?n⟧/)
  })

  test('an unknown locale falls back the same way in both', () => {
    const page = pageContext()
    const server = createResolver({ catalogue: CATALOGUE, locale: 'fr' })
    const client = page.createResolver({ catalogue: page.CATALOGUE, locale: 'fr' })
    assert.strictEqual(client('briefing.nothingWaiting'), server('briefing.nothingWaiting'))
  })

  test('⛔ the inlined catalogue cannot close the inline script', () => {
    // The page is one self-contained document; a `</script>` inside any value would end the
    // script early and the rest of the UI would silently not exist.
    assert.ok(!browserI18nSource().includes('</script'), 'no literal closing tag may survive escaping')
  })
})
