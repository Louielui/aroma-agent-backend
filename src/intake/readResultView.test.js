'use strict'

/**
 * readResultView.test.js — the Owner-facing shape of a read result.
 *
 * The acceptance test the Owner set is a five-second one: how many items, which source
 * each came from, which need action, what is missing, what the one next step is. These
 * assert exactly that, plus the two rules that are about honesty rather than layout:
 * an email is never labelled with a status it has no concept of, and a status value the
 * map does not know is shown WITH its raw form rather than quietly dropped.
 *
 * Pure module: no adapter, no network, no paid call.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildReadResultReply, renderItem, renderSection, renderLimits, splitModelReply,
  statusSegment, fieldOf, STATUS_LABELS, CAPS
} = require('./readResultView')

const NOW = '2026-08-03T12:00:00.000Z'
const item = (over = {}) => Object.assign({
  source: 'aroma_system', sourceId: '1', title: 'Miller\'s Meats', originalDate: '2026-08-03',
  content: 'id=1 · status=needs_review · rawVendorName=Miller\'s Meats · invoiceNumber=74284 · total=461.30',
  link: null, trust: 'live', retrievedAt: NOW
}, over)

const mail = (over = {}) => Object.assign({
  source: 'gmail', sourceId: 'm1', title: '供應商回覆', originalDate: '2026-08-02',
  content: 'from=someone · subject=re: order', link: null, trust: 'live', retrievedAt: NOW
}, over)

/* ── the per-item line ────────────────────────────────────────────────────── */

test('an item renders as at most two lines, in the Owner\'s format', () => {
  const lines = renderItem(item()).split('\n')
  assert.equal(lines.length, 2)
  assert.equal(lines[0], '**Miller\'s Meats — #74284**')
  assert.equal(lines[1], '$461.30｜2026-08-03｜需要審批｜來源：餐廳系統')
})

test('every mapped status renders as its Owner-facing word', () => {
  for (const [raw, label] of Object.entries(STATUS_LABELS)) {
    const line = renderItem(item({ content: `id=1 · status=${raw}` }))
    assert.ok(line.includes(label), `${raw} must render as ${label}`)
  }
})

test('*** an UNMAPPED status is never dropped — it shows 狀態未確認 plus the raw value ***', () => {
  const line = renderItem(item({ content: 'id=1 · status=awaiting_credit_note' }))
  assert.ok(line.includes('狀態未確認'))
  assert.ok(line.includes('awaiting_credit_note'), 'the raw value must survive')
})

test('*** a source with no status concept gets NO status segment ***', () => {
  const line = renderItem(mail())
  assert.equal(line.includes('狀態未確認'), false, 'an email is not a record with an unknown status')
  for (const label of Object.values(STATUS_LABELS)) assert.equal(line.includes(label), false)
  assert.ok(line.includes('來源：Gmail'))
  // even if the mail body happens to contain the word status
  assert.equal(statusSegment(mail({ content: 'status=approved' })), null)
})

test('an aroma_system row with no status field gets no status segment either', () => {
  assert.equal(statusSegment(item({ content: 'ingredient_id=4 · ingredient_name=z' })), null)
})

test('a missing date says 冇日期 and is never invented', () => {
  const line = renderItem(item({ originalDate: null }))
  assert.ok(line.includes('冇日期'))
  assert.equal(/20\d\d-\d\d-\d\d/.test(line), false)
})

test('an absent amount or identifier is omitted, not filled in', () => {
  const line = renderItem(item({ content: 'id=9 · status=sent' }))
  assert.equal(line.includes('$'), false)
  assert.equal(line.includes('#'), false)
  assert.ok(line.includes('已發送'))
})

test('fieldOf reads the adapter\'s compact form and nothing else', () => {
  assert.equal(fieldOf('a=1 · b=2', 'b'), '2')
  assert.equal(fieldOf('a=1 · b=2', 'c'), null)
  assert.equal(fieldOf('', 'a'), null)
  assert.equal(fieldOf('ab=1 · b=2', 'b'), '2') // not a prefix match
})

/* ── sections and length ──────────────────────────────────────────────────── */

test('a section is capped at five items and says how many more there are', () => {
  const items = Array.from({ length: 9 }, (_, i) => item({ sourceId: String(i), title: `Item ${i}` }))
  const s = renderSection('aroma_system', items)
  assert.equal((s.match(/^\*\*/gm) || []).length, CAPS.maxItemsPerSection)
  assert.ok(s.includes('另外有 4 項'))
  assert.ok(s.startsWith('### 餐廳系統'))
})

test('資料限制 lists only what failed, and is omitted when nothing did', () => {
  assert.equal(renderLimits([{ source: 'gmail', trust: 'live', count: 4, usedFallback: false }]), null)
  const l = renderLimits([
    { source: 'gmail', trust: 'live', count: 4, usedFallback: true },
    { source: 'drive', trust: 'unavailable', count: 0, error: 'timeout' },
    { source: 'aroma_system', trust: 'live', count: 0, usedFallback: false }
  ], { truncated: true })
  assert.ok(l.includes('Gmail：搵唔到直接相符'))
  assert.ok(l.includes('Drive：讀唔到（timeout）'))
  assert.ok(l.includes('餐廳系統：讀到，但冇相關結果'))
  assert.ok(l.includes('部分項目因長度上限未顯示'))
})

