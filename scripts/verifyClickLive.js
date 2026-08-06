'use strict'
/**
 * verifyClickLive.js — the half of ACCEPTANCE-CLICK.json that unit tests cannot give.
 *
 *   「C1–C9 all green as tests, PLUS a live headed probe against the frozen local hazard page
 *    showing covered/moving/disabled all REFUSED WITH A STATED REASON.」
 *
 * The unit tests run against a fake page, so they prove the ADAPTER's logic and nothing about
 * whether the real library and the real probe agree with it. This runs the real thing.
 */
const { chromium } = require('playwright-core')
const { launchOptions } = require('../src/browser/launch')
const { buildClick, REFUSAL } = require('../src/browser/click')

const PAGE = `<!doctype html><meta charset=utf8><style>
 body{font:14px sans-serif;margin:0}
 .spacer{height:1600px}
 #overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9}
 #moving{position:relative;animation:slide 1.5s linear infinite alternate}
 @keyframes slide{from{left:0}to{left:280px}}
</style>
<button id=plain>Plain</button>
<button id=covered>Covered</button>
<button id=moving>Moving</button>
<button id=disabled disabled>Disabled</button>
<button id=doomed>Doomed</button>
<div id=overlay></div>
<div class=spacer></div>
<button id=offscreen>Offscreen</button>
<script>window.__clicks=[]
for (const b of document.querySelectorAll('button')) b.addEventListener('click', () => window.__clicks.push(b.id))</script>`

const ORDER = { allowedOrigins: ['https://example.invalid'] } // replaced per-probe below

;(async () => {
  const b = await chromium.launch(launchOptions())
  const page = await b.newPage()
  await page.goto('https://www.costco.ca/robots.txt', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.setContent(PAGE)   // keeps the costco.ca origin, so the order check is real
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable'); await cdp.send('Accessibility.enable')

  const order = { allowedOrigins: ['https://www.costco.ca'] }
  const click = buildClick({ page, cdp, order })
  const blocked = buildClick({ page, cdp, order: { allowedOrigins: ['https://www.example.com'] } })

  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  const ax = (name) => {
    const n = nodes.find((x) => !x.ignored && x.role && x.role.value === 'button' &&
      x.name && x.name.value === name)
    return n && { ref: 'r' + name.toLowerCase(), domId: n.backendDOMNodeId, expectRole: 'button', expectName: name }
  }

  const rows = []
  const run = async (label, fn) => {
    await page.evaluate(() => { window.__clicks = [] })
    const r = await fn()
    const clicks = await page.evaluate(() => window.__clicks)
    rows.push({ label, outcome: r.outcome, reason: r.reason || '', detail: (r.detail || '').slice(0, 46), clicked: clicks.join(',') || '-' })
  }

  await page.evaluate(() => { document.getElementById('overlay').style.display = 'none' })
  await run('plain', () => click(ax('Plain')))
  await run('offscreen', () => click(ax('Offscreen')))
  await run('disabled', () => click(ax('Disabled')))
  await run('moving', () => click(ax('Moving')))
  await run('origin not in order', () => blocked(ax('Plain')))

  const doomed = ax('Doomed')
  await page.evaluate(() => document.getElementById('doomed').remove())
  await run('stale (element removed)', () => click(doomed))

  await page.evaluate(() => { document.getElementById('overlay').style.display = '' })
  await run('covered', () => click(ax('Covered')))

  console.log('=== LIVE, headed, real playwright + real page probe ===')
  for (const r of rows) {
    console.log(`  ${r.outcome.padEnd(8)} ${String(r.reason).padEnd(28)} ${r.label.padEnd(24)} clicked=${r.clicked.padEnd(10)} ${r.detail}`)
  }

  const need = [
    ['plain', 'CLICKED'], ['offscreen', 'CLICKED'],
    ['disabled', REFUSAL.DISABLED], ['moving', REFUSAL.UNSTABLE], ['covered', REFUSAL.COVERED],
    ['stale (element removed)', REFUSAL.GONE], ['origin not in order', REFUSAL.ORIGIN]
  ]
  let ok = true
  console.log('\n=== against the FROZEN acceptance bar ===')
  for (const [label, want] of need) {
    const r = rows.find((x) => x.label === label)
    const got = r.outcome === 'CLICKED' ? 'CLICKED' : r.reason
    const pass = got === want
    if (!pass) ok = false
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(24)} want ${String(want).padEnd(28)} got ${got}`)
  }
  // Nothing may have been clicked on any refusal.
  const leaked = rows.filter((r) => r.outcome !== 'CLICKED' && r.clicked !== '-')
  console.log(`  ${leaked.length === 0 ? 'PASS' : 'FAIL'}  no refusal clicked anything` + (leaked.length ? ' — ' + JSON.stringify(leaked) : ''))
  if (leaked.length) ok = false

  console.log('\n  VERDICT: ' + (ok ? 'ACCEPTANCE MET' : 'ACCEPTANCE NOT MET'))
  await b.close()
  process.exit(ok ? 0 : 1)
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
