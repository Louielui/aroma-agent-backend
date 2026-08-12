'use strict'
/**
 * runShapeDriftErrand.js — the field-shape check, by hand.
 *
 *   node --env-file=.env scripts/runShapeDriftErrand.js
 *
 * The SAME runner the scheduled route uses (`src/errands/shapeDriftRunner.js`), for the reason
 * the recall errand gives: the hand path and the timer path must not drift, and the timer path
 * is the one that runs while nobody is watching.
 *
 * READ ONLY — six GETs, zero writes, zero model tokens.
 */
const path = require('node:path')
const { runShapeDrift } = require('../src/errands/shapeDriftRunner')
const { openErrandStore } = require('../src/home/errandStore')
const { runErrand } = require('../src/home/errandRunner')

;(async () => {
  const store = openErrandStore(path.join(__dirname, '..', 'data', 'home'))
  const day = new Date().toISOString().slice(0, 10)

  console.log('\n══════════ 欄位形狀檢查(手動)══════════\n')
  const result = await runShapeDrift()

  const r = await runErrand({
    store,
    // One row per day: re-running today updates today's row rather than stacking duplicates,
    // and yesterday's answer stays there to compare against.
    id: 'shapedrift-' + day,
    title: '欄位形狀檢查',
    run: async () => result
  })

  console.log('  對比咗 ' + result.drift.endpointsCompared + ' 個 endpoint,捕捉日期 ' + result.capturedOn)
  console.log('  ' + r.outcome + (r.recorded ? '  已記低' : '  ⛔ 冇記低: ' + r.recordError))

  if (result.drift.alarms.length) {
    console.log('\n  ⛔ 警報(欄位集合改變,需要你睇):')
    for (const a of result.drift.alarms) {
      console.log('     ' + a.kind.padEnd(14) + a.endpoint + (a.field ? '.' + a.field : '') +
        (a.detail ? '  ' + JSON.stringify(a.detail) : ''))
    }
  } else {
    console.log('\n  欄位集合冇變。')
  }

  if (result.answer) console.log('\n  ' + result.answer)
  console.log('\n  冇寫入,冇付費模型呼叫。\n')
  process.exit(0)
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
