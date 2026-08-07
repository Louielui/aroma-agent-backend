'use strict'
/**
 * errandInvoicesPending.js — ERRAND-002, the Owner's own system.
 *
 *   「去 aroma-system 個 invoice 頁，讀返而家 pending 嗰啲發票嘅供應商同金額。」
 *
 * > **Owner: 「If it needs a login, stop and say so rather than asking me for one. I want to
 * > know whether login is the next wall before we decide anything about it.」**
 *
 * ⛔ NO LOGIN IS ATTEMPTED. `type` refuses credential fields structurally; this script never
 * even looks for a way in. Hitting a login screen is a RESULT, not an obstacle to route around.
 *
 * Read-only. CAPS: 12 browser actions, 120s, zero paid model calls.
 */
const { chromium } = require('playwright-core')
const { launchOptions } = require('../src/browser/launch')
const { readPage } = require('../src/browser/axTree')
const { checkNavigation, NAV } = require('../src/browser/navigate')
const { buildWaitFor, WAIT } = require('../src/browser/wait')
const { buildSession } = require('../src/browser/session')
const { buildClick } = require('../src/browser/click')
const { buildType } = require('../src/browser/type')

const HOST = 'https://system.aromabistro741.com'
const ORDER = { allowedOrigins: [HOST] }
const TRY = ['/invoices/intake', '/invoices/review', '/invoices']
const MAX_ACTIONS = 12
const DEADLINE_MS = 120000

const steps = []
let actions = 0
const t0 = Date.now()
const note = (verb, target, outcome, detail) => {
  steps.push({ verb, target, outcome, detail: detail || '' })
  console.log(`  ${String(steps.length).padStart(2)}. ${verb.padEnd(11)} ${outcome.padEnd(12)} ${target}`)
  if (detail) console.log(`      ${detail}`)
}
let stopped = null
const LAST = { url: '', text: '', raw: 0 }

/** Does this read look like a login wall? Reported, never routed around. */
function loginWall (v) {
  const pw = v.nodes.find((n) => /password/i.test(n.name))
  const signin = v.nodes.find((n) => n.interactive && /sign\s*in|log\s*in|登入/i.test(n.name))
  const user = v.nodes.find((n) => /textbox|searchbox|combobox/.test(n.role) && /user|email|account/i.test(n.name))
  const hits = [pw && 'a password field', signin && `an interactive "${signin.name}"`, user && 'a username field'].filter(Boolean)
  return hits.length ? hits : null
}

;(async () => {
  const b = await chromium.launch(launchOptions())
  const page = await b.newPage()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable'); await cdp.send('Accessibility.enable')
  const waitFor = buildWaitFor({ page })
  const read = async () => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    LAST.raw = nodes.length
    return readPage(nodes, { maxNodes: 400, maxChars: 30000 })
  }
  const s = buildSession({
    read,
    click: buildClick({ page, cdp, order: ORDER }),
    type: buildType({ page, cdp, order: ORDER }),
    waitFor,
    screenshot: async () => ({ outcome: 'CAPTURED' })
  })

  let v = null
  for (const path of TRY) {
    if (actions >= MAX_ACTIONS || Date.now() - t0 > DEADLINE_MS) { stopped = { what: 'budget', why: 'actions/time cap' }; break }
    const url = HOST + path
    const nav = checkNavigation(url, ORDER)
    if (nav.verdict !== NAV.ALLOWED) { note('navigate', url, 'BLOCKED', nav.reason); continue }
    let status = '?'
    try { const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); status = r ? r.status() : 'null' } catch (e) { status = 'THREW ' + e.message.split('\n')[0].slice(0, 44) }
    actions++
    note('navigate', url, String(status).startsWith('THREW') ? 'FAILED' : 'ARRIVED', 'HTTP ' + status)
    if (String(status).startsWith('THREW')) continue
    await waitFor({ condition: WAIT.NETWORK_IDLE, timeoutMs: 8000 })
    v = await s.read()
    LAST.url = page.url()
    LAST.text = v.text
    note('read_page', path, 'READ', `${v.nodes.length} of ${v.totalCandidates} shown (raw ${LAST.raw})`)

    const wall = loginWall(v)
    if (wall) {
      stopped = {
        what: 'A LOGIN WALL — and this is the answer to the question, not an obstacle',
        why: 'the read surfaced ' + wall.join(' + ') + '. No login was attempted and none will be.'
      }
      break
    }
    // Anything that looks like invoice content?
    const money = v.nodes.filter((n) => /\$\s?[\d,]+\.\d{2}/.test(n.name))
    if (money.length) { note('found', 'money-shaped text', 'OK', money.length + ' node(s)'); break }
    note('looked for', 'invoice rows on ' + path, 'NONE', 'no money-shaped text in the read; trying the next route')
    v = null
  }
  done(b, v)
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })

function extract (v) {
  const rows = []
  for (let i = 0; i < v.nodes.length && rows.length < 12; i++) {
    const m = v.nodes[i].name.match(/\$\s?[\d,]+\.\d{2}/)
    if (!m) continue
    let supplier = ''
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
      const c = v.nodes[j].name
      if (c && c.length > 3 && !/\$|^\d+$/.test(c)) { supplier = c.slice(0, 46); break }
    }
    rows.push({ supplier, amount: m[0] })
  }
  return rows
}

async function done (b, v) {
  await b.close()
  console.log('\n══════════ 報告 ══════════\n')
  if (stopped) {
    console.log('  停咗:' + stopped.what)
    console.log('  點解:' + stopped.why)
    if (LAST.text) {
      console.log('\n  模型見到嘅嘢(頭 18 行):\n')
      console.log(LAST.text.split('\n').slice(0, 18).map((l) => '      ' + l.slice(0, 92)).join('\n'))
    }
  } else if (v) {
    const rows = extract(v)
    if (!rows.length) {
      console.log('  去到頁面,但讀唔到「供應商 + 金額」。')
      console.log('\n  模型見到嘅嘢(頭 18 行):\n')
      console.log(LAST.text.split('\n').slice(0, 18).map((l) => '      ' + l.slice(0, 92)).join('\n'))
    } else {
      console.log('  pending 發票:\n')
      rows.forEach((r, i) => console.log(`   ${i + 1}. ${r.amount.padEnd(12)} ${r.supplier}`))
    }
  } else {
    console.log('  三條 invoice 路線都讀唔到內容。')
    if (LAST.text) console.log('\n' + LAST.text.split('\n').slice(0, 14).map((l) => '      ' + l.slice(0, 92)).join('\n'))
  }
  console.log(`\n  ${steps.length} 步,${actions} 個動作,${((Date.now() - t0) / 1000).toFixed(1)}s,上限 ${MAX_ACTIONS} 個動作 / 120s`)
  console.log('  冇試過登入,冇打過任何憑證,冇付費模型呼叫。')
  process.exit(0)
}
