'use strict'

/**
 * readResultView.test.js — the Owner-facing shape of a read result.
 *
 * The acceptance test is a five-second one: how many items, which source each came from,
 * which need action, what is missing, what the one next step is. On top of that, two rules
 * that are about honesty rather than layout — an email is never labelled with a status it
 * has no concept of, and a status value the map does not know is shown WITH its raw form —
 * and one about relevance: a connector returning data is not a reason to show it.
 *
 * EVERY STRUCTURAL CLAIM IS ASSERTED WITH SEVERAL SOURCES PRESENT. Single-source tests
 * hid the truncation defect twice; a filter is exactly the kind of thing that looks
 * correct until something else is in the list beside it.
 *
 * Pure module: no adapter, no network, no paid call.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildReadResultReply, renderItem, renderSection, renderLimits, selectRelevant,
  splitModelReply, oneQuestion, statusSegment, fieldOf, dayOf, STATUS_LABELS, CAPS
} = require('./readResultView')
const { intentFor, aromaMethodFor, AROMA_INTENTS } = require('../context/readContext')

const NOW = '2026-08-03T12:00:00.000Z'
const invoice = (over = {}) => Object.assign({
  source: 'aroma_system', sourceId: '1', title: 'A-1 Environmental Services Ltd.', originalDate: '2026-07-06',
  content: 'id=1 · status=needs_review · rawVendorName=A-1 Environmental Services Ltd. · total=191.10',
  link: null, trust: 'live', retrievedAt: NOW
}, over)

const mail = (over = {}) => Object.assign({
  source: 'gmail', sourceId: 'm1', title: 'Invoice Report', originalDate: 'Sun, 3 Aug 2026 09:14:02 -0500',
  content: 'a snippet', link: null, trust: 'live', retrievedAt: NOW
}, over)

const other = (source, title) => ({ source, sourceId: source + '-1', title, originalDate: '2026-07-30', content: 'x', trust: 'live', retrievedAt: NOW })

/* ── 1. the intent table is ONE table, and the Aroma six are untouched ─────── */

test('*** the six Aroma routes are byte-identical after the table was extended ***', () => {
  const FROZEN = [
    ['最近有咩發票？', 'listInvoices'], ['發票總數', 'listInvoices'],
    ['recent invoices', 'listInvoices'], ['latest invoice', 'listInvoices'],
    ['採購單去咗邊', 'listPurchaseOrders'], ['訂單狀態', 'listPurchaseOrders'],
    ['open purchase orders', 'listPurchaseOrders'], ['any PO today', 'listPurchaseOrders'],
    ['今日盤點', 'listDailyCounts'], ['點存做咗未', 'listDailyCounts'],
    ['daily count', 'listDailyCounts'], ['stocktake done?', 'listDailyCounts'],
    ['邊個供應商', 'listSuppliers'], ['供貨商電話', 'listSuppliers'],
    ['supplier list', 'listSuppliers'], ['which vendors', 'listSuppliers'],
    ['要訂貨未', 'listOrderPlanning'], ['補貨清單', 'listOrderPlanning'],
    ['order planning', 'listOrderPlanning'], ['what to reorder', 'listOrderPlanning'],
    ['而家倉存入面有咩？', 'listInventory'], ['庫存夠唔夠', 'listInventory'],
    ['存貨點', 'listInventory'], ['what is in inventory', 'listInventory'],
    ['stock level', 'listInventory'],
    // and the no-match default is still inventory
    ['', 'listInventory'], ['今日天氣點', 'listInventory'], ['how are we doing', 'listInventory'],
    ['what is the position', 'listInventory'], ['the point of this', 'listInventory']
  ]
  for (const [msg, method] of FROZEN) assert.equal(aromaMethodFor(msg), method, `"${msg}" must still route to ${method}`)
})

test('a NON-Aroma intent still leaves aromaMethodFor at its unmatched default', () => {
  assert.equal(intentFor('今個星期有咩安排').key, 'schedule')
  assert.equal(aromaMethodFor('今個星期有咩安排'), 'listInventory') // method: null → unchanged behaviour
  assert.equal(AROMA_INTENTS.length, 6)
  for (const i of AROMA_INTENTS) assert.ok(i.method, 'the Aroma subset is exactly the entries that route')
})

