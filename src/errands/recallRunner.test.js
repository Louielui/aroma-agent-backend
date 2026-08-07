'use strict'
/**
 * recallRunner.test.js — the list that runs unattended every morning.
 *
 * ⛔ A PLACEHOLDER IN A DAILY UNATTENDED TASK IS WORSE THAN A PLACEHOLDER ANYWHERE ELSE.
 * It produces a confident answer, every day, to a question nobody asked. This test exists so
 * the list cannot quietly drift back to something nobody chose.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { DEFAULT_INGREDIENTS } = require('./recallRunner')

describe('the ingredient list is the Owner\'s, not the author\'s', () => {
  test('it is exactly what he named on 2026-08-07', () => {
    assert.deepStrictEqual(DEFAULT_INGREDIENTS,
      ['mushrooms', 'chicken', 'cheese', 'beef', 'romaine', 'green onion'])
  })

  test('the author\'s original guesses are gone', () => {
    // 'lettuce' and 'shrimp' were mine. He stocks romaine specifically — and romaine is the
    // one leafy green with a recurring E. coli recall history, so the narrower word is better.
    for (const mine of ['lettuce', 'shrimp']) {
      assert.ok(!DEFAULT_INGREDIENTS.includes(mine), mine + ' was a placeholder, not a decision')
    }
  })

  test('the list stays short enough to stay inside the pacing budget', () => {
    // ~7s each plus a 5s pause between: six is ~70s, well inside the task\'s 20-minute limit.
    assert.ok(DEFAULT_INGREDIENTS.length <= 8,
      'each additional ingredient is ~12s of unattended browser time against a site that throttles')
  })
})
