'use strict'

/**
 * orderPlanningIntentMatch.test.js — 「今日邊啲貨要補？」 MUST READ SOMETHING.
 *
 * WHAT WAS MEASURED. On 2026-08-24 that exact question routed to CONVERSATION with
 * sources=[] and read nothing. The intent table held 補貨; he TOPICALISED it — object first,
 * verb after — and 貨…要補 matched no token. The date word 今日 was incidental: removing it
 * changed nothing, and keeping it while writing 補貨 worked. So this was never a date defect.
 *
 * ⛔ WHY A LITERAL AND NOT A MECHANISM. The general rule — for a two-character verb-object
 * term XY, also match Y<gap>要X — was built and measured first, because a mechanism is what
 * the separable-compound fix earned. It repairs this phrase and stays clean on 補充 language.
 * It also makes 「今日啲貨要點算？」 match daily_count, because 點貨 inverts to 貨…要點, and 要點
 * is 「how / what to do」, not 「count」 — and daily_count outranks order_planning in the table,
 * so that turn would be hijacked into the wrong read. Contiguity does not save it: 貨要點 has
 * no gap. The phenomenon is real; the vocabulary cannot carry the general rule yet.
 *
 * 要補 alone was measured and rejected too — it fires on 「呢份報告要補充說明」, and
 * order_planning outranks document, so a question about a FILE would have read ordering data.
 *
 * NO MODEL, NO CONNECTOR, NO NETWORK. intentFor and routeTurn are pure.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { intentFor } = require('./readContext')
const { routeTurn } = require('../intake/turnRouter')

/** The exact retained production phrase. Not paraphrased anywhere in this file. */
const MEASURED = '今日邊啲貨要補？'

/* ═══ 1. THE MEASURED PHRASE ═════════════════════════════════════════════ */

test('*** ⛔ 「今日邊啲貨要補？」 IS order_planning AND READS aroma_system ***', () => {
  const i = intentFor(MEASURED)
  assert.ok(i, 'intentFor returned null — the measured defect is back')
  assert.equal(i.key, 'order_planning')
  assert.equal(i.method, 'listOrderPlanning')

  const r = routeTurn(MEASURED, { previousLane: null })
  assert.equal(r.route, 'BUSINESS_QUERY', 'got ' + r.route + ' / ' + r.reason)
  assert.equal(r.reason, 'intent_order_planning')
  assert.deepEqual(r.sources, ['aroma_system'], 'a business question that reads nothing is the whole defect')
})

/* ═══ 2. THE DATE WORD WAS NEVER THE CAUSE — pinned so the story survives ═ */

test('the ablation that proved this is not a date defect', () => {
  // Recorded in the Phase 0 forensic: neither direction depends on 今日.
  assert.equal(routeTurn('邊啲貨要補？').route, 'BUSINESS_QUERY', 'without the date word')
  assert.equal(routeTurn('今日邊啲貨要補貨？').route, 'BUSINESS_QUERY', 'with the date word')
})

/* ═══ 3. DATE / UTILITY NON-REGRESSION — the anchor was NOT touched ══════ */

test('*** ⛔ 「今日幾月幾號」 IS STILL A UTILITY DATE QUESTION ***', () => {
  const r = routeTurn('今日幾月幾號')
  assert.equal(r.route, 'UTILITY')
  assert.equal(r.reason, 'utility_date')
  assert.deepEqual(r.sources, [], 'UTILITY reads nothing, ever')
})

test('*** ⛔ 「今日張發票幾號到期」 IS STILL A BUSINESS QUESTION ***', () => {
  // The {0,2} anchor's own counter-example. If a widening ever swallows this, a real invoice
  // question becomes a clock answer — the exact defect the anchor was tightened to prevent.
  const r = routeTurn('今日張發票幾號到期')
  assert.equal(r.route, 'BUSINESS_QUERY')
  assert.equal(r.reason, 'intent_invoice')
  assert.deepEqual(r.sources, ['aroma_system'])
})

