'use strict'
/**
 * probeRecallFacets.js — find the REAL facet URL instead of guessing a Drupal parameter.
 *
 * Diagnostic only. Uses page.evaluate to read hrefs, which the errand's own session
 * deliberately cannot do — this is measuring the site, not doing the errand.
 */
const { chromium } = require('playwright-core')
const { launchOptions } = require('../../src/browser/launch')
const { HOST, SEARCH_PATH } = require('../../src/errands/recallCheck')

const QUERY = process.argv[2] || 'green onion'

;(async () => {
  const b = await chromium.launch(launchOptions())
  const page = await b.newPage()
  await page.goto(HOST + SEARCH_PATH, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

  const box = await page.$('input[type="search"], input[name="search_api_fulltext"], input[type="text"]')
  if (!box) { console.log('no search box'); await b.close(); process.exit(1) }
  await box.fill(QUERY)
  await box.press('Enter')
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

  console.log('\nRESULT URL:\n  ' + page.url())

  const facets = await page.evaluate(() => {
    const out = []
    document.querySelectorAll('a').forEach((a) => {
      const t = (a.textContent || '').replace(/\s+/g, ' ').trim()
      if (/^(20\d\d|Food|Consumer products|Health products)\b.*results available/i.test(t)) {
        out.push({ text: t.slice(0, 40), href: a.getAttribute('href') })
      }
    })
    return out.slice(0, 12)
  })
  console.log('\nFACET LINKS:')
  facets.forEach((f) => console.log('  ' + f.text.padEnd(34) + f.href))

  const count = await page.evaluate(() => {
    const m = document.body.innerText.match(/Displaying[^\n]*items\./)
    return m ? m[0] : null
  })
  console.log('\nCOUNT: ' + count)

  await b.close()
  process.exit(0)
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
