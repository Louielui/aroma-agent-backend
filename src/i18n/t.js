'use strict'

/**
 * t.js — the one `t` every interface module imports.
 *
 * ⛔ THE LOCALE IS READ AT USE TIME, NOT AT MODULE LOAD.
 *
 * Same rule as `settingsValues.js`, and for the same reason: a module-level
 * `createResolver({ locale })` freezes the language at require() time, and then switching
 * languages would need a restart — which is exactly the kind of setting the registry exists to
 * avoid. The resolver itself is cached per locale; only the CHOICE is re-read.
 *
 * ── WHERE THE LOCALE COMES FROM, TODAY ──────────────────────────────────────
 * Nowhere yet, deliberately. Step 3 of the bilingual work adds `language` to the settings
 * registry as its eighth and final entry, and that is a one-line change HERE. Until then this
 * returns the default, and it says so rather than pretending to consult a setting that does not
 * exist. An env override exists for tests and for looking at the English rendering before the
 * switch is built — it is not the feature.
 */

const { createResolver, LOCALES, DEFAULT_LOCALE } = require('../governance/textResolver')
const { CATALOGUE } = require('./catalogue')

const cache = new Map()

function resolverFor (locale) {
  if (!cache.has(locale)) cache.set(locale, createResolver({ catalogue: CATALOGUE, locale }))
  return cache.get(locale)
}

/**
 * ⛔ THE SETTING, READ AT USE TIME — never captured at module load.
 *
 * `language` is entry 8 of 8 in the settings registry. Reading it here, on every call, is what
 * makes 「I changed it」 and 「it took effect」 the same moment for anything rendered after the
 * change. A module-level `const locale = ...` would have made this a restart-only setting,
 * which is the thing the registry exists to stop.
 *
 * Order, and each part is deliberate:
 *   1. `XIANGXIANG_LOCALE` — a developer override for tests and for looking at a rendering
 *      without touching his stored settings. Deliberately FIRST so a test cannot be perturbed
 *      by whatever he happens to have saved.
 *   2. the stored setting — the feature.
 *   3. the default — never a guess.
 *
 * ⛔ AND IT NEVER THROWS. A settings file that cannot be read must not blank the interface;
 * it falls back to the default, which is the same rule as `missingMark` one level down.
 */
function currentLocale () {
  const env = process.env.XIANGXIANG_LOCALE
  if (LOCALES.includes(env)) return env
  try {
    const v = require('../home/settingsValues').get('language')
    if (LOCALES.includes(v)) return v
  } catch (_) { /* no settings module or unreadable file — the default stands, visibly */ }
  return DEFAULT_LOCALE
}

/**
 * @param {string} key MUST be a string literal at the call site — enforced by the source scan
 *   in `textResolver.test.js`. See `textResolver.js` for why the obvious check for that is wrong.
 * @param {object=} slots inserted VERBATIM. Never looked up, never translated.
 */
function t (key, slots) {
  return resolverFor(currentLocale())(key, slots)
}

module.exports = { t, currentLocale }
