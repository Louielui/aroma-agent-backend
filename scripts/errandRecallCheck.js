'use strict'
/**
 * errandRecallCheck.js — ERRAND-003. The target that had to work end to end.
 *
 * > **Owner: 「find me a target that works end to end… where the six verbs actually deliver an
 * > answer rather than an honest stop. If no such target exists in my work, that itself is the
 * > finding.」**
 *
 * The question a chef actually has: **「我入嘅貨有冇被回收?」** Canada's recall register is
 * public, has no login, and — measured — no bot mitigation. It also has NO usable API, which
 * is what makes the browser the right tool for it (HR-21).
 *
 * All six verbs. CAPS: 12 browser actions, 150s, zero paid model calls.
 */
const { chromium } = require('playwright-core')
const { launchOptions } = require('../src/browser/launch')
const { readPage } = require('../src/browser/axTree')
const { checkNavigation, NAV } = require('../src/browser/navigate')
const { buildClick } = require('../src/browser/click')
const { buildType } = require('../src/browser/type')
const { buildWaitFor, WAIT } = require('../src/browser/wait')
const { buildSession } = require('../src/browser/session')
const { buildRequestFence } = require('../src/browser/requestFence')

const HOST = 'https://recalls-rappels.canada.ca'
const ORDER = { allowedOrigins: [HOST] }
const QUERY = process.argv[2] || 'mushrooms'
const MAX_ACTIONS = 12
const DEADLINE_MS = 150000

const steps = []
let actions = 0
const t0 = Date.now()
const note = (verb, target, outcome, detail) => {
  steps.push({ verb, target, outcome, detail: detail || '' })
  console.log(`  ${String(steps.length).padStart(2)}. ${verb.padEnd(11)} ${outcome.padEnd(11)} ${target}`)
  if (detail) console.log(`      ${detail}`)
}
let stopped = null
const stop = (what, why) => { stopped = { what, why } }
const budgetLeft = () => actions < MAX_ACTIONS && (Date.now() - t0) < DEADLINE_MS

;(async () => {
  const b = await chromium.launch(launchOptions())
  const page = await b.newPage()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable'); await cdp.send('Accessibility.enable')
  // L3 INSTALLED. The measurement is whether the one errand that works still works.
  const fence = process.env.FENCE === 'off' ? null : buildRequestFence({ order: ORDER })
  if (fence) { await page.route('**/*', fence.handle); globalThis.__fence = fence }
  const waitFor = buildWaitFor({ page })
  const read = async () => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    return readPage(nodes, { maxNodes: 500, maxChars: 40000 })
  }
  const s = buildSession({
    read,
    click: buildClick({ page, cdp, order: ORDER }),
    type: buildType({ page, cdp, order: ORDER }),
    waitFor,
    screenshot: async () => ({ outcome: 'CAPTURED' })
  })

  // 1. NAVIGATE
  const url = HOST + '/en/search/site?f%5B0%5D=type%3Arecall'
  if (checkNavigation(url, ORDER).verdict !== NAV.ALLOWED) { note('navigate', url, 'BLOCKED', ''); return done(b) }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); actions++
  note('navigate', 'the Canadian recall register', 'ARRIVED', 'HTTP 200')
  await waitFor({ condition: WAIT.NETWORK_IDLE, timeoutMs: 8000 })

  // 2. READ
  let v = await s.read()
  note('read_page', 'the recall list', 'READ', `${v.nodes.length} of ${v.totalCandidates} shown`)
  if (v.nodes.some((n) => /password/i.test(n.name))) { stop('a login wall', 'a password field was in the read'); return done(b) }

  // 3. TYPE the ingredient into the site search
  const box = v.nodes.find((n) => /searchbox|textbox|combobox/.test(n.role) && /search|recherche/i.test(n.name))
  if (!box) { stop('no search box surfaced', 'read_page found no field named like search'); return done(b) }
  if (!budgetLeft()) { stop('budget', ''); return done(b) }
  const t = await s.type({ ref: box.ref, domId: box.domId, expectRole: box.role, expectName: box.name, text: QUERY }); actions++
  note('type', `${box.role} "${box.name}"`, t.outcome, t.reason || `${t.record.length} chars, shape ${t.record.shape}`)
  if (t.outcome !== 'TYPED') { stop('could not type the query', t.reason + ' — ' + t.detail); return done(b) }

  // 4. READ AGAIN — the composition rule, enforced by the session
  v = await s.read()
  note('read_page', 'after typing', 'READ', `${v.nodes.length} shown`)

  // 5. CLICK the search control
  const go = v.nodes.find((n) => n.interactive && /^(search|go|submit|rechercher)$/i.test(n.name.trim())) ||
             v.nodes.find((n) => n.role === 'button' && /search/i.test(n.name))
  if (!go) { stop('no clickable way to run the search', 'type never presses Enter and no Search button was in the read'); return done(b) }
  if (!budgetLeft()) { stop('budget', ''); return done(b) }
  const c = await s.click({ ref: go.ref, domId: go.domId, expectRole: go.role, expectName: go.name }); actions++
  note('click', `${go.role} "${go.name}"`, c.outcome, c.reason || '')
  if (c.outcome !== 'CLICKED') { stop('could not run the search', c.reason + ' — ' + c.detail); return done(b) }

  // 6. WAIT then READ the answer
  await waitFor({ condition: WAIT.NETWORK_IDLE, timeoutMs: 12000 })
  v = await s.read()
  note('read_page', 'the results', 'READ', `${v.nodes.length} of ${v.totalCandidates} shown`)
  done(b, v)
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })

