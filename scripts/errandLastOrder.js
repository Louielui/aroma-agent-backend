'use strict'
/**
 * errandLastOrder.js — STEP 5. 「讀返我上一張 Costco Business Centre 訂單」
 * Read-only. CAPS: 15 actions, 180s, zero paid model calls.
 */
const { openBrowserSession } = require('../src/browser/browserSession')
const PROFILE = 'C:\Aroma\browser-profile'
const ORDER = { allowedOrigins: ['https://www.costco.ca', 'https://businesscentre.costco.ca'] }

;(async () => {
  const s = await openBrowserSession({ profileDir: PROFILE, order: ORDER })
  if (!s.opened) {
    console.log('⛔ THE SESSION REFUSED TO OPEN. No browser was launched by me.\n')
    console.log('  reason: ' + s.reason)
    if (s.unclean) {
      for (const u of s.unclean) console.log(`    - ${u.probe.padEnd(11)} ${u.state}\n        ${u.saying}`)
    } else {
      console.log('    ' + s.detail)
    }
    console.log('\n  liveLayers(): not available — there is no session to ask.')
    process.exit(2)
  }
  console.log('session opened. live layers: ' + JSON.stringify(s.liveLayers(), null, 2))
  await s.close()
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
