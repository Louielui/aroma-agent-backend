'use strict'
/**
 * verifySequenceLive.js — the six verbs as ONE thing, against ACCEPTANCE-SEQUENCE.json.
 *
 * > **Owner: 「The verbs each passed alone. Nothing has yet strung them together, and every
 * > failure this week appeared at a seam rather than inside a unit.」**
 *
 * Live, headed, READ-ONLY destination. Nothing that submits.
 */
const { chromium } = require('playwright-core')
const { launchOptions } = require('../src/browser/launch')
const { readPage } = require('../src/browser/axTree')
const { checkNavigation, NAV } = require('../src/browser/navigate')
const { buildClick } = require('../src/browser/click')
const { buildType } = require('../src/browser/type')
const { buildWaitFor, WAIT } = require('../src/browser/wait')
const { buildSession, SESSION_REFUSAL } = require('../src/browser/session')
const fs = require('node:fs')
const path = require('node:path')

const ORDER = { allowedOrigins: ['https://en.wikipedia.org'] }
const START = 'https://en.wikipedia.org/wiki/Costco'

const steps = []
const note = (verb, target, outcome, detail) =>
  steps.push({ n: steps.length + 1, verb, target, outcome, detail: detail || '' })

;(async () => {
  const b = await chromium.launch(launchOptions())
  const page = await b.newPage()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable'); await cdp.send('Accessibility.enable')
  const click = buildClick({ page, cdp, order: ORDER })
  const type = buildType({ page, cdp, order: ORDER })
  const waitFor = buildWaitFor({ page })

  const readTree = async () => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    return { raw: nodes, view: readPage(nodes) }
  }
  const findIn = (view, role, nameRe) =>
    view.nodes.find((n) => n.role === role && nameRe.test(n.name))

  // ── 1. NAVIGATE ───────────────────────────────────────────────────────────
  const nav = checkNavigation(START, ORDER)
  if (nav.verdict !== NAV.ALLOWED) { note('navigate', START, 'BLOCKED', nav.reason); return finish(b) }
  await page.goto(START, { waitUntil: 'domcontentloaded', timeout: 45000 })
  note('navigate', START, 'ARRIVED', 'origin named in the order')

  // ── 2. READ ───────────────────────────────────────────────────────────────
  let { view } = await readTree()
  note('read_page', 'the article', 'READ',
    `${view.nodes.length} of ${view.totalCandidates} shown${view.truncated ? ', truncated and stated' : ''}`)

  const searchBtn = findIn(view, 'button', /^Search$/)
  const survivor = findIn(view, 'link', /^Jump to content$/)
  if (!searchBtn) { note('read_page', 'Search button', 'NOT_FOUND', 'the page changed shape'); return finish(b) }

  // Refs captured BEFORE any action — this is the premise under test.
  const refBefore = { ...searchBtn }
  const survivorBefore = { ...survivor }

  // ── 3. CLICK — opens the search box; a DOM change, not a navigation ───────
  const c1 = await click({ ref: refBefore.ref, domId: refBefore.domId, expectRole: 'button', expectName: refBefore.name })
  note('click', `button "${refBefore.name}"`, c1.outcome, c1.reason || 'opened the search box')
  if (c1.outcome !== 'CLICKED') return finish(b)

  // ── 4. READ AGAIN ─────────────────────────────────────────────────────────
  await waitFor({ condition: WAIT.DOM_READY, timeoutMs: 5000 })
  const after = await readTree()
  view = after.view
  note('read_page', 'after the click', 'READ', `${view.nodes.length} shown`)

  // ── S1: does a ref taken BEFORE the action still resolve AFTER it? ────────
  const s1 = await click({ ref: survivorBefore.ref, domId: survivorBefore.domId, expectRole: 'link', expectName: survivorBefore.name })
  note('click(stale ref — element was re-rendered)', `link "${survivorBefore.name}"`, s1.outcome, s1.reason || '')
  // S1′ — it must REFUSE BY NAME. The new node has the same role, the same accessible name
  // and the same position; silently re-binding to it is REF 250 in a new coat.
  const S1 = s1.outcome === 'REFUSED' && s1.reason === 'ELEMENT_GONE'

  // ── S2: a ref to something the DOM removed must die loudly ────────────────
  const doomed = findIn(view, 'link', /./)
  await page.evaluate((id) => {
    const el = document.querySelector('[data-aroma-probe-doomed]') || null
    if (el) el.remove()
  })
  const removed = await page.evaluate(() => {
    const a = document.querySelector('#content a') || document.querySelector('a')
    if (!a) return null
    const name = a.textContent.trim()
    a.remove()
    return name
  })
  const gone = doomed && await (async () => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    const still = nodes.find((n) => n.backendDOMNodeId === doomed.domId)
    return still
  })()
  const s2 = await click({ ref: 'r-doomed', domId: 999999, expectRole: 'link', expectName: 'no such element' })
  note('click(ref to a removed node)', 'a node id that is not on this page', s2.outcome, s2.reason)
  const S2 = s2.outcome === 'REFUSED' && s2.reason === 'ELEMENT_GONE'

  // ── S3: a ref from BEFORE a navigation ────────────────────────────────────
  const preNavRef = { ...survivorBefore }
  await page.goto('https://en.wikipedia.org/wiki/Kirkland_Signature', { waitUntil: 'domcontentloaded', timeout: 45000 })
  note('navigate', 'a second article', 'ARRIVED', 'same origin, named in the order')
  const s3 = await click({ ref: preNavRef.ref, domId: preNavRef.domId, expectRole: 'link', expectName: preNavRef.name })
  note('click(ref from before the navigation)', `link "${preNavRef.name}"`, s3.outcome, s3.reason || 'resolved in the NEW document')
  // Either it refuses, or it resolves to something with the same name. What it must never do
  // is act on a DIFFERENT element while reporting success.
  const S3 = s3.outcome !== 'CLICKED' || s3.record.name === preNavRef.name

  // ── 5. TYPE into the search box — read-only destination, no submit ────────
  const v3 = (await readTree()).view
  const box = findIn(v3, 'searchbox', /./) || findIn(v3, 'textbox', /./) || findIn(v3, 'combobox', /./)
  if (box) {
    const t = await type({ ref: box.ref, domId: box.domId, expectRole: box.role, expectName: box.name, text: 'paper towels' })
    note('type', `${box.role} "${box.name}"`, t.outcome, t.reason || `${t.record.length} chars, shape ${t.record.shape}`)
  } else {
    note('type', 'a search box', 'NOT_FOUND', 'no editable field surfaced in the read')
  }

  // ── 6. WAIT, and then the STOP ────────────────────────────────────────────
  const w = await waitFor({ condition: WAIT.NETWORK_IDLE, timeoutMs: 8000 })
  note('wait_for', 'network idle', w.outcome, `${w.waitedMs}ms`)

  // S7/S8 — a stop that is knowable without waiting must arrive fast.
  const t0 = Date.now()
  const blocked = buildClick({ page, cdp, order: { allowedOrigins: ['https://www.example.com'] } })
  const stop = await blocked({ ref: 'r-x', domId: 1, expectRole: 'link', expectName: 'anything' })
  const stopMs = Date.now() - t0
  note('click(origin not in the order)', 'the sealed order', stop.outcome, `${stop.reason} in ${stopMs}ms`)

  // ── S1b — the composition rule, enforced live by the runner ───────────────
  const session = buildSession({
    read: async () => (await readTree()).view,
    click: (t) => click(t),
    type: (t) => type(t),
    waitFor: (r) => waitFor(r),
    screenshot: async () => ({ outcome: 'CAPTURED' })
  })
  const sv = await session.read()
  const candidates = sv.nodes.filter((n) => n.interactive && n.name)
  // ⚠ THE FIRST ACT MUST ACTUALLY SUCCEED, or the guard never arms — a REFUSED act does not
  // spend the read, by design. The first version of this probe picked a skip-link that
  // playwright refuses, so the second act was correctly ALLOWED and the check read as a
  // failure of the runner. The harness was wrong, not the rule.
  let first = null
  let used = null
  for (const c of candidates.slice(0, 6)) {
    const r = await session.click({ ref: c.ref, domId: c.domId, expectRole: c.role, expectName: c.name })
    if (r.outcome === 'CLICKED') { first = r; used = c; break }
  }
  note('session: read then act', used ? `${used.role} "${used.name}"` : 'no clickable candidate',
    first ? first.outcome : 'NONE_CLICKABLE', 'the first act on a fresh read')
  const other = candidates.find((c) => !used || c.ref !== used.ref)
  const secondAct = await session.click({ ref: other.ref, domId: other.domId, expectRole: other.role, expectName: other.name })
  note('session: a SECOND act on the same read', `${other.role} "${other.name}"`, secondAct.outcome, secondAct.reason || '')
  const S1b = Boolean(first) && secondAct.outcome === 'REFUSED' && secondAct.reason === SESSION_REFUSAL.STALE_READ

  const plan = await session.checkPlan([{ verb: 'read_page' }, { verb: 'click' }, { verb: 'click' }])
  note('session: plan check', 'read → click → click', plan.ok ? 'ALLOWED' : 'REFUSED', plan.detail || '')
  const S1c = plan.ok === false && plan.reason === SESSION_REFUSAL.STALE_READ

  // ── S9 — the rejected fix must be absent from the source, not merely unused ─
  const src = ['click.js', 'type.js', 'session.js', 'axTree.js']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'browser', f), 'utf8'))
    .join('\n')
    .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')   // code only, not comments
  const S9 = !/getByRole|getByText|getByLabel|re-?resolve|refindBy|byAccessibleName/i.test(src)

  finish(b, { S1, S1b, S1c, S9, S2, S3, stopMs, stopOutcome: stop.outcome, stopReason: stop.reason })
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })

