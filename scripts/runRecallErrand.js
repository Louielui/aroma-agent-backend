'use strict'
/**
 * runRecallErrand.js — ERRAND-003, by hand.
 *
 *   node scripts/runRecallErrand.js [ingredient ...]
 *
 * The SAME runner the scheduled route uses (`src/errands/recallRunner.js`), so the hand path
 * and the timer path cannot drift into browsers with different fences — and the timer path is
 * the one that runs while nobody is watching.
 *
 * The only difference is provenance: rows written here carry no `trigger: 'SCHEDULED'` and no
 * `nextRunAt`, because a hand-run promises nothing about when it will happen again.
 */
const path = require('node:path')
const { runRecallForIngredients } = require('../src/errands/recallRunner')
const { openErrandStore } = require('../src/home/errandStore')
const { runErrand } = require('../src/home/errandRunner')

;(async () => {
  const store = openErrandStore(path.join(__dirname, '..', 'data', 'home'))
  const day = new Date().toISOString().slice(0, 10)
  const args = process.argv.slice(2)

  console.log('\n══════════ ERRAND-003 回收檢查(手動)══════════\n')
  const items = await runRecallForIngredients(args.length ? args : undefined)

  for (const it of items) {
    const r = await runErrand({
      store,
      // One id per ingredient per day: re-running today updates today's row instead of
      // stacking duplicates, and yesterday's answer is still there to compare against.
      id: 'recall-' + it.suffix + '-' + day,
      title: it.title,
      run: async () => it.result
    })
    console.log('  ' + it.suffix.padEnd(12) + r.outcome.padEnd(18) + (r.recorded ? '已記低' : '⛔ 冇記低:' + r.recordError))
    if (it.result.answer) console.log('      ' + it.result.answer.slice(0, 100))
    if (r.detail) console.log('      ' + r.detail)
  }

  const f = items.fenceReport
  if (f) console.log('\n  L3:拒絕咗 ' + f.refusedCount + ' 個寫入請求,批准咗 ' + f.allowedWrites + ' 個。')
  console.log('  冇登入,冇憑證,冇付費模型呼叫。\n')
  process.exit(0)
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
