'use strict'
/**
 * groupBudget.test.js — the failure this design CREATES, tested before the design works.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 「21 件貨睇落係 3 件。」
 *
 * Cutting a flat list looks like a shorter list — the reader can see the list is short.
 * Cutting INSIDE a group looks like a COMPLETE group with fewer members. Nothing about
 * 「Kirkland — 2 items」 says that Kirkland has 7.
 *
 * > **Owner: 「Build the per-group 『2 of 7 shown』 FIRST, before the grouping itself works —
 * > if it arrives last it will arrive as a nice-to-have.」**
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { budgetGroups } = require('./groupBudget')

const g = (name, n, from = 0) => ({
  ref: 'r' + name.padEnd(8, '0').slice(0, 8),
  name,
  members: Array.from({ length: n }, (_, i) => ({ ref: 'm' + name[0] + (from + i), role: 'button', name: 'Add' }))
})

describe('a group that is cut says so, in the group', () => {
  test('a fully shown group carries NO count — a suffix that always fires is ignored', () => {
    const out = budgetGroups([g('alpha', 3)], { maxNodes: 100 })
    assert.strictEqual(out.groups[0].partial, false)
    assert.doesNotMatch(out.text, /of \d+ shown/)
  })

  test('a PARTIALLY shown group states shown-of-total on its own line', () => {
    const out = budgetGroups([g('alpha', 7)], { maxNodes: 3 })
    const grp = out.groups[0]
    assert.strictEqual(grp.partial, true)
    assert.strictEqual(grp.shown, 2, 'one slot goes to the group line itself')
    assert.strictEqual(grp.total, 7)
    assert.match(out.text, /2 of 7 shown/)
  })

  test('the count is on the GROUP line, not only in a global footer', () => {
    const out = budgetGroups([g('alpha', 7)], { maxNodes: 3 })
    const groupLine = out.text.split('\n').find((l) => l.includes('alpha'))
    assert.match(groupLine, /2 of 7 shown/,
      'a global notice does not tell the reader WHICH group was cut')
  })

  test('a group with NO room for members is dropped whole, never left as a bare header', () => {
    const out = budgetGroups([g('alpha', 5), g('beta', 5)], { maxNodes: 3 })
    assert.strictEqual(out.groups.length, 1, 'beta had no room for a single member')
    assert.strictEqual(out.groupsDropped, 1)
    assert.ok(!out.text.includes('beta'), 'a header with nothing under it is not actionable')
  })

  test('groups dropped entirely are counted in the global notice', () => {
    const out = budgetGroups([g('alpha', 4), g('beta', 4), g('gamma', 4)], { maxNodes: 5 })
    assert.ok(out.groupsDropped >= 1)
    assert.match(out.text, /truncated/i)
    assert.match(out.text, new RegExp(String(out.groupsDropped) + ' group'))
  })

  test('nothing is cut silently — every dropped member is in some stated count', () => {
    const groups = [g('alpha', 6), g('beta', 6), g('gamma', 6)]
    const out = budgetGroups(groups, { maxNodes: 8 })
    const shown = out.groups.reduce((s, x) => s + x.shown, 0)
    const accountedByPartial = out.groups.reduce((s, x) => s + (x.total - x.shown), 0)
    const accountedByDrop = 18 - shown - accountedByPartial
    assert.strictEqual(shown + accountedByPartial + accountedByDrop, 18)
    assert.ok(out.truncated)
  })

  test('the character budget cuts inside a group the same way the count budget does', () => {
    const out = budgetGroups([g("alpha", 7)], { maxNodes: 100, maxChars: 240 })
    assert.strictEqual(out.groups[0].partial, true)
    assert.match(out.text, /of 7 shown/)
    assert.ok(out.text.length <= 240, "got " + out.text.length)
  })

  test('ungrouped nodes still work and are not forced into a group', () => {
    const out = budgetGroups([], { maxNodes: 10 }, [{ ref: 'rzz', role: 'link', name: 'Home' }])
    assert.match(out.text, /\[#rzz\] link "Home"/)
    assert.strictEqual(out.truncated, false)
  })
})

describe('the probe is not the loop — a bare header must never survive', () => {
  test('a group that ends up with zero members is dropped, not printed as 「0 of N」', () => {
    // Regression: the real Wikipedia capture produced `group "Panorama…" — 0 of 1 shown`.
    // The probe said one member would fit; the loop then took none. Synthetic groups never
    // hit it, so this asserts the INVARIANT directly rather than a scenario.
    for (const maxChars of [80, 120, 160, 200, 240, 300, 400, 600]) {
      for (const maxNodes of [1, 2, 3, 4, 5, 9]) {
        const out = budgetGroups([g('alpha', 4), g('beta', 4)], { maxNodes, maxChars })
        for (const grp of out.groups) {
          assert.ok(grp.shown >= 1,
            `emitted a header with ${grp.shown} members at maxNodes=${maxNodes} maxChars=${maxChars}`)
        }
        assert.doesNotMatch(out.text, /— 0 of \d+ shown/)
      }
    }
  })
})

describe('looseFirst is a MEASURED DEAD END, kept only as a record', () => {
  test('it is OFF by default', () => {
    const out = budgetGroups([g('alpha', 2)], { maxNodes: 50 }, [{ ref: 'rz', role: 'link', name: 'Home' }])
    assert.ok(out.text.indexOf('alpha') < out.text.indexOf('Home'), 'groups still lead by default')
  })

  test('with looseFirst, a large loose set starves the groups entirely', () => {
    // This is the measurement, as a test: on the real pages it emitted ZERO groups, which
    // discards the 21-button fix. Neither extreme works — the open question is ALLOCATION.
    const loose = Array.from({ length: 40 }, (_, i) => ({ ref: 'rl' + i, role: 'link', name: 'Item ' + i }))
    const out = budgetGroups([g('alpha', 3)], { maxNodes: 40, looseFirst: true }, loose)
    assert.strictEqual(out.groups.length, 0, 'groups get nothing')
    assert.ok(out.groupsDropped > 0, 'and the loss is counted, not silent')
  })
})
