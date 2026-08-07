'use strict'
/**
 * settingsValues.test.js — the values, and the thing that makes them worth having.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「Changing a setting should not need a restart where it can be avoided … a registry
 * > where every change needs a restart is barely better than editing constants.」**
 *
 * ⛔ THE MECHANISM: every consumer calls `get(id)` at the moment it needs the value. A constant
 * imported at the top of a file is frozen for the life of the process, and THAT is what forces
 * a restart — not the fact that it was a constant.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/** Each test gets its own data dir, so nothing here writes to his real settings. */
function withDir (fn) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'setv-'))
  const prev = process.env.AROMA_DATA_DIR
  process.env.AROMA_DATA_DIR = d
  const settings = require('./settingsValues')
  settings._resetCache()
  try { return fn(settings, d) } finally {
    if (prev === undefined) delete process.env.AROMA_DATA_DIR; else process.env.AROMA_DATA_DIR = prev
    settings._resetCache()
    fs.rmSync(d, { recursive: true, force: true })
  }
}

describe('nothing stored means the behaviour that existed before the registry', () => {
  test('⛔ a missing values file is DEFAULTS, never an error and never empty', () => {
    withDir((s) => {
      assert.deepStrictEqual(s.get('recallIngredients'), ['mushrooms', 'chicken', 'cheese', 'beef', 'romaine', 'green onion'])
      assert.strictEqual(s.get('pauseBetweenMs'), 5000)
    })
  })

  test('an unreadable values file is also defaults, not a crash', () => {
    withDir((s, d) => {
      fs.writeFileSync(path.join(d, 'settings-values.json'), '{ not json')
      s._resetCache()
      assert.strictEqual(s.get('pauseBetweenMs'), 5000)
    })
  })
})

describe('⛔ a change takes effect WITHOUT a restart', () => {
  test('set() then get() in the same process returns the new value', () => {
    withDir((s) => {
      assert.strictEqual(s.get('recallShownPerIngredient'), 6)
      const r = s.set('recallShownPerIngredient', 3)
      assert.strictEqual(r.ok, true)
      // ⛔ Same process, no reload, no re-require.
      assert.strictEqual(s.get('recallShownPerIngredient'), 3)
    })
  })

  test('⛔ and the CONSUMER sees it — the cadence used by freshness changes live', () => {
    withDir((s) => {
      const { freshnessOf, KINDS } = require('./errandKinds')
      const NOW = Date.now()
      const rows = [{ id: 'recall-a-1', title: 't', outcome: 'ANSWERED', at: NOW - 3 * 3600 * 1000, items: [] }]
      const kind = KINDS.find((k) => k.id === 'recall')

      // daily cadence, 3 hours old → FRESH
      assert.strictEqual(freshnessOf(kind, rows, NOW).state, 'FRESH')

      // he decides it should be checked hourly, with no grace
      assert.strictEqual(s.set('recallEveryMs', 60 * 60 * 1000).ok, true)
      assert.strictEqual(s.set('recallGraceMs', 0).ok, true)

      // ⛔ SAME PROCESS. The frozen KINDS entry still says DAY; the answer changed anyway.
      assert.strictEqual(freshnessOf(kind, rows, NOW).state, 'DUE',
        'if this is still FRESH, the cadence was captured at module load and the registry is decoration')
    })
  })

  test('a file edited by hand is picked up too — the cache is one second, not the process life', () => {
    withDir((s, d) => {
      fs.writeFileSync(path.join(d, 'settings-values.json'), JSON.stringify({ recallShownPerIngredient: 9 }))
      s._resetCache()
      assert.strictEqual(s.get('recallShownPerIngredient'), 9)
    })
  })
})

describe('⛔ the fence is re-checked on every READ, not only on the way in', () => {
  test('a hand-edited value outside its range falls back to the default', () => {
    // A range checked only by the write path stops being a fence the moment he edits the JSON —
    // which he can do, and which no write path would ever see.
    withDir((s, d) => {
      fs.writeFileSync(path.join(d, 'settings-values.json'), JSON.stringify({ pauseBetweenMs: 0 }))
      s._resetCache()
      assert.strictEqual(s.get('pauseBetweenMs'), 5000,
        'a 0ms pause hand-written into the file must not defeat HR-34')
    })
  })

  test('an out-of-range write is refused and NOTHING is stored', () => {
    withDir((s, d) => {
      const r = s.set('pauseBetweenMs', 10)
      assert.strictEqual(r.ok, false)
      assert.ok(!fs.existsSync(path.join(d, 'settings-values.json')), 'a refused write must not create the file')
    })
  })

  test('an unknown id is refused', () => {
    withDir((s) => assert.strictEqual(s.set('nope', 1).ok, false))
  })
})

describe('⛔ a setting that does NOT apply live says so', () => {
  test('the daily hour reports that the task must be re-registered', () => {
    withDir((s) => {
      const r = s.set('recallDailyHour', 8)
      assert.strictEqual(r.ok, true)
      assert.strictEqual(r.appliesOn, 'REREGISTER_TASK')
      assert.match(r.howToApply, /aroma-errand-task/,
        'reporting it as merely saved would let him believe it took effect')
    })
  })

  test('a LIVE setting says so too, so the two are distinguishable', () => {
    withDir((s) => {
      const r = s.set('pauseBetweenMs', 8000)
      assert.strictEqual(r.appliesOn, 'LIVE')
      assert.strictEqual(r.howToApply, null)
    })
  })
})

describe('all() is what a settings screen would render', () => {
  test('it returns every entry, with stored values winning over defaults', () => {
    withDir((s) => {
      s.set('recallShownPerIngredient', 4)
      const a = s.all()
      assert.strictEqual(a.recallShownPerIngredient, 4)
      assert.strictEqual(a.pauseBetweenMs, 5000)
      assert.strictEqual(Object.keys(a).length, require('../governance/settingsRegistry').ENTRIES.length)
    })
  })
})