test('the appended intents cannot steal a match from the Aroma six', () => {
  // 「發票」 and 「文件」 in one sentence: invoice is earlier in the table and wins.
  assert.equal(intentFor('嗰份文件入面有咩發票？').key, 'invoice')
  assert.equal(intentFor('email me the supplier list').key, 'supplier')
})

/* ── 2. relevance — the defect that prompted this round ───────────────────── */

const INVOICE_TURN = {
  reply: '我睇咗。\n\n### 下一步\n要唔要我開審批？',
  message: '最近有咩發票？',
  itemsBySource: [
    { source: 'drive', items: [other('drive', 'Architecture.md'), other('drive', 'Notes.md')] },
    { source: 'gmail', items: [mail(), mail({ sourceId: 'm2', title: 'TV on sale' })] },
    { source: 'calendar', items: [other('calendar', '眼科覆診')] },
    { source: 'github', items: [other('github', 'fix: typo'), other('github', 'chore: bump')] },
    { source: 'aroma_system', items: [invoice()] }
  ],
  perSource: [
    { source: 'drive', trust: 'live', count: 2, usedFallback: false },
    { source: 'gmail', trust: 'live', count: 2, usedFallback: true }, // recent items, NOT a match
    { source: 'calendar', trust: 'live', count: 1, usedFallback: false },
    { source: 'github', trust: 'live', count: 2, usedFallback: false },
    { source: 'aroma_system', trust: 'live', count: 1, usedFallback: false }
  ],
  truncated: false
}

test('*** an invoice question shows ONLY invoice evidence — five sources in, one out ***', () => {
  const { reply, applied } = buildReadResultReply(INVOICE_TURN)
  assert.equal(applied, true)
  assert.ok(reply.includes('### 餐廳系統'))
  for (const gone of ['### Drive', '### 日曆', '### GitHub', 'Architecture.md', '眼科覆診', 'fix: typo', 'TV on sale']) {
    assert.equal(reply.includes(gone), false, `${gone} is not invoice evidence and must not appear`)
  }
})

test('*** a FALLBACK never reaches the main result, only 資料限制 ***', () => {
  const { reply } = buildReadResultReply(INVOICE_TURN)
  assert.equal(reply.includes('### Gmail'), false, 'gmail was recent-items, not a match')
  assert.ok(reply.includes('Gmail：搵唔到直接相符嘅發票'))
  assert.ok(reply.includes('最近項目 2 項未列出'))
})

test('*** nothing disappears silently — the hidden count is real ***', () => {
  const { reply } = buildReadResultReply(INVOICE_TURN)
  // drive 2 + calendar 1 + github 2 + gmail 2 = 7 retrieved but not shown
  assert.ok(reply.includes('另有 7 項未列出（判斷為與此問題無關）'), reply)
  const { hidden, groups } = selectRelevant(intentFor('最近有咩發票？'), INVOICE_TURN.itemsBySource, INVOICE_TURN.perSource)
  assert.equal(hidden, 7)
  assert.deepEqual(groups.map((g) => g.source), ['aroma_system'])
})

test('an in-scope source found BY SEARCH is shown alongside Aroma System', () => {
  const turn = Object.assign({}, INVOICE_TURN, {
    perSource: INVOICE_TURN.perSource.map((r) => (r.source === 'gmail' ? Object.assign({}, r, { usedFallback: false }) : r))
  })
  const { reply } = buildReadResultReply(turn)
  assert.ok(reply.includes('### Gmail'))
  assert.ok(reply.includes('### 餐廳系統'))
  assert.equal(reply.includes('### Drive'), false) // still out of scope
  assert.ok(reply.includes('另有 5 項未列出'))
})

test('a schedule question shows the calendar and nothing else', () => {
  const { reply, intent } = buildReadResultReply(Object.assign({}, INVOICE_TURN, { message: '今個星期有咩安排？' }))
  assert.equal(intent.key, 'schedule')
  assert.ok(reply.includes('### 日曆'))
  assert.ok(reply.includes('眼科覆診'))
  for (const gone of ['### 餐廳系統', '### Drive', '### GitHub']) assert.equal(reply.includes(gone), false)
})