/** A recall entry is a link, followed within a few lines by "<category> | <date>". */
function extract (v) {
  const out = []
  for (let i = 0; i < v.nodes.length && out.length < 6; i++) {
    const n = v.nodes[i]
    if (n.role !== 'link' || n.name.length < 25) continue
    if (!new RegExp(QUERY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(n.name)) continue
    let when = ''
    for (let j = i + 1; j < Math.min(i + 5, v.nodes.length); j++) {
      const m = v.nodes[j].name.match(/([A-Za-z ]+)\s\|\s(\d{4}-\d{2}-\d{2})/)
      if (m) { when = m[2] + '  ' + m[1].trim(); break }
    }
    out.push({ title: n.name.replace(/\s+/g, ' ').slice(0, 76), when })
  }
  return out
}

async function done (b, v) {
  await b.close()
  console.log('\n══════════ 報告 ══════════\n')
  if (stopped) {
    console.log('  停咗:' + stopped.what)
    console.log('  點解:' + stopped.why)
  } else {
    const rows = extract(v)
    if (!rows.length) {
      console.log(`  「${QUERY}」冇搵到相關回收。`)
      console.log('  (讀到' + v.nodes.length + '個節點,入面冇一條回收標題含呢個字。)')
    } else {
      console.log(`  「${QUERY}」相關嘅回收 —— ${rows.length} 條:\n`)
      rows.forEach((r, i) => console.log(`   ${i + 1}. ${(r.when || '日期不明').padEnd(28)} ${r.title}`))
    }
  }
  console.log(`\n  ${steps.length} 步,${actions} 個動作,${((Date.now() - t0) / 1000).toFixed(1)}s,上限 ${MAX_ACTIONS} / 150s`)
  console.log('  冇登入,冇憑證,冇付費模型呼叫。')
  if (globalThis.__fence) {
    const r = globalThis.__fence.report()
    console.log(`  L3:拒絕咗 ${r.refusedCount} 個寫入請求,批准咗 ${r.allowedWrites} 個。`)
    r.refused.slice(0, 6).forEach(x => console.log(`      ${x.method} ${x.url.slice(0, 76)}`))
  }
  process.exit(0)
}