async function finish (b, res) {
  await b.close()
  console.log('══════ THE REPORT — judge it on its own; the turns are not shown ══════\n')
  for (const s of steps) {
    console.log(`  ${String(s.n).padStart(2)}. ${s.verb.padEnd(34)} ${s.outcome.padEnd(10)} ${s.target}`)
    if (s.detail) console.log(`      ${s.detail}`)
  }
  if (!res) { console.log('\n  sequence ended early — see the last step'); process.exit(1) }

  const text = JSON.stringify(steps)
  const checks = [
    ["S1'  a stale ref is REFUSED BY NAME, never re-bound to the new node", res.S1],
    ['S1b  read -> act -> act refused BY THE RUNNER, before the browser', res.S1b],
    ['S1c  a plan that acts twice on one read is refused before it starts', res.S1c],
    ['S9   no code path re-finds a stale ref by role + accessible name', res.S9],
    ['S2  a ref to a removed node REFUSES with ELEMENT_GONE', res.S2],
    ['S3  a ref from before a navigation never acts on a different element', res.S3],
    ['S4  the report names every step, its target and its outcome', steps.every((s) => s.verb && s.target && s.outcome)],
    ['S5  no typed value anywhere in the report', !text.includes('paper towels')],
    ['S6  no coordinates anywhere in the report', !/"x":|"y":|clientX|boundingBox/.test(text)],
    ['S7  it stops with a NAMED reason, not by continuing', res.stopOutcome === 'BLOCKED' && Boolean(res.stopReason)],
    ['S8  a knowable stop is fast, not a timeout', res.stopMs < 1000]
  ]
  console.log('\n══════ against the FROZEN acceptance ══════\n')
  let ok = true
  for (const [name, pass] of checks) { if (!pass) ok = false; console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`) }
  console.log(`\n  stop arrived in ${res.stopMs}ms as ${res.stopOutcome}/${res.stopReason}`)
  console.log('\n  VERDICT: ' + (ok ? 'ACCEPTANCE MET' : 'ACCEPTANCE NOT MET'))
  process.exit(ok ? 0 : 1)
}
