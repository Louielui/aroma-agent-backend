'use strict'

/**
 * enquiryStore.test.js — the turns are kept, and are read only when he asks.
 *
 * > **Owner: 「I want to see the turns, not just the report, when I ask. Not by default —
 * > that would recreate the relay — but a way to open one investigation and read what
 * > actually happened. The report is what I read normally; the turns are what I check when
 * > the report surprises me.」**
 *
 * So: stored always, surfaced never, retrievable by id.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const { createEnquiryStore } = require('./enquiryStore')

function tmpStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enq-'))
  return createEnquiryStore({ dir })
}

const sample = {
  enquiryId: 'enq_abc12345',
  question: '訂貨建議少咗 18 樣',
  report: { outcome: 'CONCLUDED', text: '唔係缺陷。', rounds: 2, costUsd: 0.24 },
  turns: [
    { goal: '查 order-planning', result: 'count 43', costUsd: 0.11, sessionId: 's1', startedAt: 'a', finishedAt: 'b' },
    { goal: '查 view 定義', result: '199 rows', costUsd: 0.13, sessionId: 's1', startedAt: 'c', finishedAt: 'd' }
  ]
}

describe('storing and opening one enquiry', () => {
  test('an enquiry can be saved and reopened whole', () => {
    const s = tmpStore()
    s.save(sample)
    const got = s.get('enq_abc12345')
    assert.strictEqual(got.question, sample.question)
    assert.strictEqual(got.turns.length, 2)
    assert.strictEqual(got.turns[1].result, '199 rows')
  })

  test('the LIST is reports only — opening the turns is a second, deliberate step', () => {
    const s = tmpStore()
    s.save(sample)
    const list = s.list()
    assert.strictEqual(list.length, 1)
    assert.ok(list[0].enquiryId && list[0].report)
    assert.strictEqual(list[0].turns, undefined,
      'listing the turns by default would recreate exactly the relay this removes')
  })

  test('an unknown id returns null rather than an empty enquiry', () => {
    const s = tmpStore()
    assert.strictEqual(s.get('enq_nope'), null,
      'an empty enquiry object would read as "it ran and found nothing"')
  })

  test('a malformed id cannot become a file path', () => {
    const s = tmpStore()
    for (const bad of ['../escape', 'a/b', 'a\\b', '']) {
      assert.strictEqual(s.get(bad), null)
      assert.throws(() => s.save({ ...sample, enquiryId: bad }))
    }
  })

  test('newest first, so the one he just ran is the one he opens', () => {
    const s = tmpStore()
    s.save({ ...sample, enquiryId: 'enq_old00001', savedAt: '2026-08-01T00:00:00.000Z' })
    s.save({ ...sample, enquiryId: 'enq_new00001', savedAt: '2026-08-06T00:00:00.000Z' })
    assert.strictEqual(s.list()[0].enquiryId, 'enq_new00001')
  })
})

describe('what the stored record must and must not carry', () => {
  test('every turn keeps its cost, so a surprising report can be priced', () => {
    const s = tmpStore()
    s.save(sample)
    const got = s.get('enq_abc12345')
    assert.strictEqual(got.turns.reduce((n, t) => n + t.costUsd, 0).toFixed(2), '0.24')
  })

  test('the store writes no approval or authorisation field', () => {
    const s = tmpStore()
    s.save(sample)
    const got = s.get('enq_abc12345')
    assert.ok(!('approved' in got) && !('authorised' in got),
      'a record of what was investigated is history, never permission')
  })
})
