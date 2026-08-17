'use strict'

/**
 * readStateGuard — CAPABILITY GRAIN.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ A LIVE SOURCE IS NOT A LIVE CAPABILITY.
 *
 * The guard reasoned at SOURCE grain when correcting a CAPABILITY denial. A successful read
 * of `aroma_system.inventory` proves inventory works. It proves NOTHING about sales,
 * attendance, labour cost, prep or food cost — but any live Aroma row authorised the
 * correction 「連接是正常的，權限也是開著的」.
 *
 * Measured in the 30-question benchmark: Q16, 17, 18, 20, 23, 25, 28 and 30 each contained a
 * CORRECT capability-limit statement, and the server appended a contradiction to it. Q28 was
 * otherwise a good answer, spoiled only by this. This is the one defect on the list that was
 * actively destroying correct answers.
 *
 * ⛔ WHICH CAPABILITY THE DENIAL IS ABOUT COMES FROM THE OWNER'S QUESTION, NEVER FROM HER
 * PROSE. The expected operation is derived deterministically through the existing intent
 * table before any model text is considered. Reading her sentence to decide what she claimed
 * would make model output evidence about itself, and would need a phrase list that never
 * ends — the pattern closed repeatedly in this project.
 *
 * ⛔ AND SILENCE IS THE SAFE DIRECTION. A missed correction leaves a wrong sentence on screen;
 * a false correction contradicts a right one with the server's authority behind it. When the
 * intent table yields no operation, the guard has no basis to correct anything.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { enforceReadState, detectFalseReadClaim } = require('./readStateGuard')
const { t } = require('../i18n/t')

/** Production shape: perSource rows carry source, readKey, operation, trust, count. */
const row = (operation, over = {}) => Object.assign({
  source: 'aroma_system',
  readKey: 'aroma_system',
  operation,
  trust: 'live',
  count: 4,
  usedFallback: false,
  error: null
}, over)

const INVOICES = 'aroma_system.invoices'
const INVENTORY = 'aroma_system.inventory'

/* ═══ A — the benchmark defect itself ══════════════════════════════════════ */

test('*** ⛔ A. A SALES DENIAL IS NOT "CORRECTED" BY A LIVE INVENTORY READ ***', () => {
  /**
   * ⛔ VERBATIM FROM THE BENCHMARK. The Owner asked for yesterday's takings; the reply
   * correctly said sales is not connected; inventory had read live; the server contradicted
   * a true sentence. There is no sales operation in the vocabulary, so there is nothing the
   * record can prove here — and the guard must therefore say nothing at all.
   */
  const out = enforceReadState(
    'Aroma System 目前未連接銷售額查詢功能，無法讀取各地點的營業收入紀錄。',
    [row(INVENTORY)],
    '昨天 The Forks 做咗幾多錢？'
  )
  assert.equal(out.corrected, false, '⛔ the server contradicted a CORRECT capability statement')
  assert.equal(out.reply.includes('系統更正'), false, '⛔ a correction was appended to a true sentence')
})

/* ═══ B / C / D — operation grain, in both directions ══════════════════════ */

test('*** ⛔ B. A FALSE INVOICE DENIAL IS STILL CORRECTED WHEN INVOICES READ LIVE ***', () => {
  // The guard must not go quiet everywhere — a denial the record actually disproves is
  // exactly what it exists for.
  const out = enforceReadState(
    '我未連接到發票資料，讀取唔到。',
    [row(INVOICES)],
    '最近有邊啲發票？'
  )
  assert.equal(out.corrected, true, '⛔ a genuinely false denial went uncorrected')
  assert.ok(out.reply.includes('系統更正'), 'the correction is visible and labelled')
})

test('*** ⛔ C. THE SAME FALSE DENIAL IS NOT CORRECTED BY A DIFFERENT OPERATION ***', () => {
  // Inventory being live says nothing about invoices. Today it did.
  const out = enforceReadState(
    '我未連接到發票資料，讀取唔到。',
    [row(INVENTORY)],
    '最近有邊啲發票？'
  )
  assert.equal(out.corrected, false, '⛔ an unrelated operation authorised the correction')
})

test('*** ⛔ D. A SUCCESSFUL EMPTY READ STILL PROVES THE OPERATION EXISTS ***', () => {
  // ⛔ ZERO ROWS IS NOT A MISSING CAPABILITY. The read succeeded; there was simply nothing to
  //    return. `trust` decides this, never the count.
  const out = enforceReadState(
    '發票功能未連接。',
    [row(INVOICES, { count: 0 })],
    '最近有邊啲發票？'
  )
  assert.equal(out.corrected, true, '⛔ an empty but successful read stopped proving the wiring')
})

/* ═══ E — the source itself is still a question one can ask ════════════════ */

test('*** E. "CAN YOU SEE AROMA SYSTEM?" IS STILL ANSWERED BY ANY LIVE AROMA READ ***', () => {
  /**
   * ⛔ THE ONE CASE WHERE SOURCE GRAIN IS THE RIGHT GRAIN. He asked about the connection, not
   * about a business view, so a live read of any operation genuinely disproves 「未連接」.
   * The discriminator is HIS question naming the source — not her reply naming it, which is
   * what the sales replies did.
   */
  const out = enforceReadState(
    '我未連接到 Aroma System。',
    [row(INVENTORY)],
    '你睇唔睇到 Aroma System？'
  )
  assert.equal(out.corrected, true, '⛔ a source-level question lost its source-level proof')
})

/* ═══ G — a live operation cannot answer for an unavailable one ════════════ */

test('*** ⛔ G. A LIVE OPERATION DOES NOT SPEAK FOR AN UNAVAILABLE ONE ***', () => {
  const out = enforceReadState(
    '我讀唔到發票。',
    [row(INVENTORY), row(INVOICES, { trust: 'unavailable', count: 0, error: 'endpoint down' })],
    '最近有邊啲發票？'
  )
  assert.equal(out.corrected, false, '⛔ the invoice denial was TRUE and was contradicted anyway')
})

/* ═══ H — the wording may only assert what was proven ══════════════════════ */

test('*** ⛔ H. THE CORRECTION NO LONGER CLAIMS SOURCE-WIDE PERMISSION ***', () => {
  /**
   * ⛔ THE SENTENCE WAS BIGGER THAN THE EVIDENCE. 「連接是正常的，權限也是開著的」 is a claim
   * about the whole source and about permissions, from a record that proves only that ONE
   * operation returned rows. The correction must state the proven fact and stop there.
   */
  const out = enforceReadState('發票功能未連接。', [row(INVOICES)], '最近有邊啲發票？')
  assert.equal(out.corrected, true)
  assert.equal(/權限也是開著|access is on/.test(out.reply), false,
    '⛔ the correction still asserts permissions, which the read record does not prove')
  assert.ok(out.reply.includes(t('rsg.readCount', { label: '餐廳系統', n: 4 })),
    'it still states the concrete read result from the record')
})

/* ═══ the detector reports the class, and stays silent when unattributable ═ */

test('*** THE CAPABILITY CLASS IS STILL REPORTED WHEN IT FIRES ***', () => {
  const found = detectFalseReadClaim('發票功能未連接。', [row(INVOICES)], '最近有邊啲發票？')
  assert.equal(found.violated, true)
  assert.equal(found.kind, 'capability')
  assert.deepEqual(found.sources, ['aroma_system'])

  const silent = detectFalseReadClaim('銷售功能未連接。', [row(INVENTORY)], '昨天做咗幾多錢？')
  assert.equal(silent.violated, false, '⛔ an unsupported domain must not be attributable at all')
  assert.equal(silent.kind, null)
})
