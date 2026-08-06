'use strict'
/**
 * captureCorpus.js — real pages, captured HEADED.
 *
 * ⚠ HEADED IS NOT A PREFERENCE HERE. DEFECT-009: headless Chrome is refused by the bot
 * mitigation on exactly the sites worth capturing, so a headless capture silently produces a
 * corpus of the easy half of the web and then scores well on it. See src/browser/launch.js.
 *
 * Writes RAW `Accessibility.getFullAXTree` output. Nothing is pruned at capture time — the
 * pruner is the thing under test and a corpus shaped by it would be worthless.
 */
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')
const { launchOptions } = require('../src/browser/launch')
const { CORPUS_DIR } = require('../src/browser/axTree')

const TARGETS = [
  { name: 'real-wikipedia-costco', url: 'https://en.wikipedia.org/wiki/Costco' },
  { name: 'real-costco-search', url: 'https://www.costco.ca/CatalogSearch?dept=All&keyword=paper+towels' },
  { name: 'real-wikipedia-portal', url: 'https://en.wikipedia.org/wiki/Portal:Current_events' },
  { name: 'real-mdn-css', url: 'https://developer.mozilla.org/en-US/docs/Web/CSS' }
]

;(async () => {
  const browser = await chromium.launch(launchOptions())
  const results = []
  for (const t of TARGETS) {
    const page = await browser.newPage()
    let row = { name: t.name, url: t.url }
    try {
      await page.goto(t.url, { timeout: 45000, waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3500)          // let client-rendered content arrive
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Accessibility.enable')
      const { nodes } = await cdp.send('Accessibility.getFullAXTree')
      const out = {
        capturedAt: '2026-08-06',
        provenance: 'REAL PAGE, HEADED CHROME, live network',
        url: t.url,
        note: 'raw Accessibility.getFullAXTree output; nothing pruned at capture time',
        nodes
      }
      fs.writeFileSync(path.join(CORPUS_DIR, t.name + '.json'), JSON.stringify(out, null, 1))
      row.rawNodes = nodes.length
      row.ok = true
    } catch (e) {
      row.ok = false
      row.error = String(e.message).split('\n')[0]
    }
    results.push(row)
    console.log(`  ${row.ok ? 'OK  ' : 'FAIL'}  ${t.name.padEnd(24)} ${row.ok ? row.rawNodes + ' raw nodes' : row.error}`)
    await page.close()
  }
  await browser.close()
  const good = results.filter(r => r.ok).length
  console.log(`\n  captured ${good}/${TARGETS.length} real pages, HEADED`)
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
