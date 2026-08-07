'use strict'
/**
 * Is there a GET route to order history?
 *
 * The Orders link performs a POST navigation to /OAuthLogonCmd, which L3 refuses and which the
 * Owner has ruled must NOT be opened via allowedWrites. So: does the page offer any ordinary
 * GET link into the account area? Reading hrefs is a read; navigating to one is a GET.
 *
 * Read-only. No fence change. No paid model calls.
 */
const { openBrowserSession } = require('../src/browser/browserSession')
const { WAIT } = require('../src/browser/wait')

const PROFILE = 'C:\\Aroma\\browser-profile'
const ORDER = { allowedOrigins: ['https://www.costcobusinesscentre.ca'] }

;(async () => {
  const s = await openBrowserSession({ profileDir: PROFILE, order: ORDER })
  if (!s.opened) { console.log('refused: ' + s.reason); process.exit(2) }
  await s.page.waitForTimeout(1200)
  await s.page.goto('https://www.costcobusinesscentre.ca/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await s.waitFor({ condition: WAIT.NETWORK_IDLE, timeoutMs: 8000 })

  const links = await s.page.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
    .map((a) => ({ text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), href: a.href }))
    .filter((l) => /order|account|history|invoice/i.test(l.href) || /order|account|history|invoice/i.test(l.text))
    .slice(0, 25))

  console.log('anchors that look account-related (' + links.length + '):')
  for (const l of links) console.log('   ' + l.text.padEnd(30) + ' -> ' + l.href.slice(0, 92))

  const forms = await s.page.evaluate(() => Array.from(document.querySelectorAll('form'))
    .map((f) => ({ method: (f.method || 'get').toUpperCase(), action: f.action }))
    .filter((f) => /order|logon|account/i.test(f.action)).slice(0, 10))
  console.log('\nforms pointing at order/logon/account:')
  for (const f of forms) console.log('   ' + f.method.padEnd(5) + ' ' + f.action.slice(0, 92))

  // Navigate to the GET route directly — an ordinary anchor href, no form POST, no fence change.
  const target = links.find((l) => /\/myaccount\/#.*ord/i.test(l.href))
  if (target) {
    console.log('\n=> navigating (GET) to ' + target.href.slice(0, 96))
    await s.page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await s.waitFor({ condition: WAIT.NETWORK_IDLE, timeoutMs: 12000 })
    await s.page.waitForTimeout(4000)
    const v = await s.read()
    console.log('   landed: ' + s.page.url().slice(0, 96))
    console.log('   read ' + v.nodes.length + ' nodes')
    const money = v.nodes.filter((n) => /\$\s?[\d,]+\.\d{2}/.test(n.name))
    console.log('   money-shaped nodes: ' + money.length)
    console.log(v.text.split('\n').slice(0, 22).map((l) => '      ' + l.slice(0, 88)).join('\n'))
  }

  const fr = s.fenceReport()
  console.log('\nL3 refused ' + fr.refusedCount + ' writes during this read')
  await s.close()
  process.exit(0)
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
