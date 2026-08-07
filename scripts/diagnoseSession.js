'use strict'
/** Diagnostic for STEP 5: what does the persistent context open with, and am I recognised? */
const { openBrowserSession } = require('../src/browser/browserSession')

const PROFILE = 'C:\\Aroma\\browser-profile'
const ORDER = { allowedOrigins: ['https://www.costco.ca'] }

;(async () => {
  const s = await openBrowserSession({ profileDir: PROFILE, order: ORDER })
  if (!s.opened) {
    console.log('refused: ' + s.reason)
    for (const u of (s.unclean || [])) console.log('  ' + u.probe + ' ' + u.state)
    process.exit(2)
  }
  console.log('page at open:   ' + JSON.stringify(s.page.url()))
  await s.page.waitForTimeout(3000)
  console.log('after settling: ' + JSON.stringify(s.page.url()))

  try {
    const r = await s.page.goto('https://www.costco.ca/', { waitUntil: 'domcontentloaded', timeout: 45000 })
    console.log('goto -> HTTP ' + (r && r.status()))
    await s.page.waitForTimeout(5000)
    console.log('landed: ' + s.page.url())
    console.log('title:  ' + JSON.stringify((await s.page.title()).slice(0, 70)))
    const v = await s.read()
    console.log('read:   ' + v.nodes.length + ' nodes')
    const hits = v.nodes.filter((n) => /sign|account|order|hi,|welcome|bonjour/i.test(n.name)).slice(0, 10)
    console.log('account-ish elements:')
    hits.forEach((n) => console.log('   ' + n.role.padEnd(9) + ' ' + JSON.stringify(n.name.slice(0, 50))))
  } catch (e) {
    console.log('goto failed: ' + String(e.message).split('\n')[0].slice(0, 100))
  }
  const f = s.fenceReport()
  console.log('L3 refused ' + f.refusedCount + ' writes, allowed ' + f.allowedWrites)
  await s.close()
  process.exit(0)
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
