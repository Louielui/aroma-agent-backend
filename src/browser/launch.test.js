'use strict'
const { describe, test } = require('node:test')
const assert = require('node:assert')
const { launchOptions } = require('./launch')

describe('headed is structural, not a default', () => {
  test('the options are headed', () => {
    assert.strictEqual(launchOptions().headless, false)
    assert.strictEqual(launchOptions().channel, 'chrome')
  })

  test('asking for headless THROWS — it is not silently corrected', () => {
    assert.throws(() => launchOptions({ headless: true }), /headless is refused/)
  })

  test('the refusal names the evidence, so the next person does not re-derive it', () => {
    assert.throws(() => launchOptions({ headless: true }), /DEFECT-009/)
  })

  test('headless: false passed explicitly is fine — agreeing is not violating', () => {
    assert.strictEqual(launchOptions({ headless: false }).headless, false)
  })

  test('other options pass through', () => {
    assert.deepStrictEqual(launchOptions({ args: ['--x'] }).args, ['--x'])
  })
})
