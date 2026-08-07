'use strict'

/**
 * browserResolver.js — the SAME resolver, shipped into the page.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE PROBLEM THIS EXISTS TO NOT HAVE.
 *
 * The page cannot `require` the resolver, so the obvious move is to write a small `t()` in
 * `app.js`. That is TWO RENDERINGS OF THE SAME KEY, and the project's own ruling on exactly
 * this shape is already written in `sectionAttachment.js`:
 *
 *   > **Two renderings could disagree; one function cannot disagree with itself.**
 *
 * A second implementation would agree with the first on every case anyone thought to try, and
 * differ on the one nobody did — an unfilled slot, a missing key, a locale fallback. And it
 * would differ SILENTLY, because both produce a plausible string.
 *
 * ── SO THE BROWSER RUNS THE SERVER'S OWN FUNCTION ───────────────────────────
 * The source below is not a re-implementation. It is `createResolver.toString()` — the actual
 * function object from `governance/textResolver.js` — plus the module constants it closes over,
 * serialised from those same constants rather than retyped. Editing the resolver changes what
 * the browser runs, with no second edit and no possibility of drift.
 *
 * ⛔ AND THAT IS STILL NOT PROOF, so it is not left as an argument. `browserResolver.test.js`
 * renders EVERY catalogue key, in BOTH locales, through both paths and asserts the strings are
 * identical — including the cases a second implementation would get wrong. Shared source is the
 * mechanism; the equivalence test is the evidence.
 *
 * ⚠ WHAT THIS DOES NOT COVER: `i18n/t.js` — locale resolution and the per-locale cache — is NOT
 * shipped. The page picks its locale from a value the server hands it, so 「which locale」 is
 * answered in two places by construction. What is shared is the rendering, which is where a
 * disagreement would be invisible; 「which locale」 is visible the moment it is wrong.
 */

const { createResolver, LOCALES, DEFAULT_LOCALE, KEY_SHAPE, SLOT, missingMark } = require('../governance/textResolver')
const { CATALOGUE } = require('./catalogue')

/**
 * JS source defining `createResolver` in the page, identical to the server's.
 * @returns {string}
 */
function browserResolverSource () {
  return [
    '/* Generated from src/governance/textResolver.js — DO NOT EDIT IN THE PAGE. */',
    'var LOCALES = ' + JSON.stringify(LOCALES) + ';',
    'var DEFAULT_LOCALE = ' + JSON.stringify(DEFAULT_LOCALE) + ';',
    // The regexes are rebuilt from `.source`/`.flags`, not retyped — a retyped pattern is a
    // second implementation of the smallest and most easily wrong kind.
    'var KEY_SHAPE = new RegExp(' + JSON.stringify(KEY_SHAPE.source) + ', ' + JSON.stringify(KEY_SHAPE.flags) + ');',
    'var SLOT = new RegExp(' + JSON.stringify(SLOT.source) + ', ' + JSON.stringify(SLOT.flags) + ');',
    'var missingMark = ' + missingMark.toString() + ';',
    'var createResolver = ' + createResolver.toString() + ';'
  ].join('\n')
}

/**
 * The locale the page STARTS in, resolved by the same `currentLocale()` the server uses.
 *
 * ⛔ THE PAGE SHIPS BOTH LANGUAGES AND IS TOLD WHICH ONE TO OPEN IN. It is not given a bound
 * catalogue: switching language must not need a reload, let alone a restart. This is the
 * initial value only.
 *
 * ⚠ AND THERE IS NO SWITCH YET. That is step 3 — `language` as the settings registry's eighth
 * and final entry — and it is one line: the page reads the setting instead of this. Until then
 * the only way to change it is `XIANGXIANG_LOCALE` in the server's environment, which is a
 * developer affordance and not the feature. Said plainly so nobody reports the missing switch
 * as a defect.
 */
function browserLocaleSource () {
  const { currentLocale } = require('./t')
  return 'var INITIAL_LOCALE = ' + JSON.stringify(currentLocale()) + ';'
}

/** The catalogue, both locales, as a page-safe literal. */
function browserCatalogueSource () {
  // ⛔ `</script>` inside any string would end the inline script early. The page is assembled
  // as one document, so this is escaped here rather than trusted not to occur.
  return 'var CATALOGUE = ' + JSON.stringify(CATALOGUE).replace(/</g, '\\u003c') + ';'
}

/** Everything the page needs, in one block. */
function browserI18nSource () {
  return browserResolverSource() + '\n' + browserLocaleSource() + '\n' + browserCatalogueSource()
}

module.exports = { browserResolverSource, browserCatalogueSource, browserLocaleSource, browserI18nSource }
