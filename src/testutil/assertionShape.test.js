'use strict'
/**
 * assertionShape.test.js — no assertion in the suite may pass without touching its subject.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「A test that compares a literal to itself has been green since the day it was
 * > written and would have stayed green forever — and the only reason anyone looked was a
 * > translation pass.」**
 *
 * ⛔ THE FINDING, RECORDED ON ITS OWN AND NOT INSIDE THE 164 COUNT.
 *
 * The original, in `errandConclusion.test.js`:
 *
 *     assert.match(c.unknown || c.gap || c.alert || '從來未', /從來未|未有/)
 *
 * On NEVER_RUN all three fields are null. The chain falls through to the LITERAL, and the
 * literal satisfies the matcher: it asserts that '從來未' contains 從來未. It was not a weak
 * test — it was not a test. It went green the day it was written and nothing would ever have
 * changed that, because a passing test is not something anyone goes back to read.
 *
 * ⛔ AND THE SWEEP FOUND THE FAMILY IS NOT RARE, AND NOT RANDOMLY PLACED.
 * Across 223 test files and 7,220 assertions, the exact self-matching literal appears ONCE —
 * the one above. But the wider shape (an assertion that exempts itself when its subject is
 * absent) appeared FIVE more times, and every single one sits on a 「must not read as good
 * news」 guard: the blocked recall that must not read as a clean page, the calm summary that
 * must not swallow an unchecked ingredient, the envelope that must not frame an ordinary turn.
 *
 * ⛔ THE FIRST SWEEP'S RESULT WAS NOT TRUSTWORTHY, AND ONLY THE SEEN-TO-FAIL SAID SO.
 * `readLiteral` never accumulated ordinary characters, so every literal read back as ''. The
 * detector still fired on the five `|| ''` sites — by coincidence, since their fallback really
 * was empty — while being structurally incapable of seeing `|| '從來未'`, the one shape it was
 * written to find. A clean sweep would have been reported and believed. The four cases below
 * are the only reason that is not what happened; the fix is marked at the line in
 * `assertionShape.js`. The numbers above are from the re-run.
 *
 * That placement is not a coincidence. `|| ''` is what you write when you are being careful
 * about a field that might be missing — and 「might be missing」 is exactly the state those
 * guards exist to catch. The defensive habit disarmed the guard it was defending.
 *
 * None of the five was masking a live defect: adding the existence assertion left all of them
 * green. They were loaded guns pointed away from the target, not holes in the floor.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { findVacuousAssertions } = require('./assertionShape')
const { codeOnly } = require('./codeOnly')

const SRC = path.join(__dirname, '..')

function scanAll () {
  const out = []
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      const st = fs.statSync(p)
      if (st.isDirectory()) { if (n !== 'node_modules') walk(p); continue }
      if (!/\.test\.js$/.test(n)) continue
      const rel = path.relative(SRC, p).split(path.sep).join('/')
      // ⛔ Comments stripped first: this very file quotes the original assertion, and a scanner
      // that reads its own documentation as code is the mistake that cost three tests before.
      for (const f of findVacuousAssertions(codeOnly(fs.readFileSync(p, 'utf8')))) {
        out.push({ file: rel, ...f })
      }
    }
  }
  walk(SRC)
  return out
}

describe('⛔ no assertion may pass without touching its subject', () => {
  test('the suite is free of the fall-through and empty-coercion shapes', () => {
    const found = scanAll()
    assert.deepStrictEqual(found.map((f) => f.file + ':' + f.line + ' ' + f.kind), [],
      'each of these can pass with its subject absent:\n' +
      found.map((f) => '  ' + f.file + ':' + f.line + '\n    ' + f.snippet).join('\n'))
  })

  test('⛔ SEEN TO FAIL — each shape is really caught', () => {
    // A probe never observed failing is not evidence.
    /**
     * ⛔ ASSEMBLED, NOT WRITTEN OUT — otherwise these four examples are themselves flagged by
     * the sweep above, and the file fails on its own fixtures. The same shape as the three
     * tests that once failed on their own documentation, which is why `codeOnly` exists: a
     * scanner cannot tell an example from an instance, so the example must not look like one.
     */
    const A = 'assert' + '.'
    const cases = [
      // The original, verbatim.
      [A + "match(c.unknown || c.gap || c.alert || '從來未', /從來未|未有/)", 'FALLTHROUGH_SELF_MATCH'],
      // Absence asserted against a value defaulted to empty.
      [A + "doesNotMatch(r.detail || '', /冇搵到相關回收/)", 'FALLTHROUGH_SELF_MATCH'],
      [A + "ok(!/section_context/.test(seen.prompt || ''))", 'EMPTY_COERCION_ABSENCE'],
      // Truthiness satisfied by the fallback alone.
      [A + "ok(rows.length || 'nothing ran')", 'FALLTHROUGH_TRUTHY']
    ]
    for (const [code, kind] of cases) {
      const found = findVacuousAssertions(code)
      assert.strictEqual(found.length, 1, 'must be caught: ' + code)
      assert.strictEqual(found[0].kind, kind, code)
    }
  })

  test('⛔ AND IT DOES NOT FIRE ON HONEST ASSERTIONS', () => {
    // A detector that flags everything gets switched off, and then it protects nothing.
    const A = 'assert' + '.'
    for (const code of [
      A + "match(c.calm, /5/)",
      A + "doesNotMatch(c.calm, /green onion/)",
      A + "ok(c.gap, 'the unchecked ingredient must have its own line')",
      // A fall-through whose literal does NOT satisfy the matcher still tests something.
      A + "match(a || 'nothing', /something/)",
      // An `||` chain with no literal tail is an ordinary default.
      A + 'ok(a || b)'
    ]) {
      assert.deepStrictEqual(findVacuousAssertions(code), [], 'false positive on: ' + code)
    }
  })

  test('the scanner reports what it does NOT cover', () => {
    // ⛔ This checks the honesty, not the code. A green run above means ONE family is absent —
    // not that every assertion in the suite can fail. A fixture that cannot reach the state
    // under test, a matcher loose enough to accept anything, a loop over an empty array: all
    // invisible here. Saying so in the module is the only thing that stops the green from
    // being read as 「the suite has no vacuous tests」.
    const src = fs.readFileSync(path.join(__dirname, 'assertionShape.js'), 'utf8')
    assert.match(src, /WHAT IS NOT DETECTED/)
  })
})
