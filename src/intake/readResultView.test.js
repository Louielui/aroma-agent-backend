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
const { CATALOGUE } = require('../i18n/catalogue')
const assert = require('node:assert/strict')

const {
  buildReadResultReply, renderItem, renderSection, renderLimits, selectRelevant,
  splitModelReply, oneQuestion, statusSegment, fieldOf, dayOf, extractOpinion, sanitizeOpinion, STATUS_LABELS, CAPS
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
    // The five no-match entries that used to sit here are GONE — they asserted the
    // inventory default, which was deleted 2026-08-04. The SIX real routes above are the
    // byte-identical guarantee, and they are untouched. See noIntentNoRead.test.js.
  ]
  for (const [msg, method] of FROZEN) assert.equal(aromaMethodFor(msg), method, `"${msg}" must still route to ${method}`)
})

test('*** a NON-Aroma intent asks Aroma System for NOTHING ***', () => {
  // INVERTED. A calendar question used to fall through method:null to listInventory, so
  // 「今個星期有咩安排」 read stock levels. It now asks the restaurant system for nothing.
  assert.equal(intentFor('今個星期有咩安排').key, 'schedule')
  assert.equal(aromaMethodFor('今個星期有咩安排'), null)
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

test('*** a FALLBACK never reaches the main result — and Gmail is now wholly out of scope ***', () => {
  // NARROWED 2026-08-04 by the Owner's ruling: an intent may name at most the ONE source
  // that authoritatively holds the entity, so invoice no longer names gmail. The render
  // layer reads the SAME intent.sources as the read layer, so Gmail is not merely unread —
  // it cannot be SHOWN for an invoice question even if rows for it arrived. This test used
  // to assert its per-source fallback note appeared under 資料限制; that note is gone with
  // the source, and the rows it stood for are still counted as hidden below.
  const { reply } = buildReadResultReply(INVOICE_TURN)
  assert.equal(reply.includes('### Gmail'), false, 'not a section')
  assert.equal(reply.includes('Gmail'), false, 'and not a 資料限制 line either: ' + reply)
})

test('*** nothing disappears silently — the hidden count is real ***', () => {
  const { reply } = buildReadResultReply(INVOICE_TURN)
  // drive 2 + calendar 1 + github 2 + gmail 2 = 7 retrieved but not shown
  assert.ok(reply.includes('另有 7 項未列出（判斷為與此問題無關）'), reply)
  const { hidden, groups } = selectRelevant(intentFor('最近有咩發票？'), INVOICE_TURN.itemsBySource, INVOICE_TURN.perSource)
  assert.equal(hidden, 7)
  assert.deepEqual(groups.map((g) => g.source), ['aroma_system'])
})

test('*** INVERTED: Gmail is NOT shown for an invoice question, even when it matched by search ***', () => {
  // This asserted the opposite while invoice named gmail as a second source. The Owner's
  // ruling is that a declared source is a hint about where an answer might live, never an
  // authorisation — and an invoice report EMAIL is not the invoice RECORD. So even a
  // genuine keyword match in mail stays out of an invoice answer.
  const turn = Object.assign({}, INVOICE_TURN, {
    perSource: INVOICE_TURN.perSource.map((r) => (r.source === 'gmail' ? Object.assign({}, r, { usedFallback: false }) : r))
  })
  const { reply } = buildReadResultReply(turn)
  assert.equal(reply.includes('### Gmail'), false, 'the ruling, at the render layer')
  assert.ok(reply.includes('### 餐廳系統'), 'the authoritative source still answers')
  assert.equal(reply.includes('### Drive'), false)
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
  // CONVERTED: which statement, with the noun as a slot.
  assert.ok(reply.includes(CATALOGUE['rrv.noDirectMatch'].zh.replace('{noun}', '發票')), reply)
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
    // STATUS_LABELS holds thunks now — a key string there would be a dynamic key (HR-48).
    assert.ok(renderItem(invoice({ content: `id=1 · status=${raw}` })).includes(label()))
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

test('*** each source keeps its own paragraph, and the order is fixed ***', () => {
  // A TWO-SOURCE ANSWER CANNOT CURRENTLY ARISE: every intent names exactly one source
  // after the 2026-08-04 ruling. The separation and ordering logic is still worth pinning
  // for the day one legitimately names two, so this asserts the single-source shape and
  // that no heading is ever concatenated onto another line.
  const turn = Object.assign({}, INVOICE_TURN, {
    perSource: INVOICE_TURN.perSource.map((r) => (r.source === 'gmail' ? Object.assign({}, r, { usedFallback: false }) : r))
  })
  const { reply } = buildReadResultReply(turn)
  for (const line of reply.split('\n')) {
    assert.equal((line.match(/###/g) || []).length > 1, false, 'one heading per line: ' + line)
  }
  assert.ok(reply.indexOf('### 最近發票') >= 0, 'the in-scope section is rendered')
  assert.ok(reply.indexOf('### Gmail') < reply.indexOf('### 資料限制'))
  assert.ok(reply.indexOf('### 資料限制') < reply.indexOf('### 下一步'))
})

test('an unavailable in-scope source is reported, not hidden', () => {
  const l = renderLimits(intentFor('發票'), [{ source: 'aroma_system', trust: 'unavailable', count: 0, error: 'timeout' }], 0, {})
  // CONVERTED: which statement, and both languages must keep 「could not be READ」 apart from
  // 「read and found nothing」 — the distinction this whole file exists for.
  assert.ok(l.includes(CATALOGUE['rrv.sourceUnreadable'].zh.split('{')[0]) || /讀不到/.test(l), l)
  assert.match(CATALOGUE['rrv.sourceUnreadable'].en, /could not be read/i)
  assert.match(CATALOGUE['rrv.sourceEmpty'].en, /read successfully/i, 'and the opposite claim stays opposite')
})

/* ── 9. 香香睇法 — her judgement, without the numbers ──────────────────────── */
// A rendered table cannot say "this one has been sitting a month". She gets one short
// section for that, after the data and before the question. The numbers stay the
// server's: any sentence carrying a digit is either restating what is already rendered
// or inventing something, and both are dropped.

const withOpinion = (text) => Object.assign({}, INVOICE_TURN, {
  reply: `### 香香睇法\n${text}\n\n### 下一步\n要唔要我開審批？`
})

test('*** her section lands AFTER the data and BEFORE 下一步 ***', () => {
  const { reply } = buildReadResultReply(withOpinion('呢張拖咗成個月,值得先處理。'))
  assert.ok(reply.includes('### 香香睇法'))
  assert.ok(reply.includes('呢張拖咗成個月,值得先處理。'))
  assert.ok(reply.indexOf('### 餐廳系統') < reply.indexOf('### 香香睇法'))
  assert.ok(reply.indexOf('### 資料限制') < reply.indexOf('### 香香睇法'))
  assert.ok(reply.indexOf('### 香香睇法') < reply.indexOf('### 下一步'))
})

test('*** a sentence carrying a number is dropped — the server owns the figures ***', () => {
  for (const bad of ['佢欠 $191.10。', '單號 #74284 嗰張要跟。', '2026-07-06 嗰張最舊。', '總共有 13 項未處理。']) {
    assert.equal(sanitizeOpinion(bad), null, `must drop: ${bad}`)
  }
  // a mixed paragraph keeps only the digit-free judgement
  assert.equal(sanitizeOpinion('呢間供應商成日遲。佢欠 $191.10。'), '呢間供應商成日遲。')
})

test('nothing worth saying → the section is omitted, never padded', () => {
  assert.equal(sanitizeOpinion(''), null)
  assert.equal(sanitizeOpinion('   \n  '), null)
  assert.equal(extractOpinion('### 下一步\n要唔要我開審批？'), null) // she wrote no such section
  const { reply } = buildReadResultReply(withOpinion('$100 全部都係數字。'))
  assert.equal(reply.includes('### 香香睇法'), false)
  assert.ok(reply.includes('### 下一步')) // the rest is unaffected
})

test('at most three sentences survive', () => {
  const five = '一。二。三。四。五。'
  assert.equal(sanitizeOpinion(five), '一。二。三。')
  const { reply } = buildReadResultReply(withOpinion(five))
  const sec = reply.split('### 香香睇法\n\n')[1].split('\n\n')[0]
  assert.equal((sec.match(/。/g) || []).length, 3)
})

test('her section is bounded by the next heading, not by the end of the reply', () => {
  const r = buildReadResultReply(Object.assign({}, INVOICE_TURN, {
    reply: '### 香香睇法\n值得留意。\n\n### 下一步\n要唔要我開審批？'
  }))
  const sec = r.reply.split('### 香香睇法\n\n')[1].split('\n\n')[0]
  assert.equal(sec, '值得留意。')
  assert.equal(sec.includes('要唔要'), false) // the question did not bleed into her section
})

// The premise "multi-source" no longer arises (one source per intent, 2026-08-04 ruling),
// but the substance — no digit and no item detail may appear in her own section — is
// unchanged and is what this actually tests.
test('*** her words never carry item detail ***', () => {
  const turn = Object.assign({}, withOpinion('有一批舊嘅未清,建議今個星期掃一次。'), {
    perSource: INVOICE_TURN.perSource.map((r) => (r.source === 'gmail' ? Object.assign({}, r, { usedFallback: false }) : r))
  })
  const { reply } = buildReadResultReply(turn)
  const sec = reply.split('### 香香睇法\n\n')[1].split('\n\n')[0]
  assert.equal(/\d/.test(sec), false, 'no digit may appear in her section')
  for (const detail of ['191.10', '#74284', '2026-07-06']) assert.equal(sec.includes(detail), false)
  // and the rendered data above is untouched by her presence
  assert.ok(reply.includes('$191.10｜2026-07-06｜需要審批'))
  // Gmail is out of scope for an invoice question since the 2026-08-04 ruling; the point of
  // this line is that the DATA above her section is untouched by her presence, which the
  // authoritative source alone demonstrates.
  assert.ok(reply.includes('### 餐廳系統'))
  assert.equal(reply.includes('### Gmail'), false)
})
