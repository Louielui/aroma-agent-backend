'use strict'

/**
 * assertionShape.js — finding assertions that cannot fail.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「A test that compares a literal to itself has been green since the day it was
 * > written and would have stayed green forever — and the only reason anyone looked was a
 * > translation pass.」**
 *
 * The one that was found:
 *
 *     assert.match(c.unknown || c.gap || c.alert || '從來未', /從來未|未有/)
 *
 * On the state it was written to cover, all three fields are null. The chain falls through to
 * the LITERAL, and the literal satisfies the matcher. It asserts that '從來未' contains 從來未.
 *
 * ⛔ WHY THIS SHAPE IS INVISIBLE. Nothing about it looks wrong. It reads as defensive — the
 * `||` looks like it is handling a case rather than erasing one — and it is green, so no run
 * ever draws attention to it. It is only findable by asking a question no one thinks to ask:
 * **can this assertion pass without touching the thing it names?**
 *
 * ── ⛔ AND THE GENERAL FORM, WHICH IS BIGGER THAN `|| ''` (HR-46) ───────────
 *
 * > **Owner: 「防守嘅習慣，解除咗佢自己防守緊嘅守衛。」**
 *
 * All five instances found by the first sweep sat on a 「must not read as good news」 guard. That
 * is not chance: `|| ''` is what you write when being careful about a field that MIGHT BE
 * MISSING, and 「might be missing」 is the exact state those guards exist to catch. The care and
 * the hole have the same cause.
 *
 * The rule generalises past `|| ''` and past tests. Wherever a fallback is written — `|| []`,
 * `|| {}`, `?? 0`, `catch { return null }` — ask what the code does when the FALLBACK is the
 * value, and whether that is the case you were trying to check. In production this is how
 * `detailFor` turned a missing `items` into `[]` and produced a false all-clear for eight
 * ingredients (HR-43), and how a missing store rendered identically to a corrupt one until
 * NOT_WIRED was split out. A fallback answers a question the code failed to answer; sometimes
 * that is mercy, and on a guard it is a lie.
 *
 * ── WHAT IS DETECTED ────────────────────────────────────────────────────────
 * ① FALL-THROUGH: the subject is an `||` chain ending in a literal, and that literal alone
 *    satisfies the matcher. The assertion passes with every real operand null.
 * ② EMPTY-COERCION: the subject coerces a possibly-absent value with `|| ''` and then asserts
 *    that something is ABSENT from it. Empty contains nothing, so the absent case passes for
 *    free — a nullable field silently exempts itself from the check it looks covered by.
 *
 * ⛔ THIS DETECTOR'S OWN CLEAN RESULT MEANS NOTHING UNTIL IT HAS BEEN SEEN TO FIRE (HR-47).
 * Its first version had a one-line bug — `readLiteral` never accumulated ordinary characters —
 * so it was structurally incapable of seeing `|| '從來未'`, the shape it was written to find,
 * while still reporting the `|| ''` sites and looking like it worked. A broken detector and a
 * clean codebase produce the same output. `assertionShape.test.js` feeds it real instances,
 * copied from the code that motivated it, and watches each one fire.
 *
 * ⛔ WHAT IS NOT DETECTED, AND THE HONESTY THAT MATTERS MORE THAN THE COVERAGE:
 * this finds ONE family. An assertion can be vacuous in ways no scanner sees — a fixture that
 * cannot produce the state under test, a matcher loose enough that any string passes, a loop
 * over an empty array. A green run here means this shape is absent, NOT that every assertion
 * in the suite can fail.
 */

/** Reads a JS literal at `i`, returning its value and end index — or null if there isn't one. */
function readLiteral (src, i) {
  const q = src[i]
  if (q !== "'" && q !== '"' && q !== '`') return null
  let out = ''
  for (let j = i + 1; j < src.length; j++) {
    const ch = src[j]
    if (ch === '\\') { out += src[j + 1]; j++; continue }
    if (ch === q) {
      // A template with a substitution is not a constant — it is not a fall-through literal.
      if (q === '`' && /\$\{/.test(out)) return null
      return { value: out, end: j }
    }
    // ⛔ THIS LINE WAS MISSING, AND THE SEEN-TO-FAIL TEST IS THE ONLY REASON ANYONE KNOWS.
    // Without it every literal read back as the empty string, so the detector fired only where
    // the fallback genuinely WAS '' — and silently could not see `|| '從來未'`, the exact shape
    // it was written to find. A sweep run against it would have reported a clean suite.
    out += ch
  }
  return null
}

/** Splits an argument list at top-level commas, respecting nesting, strings and regexes. */
function splitArgs (src, open) {
  const args = []
  let depth = 0
  let start = open + 1
  for (let i = open + 1; i < src.length; i++) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const lit = readLiteralRaw(src, i)
      if (lit === null) return null
      i = lit
      continue
    }
    if (ch === '/' && isRegexStart(src, i)) {
      const end = readRegexEnd(src, i)
      if (end === null) return null
      i = end
      continue
    }
    if ('([{'.includes(ch)) { depth++; continue }
    if (')]}'.includes(ch)) {
      if (ch === ')' && depth === 0) { args.push(src.slice(start, i)); return { args, close: i } }
      depth--
      continue
    }
    if (ch === ',' && depth === 0) { args.push(src.slice(start, i)); start = i + 1 }
  }
  return null
}