test('the model reply splits at 下一步 so the sections land in between', () => {
  const a = splitModelReply('搵到兩張發票。\n\n### 下一步\n要唔要我開審批？')
  assert.equal(a.summary, '搵到兩張發票。')
  assert.equal(a.next, '要唔要我開審批？')
  const b = splitModelReply('冇標題嘅回覆')
  assert.equal(b.summary, '冇標題嘅回覆')
  assert.equal(b.next, null)
})

/* ── THE MULTI-SOURCE PATH — mandatory ────────────────────────────────────── */
// Single-source tests hid the truncation defect twice. Every structural claim below is
// asserted with several sources present at once.

const FIVE_SOURCE_TURN = {
  reply: '搵到 3 項,其中一張發票等緊審批。\n\n### 下一步\n要唔要我而家開審批？',
  itemsBySource: [
    { source: 'gmail', items: [mail(), mail({ sourceId: 'm2', title: '送貨通知' })] },
    { source: 'drive', items: [{ source: 'drive', sourceId: 'd1', title: '成本表.xlsx', originalDate: '2026-07-30', content: 'name=成本表.xlsx', trust: 'live' }] },
    { source: 'aroma_system', items: [item()] }
  ],
  perSource: [
    { source: 'gmail', trust: 'live', count: 2, usedFallback: false },
    { source: 'drive', trust: 'live', count: 1, usedFallback: false },
    { source: 'calendar', trust: 'unavailable', count: 0, error: 'timeout' },
    { source: 'aroma_system', trust: 'live', count: 1, usedFallback: false }
  ],
  truncated: false
}

test('*** Gmail and Aroma System NEVER share a paragraph ***', () => {
  const { reply } = buildReadResultReply(FIVE_SOURCE_TURN)
  const gmailAt = reply.indexOf('### Gmail')
  const aromaAt = reply.indexOf('### 餐廳系統')
  assert.ok(gmailAt > -1 && aromaAt > -1, 'both sources must have their own section')
  const between = reply.slice(Math.min(gmailAt, aromaAt), Math.max(gmailAt, aromaAt))
  assert.ok(between.includes('\n\n'), 'the sections are separate blocks')
  // no line carries two sources
  for (const line of reply.split('\n')) {
    assert.equal(line.includes('來源：Gmail') && line.includes('來源：餐廳系統'), false)
  }
})

test('*** the five-second test: counts, sources, action, gaps, one next step ***', () => {
  const { reply, applied } = buildReadResultReply(FIVE_SOURCE_TURN)
  assert.equal(applied, true)
  assert.ok(reply.includes('### 結果摘要'))          // (1) how many
  assert.ok(reply.includes('搵到 3 項'))
  for (const s of ['### Gmail', '### Drive', '### 餐廳系統']) assert.ok(reply.includes(s)) // (2) which source
  assert.ok(reply.includes('需要審批'))               // (3) what needs action
  assert.ok(reply.includes('### 資料限制'))           // (4) what is missing
  assert.ok(reply.includes('日曆：讀唔到'))
  assert.ok(reply.includes('### 下一步'))             // (5) the one next step
  assert.equal((reply.match(/### 下一步/g) || []).length, 1)
  // order: summary → sections → limits → next step
  assert.ok(reply.indexOf('### 結果摘要') < reply.indexOf('### Gmail'))
  assert.ok(reply.indexOf('### Gmail') < reply.indexOf('### 資料限制'))
  assert.ok(reply.indexOf('### 資料限制') < reply.indexOf('### 下一步'))
})

test('a source that returned nothing gets no empty section', () => {
  const { reply } = buildReadResultReply(Object.assign({}, FIVE_SOURCE_TURN, {
    itemsBySource: FIVE_SOURCE_TURN.itemsBySource.concat([{ source: 'github', items: [] }])
  }))
  assert.equal(reply.includes('### GitHub'), false)
})

test('nothing retrieved → the reply passes through completely untouched', () => {
  const original = '我而家讀唔到餐廳系統。'
  const r = buildReadResultReply({ reply: original, itemsBySource: [], perSource: [], truncated: false })
  assert.equal(r.applied, false)
  assert.equal(r.reply, original) // presentation never manufactures a result
})

test('a model reply with no 下一步 heading still keeps every item', () => {
  const r = buildReadResultReply(Object.assign({}, FIVE_SOURCE_TURN, { reply: '搵到幾項。' }))
  assert.ok(r.reply.includes('### Gmail'))
  assert.ok(r.reply.includes('### 餐廳系統'))
  assert.ok(r.reply.includes('Miller\'s Meats'))
  assert.equal(r.reply.includes('### 下一步'), false) // never invented
})

test('every section stays short — no wall of text', () => {
  const many = Array.from({ length: 20 }, (_, i) => item({ sourceId: String(i), title: `T${i}` }))
  const { reply } = buildReadResultReply({
    reply: '摘要。\n\n### 下一步\n一個問題？',
    itemsBySource: [{ source: 'aroma_system', items: many }, { source: 'gmail', items: many.map((x) => Object.assign({}, x, { source: 'gmail' })) }],
    perSource: [{ source: 'aroma_system', trust: 'live', count: 20 }, { source: 'gmail', trust: 'live', count: 20 }],
    truncated: false
  })
  assert.equal((reply.match(/^\*\*/gm) || []).length, CAPS.maxItemsPerSection * 2)
  assert.equal((reply.match(/另外有 15 項/g) || []).length, 2)
})
