'use strict'

/**
 * codeOnly.js — strip comments before grepping source in a test.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS EXISTS: a source-scanning test that fails on its own documentation.
 *
 * Twice in one day:
 *   · a test forbidding `g.items || []` matched the COMMENT explaining why it was removed;
 *   · a test forbidding a `message` parameter matched the sentence saying there is none.
 *
 * Both times the code was right and the test was reading prose. A structural test asserts a
 * property of the CODE; comments are where we explain the property, so the two are guaranteed
 * to collide as the explanations get better.
 *
 * Fixing it in place twice is how a third one happens. This is the mechanism instead.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ⚠ It is deliberately crude — line comments and block-comment bodies, no string awareness.
 * It is for structural greps in tests, never for parsing.
 */
function codeOnly (src) {
  return String(src == null ? '' : src)
    .replace(/\/\*[\s\S]*?\*\//g, '')       // block comments, including the ⛔ headers
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .map((l) => l.replace(/\s\/\/.*$/, '')) // trailing line comments
    .join('\n')
}

module.exports = { codeOnly }