test('no intent match → the reply passes through completely untouched', () => {
  const original = '好呀,聽日再傾。'
  const r = buildReadResultReply(Object.assign({}, INVOICE_TURN, { message: '你好嗎？', reply: original }))
  assert.equal(r.applied, false)
  assert.equal(r.reply, original)
  assert.equal(r.intent, null)
})

/* ── 3. the summary is generated, and carries no item detail ──────────────── */

test('*** 結果摘要 is one sentence of counts — never item detail ***', () => {
  const { reply } = buildReadResultReply(INVOICE_TURN)
  const summary = reply.split('\n\n')[1]
  assert.equal(summary, '目前確認到餐廳系統 1 張發票。')
  for (const detail of ['191.10', 'A-1 Environmental', '2026-07-06', '需要審批']) {
    assert.equal(summary.includes(detail), false, `the summary must not restate ${detail}`)
  }
  assert.ok(reply.startsWith('### 最近發票')) // the heading is the intent, not 結果摘要
})

test('with nothing relevant the summary says so, and the section list is empty', () => {
  const turn = Object.assign({}, INVOICE_TURN, { itemsBySource: [{ source: 'drive', items: [other('drive', 'x')] }] })
  const { reply } = buildReadResultReply(turn)
  assert.ok(reply.includes('暫時搵唔到同「發票」直接相符嘅記錄。'))
  assert.equal(reply.includes('### 餐廳系統'), false)
  assert.ok(reply.includes('### 下一步'))
})

/* ── 4. dates ─────────────────────────────────────────────────────────────── */

test('*** a complete YYYY-MM-DD, from ISO and from an RFC 5322 mail header ***', () => {
  assert.equal(dayOf('2026-07-06'), '2026-07-06')
  assert.equal(dayOf('2026-07-06T10:00:00Z'), '2026-07-06')
  assert.equal(dayOf('Sun, 3 Aug 2026 09:14:02 -0500'), '2026-08-03') // was "03 Aug 202"
  assert.equal(dayOf('3 Aug 2026'), '2026-08-03')
  assert.equal(dayOf(null), null)
  // unparseable is shown AS IT IS — never sliced into a wrong date
  assert.equal(dayOf('第三季'), '第三季')
})

test('a mail item renders a complete date in a multi-source turn', () => {
  const turn = Object.assign({}, INVOICE_TURN, {
    message: '最近有咩郵件？',
    perSource: INVOICE_TURN.perSource.map((r) => (r.source === 'gmail' ? Object.assign({}, r, { usedFallback: false }) : r))
  })
  const { reply } = buildReadResultReply(turn)
  assert.ok(reply.includes('2026-08-03'))
  assert.equal(/\d{2} [A-Z][a-z]{2} \d{3}(?!\d)/.test(reply), false, 'no truncated date may survive')
})

/* ── 5. status ────────────────────────────────────────────────────────────── */

test('every mapped status renders as its Owner-facing word, and needs_review never leaks', () => {
  for (const [raw, label] of Object.entries(STATUS_LABELS)) {
    assert.ok(renderItem(invoice({ content: `id=1 · status=${raw}` })).includes(label))
  }
  const { reply } = buildReadResultReply(INVOICE_TURN)
  assert.ok(reply.includes('需要審批'))
  assert.equal(reply.includes('needs_review'), false)
})

test('*** an UNMAPPED status is never dropped — 狀態未確認 plus the raw value ***', () => {
  const line = renderItem(invoice({ content: 'id=1 · status=awaiting_credit_note' }))
  assert.ok(line.includes('狀態未確認'))
  assert.ok(line.includes('awaiting_credit_note'))
})

test('*** a source with no status concept gets NO status segment ***', () => {
  const line = renderItem(mail())
  assert.equal(line.includes('狀態未確認'), false)
  for (const label of Object.values(STATUS_LABELS)) assert.equal(line.includes(label), false)
  assert.equal(statusSegment(mail({ content: 'status=approved' })), null)
  assert.equal(statusSegment(invoice({ content: 'ingredient_id=4' })), null) // no status field
})

