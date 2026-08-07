'use strict'
/**
 * errandPaperTowel.js — a real errand, chosen by the Owner, not by a test.
 *
 *   「去 costco.ca，搵 paper towel，讀返頭五件貨嘅名同價錢。唔好加入購物車，唔好登入。」
 *
 * Six verbs as they are. NOTHING is built for this. If it needs a seventh verb, that is a
 * finding and the run stops there.
 *
 * CAPS: 15 browser actions, 180s wall clock, and zero paid model calls — the verbs are
 * deterministic, so this errand costs nothing but time.
 */
const { chromium } = require('playwright-core')
const { launchOptions } = require('../src/browser/launch')
const { readPage } = require('../src/browser/axTree')
const { checkNavigation, NAV } = require('../src/browser/navigate')
const { buildClick } = require('../src/browser/click')
const { buildType } = require('../src/browser/type')
const { buildWaitFor, WAIT } = require('../src/browser/wait')
const { buildSession } = require('../src/browser/session')

const ORDER = { allowedOrigins: ['https://www.costco.ca'] }
const MAX_ACTIONS = 15
const DEADLINE_MS = 180000

const steps = []
let actions = 0
const t0 = Date.now()
const note = (verb, target, outcome, detail) => {
  steps.push({ verb, target, outcome, detail: detail || '' })
  console.log(`  ${String(steps.length).padStart(2)}. ${verb.padEnd(12)} ${outcome.padEnd(12)} ${target}`)
  if (detail) console.log(`      ${detail}`)
}
const budgetLeft = () => actions < MAX_ACTIONS && (Date.now() - t0) < DEADLINE_MS

let stopped = null
const LAST = { url: '', domCount: 0, bodyText: '' }
const stop = (what, why) => { stopped = { what, why }; return null }

;(async () => {
  const b = await chromium.launch(launchOptions())
  const page = await b.newPage()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable'); await cdp.send('Accessibility.enable')

  const click = buildClick({ page, cdp, order: ORDER })
  const type = buildType({ page, cdp, order: ORDER })
  const waitFor = buildWaitFor({ page })
  const read = async () => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    return readPage(nodes, { maxNodes: 400, maxChars: 30000 })
  }
  const s = buildSession({ read, click, type, waitFor, screenshot: async () => ({ outcome: 'CAPTURED' }) })

  // 1. NAVIGATE
  const url = 'https://www.costco.ca/'
  const nav = checkNavigation(url, ORDER)
  if (nav.verdict !== NAV.ALLOWED) { note('navigate', url, 'BLOCKED', nav.reason); return done(b) }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); actions++
  note('navigate', url, 'ARRIVED', '')
  await waitFor({ condition: WAIT.NETWORK_IDLE, timeoutMs: 8000 })

  // 2. READ
  let v = await s.read()
  note('read_page', 'the home page', 'READ', `${v.nodes.length} of ${v.totalCandidates} shown`)

  // What did we land on? Look for the things the Owner predicted.
  const hazards = v.nodes.filter((n) => /cookie|accept|consent|postal|warehouse|location|continue|privacy|region|country/i.test(n.name))
  if (hazards.length) {
    note('observed', 'possible interstitial', 'NOTED',
      hazards.slice(0, 5).map((h) => `${h.role} "${h.name.slice(0, 46)}"`).join(' | '))
  }

  // 3. FIND THE SEARCH BOX
  const box = v.nodes.find((n) => /searchbox|textbox|combobox/.test(n.role) && /search/i.test(n.name))
  if (!box) { stop('no search box surfaced in the read', 'read_page found no searchbox/textbox named like search'); return done(b) }
  note('found', `${box.role} "${box.name}"`, 'OK', '')

  // 4. TYPE
  if (!budgetLeft()) { stop('budget', 'actions/time'); return done(b) }
  const t = await type({ ref: box.ref, domId: box.domId, expectRole: box.role, expectName: box.name, text: 'paper towel' }); actions++
  note('type', `${box.role} "${box.name}"`, t.outcome, t.reason || `${t.record.length} chars, shape ${t.record.shape}`)
  if (t.outcome !== 'TYPED') { stop('could not type the query', t.reason + ' — ' + t.detail); return done(b) }

  // 5. SUBMIT THE SEARCH — and this is where the six verbs may run out.
  await waitFor({ condition: WAIT.DOM_READY, timeoutMs: 4000 })
  v = await s.read()
  note('read_page', 'after typing', 'READ', `${v.nodes.length} shown`)
  const submitish = v.nodes.filter((n) => n.interactive && /^(search|submit|go)$/i.test(n.name.trim()))
  note('looking for', 'a clickable way to run the search', submitish.length ? 'FOUND' : 'NOT_FOUND',
    submitish.length ? submitish.map((x) => `${x.role} "${x.name}"`).join(' | ') : 'no button named Search/Submit/Go in the read')

  if (!submitish.length) {
    stop('THE SEARCH CANNOT BE RUN WITH THE SIX VERBS',
      'type never presses Enter (by design, no submit verb) and the read surfaced no clickable Search button. ' +
      'Running the search requires either a submit verb or navigating directly to a results URL.')
    return done(b)
  }
  if (!budgetLeft()) { stop('budget', 'actions/time'); return done(b) }
  const c = await click({ ref: submitish[0].ref, domId: submitish[0].domId, expectRole: submitish[0].role, expectName: submitish[0].name }); actions++
  note('click', `${submitish[0].role} "${submitish[0].name}"`, c.outcome, c.reason || '')
  if (c.outcome !== 'CLICKED') { stop('could not run the search', c.reason + ' — ' + c.detail); return done(b) }

  // 6. WAIT, READ, EXTRACT
  await waitFor({ condition: WAIT.NETWORK_IDLE, timeoutMs: 12000 })
  v = await s.read()
  note('read_page', 'the results', 'READ', `${v.nodes.length} of ${v.totalCandidates} shown`)
  LAST.url = page.url()
  LAST.domCount = await page.evaluate(() => document.querySelectorAll('*').length)
  LAST.bodyText = String(await page.evaluate(() => document.body.innerText)).replace(/s+/g, ' ').slice(0, 240)
  done(b, v)
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })

function extract (v) {
  // Document-order proximity — the property measured 30/30 and now load-bearing.
  const out = []
  const lines = v.nodes
  for (let i = 0; i < lines.length && out.length < 5; i++) {
    const n = lines[i]
    if (n.role !== 'link' || n.name.length < 20) continue
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const m = lines[j].name.match(/\$\s?[\d,]+\.\d{2}/)
      if (m) { out.push({ name: n.name.slice(0, 62), price: m[0] }); break }
    }
  }
  return out
}

async function done (b, v) {
  await b.close()
  console.log('\n══════════ 報告 ══════════\n')
  if (stopped) {
    console.log('  行唔到：' + stopped.what)
    console.log('  點解：' + stopped.why)
  } else {
    const rows = extract(v)
    if (!rows.length) {
      console.log('  去到結果頁，但讀唔到「名 + 價錢」嘅配對。')
      console.log('\n  ⚠ 頁面 URL：' + LAST.url)
      console.log('  ⚠ 原始 AX 節點 ' + v.rawNodeCount + ' 個，存活 ' + v.nodes.length + ' 個。')
      console.log('  ⚠ 模型實際見到嘅全部嘢：\n')
      console.log(v.text.split('\n').map((l) => '      ' + l).join('\n'))
      console.log('\n  ⚠ DOM 元素總數：' + LAST.domCount)
      console.log('  ⚠ body 開頭文字：' + JSON.stringify(LAST.bodyText))
    } else {
      console.log('  paper towel，頭 ' + rows.length + ' 件：\n')
      rows.forEach((r, i) => console.log(`   ${i + 1}. ${r.price.padEnd(10)} ${r.name}`))
    }
  }
  console.log(`\n  ${steps.length} 步，${actions} 個動作，${((Date.now() - t0) / 1000).toFixed(1)}s，上限 ${MAX_ACTIONS} 個動作 / 180s`)
  console.log('  冇加入購物車，冇登入，冇付費模型呼叫。')
  process.exit(0)
}
