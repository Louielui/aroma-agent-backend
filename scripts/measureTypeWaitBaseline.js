'use strict'
/**
 * measureTypeWaitBaseline.js — HR-18 applied to `type` and `wait_for` BEFORE either is designed.
 *
 * > **Owner: 「that is now two rounds where the honest baseline was more capable than the
 * > assertion, and type and wait_for are the most likely to be the same shape.」**
 *
 * Every probe clears its own state first and reports NO_EFFECT rather than inheriting a
 * previous result — the harness lesson from the click baseline, which was confounded three
 * times before it was right.
 */
const { chromium } = require('playwright-core')
const { launchOptions } = require('../src/browser/launch')

const PAGE = `<!doctype html><meta charset=utf8><body style="font:14px sans-serif">
<input id=plain value="existing text">
<input id=ro value="read only" readonly>
<input id=dis value="disabled" disabled>
<input id=num type=number value="7">
<div id=ce contenteditable>editable div</div>
<textarea id=ta>line one</textarea>
<input id=react value="">
<button id=later style="display:none">Appears Later</button>
<script>
 window.__ev = []
 const log = (el, e) => window.__ev.push(el.id + ':' + e.type)
 for (const el of document.querySelectorAll('input,textarea,div[contenteditable]')) {
   for (const t of ['focus','input','change','keydown']) el.addEventListener(t, (e) => log(el, e))
 }
 setTimeout(() => { document.getElementById('later').style.display = '' }, 1200)
</script>`

async function probe (page, name, fn) {
  await page.evaluate(() => { window.__ev = [] })
  const t0 = Date.now()
  try {
    const value = await fn()
    const ev = await page.evaluate(() => window.__ev)
    return { name, outcome: 'OK', detail: String(value), events: ev.join(' '), ms: Date.now() - t0 }
  } catch (e) {
    return { name, outcome: 'REFUSED', detail: String(e.message).split('\n')[0].slice(0, 62), events: '', ms: Date.now() - t0 }
  }
}

const val = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i)
  return el.isContentEditable ? el.textContent : el.value
}, id)

;(async () => {
  const b = await chromium.launch(launchOptions())
  const page = await b.newPage()
  await page.setContent(PAGE)

  console.log('=== TYPING: what playwright-core already does ===')
  const t = []
  t.push(await probe(page, 'fill() over existing text', async () => {
    await page.fill('#plain', 'new value'); return JSON.stringify(await val(page, 'plain'))
  }))
  t.push(await probe(page, 'pressSequentially (keystrokes)', async () => {
    await page.locator('#react').pressSequentially('abc', { timeout: 4000 }); return JSON.stringify(await val(page, 'react'))
  }))
  t.push(await probe(page, 'fill() on CONTENTEDITABLE', async () => {
    await page.fill('#ce', 'replaced'); return JSON.stringify(await val(page, 'ce'))
  }))
  t.push(await probe(page, 'fill() on a textarea', async () => {
    await page.fill('#ta', 'two\nlines'); return JSON.stringify(await val(page, 'ta'))
  }))
  t.push(await probe(page, 'fill() on READONLY', async () => {
    await page.fill('#ro', 'x', { timeout: 2500 }); return JSON.stringify(await val(page, 'ro'))
  }))
  t.push(await probe(page, 'fill() on DISABLED', async () => {
    await page.fill('#dis', 'x', { timeout: 2500 }); return JSON.stringify(await val(page, 'dis'))
  }))
  t.push(await probe(page, 'fill() a number input with text', async () => {
    await page.fill('#num', 'not-a-number', { timeout: 2500 }); return JSON.stringify(await val(page, 'num'))
  }))
  t.push(await probe(page, 'fill("") clears', async () => {
    await page.fill('#plain', ''); return JSON.stringify(await val(page, 'plain'))
  }))
  for (const r of t) console.log(`  ${r.outcome.padEnd(8)} ${String(r.ms).padStart(5)}ms  ${r.name.padEnd(32)} -> ${r.detail.padEnd(20)} events: ${r.events}`)

  console.log('\n=== force on fill — the same flag, the same shape? ===')
  await page.evaluate(() => { document.getElementById('ro').readOnly = true })
  const forced = await probe(page, 'fill READONLY with force:true', async () => {
    await page.fill('#ro', 'FORCED', { force: true, timeout: 2500 }); return JSON.stringify(await val(page, 'ro'))
  })
  console.log(`  ${forced.outcome.padEnd(8)} ${forced.name} -> ${forced.detail}  ${forced.detail === '"read only"' ? '  <-- SUCCEEDED AND CHANGED NOTHING' : ''}`)

  console.log('\n=== WAITING: what playwright-core already does ===')
  const w = []
  w.push(await probe(page, 'waitForSelector — appears in 1.2s', async () => {
    await page.evaluate(() => { const e = document.getElementById('later'); e.style.display = 'none'; setTimeout(() => { e.style.display = '' }, 1200) })
    await page.locator('#later').waitFor({ state: 'visible', timeout: 5000 }); return 'visible'
  }))
  w.push(await probe(page, 'waitFor — never appears', async () => {
    await page.locator('#nonexistent').waitFor({ state: 'visible', timeout: 2000 }); return 'visible'
  }))
  w.push(await probe(page, 'waitForFunction — arbitrary condition', async () => {
    await page.evaluate(() => { setTimeout(() => { window.__ready = true }, 800) })
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 4000 }); return 'condition met'
  }))
  for (const r of w) console.log(`  ${r.outcome.padEnd(8)} ${String(r.ms).padStart(5)}ms  ${r.name.padEnd(32)} -> ${r.detail}`)

  console.log('\n=== waiting on a REAL page: load states and navigation ===')
  const p2 = await b.newPage()
  const t1 = Date.now()
  await p2.goto('https://www.costco.ca/robots.txt', { waitUntil: 'domcontentloaded', timeout: 30000 })
  const tDom = Date.now() - t1
  let idleMs = null
  try { const t2 = Date.now(); await p2.waitForLoadState('networkidle', { timeout: 15000 }); idleMs = Date.now() - t2 } catch (_) { idleMs = 'TIMED OUT' }
  console.log(`  domcontentloaded ${tDom}ms; then networkidle ${idleMs}${typeof idleMs === 'number' ? 'ms' : ''}`)

  console.log('\n=== SCREENSHOT ===')
  const shot = await p2.screenshot({ type: 'png' })
  console.log(`  page.screenshot -> ${shot.length} bytes, Buffer: ${Buffer.isBuffer(shot)}`)
  const el = await page.locator('#plain').screenshot({ type: 'png' }).then((x) => x.length, (e) => 'FAILED ' + e.message.slice(0, 40))
  console.log(`  locator.screenshot (one element) -> ${el} bytes`)

  await b.close()
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