/* ── 6. item format and length ────────────────────────────────────────────── */

test('an item is two lines and carries no 來源 segment', () => {
  const lines = renderItem(invoice()).split('\n')
  assert.equal(lines.length, 2)
  assert.equal(lines[0], '**A-1 Environmental Services Ltd.**')
  assert.equal(lines[1], '$191.10｜2026-07-06｜需要審批')
  assert.equal(lines[1].includes('來源'), false) // the heading above already says it
})

test('a section is capped at five items and says how many more', () => {
  const items = Array.from({ length: 9 }, (_, i) => invoice({ sourceId: String(i), title: `Item ${i}` }))
  const s = renderSection('aroma_system', items)
  assert.equal((s.match(/^\*\*/gm) || []).length, CAPS.maxItemsPerSection)
  assert.ok(s.includes('另外有 4 項'))
})

test('fieldOf reads the adapter\'s compact form and nothing else', () => {
  assert.equal(fieldOf('a=1 · b=2', 'b'), '2')
  assert.equal(fieldOf('a=1 · b=2', 'c'), null)
  assert.equal(fieldOf('ab=1 · b=2', 'b'), '2') // not a prefix match
})

/* ── 7. exactly one next-step question ────────────────────────────────────── */

test('*** exactly ONE question, and never 「A 定 B」 ***', () => {
  const intent = intentFor('最近有咩發票？')
  assert.equal(oneQuestion('要唔要我開審批？ 定係你自己睇？', intent), '要唔要我開審批？')
  assert.equal(oneQuestion('要我做 A 定 B？', intent), intent.defaultQuestion) // two options in one sentence
  assert.equal(oneQuestion('Shall I do A or B?', intent), intent.defaultQuestion)
  assert.equal(oneQuestion('冇問題喺度', intent), intent.defaultQuestion)
  assert.equal(oneQuestion('', intent), intent.defaultQuestion)
})

test('the rendered reply carries exactly one 下一步 and one question mark line', () => {
  const { reply } = buildReadResultReply(INVOICE_TURN)
  assert.equal((reply.match(/### 下一步/g) || []).length, 1)
  const next = reply.split('### 下一步\n\n')[1]
  assert.equal((next.match(/[？?]/g) || []).length, 1)
})

test('the model reply splits at 下一步, and its prose above is discarded', () => {
  const a = splitModelReply('一堆重覆嘅清單。\n\n### 下一步\n要唔要我開審批？')
  assert.equal(a.next, '要唔要我開審批？')
  const { reply } = buildReadResultReply(Object.assign({}, INVOICE_TURN, {
    reply: '發票有 A-1 $191.10 需要審批,仲有…\n\n### 下一步\n要唔要我開審批？'
  }))
  assert.equal(reply.includes('仲有…'), false, 'the model\'s own restatement never survives')
})

/* ── 8. section ordering and separation ───────────────────────────────────── */

test('*** two sources never share a paragraph, and the order is fixed ***', () => {
  const turn = Object.assign({}, INVOICE_TURN, {
    perSource: INVOICE_TURN.perSource.map((r) => (r.source === 'gmail' ? Object.assign({}, r, { usedFallback: false }) : r))
  })
  const { reply } = buildReadResultReply(turn)
  for (const line of reply.split('\n')) {
    assert.equal(line.includes('### Gmail') && line.includes('### 餐廳系統'), false)
  }
  assert.ok(reply.indexOf('### 最近發票') < reply.indexOf('### Gmail'))
  assert.ok(reply.indexOf('### Gmail') < reply.indexOf('### 資料限制'))
  assert.ok(reply.indexOf('### 資料限制') < reply.indexOf('### 下一步'))
})

test('an unavailable in-scope source is reported, not hidden', () => {
  const l = renderLimits(intentFor('發票'), [{ source: 'aroma_system', trust: 'unavailable', count: 0, error: 'timeout' }], 0, {})
  assert.ok(l.includes('餐廳系統：讀唔到（timeout）'))
})
