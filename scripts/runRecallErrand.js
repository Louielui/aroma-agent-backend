'use strict'
/**
 * runRecallErrand.js — the first errand that records itself.
 *
 *   node scripts/runRecallErrand.js [ingredient ...]
 *
 * ERRAND-003 through `runErrand`, so the outcome lands in the store and reaches 首頁 instead of
 * scrolling past in a terminal. Same six verbs, same caps, same zero paid model calls.
 *
 * ⛔ NO CREDENTIAL PROFILE. A fresh ephemeral browser. The recall register is public; borrowing
 * the logged-in profile would put a credential on a page that never needed one, and would make
 * the errand fail whenever his own Chrome holds the lock.
 *
 * ⛔ NOT A SCHEDULER. This runs when it is run, by hand. She still has none — adding a timer
 * here would be a third execution mode arriving without a decision.
 */
const path = require('node:path')
const { chromium } = require('playwright-core')
const { launchOptions } = require('../src/browser/launch')
const { readPage } = require('../src/browser/axTree')
const { checkNavigation, NAV } = require('../src/browser/navigate')
const { buildClick } = require('../src/browser/click')
const { buildType } = require('../src/browser/type')
const { buildWaitFor } = require('../src/browser/wait')
const { buildSession } = require('../src/browser/session')
const { buildRequestFence } = require('../src/browser/requestFence')
const { checkRecall, HOST, SEARCH_PATH } = require('../src/errands/recallCheck')
const { openErrandStore } = require('../src/home/errandStore')
const { runErrand } = require('../src/home/errandRunner')

const ORDER = { allowedOrigins: [HOST] }
const INGREDIENTS = process.argv.slice(2)
if (!INGREDIENTS.length) INGREDIENTS.push('mushrooms', 'chicken', 'cheese')

;(async () => {
  const store = openErrandStore(path.join(__dirname, '..', 'data', 'home'))
  const b = await chromium.launch(launchOptions())
  const page = await b.newPage()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable'); await cdp.send('Accessibility.enable')

  // L3 on the page; L1 lives inside buildClick; the composition rule inside buildSession.
  const fence = buildRequestFence({ order: ORDER })
  await page.route('**/*', fence.handle)

  const session = buildSession({
    read: async () => {
      const { nodes } = await cdp.send('Accessibility.getFullAXTree')
      return readPage(nodes, { maxNodes: 500, maxChars: 40000 })
    },
    click: buildClick({ page, cdp, order: ORDER }),
    type: buildType({ page, cdp, order: ORDER }),
    waitFor: buildWaitFor({ page }),
    screenshot: async () => ({ outcome: 'CAPTURED' })
  })

  // The origin check stays at the call site — the government block is checked per navigation.
  const goto = async (url) => {
    const nav = checkNavigation(url, ORDER)
    if (nav.verdict !== NAV.ALLOWED) return { ok: false, reason: nav.reason }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    return { ok: true }
  }

  console.log('\n══════════ ERRAND-003 回收檢查 ══════════\n')
  const day = new Date().toISOString().slice(0, 10)
  for (const q of INGREDIENTS) {
    const r = await runErrand({
      store,
      // One id per ingredient per day: re-running today updates today's row instead of
      // stacking duplicates, and yesterday's answer is still there to compare against.
      id: 'recall-' + q + '-' + day,
      title: '回收檢查 — ' + q,
      run: () => checkRecall({ session, goto, query: q, url: HOST + SEARCH_PATH })
    })
    console.log('  ' + q.padEnd(12) + r.outcome.padEnd(18) + (r.recorded ? '已記低' : '⛔ 冇記低:' + r.recordError))
    if (r.detail) console.log('      ' + r.detail)
  }

  const f = fence.report()
  console.log('\n  L3:拒絕咗 ' + f.refusedCount + ' 個寫入請求,批准咗 ' + f.allowedWrites + ' 個。')
  console.log('  冇登入,冇憑證,冇付費模型呼叫。')
  console.log('  ⛔ 冇 scheduler — 呢個 script 要人手行先會有新紀錄。\n')
  await b.close()
  process.exit(0)
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
