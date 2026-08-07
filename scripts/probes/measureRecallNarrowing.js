'use strict'
/**
 * measureRecallNarrowing.js — the A/B the Owner asked for, before anything is kept.
 *
 * > 「Measure it against today's baseline before you keep it. If 「green onion」 goes from 349 to
 * >  something readable and the top result is food rather than Mifepristone, it worked. If
 * >  quoting drops it to zero on an ingredient that genuinely has recalls, that is worse than
 * >  noise and I want to know before it runs tomorrow.」**
 *
 * ⛔ THE FAILURE CONDITION IS EXPLICIT AND IS CHECKED: a variant that returns ZERO on an
 * ingredient the baseline shows has real recalls is WORSE than noise, and is reported as a
 * failure of that variant rather than as a good small number.
 *
 * Measured by direct navigation (read-only GET), paced — HR-34.
 */
const { chromium } = require('playwright-core')
const { launchOptions } = require('../../src/browser/launch')
const { HOST } = require('../../src/errands/recallCheck')

const BASE = HOST + '/en/search/site?search_api_fulltext='
const INGREDIENTS = ['green onion', 'romaine', 'cheese', 'beef', 'mushrooms', 'chicken']
const PAUSE = 4000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const VARIANTS = [
  { key: 'baseline', label: '(今日)', url: (q) => BASE + encodeURIComponent(q) },
  { key: 'quoted', label: '詞組', url: (q) => BASE + encodeURIComponent('"' + q + '"') },
  { key: '2026', label: '只計 2026', url: (q) => BASE + encodeURIComponent(q) + '&f%5B0%5D=date%3A2026' },
  { key: 'quoted+2026', label: '詞組+2026', url: (q) => BASE + encodeURIComponent('"' + q + '"') + '&f%5B0%5D=date%3A2026' },
  { key: 'quoted+2026+food', label: '詞組+2026+Food', url: (q) => BASE + encodeURIComponent('"' + q + '"') + '&f%5B0%5D=date%3A2026&f%5B1%5D=cat%3A144' },
  { key: '2026+food', label: '2026+Food', url: (q) => BASE + encodeURIComponent(q) + '&f%5B0%5D=date%3A2026&f%5B1%5D=cat%3A144' }
]

;(async () => {
  const b = await chromium.launch(launchOptions())
  const page = await b.newPage()
  const results = {}

  for (const q of INGREDIENTS) {
    results[q] = {}
    for (const v of VARIANTS) {
      await sleep(PAUSE)
      let count = null
      let top = ''
      try {
        await page.goto(v.url(q), { waitUntil: 'domcontentloaded', timeout: 30000 })
        await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})
        const info = await page.evaluate(() => {
          const txt = document.body.innerText
          const m = txt.match(/Displaying\s+\d+\s*[-–]\s*\d+\s+of\s+(\d+)\s+items/i)
          const none = /no results|yielded no/i.test(txt)
          let first = ''
          for (const a of document.querySelectorAll('a')) {
            const t = (a.textContent || '').replace(/\s+/g, ' ').trim()
            if (t.length > 30 && /recall|advisory|notification|affected/i.test(t)) { first = t; break }
          }
          return { total: m ? +m[1] : (none ? 0 : null), first }
        })
        count = info.total
        top = info.first
      } catch (e) { top = 'ERR ' + String(e.message).split('\n')[0].slice(0, 40) }
      results[q][v.key] = { count, top }
      console.log('  ' + q.padEnd(13) + v.label.padEnd(17) + String(count === null ? '?' : count).padStart(5) + '  ' + top.slice(0, 66))
    }
    console.log('')
  }

  // ── the Owner's explicit failure condition ────────────────────────────────
  console.log('\n══════ 判決 ══════')
  for (const v of VARIANTS.slice(1)) {
    const zeroed = []
    let totalBefore = 0
    let totalAfter = 0
    for (const q of INGREDIENTS) {
      const base = results[q].baseline.count
      const now = results[q][v.key].count
      if (base > 0) totalBefore += base
      if (now > 0) totalAfter += now
      // ⛔ Zero where the baseline had real recalls: worse than noise.
      if (base > 0 && now === 0) zeroed.push(q + ' (' + base + '→0)')
    }
    const verdict = zeroed.length ? '⛔ 掉到零:' + zeroed.join(', ') : '✅ 冇任何一樣掉到零'
    console.log('  ' + v.label.padEnd(17) + String(totalBefore).padStart(5) + ' → ' + String(totalAfter).padStart(5) + '   ' + verdict)
  }
  await b.close()
  process.exit(0)
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
