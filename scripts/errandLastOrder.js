'use strict'
/**
 * errandLastOrder.js — STEP 5.
 *
 *   「讀返我上一張 Costco Business Centre 訂單 —— 日期、貨品、金額。
 *     唔好加入購物車、唔好落單、唔好改任何嘢。」
 *
 * Read-only. CAPS: 15 actions, 180s, ZERO paid model calls.
 * All four layers live: probes before launch, L3 on the page, L1 inside click, government
 * block on the order and on every navigate.
 */
const { openBrowserSession } = require('../src/browser/browserSession')
const { WAIT } = require('../src/browser/wait')

const PROFILE = 'C:\\Aroma\\browser-profile'
// The real domain, found by reading the profile cookie store rather than guessing again:
// businesscentre.costco.ca DOES NOT RESOLVE. Costco Business Centre Canada is its own site.
const ORDER = { allowedOrigins: ['https://www.costcobusinesscentre.ca'] }
const MAX_ACTIONS = 15
const DEADLINE_MS = 180000

const steps = []
let actions = 0
const t0 = Date.now()
const note = (verb, target, outcome, detail) => {
  steps.push({ verb, target, outcome, detail: detail || '' })
  console.log(`  ${String(steps.length).padStart(2)}. ${verb.padEnd(11)} ${outcome.padEnd(12)} ${target}`)
  if (detail) console.log(`      ${detail}`)
}
const budgetLeft = () => actions < MAX_ACTIONS && (Date.now() - t0) < DEADLINE_MS
let stopped = null

;(async () => {
  const s = await openBrowserSession({ profileDir: PROFILE, order: ORDER })
  if (!s.opened) {
    console.log('⛔ THE SESSION REFUSED TO OPEN. No browser was launched.\n')
    console.log('  reason: ' + s.reason)
    for (const u of (s.unclean || [])) console.log(`    - ${u.probe.padEnd(11)} ${u.state}\n        ${u.saying}`)
    if (!s.unclean) console.log('    ' + s.detail)
    process.exit(2)
  }

  console.log('=== live layers, answered by the running session ===')
  for (const [k, v] of Object.entries(s.liveLayers())) console.log(`  ${k.padEnd(18)} ${v}`)
  console.log('\n=== probe results at launch ===')
  console.log(`  payment ${s.probes.payment.state} · cardSaving ${s.probes.cardSaving.state} · signIn ${s.probes.signIn.state} · lock ${s.probes.lock.state}`)
  console.log('')

  try {
    await s.page.waitForTimeout(1500)   // let the fresh context settle; two back-to-back gotos raced
    for (const url of ['https://www.costcobusinesscentre.ca/']) {
      if (!budgetLeft()) break
      let ok = false
      try {
        const r = await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        actions++
        ok = Boolean(r) && r.status() < 400
        note('navigate', url, ok ? 'ARRIVED' : 'HTTP ' + (r && r.status()), '')
      } catch (e) {
        actions++
        note('navigate', url, 'FAILED', String(e.message).split('\n')[0].slice(0, 70))
      }
      if (!ok) continue

      await s.waitFor({ condition: WAIT.NETWORK_IDLE, timeoutMs: 8000 })
      const v = await s.read()
      note('read_page', url, 'READ', `${v.nodes.length} of ${v.totalCandidates} shown`)

      // Am I recognised? A signed-in page names the account or offers an order history link.
      const signedIn = v.nodes.filter((n) => /sign\s*out|log\s*out|my account|orders|order history|business centre account/i.test(n.name))
      const signInPrompt = v.nodes.filter((n) => n.interactive && /^sign in$|^log in$/i.test(n.name.trim()))
      note('recognised?', url, signedIn.length ? 'LOOKS SIGNED IN' : signInPrompt.length ? 'SIGN-IN OFFERED' : 'UNCLEAR',
        (signedIn.slice(0, 4).map((n) => `${n.role} "${n.name.slice(0, 34)}"`).join(' | ')) || '')

      // EXACT match. A loose regex picked a promo banner containing the word "order" on the
      // first attempt -- the REF 250 shape at the selection layer: a real, printed, wrong
      // element. read_page surfaced link "Orders"; target that and nothing else.
      const orders = v.nodes.find((n) => n.interactive && /^(orders|order history)$/i.test(n.name.trim()))
      if (orders && budgetLeft()) {
        const c = await s.click({ ref: orders.ref, domId: orders.domId, expectRole: orders.role, expectName: orders.name })
        actions++
        note('click', `${orders.role} "${orders.name.slice(0, 36)}"`, c.outcome, c.reason || '')
        if (c.outcome === 'CLICKED') {
          await s.waitFor({ condition: WAIT.NETWORK_IDLE, timeoutMs: 10000 })
          const v2 = await s.read()
          note('read_page', 'the orders page', 'READ', `${v2.nodes.length} shown`)
          const money = v2.nodes.filter((n) => /\$\s?[\d,]+\.\d{2}/.test(n.name))
          const dates = v2.nodes.filter((n) => /\d{4}-\d{2}-\d{2}|\b(19|20)\d{2}\b.*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(n.name))
          note('found', 'order-shaped content', money.length ? 'YES' : 'NO',
            money.length ? money.slice(0, 5).map((n) => n.name.slice(0, 40)).join(' | ') : 'no money-shaped text; ' + dates.length + ' date-shaped')
          if (!money.length) {
            console.log('\n  ⚠ what the page actually says (url: ' + s.page.url().slice(0, 90) + '):')
            console.log(v2.text.split('\n').slice(0, 14).map((l) => '      ' + l.slice(0, 88)).join('\n'))
          }
          if (money.length) { stopped = null; break }
        }
      }
    }
  } finally {
    const f = s.fenceReport()
    console.log('\n══════════ 報告 ══════════\n')
    console.log(`  L3:拒絕咗 ${f.refusedCount} 個寫入請求,批准咗 ${f.allowedWrites} 個。`)
    const docs = f.refused.filter((x) => x.type === "document")
    if (docs.length) {
      console.log("  ⛔ 其中 " + docs.length + " 個係 NAVIGATION(document),即係成版頁俾我自己擋咗:")
      docs.forEach((x) => console.log("      " + x.method + " " + x.url.slice(0, 74)))
    }
    console.log("  其餘(背景請求):")
    f.refused.filter((x) => x.type !== "document").slice(0, 6).forEach((x) => console.log(`      ${x.type.padEnd(10)} ${x.method} ${x.url.slice(0, 62)}`))
    const l1 = steps.filter((x) => x.outcome === 'STOPPED_FOR_YOU')
    console.log(`  L1:停低咗 ${l1.length} 次。` + (l1.length ? l1.map((x) => x.target).join(', ') : ''))
    console.log(`\n  ${steps.length} 步,${actions} 個動作,${((Date.now() - t0) / 1000).toFixed(1)}s,上限 ${MAX_ACTIONS} / 180s`)
    console.log('  冇加入購物車,冇落單,冇改任何嘢,冇付費模型呼叫。')
    await s.close()
  }
  process.exit(0)
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
