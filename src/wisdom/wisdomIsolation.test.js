'use strict'

/**
 * wisdomIsolation.test.js — proof that W0 is BUILT AND NOT WIRED.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE WHOLE POINT OF THIS FILE.
 *
 * A learning subsystem is the one thing that must not arrive quietly. W0 exists to make the
 * container correct BEFORE any intelligence goes in it, so the container must be provably
 * unreachable from the running product: no import from the intake path, no flag, no reflection
 * worker, no model call, no candidate auto-writer.
 *
 * If a later tranche wires it, these assertions fail — which is exactly right. Wiring should
 * require deleting a test that says 「this is not wired」, in a diff someone reviews.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
/** Comments may DISCUSS forbidden things; the guard must judge executable code only. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const PRODUCTION_PATHS = [
  'src/intake/intakeService.js',
  'src/routes/demoRouter.js',
  'src/routes/intakeRouter.js',
  'src/app.js',
  'src/index.js'
]

/* ═══ NOT IMPORTED BY THE RUNNING PRODUCT ══════════════════════════════ */

test('*** ⛔ no production runtime file imports the wisdom domain ***', () => {
  for (const p of PRODUCTION_PATHS) {
    const code = strip(read(p))
    assert.equal(/require\(['"][^'"]*wisdom[^'"]*['"]\)/i.test(code), false, '⛔ ' + p + ' imports wisdom')
    assert.equal(/wisdomRecall|wisdomStore|wisdomContract|buildWisdomBlock/.test(code), false, '⛔ ' + p + ' references wisdom runtime')
  }
})

test('*** ⛔ nothing outside src/wisdom requires the wisdom domain at all ***', () => {
  const offenders = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const stat = fs.statSync(full)
      if (stat.isDirectory()) {
        if (name === 'node_modules' || name === '.git' || name === 'wisdom') continue
        walk(full)
        continue
      }
      if (!name.endsWith('.js')) continue
      const code = strip(fs.readFileSync(full, 'utf8'))
      if (/require\(['"][^'"]*\/wisdom\/[^'"]*['"]\)/.test(code)) offenders.push(path.relative(REPO, full))
    }
  }
  walk(path.join(REPO, 'src'))
  assert.deepEqual(offenders, [], '⛔ wisdom is reachable from: ' + offenders.join(', '))
})

/* ═══ NO FLAG, NO ACTIVATION SURFACE ═══════════════════════════════════ */

test('*** ⛔ there is no WISDOM flag anywhere — not in the launcher, not in flags.js ***', () => {
  const launcher = read('scripts/launcher/xiangxiang-body.ps1')
  assert.equal(/WISDOM/i.test(launcher), false, '⛔ the launcher carries a wisdom flag')

  const flags = read('src/context/flags.js')
  assert.equal(/WISDOM/i.test(flags), false, '⛔ wisdom appears in the read-access flag table')

  // And no module reads such a variable into being.
  const offenders = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      if (fs.statSync(full).isDirectory()) { if (name !== 'node_modules' && name !== '.git') walk(full); continue }
      // ⛔ RUNTIME CODE ONLY. This very file names the forbidden variables in order to search
      // for them; a guard that flags its own search terms flags nothing useful.
      if (!name.endsWith('.js') || name.endsWith('.test.js')) continue
      if (/WISDOM_MEMORY|WISDOM_RECALL|CONTEXT_WISDOM/.test(strip(fs.readFileSync(full, 'utf8')))) offenders.push(path.relative(REPO, full))
    }
  }
  walk(path.join(REPO, 'src'))
  assert.deepEqual(offenders, [], '⛔ a wisdom activation flag exists in: ' + offenders.join(', '))
})

/* ═══ NO MODEL, NO NETWORK, IN THE DOMAIN ITSELF ═══════════════════════ */

test('*** ⛔ src/wisdom makes no network or model call, in executable code ***', () => {
  const dir = path.join(REPO, 'src', 'wisdom')
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js') || name.endsWith('.test.js')) continue
    const code = strip(fs.readFileSync(path.join(dir, name), 'utf8'))
    for (const forbidden of ['fetch(', 'https://', 'api.openai', 'anthropic', 'adapter.complete', 'provider.search', 'axios']) {
      assert.equal(code.toLowerCase().includes(forbidden.toLowerCase()), false, '⛔ ' + name + ' contains «' + forbidden + '»')
    }
    // No provider/adapter import either.
    assert.equal(/require\(['"][^'"]*adapters?\/[^'"]*['"]\)/.test(code), false, '⛔ ' + name + ' imports an adapter')
  }
})

test('*** ⛔ there is no reflection worker and no candidate auto-writer ***', () => {
  const dir = path.join(REPO, 'src', 'wisdom')
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.js'))
  // The domain is exactly three modules plus their tests. A scheduler, a worker or a post-turn
  // hook would have to be a new file, and this is where it would be noticed.
  const runtime = files.filter((n) => !n.endsWith('.test.js')).sort()
  assert.deepEqual(runtime, ['wisdomContract.js', 'wisdomRecall.js', 'wisdomStore.js'])

  for (const name of runtime) {
    const code = strip(fs.readFileSync(path.join(dir, name), 'utf8'))
    for (const forbidden of ['setInterval', 'setTimeout', 'cron', 'schedule', 'onTurnEnd', 'afterTurn', 'reflect']) {
      assert.equal(new RegExp('\\b' + forbidden + '\\b', 'i').test(code), false, '⛔ ' + name + ' contains «' + forbidden + '»')
    }
  }
})

/* ═══ THE RECALL BUILDER CANNOT REACH A STORE BY ITSELF ════════════════ */

test('*** ⛔ wisdomRecall has no default store reach-through ***', () => {
  const code = strip(read('src/wisdom/wisdomRecall.js'))
  assert.equal(/require\(['"]\.\/wisdomStore['"]\)/.test(code), false, '⛔ the renderer can open a store on its own')
  assert.equal(/createWisdomStore/.test(code), false)

  // Called with nothing, it produces nothing — it cannot go and find data.
  const { buildWisdomBlock } = require('./wisdomRecall')
  assert.equal(buildWisdomBlock().block, null)
  assert.equal(buildWisdomBlock({}).block, null)
})

/* ═══ NO PRODUCTION DATA PATH IS CREATED BY MERELY LOADING ═════════════ */

test('*** ⛔ requiring the domain creates no files anywhere ***', () => {
  const { PRODUCTION_DIR } = require('../store/dataDir')
  delete require.cache[require.resolve('./wisdomStore')]
  delete require.cache[require.resolve('./wisdomContract')]
  delete require.cache[require.resolve('./wisdomRecall')]
  require('./wisdomStore'); require('./wisdomContract'); require('./wisdomRecall')
  assert.equal(fs.existsSync(path.join(PRODUCTION_DIR, 'wisdom')), false,
    '⛔ loading the module created a production wisdom directory')
})