/** End index of a string literal starting at `i`, ignoring its value. */
function readLiteralRaw (src, i) {
  const q = src[i]
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue }
    if (src[j] === q) return j
  }
  return null
}

/** A `/` starts a regex when the previous meaningful character cannot end an expression. */
function isRegexStart (src, i) {
  let j = i - 1
  while (j >= 0 && /\s/.test(src[j])) j--
  if (j < 0) return true
  return !/[\w)\]'"`]/.test(src[j])
}

function readRegexEnd (src, i) {
  let inClass = false
  for (let j = i + 1; j < src.length; j++) {
    const ch = src[j]
    if (ch === '\\') { j++; continue }
    if (ch === '[') inClass = true
    else if (ch === ']') inClass = false
    else if (ch === '\n') return null
    else if (ch === '/' && !inClass) {
      let k = j + 1
      while (k < src.length && /[a-z]/.test(src[k])) k++
      return k - 1
    }
  }
  return null
}

/** Splits an expression at top-level `||`, respecting nesting and strings. */
function splitOr (expr) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = readLiteralRaw(expr, i)
      if (end === null) break
      i = end
      continue
    }
    if (ch === '/' && isRegexStart(expr, i)) {
      const end = readRegexEnd(expr, i)
      if (end === null) continue
      i = end
      continue
    }
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (ch === '|' && expr[i + 1] === '|' && depth === 0) {
      parts.push(expr.slice(start, i))
      i++
      start = i + 1
    }
  }
  parts.push(expr.slice(start))
  return parts.map((p) => p.trim())
}

/** Builds a RegExp from a regex-literal source, or null. */
function toRegExp (text) {
  const m = /^\/((?:\\.|\[(?:\\.|[^\]])*\]|[^/])+)\/([a-z]*)$/.exec(text.trim())
  if (!m) return null
  try { return new RegExp(m[1], m[2]) } catch (_) { return null }
}

const MATCHERS = new Set(['match', 'doesNotMatch', 'ok'])

/**
 * @param {string} code source with comments already stripped
 * @returns {Array<{line:number, kind:string, snippet:string, fallback:string}>}
 */
function findVacuousAssertions (code) {
  const found = []
  const re = /assert\.(match|doesNotMatch|ok)\s*\(/g
  let m
  while ((m = re.exec(code)) !== null) {
    const fn = m[1]
    if (!MATCHERS.has(fn)) continue
    const open = m.index + m[0].length - 1
    const parsed = splitArgs(code, open)
    if (!parsed || !parsed.args.length) continue
    const subject = parsed.args[0].trim()
    const line = code.slice(0, m.index).split('\n').length
    const snippet = code.slice(m.index, parsed.close + 1).replace(/\s+/g, ' ').slice(0, 160)

    // ── ① FALL-THROUGH: `x || y || 'literal'` where the literal alone satisfies the matcher.
    const ors = splitOr(subject)
    if (ors.length > 1) {
      const last = ors[ors.length - 1]
      const lit = readLiteral(last, 0)
      if (lit && lit.end === last.length - 1) {
        if (fn === 'ok') {
          if (lit.value) found.push({ line, kind: 'FALLTHROUGH_TRUTHY', snippet, fallback: lit.value })
        } else {
          const rx = toRegExp(parsed.args[1] || '')
          if (rx) {
            const satisfied = fn === 'match' ? rx.test(lit.value) : !rx.test(lit.value)
            if (satisfied) found.push({ line, kind: 'FALLTHROUGH_SELF_MATCH', snippet, fallback: lit.value })
          }
        }
      }
    }

    // ── ② EMPTY-COERCION: asserting absence from a value defaulted to ''.
    // `assert.ok(!/x/.test(v || ''))` and `assert.doesNotMatch(v || '', /x/)` both pass for
    // free whenever `v` is absent — the nullable case exempts itself from the check.
    //
    // One finding per site: `doesNotMatch(v || '', /x/)` satisfies both rules by construction,
    // and reporting it twice would inflate the count without naming a second problem.
    const alreadyFound = found.length && found[found.length - 1].line === line
    if (!alreadyFound && /\|\|\s*(''|""|``)\s*\)?/.test(subject)) {
      const negated = fn === 'doesNotMatch' || /^!/.test(subject)
      if (negated) found.push({ line, kind: 'EMPTY_COERCION_ABSENCE', snippet, fallback: '' })
    }
  }
  return found
}

module.exports = { findVacuousAssertions, splitOr, splitArgs, toRegExp }
