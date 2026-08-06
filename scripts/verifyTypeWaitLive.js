'use strict'
/**
 * verifyTypeWaitLive.js — the half of ACCEPTANCE-TYPE-WAIT.json the unit tests cannot give.
 *
 * HR-20: on `click`, seventeen green unit tests accompanied a live run that returned UNKNOWN
 * three times, because the fake accepted what the real `page.evaluate` rejects. This runs the
 * real library against a real page.
 */
const { chromium } = require('playwright-core')
const { launchOptions } = require('../src/browser/launch')
const { buildType, TYPE_REFUSAL } = require('../src/browser/type')
const { buildWaitFor, buildScreenshot, WAIT } = require('../src/browser/wait')

const PAGE = `<!doctype html><meta charset=utf8><body style="font:14px sans-serif">
<input id=search aria-label="Search" value="old query">
<input id=ro aria-label="Read Only Field" value="read only" readonly>
<input id=dis aria-label="Disabled Field" value="disabled" disabled>
<input id=pw type=password aria-label="Password">
<input id=num type=number aria-label="Quantity" value="7">
<button id=later style="display:none">Appears Later</button>`

;(async () => {
  const b = await chromium.launch(launchOptions())
  const page = await b.newPage()
  await page.goto('https://www.costco.ca/robots.txt', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.setContent(PAGE)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable'); await cdp.send('Accessibility.enable')

  const order = { allowedOrigins: ['https://www.costco.ca'] }
  const type = buildType({ page, cdp, order })
  const waitFor = buildWaitFor({ page })
  const shot = buildScreenshot({ page })

  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  const ax = (name, role) => {
    const n = nodes.find((x) => !x.ignored && x.role && (!role || x.role.value === role) &&
      x.name && x.name.value === name)
    return n && { ref: 'r-' + name.toLowerCase().replace(/\W+/g, ''), domId: n.backendDOMNodeId, expectRole: 'textbox', expectName: name }
  }

  const rows = []
  const run = async (label, fn) => { const r = await fn(); rows.push({ label, r }); return r }

  const SECRET = 'paper towels bounty'
  await run('type into a normal field', () => type({ ...ax('Search'), text: SECRET }))
  await run('READONLY', () => type({ ...ax('Read Only Field'), text: 'x' }))
  await run('DISABLED', () => type({ ...ax('Disabled Field'), text: 'x' }))
  await run('PASSWORD field', () => type({ ...ax('Password'), text: 'hunter2' }))
  await run('text into a number field', () => type({ ...ax('Quantity'), text: 'abc' }))
  await run('wait: condition never met', () => waitFor({ condition: WAIT.VISIBLE, ref: 'r-nosuch', timeoutMs: 1500 }))
  await run('wait: dom ready', () => waitFor({ condition: WAIT.DOM_READY, timeoutMs: 5000 }))
  await run('wait: unknown condition', () => waitFor({ condition: 'netwrok_idle' }))
  await run('screenshot', () => shot({}))

  console.log('=== LIVE, headed, real playwright ===')
  for (const { label, r } of rows) {
    const o = r.outcome + (r.reason ? ' / ' + r.reason : '')
    console.log(`  ${o.padEnd(46)} ${label.padEnd(28)} ${(r.detail || r.note || ('bytes=' + (r.bytes || '')) || '').slice(0, 40)}`)
  }

  const find = (l) => rows.find((x) => x.label === l).r
  const checks = [
    ['normal field typed', find('type into a normal field').outcome === 'TYPED'],
    ['READONLY named', find('READONLY').reason === TYPE_REFUSAL.READONLY],
    ['DISABLED named', find('DISABLED').reason === TYPE_REFUSAL.DISABLED],
    ['PASSWORD refused', find('PASSWORD field').reason === TYPE_REFUSAL.CREDENTIAL],
    ['number field named', find('text into a number field').reason === TYPE_REFUSAL.WRONG_TYPE],
    ['wait timeout is an outcome', find('wait: condition never met').outcome === 'TIMED_OUT'],
    ['wait met is distinguishable', find('wait: dom ready').outcome === 'HAPPENED'],
    ['unknown condition refused', find('wait: unknown condition').outcome === 'REFUSED'],
    ['screenshot is a real buffer', Buffer.isBuffer(find('screenshot').buffer) && find('screenshot').bytes > 1000],
    ['screenshot is not the record', find('screenshot').isPrimaryRecord === false]
  ]
  // ⛔ THE ONE THAT MATTERS MOST: the typed value must appear NOWHERE in any result.
  const serialised = JSON.stringify(rows.map((x) => ({ ...x.r, buffer: undefined })))
  checks.push(['the typed value is absent from every record', !serialised.includes('bounty') && !serialised.includes('hunter2')])

  console.log('\n=== against the FROZEN acceptance bar ===')
  let ok = true
  for (const [name, pass] of checks) { if (!pass) ok = false; console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`) }
  console.log('\n  VERDICT: ' + (ok ? 'ACCEPTANCE MET' : 'ACCEPTANCE NOT MET'))
  await b.close()
  process.exit(ok ? 0 : 1)
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
