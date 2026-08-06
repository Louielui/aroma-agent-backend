'use strict'

/**
 * navigate.test.js — the first verb, and the first place the stop is structural.
 *
 * > **Owner: 「第一版嘅成功案例係一次停低，唔係一次完成」** — the success case for the first
 * > version is a HALT, not a completion.
 *
 * So `navigate` is not 「go to a URL」. It is 「go to a URL THE ORDER NAMED」, and an origin the
 * order did not name does not produce an error to be retried — it produces a HALT, the same
 * BLOCKED_NEEDS_YOU outcome the enquiry report already renders on its first line.
 *
 * ALLOWLIST, NEVER DENYLIST. Same discipline as the sealed order: the default is stop, and
 * proceeding is the exception that was written down before she started.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { checkNavigation, NAV } = require('./navigate')

const order = { allowedOrigins: ['https://www.costco.ca', 'https://system.aromabistro741.com'] }

describe('an origin the order named', () => {
  test('is allowed', () => {
    assert.strictEqual(checkNavigation('https://www.costco.ca/CatalogSearch?q=x', order).verdict, NAV.ALLOWED)
  })

  test('matches on ORIGIN, not on a prefix — a lookalike host is refused', () => {
    // https://www.costco.ca.evil.com/ starts with the allowed string under a naive check.
    const r = checkNavigation('https://www.costco.ca.evil.com/x', order)
    assert.strictEqual(r.verdict, NAV.BLOCKED)
  })

  test('a different scheme on an allowed host is refused', () => {
    assert.strictEqual(checkNavigation('http://www.costco.ca/x', order).verdict, NAV.BLOCKED)
  })
})

describe('anything else HALTS — it does not error and it does not retry', () => {
  test('an unnamed origin is BLOCKED, and the reason names the origin', () => {
    const r = checkNavigation('https://www.example.com/', order)
    assert.strictEqual(r.verdict, NAV.BLOCKED)
    assert.match(r.reason, /example\.com/)
  })

  test('an EMPTY allowlist blocks everything — the default is stop', () => {
    assert.strictEqual(checkNavigation('https://www.costco.ca/', { allowedOrigins: [] }).verdict, NAV.BLOCKED)
    assert.strictEqual(checkNavigation('https://www.costco.ca/', {}).verdict, NAV.BLOCKED)
  })

  test('a missing order blocks — an absent fence is not an open one', () => {
    assert.strictEqual(checkNavigation('https://www.costco.ca/').verdict, NAV.BLOCKED)
  })

  test('non-http schemes are refused outright', () => {
    for (const u of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,x', 'chrome://settings']) {
      assert.strictEqual(checkNavigation(u, { allowedOrigins: ['*'] }).verdict, NAV.BLOCKED, u)
    }
  })

  test('a wildcard origin is NOT honoured — there is no way to say "anywhere"', () => {
    // An allowlist with an escape hatch is a denylist wearing a costume.
    assert.strictEqual(checkNavigation('https://anything.example/', { allowedOrigins: ['*'] }).verdict, NAV.BLOCKED)
  })
})

describe('malformed input is blocked, never guessed at', () => {
  for (const bad of ['', null, undefined, 'not a url', '//no-scheme.example']) {
    test('blocked: ' + JSON.stringify(bad), () => {
      assert.strictEqual(checkNavigation(bad, order).verdict, NAV.BLOCKED)
    })
  }
})
