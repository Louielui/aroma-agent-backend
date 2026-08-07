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
 * ⛔ NOT YET A SETTING. See the header — this is step 3, and it is one line.
 * Until then: the env override, else the default. Never a guess.
 */
function currentLocale () {
  const env = process.env.XIANGXIANG_LOCALE
  return LOCALES.includes(env) ? env : DEFAULT_LOCALE
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
