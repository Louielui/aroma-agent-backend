'use strict'
/**
 * measureClickBaseline.js — HR-18 applied to `click` BEFORE `click` is designed.
 *
 * > **Owner: 「do not assume click must be built from nothing without checking what
 * > playwright-core already does correctly with a ref we can resolve.」**
 *
 * ⚠ THE FIRST VERSION OF THIS HARNESS WAS CONFOUNDED — three of six probes measured nothing:
 *   - the overlay auto-removed after 2.5s and the first probe took 2.7s, so 「covered」 was
 *     clicked on an UNCOVERED button;
 *   - the animation was 1.2s and had finished, so 「moving」 was clicked on a still button;
 *   - the iframe row reported the PREVIOUS probe's click, because the last-entry read cannot
 *     tell 「a new click」 from 「no new click」.
 *
 * Fixed here: hazards are permanent, `__clicks` is CLEARED before every probe, and a probe
 * that produces no new entry reports NO_EFFECT rather than inheriting the last one. A
 * measurement that cannot distinguish success from no-change is not a measurement.
 */
const { chromium } = require('playwright-core')
const { launchOptions } = require('../src/browser/launch')

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
<div id=overlay></div>
<div class=spacer></div>
<button id=offscreen>Offscreen</button>
<iframe srcdoc="&lt;button id=inner&gt;Inner&lt;/button&gt;&lt;script&gt;document.getElementById('inner').onclick=()=&gt;parent.postMessage('inner','*')&lt;/script&gt;"></iframe>
<script>
 window.__clicks=[]
 for (const b of document.querySelectorAll('button')) b.addEventListener('click', e => window.__clicks.push({id:b.id, trusted:e.isTrusted}))
 window.addEventListener('message', e => window.__clicks.push({id:String(e.data), trusted:'in-frame'}))
</script>`

async function probe (page, name, fn, { uncover = false } = {}) {
  await page.evaluate(() => { window.__clicks = [] })
  if (uncover) await page.evaluate(() => { const o = document.getElementById('overlay'); if (o) o.style.display = 'none' })
  const t0 = Date.now()
  let outcome, detail
  try {
    await fn()
    // postMessage from an iframe is ASYNC. The first fixed harness still read __clicks too
    // early, so the frame probe reported NO_EFFECT and its message then landed during the
    // NEXT probe, mislabelling that one too. Settle before reading.
    await page.waitForTimeout(350)
    const clicks = await page.evaluate(() => window.__clicks)
    // NO NEW ENTRY IS NOT A SUCCESS. This is the distinction the first harness could not make.
    outcome = clicks.length ? 'CLICKED' : 'NO_EFFECT'
    detail = clicks.length ? JSON.stringify(clicks[0]) : 'call returned but nothing was clicked'
  } catch (e) {
    outcome = 'REFUSED'
    detail = String(e.message).split('\n')[0].slice(0, 76)
  }
  if (uncover) await page.evaluate(() => { const o = document.getElementById('overlay'); if (o) o.style.display = '' })
  return { name, outcome, detail, ms: Date.now() - t0 }
}

;(async () => {
  const b = await chromium.launch(launchOptions())
  const page = await b.newPage()
  await page.setContent(PAGE)

  const rows = []
  rows.push(await probe(page, 'plain button', () => page.click('#plain', { timeout: 4000 }), { uncover: true }))
  rows.push(await probe(page, 'OFFSCREEN (1600px down)', () => page.click('#offscreen', { timeout: 5000 }), { uncover: true }))
  rows.push(await probe(page, 'COVERED (overlay present)', () => page.click('#covered', { timeout: 4000 })))
  rows.push(await probe(page, 'MOVING (animating forever)', () => page.click('#moving', { timeout: 5000 }), { uncover: true }))
  rows.push(await probe(page, 'DISABLED', () => page.click('#disabled', { timeout: 3000 }), { uncover: true }))
  rows.push(await probe(page, 'INSIDE AN IFRAME', () => page.frameLocator('iframe').locator('#inner').click({ timeout: 5000 }), { uncover: true }))
  rows.push(await probe(page, 'COVERED + force:true', () => page.click('#covered', { timeout: 4000, force: true })))

  console.log('=== what playwright-core 1.62.1 does WITHOUT us writing anything ===')
  for (const r of rows) console.log(`  ${r.outcome.padEnd(9)} ${String(r.ms).padStart(5)}ms  ${r.name.padEnd(28)} ${r.detail}`)

  console.log('\n=== ref -> element: does backendDOMNodeId reach a playwright locator? ===')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable'); await cdp.send('Accessibility.enable')
  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  const target = nodes.find(n => !n.ignored && n.role && n.role.value === 'button' && n.name && n.name.value === 'Plain')
  console.log('  AX node for "Plain" -> backendDOMNodeId', target && target.backendDOMNodeId)
  await page.evaluate(() => { window.__clicks = []; document.getElementById('overlay').style.display = 'none' })
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: target.backendDOMNodeId })
  console.log('  DOM.resolveNode ->', object.className || object.type)
  await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: 'function(){ this.setAttribute("data-aroma-ref","probe-1") }'
  })
  const loc = page.locator('[data-aroma-ref="probe-1"]')
  console.log('  tagged + located ->', await loc.count(), 'element; text', JSON.stringify(await loc.innerText()))
  await loc.click({ timeout: 3000 })
  await page.waitForTimeout(350)
  console.log('  clicked via the resolved ref ->', JSON.stringify((await page.evaluate(() => window.__clicks))[0]))

  console.log('\n=== does a STALE ref fail loudly? (element removed after the read) ===')
  await page.evaluate(() => { document.getElementById('plain').remove() })
  const stale = await cdp.send('DOM.resolveNode', { backendNodeId: target.backendDOMNodeId })
    .then(() => 'RESOLVED ANYWAY', (e) => 'refused: ' + String(e.message).split('\n')[0].slice(0, 46))
  console.log('  DOM.resolveNode on a removed node ->', stale)
  const still = await page.locator('[data-aroma-ref="probe-1"]').count()
  console.log('  the tagged locator now finds ->', still, 'element(s)')
  const clickStale = await page.locator('[data-aroma-ref="probe-1"]').click({ timeout: 2500 })
    .then(() => 'CLICKED — silently wrong', (e) => 'refused: ' + String(e.message).split('\n')[0].slice(0, 46))
  console.log('  clicking the stale ref ->', clickStale)
  await b.close()
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
