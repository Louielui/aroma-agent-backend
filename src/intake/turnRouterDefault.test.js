'use strict'

/**
 * turnRouterDefault.test.js — the default now matches what actually runs.
 *
 * `off` stopped meaning "the old behaviour" the moment Step 2 DELETED the inventory default
 * and Step 3 made reads follow the route. What it means today is:
 *
 *   - the UTILITY route never runs, and
 *   - every enabled source is read on every chat turn — the exact defect the migration removed
 *
 * That is a configuration nobody runs and nothing is tested as a whole. The launcher has set
 * `on` since Step 2. A default matching neither the code's intent nor the live process is its
 * own trap, so it flips.
 *
 * `off` REMAINS A REAL ROLLBACK TARGET and stays provable — the four tests that used to rely
 * on the default now pass it explicitly, which is a better test than it was before: it says
 * what it is testing instead of inheriting it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { resolveTurnRouter } = require('./turnRouter')

test('*** TURN_ROUTER defaults to on ***', () => {
  assert.equal(resolveTurnRouter({}), 'on', 'unset → on')
  assert.equal(resolveTurnRouter(), 'on', 'no env object at all → on')
})

test('*** off and shadow still require an exact spelling ***', () => {
  assert.equal(resolveTurnRouter({ TURN_ROUTER: 'off' }), 'off')
  assert.equal(resolveTurnRouter({ TURN_ROUTER: 'shadow' }), 'shadow')
  assert.equal(resolveTurnRouter({ TURN_ROUTER: 'on' }), 'on')
})

test('*** an unrecognised value resolves toward READING LESS, not more ***', () => {
  // THE DIRECTION INVERTED WITH THE DEFAULT, and this is the reason the flag can no longer
  // just call resolveFlag(). For READ_ACCESS, 'off' is the cautious direction. Here 'off'
  // means read every connector on every turn, so falling back to it on a typo would be the
  // RECKLESS direction. Anything not spelled exactly resolves to 'on' — narrower reads.
  for (const bad of ['', ' ', 'ON', 'OFF', 'true', '1', 'yes', 'no', 'shadow ', 'Shadow', 'enabled', 'disabled']) {
    assert.equal(resolveTurnRouter({ TURN_ROUTER: bad }), 'on', `"${bad}" must resolve to on`)
  }
})

test('an unrecognised value is still WARNED about — it is a typo, not a preference', () => {
  const warned = []
  const orig = console.warn
  console.warn = (...a) => warned.push(a.join(' '))
  try {
    resolveTurnRouter({ TURN_ROUTER: 'enabled' })
    resolveTurnRouter({ TURN_ROUTER: 'off' })
    resolveTurnRouter({})
  } finally { console.warn = orig }
  assert.equal(warned.length, 1, 'exactly the bad one: ' + JSON.stringify(warned))
  assert.ok(warned[0].includes('TURN_ROUTER'), warned[0])
})

test('*** the launcher and the repo default now agree ***', () => {
  // The whole point. If someone edits one, this fails and they must consider the other.
  const fs = require('fs')
  const path = require('path')
  /**
   * ⛔ THE LAUNCHER MOVED, AND THIS TEST CAUGHT IT — which is what it is for.
   *
   * 2026-08-07: the flags now live in the repo at scripts/launcher/xiangxiang-body.ps1, and
   * C:\Aroma\xiangxiang.ps1 is a 21-line shim with no configuration in it (L-1 ①). Reading the
   * shim would find no TURN_ROUTER and the test would pass VACUOUSLY — an assertion that stops
   * asserting is worse than one that fails.
   *
   * The path comes from the governance module so there is ONE place that knows where the
   * launcher lives.
   */
  const { BODY_REL } = require('../governance/launcherPin')
  let launcher = null
  try { launcher = fs.readFileSync(path.join(__dirname, '..', '..', BODY_REL), 'utf8') } catch (_) {}
  if (launcher === null) return // not on the Owner's machine; the assertion above still holds
  const m = /\$env:TURN_ROUTER\s*=\s*'([a-z]+)'/.exec(launcher)
  assert.ok(m, 'the launcher no longer sets TURN_ROUTER at all')
  assert.equal(m[1], resolveTurnRouter({}), 'the launcher sets ' + m[1] + ' but the default is ' + resolveTurnRouter({}))
})
