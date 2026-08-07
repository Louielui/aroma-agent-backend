'use strict'

/**
 * textResolver.js — the ONLY way interface text is produced. GOVERNANCE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THE RESOLVER IS GOVERNANCE AND THE WORDS ARE NOT.
 *
 * The catalogue (`src/i18n/catalogue.js`) holds the WORDS — the Owner will reword them, and he
 * should not need a work order to do it. This file holds the RULES that keep DATA out of the
 * translator, and those are a fence:
 *
 *   > **A translated supplier or ingredient name is an order placed for the wrong thing.**
 *
 * Same split as `settingsRegistry.js`: the ranges are governance, the values are not.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ① LITERAL KEYS ONLY ─────────────────────────────────────────────────────
 * `t('briefing.nothingWaiting')` — never `t('supplier.' + name)`. A dynamic key is a path for
 * data to enter the translator, and it will look reasonable the first time something seems
 * repetitive.
 *
 * Enforced TWICE, because neither half is sufficient alone:
 *   · STATICALLY — `textResolver.test.js` scans the source and fails on a non-literal argument.
 *     This is the real enforcement; a linter rule nobody runs is not one.
 *   · AT RUNTIME — an unknown key cannot resolve. A key built from data will not be in the
 *     catalogue, so even if the static check were bypassed the data does not get translated.
 *
 * ⛔ AND THE OBVIOUS IMPLEMENTATION OF THIS RULE DOES NOT WORK. READ THIS BEFORE WRITING IT.
 *
 * The first version of the static check asked 「does the argument start with a string literal」.
 * It passed everything it was supposed to pass, and it passed this:
 *
 *     t('supplier.' + name)          ← BEGINS with a literal. Data straight into the translator.
 *
 * That is the natural way to write the check, it reads correct, and it is wrong. It was not
 * caught by review — it was caught by the seen-to-fail test, which fed it the shapes data would
 * actually arrive in and watched it say yes. Review looked at it and agreed with it.
 *
 * Two things follow, and both are load-bearing:
 *   · The predicate must demand a COMPLETE literal and nothing else — see `isLiteralKeyArg`.
 *   · The predicate lives HERE, not in the test, so the proof and the scan are ONE function.
 *     Two copies that drift is the same failure as two readers of one record: they agree until
 *     the day they matter. A proof written against a copy stops proving anything silently.
 *
 * ── ② TEMPLATES, NOT SENTENCES ──────────────────────────────────────────────
 * ⛔ THE PROOF, KEPT HERE BECAUSE THIS IS WHERE SOMEONE WOULD FLATTEN IT:
 *
 *     「mushrooms」(詞組搜尋):個站搵到 51 條:2026-08-04 Highline brand Organic Mini Bella…
 *      └─ DATA ─┘  └ interface ┘  └int┘ 51 └int┘  └────────── DATA, verbatim ──────────┘
 *
 * One line, both kinds. The tempting move is to store the whole sentence as one translatable
 * string — and then the ingredient, the count and **the site's own recall title** are inside the
 * translated unit. So a catalogue entry is a TEMPLATE with slots, and:
 *
 *   > ### SLOT VALUES ARE INSERTED VERBATIM AND ARE NEVER LOOKED UP, NEVER TRANSLATED.
 *
 * Translation changes the frame. It can never reach inside a slot.
 *
 * ── ③ HER REPLIES NEVER PASS THROUGH HERE ───────────────────────────────────
 * If you are reading this thinking 「the interface is bilingual, why is her answer still
 * Chinese」 — because her answer is not interface. It is model output. It has never entered this
 * catalogue and there is no key for it, so nothing here can translate it, in either direction.
 *
 * Her language is governed elsewhere and by different means: the conversation contract states
 * the rule, and `src/intake/traditionalGuard.js` checks the output. Making her bilingual would
 * be a change to THAT path — a prompt-and-guard question, not a catalogue question.
 */

const LOCALES = Object.freeze(['zh', 'en'])
const DEFAULT_LOCALE = 'zh'

/** A key is dotted, lowercase-initial segments. Data does not look like this by accident. */
const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/

/** `{name}` — the only substitution. No expressions, no nesting, nothing evaluable. */
const SLOT = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g

/**
 * ⛔ A MISSING KEY IS VISIBLE, NOT SILENT AND NOT FATAL.
 *
 * Throwing would blank a screen — the one thing this surface may never be. Returning the key
 * quietly would put `supplier.SUNCO` on screen looking like a label. This is unmistakable.
 */
const missingMark = (key) => '⟦?' + key + '⟧'

function createResolver ({ catalogue, locale, onMissing } = {}) {
  const loc = LOCALES.includes(locale) ? locale : DEFAULT_LOCALE
  const cat = catalogue || {}

  /**
   * @param {string} key   MUST be a literal at the call site — see the static test.
   * @param {object=} slots values inserted VERBATIM. Never translated, never looked up.
   */
  function t (key, slots) {
    if (typeof key !== 'string' || !KEY_SHAPE.test(key)) {
      if (onMissing) onMissing({ key, reason: 'bad_key_shape' })
      return missingMark(String(key))
    }
    const entry = cat[key]
    if (!entry) {
      // ⛔ THE RUNTIME HALF OF RULE ①. A key built from data is not in the catalogue, so data
      // cannot be translated even if the static check were somehow bypassed.
      if (onMissing) onMissing({ key, reason: 'unknown_key' })
      return missingMark(key)
    }
    const template = typeof entry[loc] === 'string' ? entry[loc] : entry[DEFAULT_LOCALE]
    if (typeof template !== 'string') {
      if (onMissing) onMissing({ key, reason: 'no_string_for_locale' })
      return missingMark(key)
    }

    return template.replace(SLOT, (whole, name) => {
      if (!slots || !Object.prototype.hasOwnProperty.call(slots, name)) {
        // A slot nobody filled is left visible rather than rendered as empty — an empty slot
        // silently produces a sentence that reads complete and says less than it should.
        return '⟦?' + name + '⟧'
      }
      // ⛔ VERBATIM. This is the boundary: whatever the caller passes goes in unchanged.
      // No lookup, no translation, no escaping into the catalogue.
      return String(slots[name])
    })
  }

  t.locale = loc
  return t
}

/**
 * ⛔ THE STATIC HALF OF RULE ①, kept HERE rather than in the test.
 *
 * The rule is the fence, so it lives in the protected path — and so that the test which proves
 * it fails uses THE SAME function the scan uses. A proof written against a copy of the predicate
 * stops proving anything the moment the two drift.
 *
 * The argument must be a complete string literal AND NOTHING ELSE. This is the line that was
 * wrong first time round: `'supplier.' + name` BEGINS with a literal, and a check that only
 * looked at the beginning let data straight through.
 *
 * @param {string} arg source text of the first argument at a `t(` call site
 */
const LITERAL_KEY_ARG = /^(['"])[^'"\\]+\1\s*(,|$)/

function isLiteralKeyArg (arg) {
  return typeof arg === 'string' && LITERAL_KEY_ARG.test(arg.trim())
}

module.exports = {
  createResolver,
  LOCALES,
  DEFAULT_LOCALE,
  KEY_SHAPE,
  SLOT,
  missingMark,
  isLiteralKeyArg,
  LITERAL_KEY_ARG
}