/* ═══ 4. EXISTING ORDER-PLANNING FORMS — the separable matcher is intact ══ */

test('*** ⛔ 訂貨 AND THE SEPARABLE 訂什麼貨 BOTH STILL MATCH ***', () => {
  for (const m of ['訂貨', '訂什麼貨', '補貨', '落單', '叫貨']) {
    const i = intentFor(m)
    assert.ok(i && i.key === 'order_planning', '⛔ lost an existing form: ' + m)
  }
  assert.equal(routeTurn('訂什麼貨').reason, 'intent_order_planning', 'CJK_GAP must not be replaced')
})

/* ═══ 5. ADVERSARIAL — SUPPLEMENTING A DOCUMENT IS NOT ORDERING STOCK ════ */

test('*** ⛔ 補充-STYLE LANGUAGE MUST NEVER BECOME order_planning ***', () => {
  // Synthetic on purpose — these are adversarial probes, not production evidence.
  // Each one HITS a naive 要補 substring/separable implementation. order_planning sits above
  // document in the table, so a false hit here sends a FILE question to the restaurant's
  // ordering data — a wrong connector, not merely a wrong answer.
  const notOrdering = [
    '呢份報告要補充說明',
    '需要補多啲背景',
    '份 spec 要補一段',
    '我要補返個假期申請',
    '幫我喺份文件度補充多啲資料',
    '呢段要補充完整先發出去'
  ]
  for (const m of notOrdering) {
    const i = intentFor(m)
    assert.notEqual(i && i.key, 'order_planning', '⛔ FALSE POSITIVE on: ' + m)
  }
})

test('*** ⛔ THE REJECTED MECHANISM STAYS REJECTED — 貨要點 is not a stock count ***', () => {
  // 「啲貨要點算？」 asks what to DO about the goods. The inverted-compound mechanism would
  // read 點貨 out of it and run a daily-count read. Pinned so nobody re-adds that rule blind.
  for (const m of ['今日啲貨要點算？', '啲貨要點處理好']) {
    const i = intentFor(m)
    assert.notEqual(i && i.key, 'daily_count', '⛔ the inverted-compound mechanism came back: ' + m)
    assert.notEqual(i && i.key, 'order_planning', '⛔ and it must not land here either: ' + m)
  }
})

/* ═══ 6. NO WRITE / ACTION AUTHORITY WAS WIDENED ═════════════════════════ */

test('*** ⛔ A READ INTENT GRANTS NO ACTION AUTHORITY ***', () => {
  // order_planning names a READ method and one read source. Nothing here can dispatch.
  const i = intentFor(MEASURED)
  assert.equal(i.method, 'listOrderPlanning', 'a list method — never a write')
  assert.deepEqual(i.sources, ['aroma_system'])
  assert.equal(routeTurn(MEASURED).route !== 'ACTION', true, 'a read question must not become ACTION')
})

/* ═══ 7. ONE VOCABULARY OWNER — no private list may appear downstream ════ */

test('*** ⛔ THE ORDER-PLANNING WORDS LIVE IN readContext AND NOWHERE ELSE ***', () => {
  const fs = require('fs')
  const path = require('path')
  const owned = ['訂貨', '補貨', '落單', '叫貨', '貨要補']
  const mustNotHold = [
    '../intake/turnRouter.js',
    '../intake/routeEvidenceGuard.js',
    '../intake/readStateGuard.js',
    '../intake/utilityAnswer.js'
  ]
  for (const rel of mustNotHold) {
    const file = path.join(__dirname, rel)
    // Strip comments: prose may DISCUSS a word; only executable text may not CARRY it.
    const code = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    for (const w of owned) {
      assert.equal(code.includes(w), false,
        '⛔ ' + path.basename(file) + ' grew its own copy of 「' + w + '」 — one vocabulary per concept')
    }
  }
})
