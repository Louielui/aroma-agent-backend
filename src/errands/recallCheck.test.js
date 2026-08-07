'use strict'
/**
 * recallCheck.test.js — ERRAND-003 as a thing that RETURNS an outcome instead of printing one.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL.
 *
 * `scripts/errandRecallCheck.js` works — it is the only errand that has ever produced a real
 * answer. But it `console.log`s its result and calls `process.exit(0)`. **An errand that prints
 * cannot be recorded**, so 首頁 said 「未有差事紀錄」 while an errand was running fine.
 *
 * The body moves here so there is ONE copy, and it returns `{outcome, answer|detail|stop}` —
 * the exact shape `runErrand` records and 首頁 renders.
 *
 * ⛔ THE SEAM THIS TESTS: a STOP must come back in a shape `errandStore` will ACCEPT.
 * The store refuses a stop with no report. If the errand builds a half stop, the runner
 * downgrades it to BLOCKED_BY_SITE and the Owner is told a site blocked her — when in truth
 * SHE stopped, for him, at a control she would not press. Those must never merge.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { checkRecall } = require('./recallCheck')
const { openErrandStore, OUTCOME } = require('../home/errandStore')
const { runErrand } = require('../home/errandRunner')

const SEARCH_BOX = { ref: 'r1', domId: 1, role: 'searchbox', name: 'Search', interactive: true }
const SEARCH_BTN = { ref: 'r2', domId: 2, role: 'button', name: 'Search', interactive: true }
const HIT = { ref: 'r3', domId: 3, role: 'link', name: 'Sliced mushrooms recalled due to Listeria contamination', interactive: true }
const DATE = { ref: 'r4', domId: 4, role: 'text', name: 'Food | 2026-08-01', interactive: false }

/** A session that behaves; each call to read() returns the next view. */
function fakeSession (views, over) {
  let i = 0
  return Object.assign({
    read: async () => ({ nodes: views[Math.min(i++, views.length - 1)], totalCandidates: 99 }),
    type: async () => ({ outcome: 'TYPED', record: { length: 9, shape: 'plain' } }),
    click: async () => ({ outcome: 'CLICKED', record: { role: 'button', name: 'Search', ref: 'r2' } }),
    waitFor: async () => ({ outcome: 'HAPPENED' })
  }, over || {})
}
const goto = async () => ({ ok: true })

describe('it answers, and the answer is a value rather than a log line', () => {
  test('recalls found → ANSWERED, carrying the title and the date', async () => {
    const r = await checkRecall({
      session: fakeSession([[SEARCH_BOX], [SEARCH_BOX, SEARCH_BTN], [HIT, DATE]]),
      goto,
      query: 'mushrooms'
    })
    assert.strictEqual(r.outcome, 'ANSWERED')
    assert.match(r.answer, /2026-08-01/, 'the date is the part he acts on')
    assert.match(r.answer, /[Ll]isteria|mushroom/, 'and the title says what it was')
  })

  test('⛔ nothing found is an ANSWER, not a blank — but only after a real search', async () => {
    const r = await checkRecall({
      session: fakeSession([[SEARCH_BOX], [SEARCH_BOX, SEARCH_BTN], [{ ref: 'r9', domId: 9, role: 'text', name: 'No results', interactive: false }]]),
      goto,
      query: 'mushrooms'
    })
    assert.strictEqual(r.outcome, 'ANSWERED')
    assert.match(r.answer, /冇/, '「冇回收」 is the good news, and it is still news')
    assert.ok(!/undefined|null/.test(r.answer))
  })

  test('the query reaches the page — an answer about the wrong ingredient is worse than none', async () => {
    let typed = null
    await checkRecall({
      session: fakeSession([[SEARCH_BOX], [SEARCH_BOX, SEARCH_BTN], [HIT, DATE]], {
        type: async (req) => { typed = req.text; return { outcome: 'TYPED', record: { length: 5, shape: 'plain' } } }
      }),
      goto,
      query: 'chicken'
    })
    assert.strictEqual(typed, 'chicken')
  })
})

describe('⛔ the three outcomes stay apart', () => {
  test('a login wall is BLOCKED_BY_SITE and says so — she never types a credential', async () => {
    const r = await checkRecall({
      session: fakeSession([[{ ref: 'r5', domId: 5, role: 'textbox', name: 'Password', interactive: true }]]),
      goto,
      query: 'mushrooms'
    })
    assert.strictEqual(r.outcome, 'BLOCKED_BY_SITE')
    assert.match(r.detail, /登入|password/i)
  })

  test('no search box is BLOCKED_BY_SITE, never a quiet 「冇回收」', async () => {
    const r = await checkRecall({ session: fakeSession([[{ ref: 'r6', domId: 6, role: 'text', name: 'hello', interactive: false }]]), goto, query: 'mushrooms' })
    assert.strictEqual(r.outcome, 'BLOCKED_BY_SITE')
    assert.doesNotMatch(r.detail || '', /冇搵到相關回收/,
      'a page she could not search must never read as a page with no recalls')
  })

  test('a refused type is BLOCKED_BY_SITE and carries the refusal reason', async () => {
    const r = await checkRecall({
      session: fakeSession([[SEARCH_BOX]], { type: async () => ({ outcome: 'REFUSED', reason: 'CREDENTIAL_SHAPED', detail: 'looks like a password field' }) }),
      goto,
      query: 'mushrooms'
    })
    assert.strictEqual(r.outcome, 'BLOCKED_BY_SITE')
    assert.match(r.detail, /CREDENTIAL_SHAPED/)
  })
})

describe('⛔ a stop comes back in a shape the STORE accepts', () => {
  test('L1 stopping the click yields STOPPED_FOR_YOU with a complete report', async () => {
    const r = await checkRecall({
      session: fakeSession([[SEARCH_BOX], [SEARCH_BOX, SEARCH_BTN]], {
        click: async () => ({
          outcome: 'STOPPED_FOR_YOU',
          record: { role: 'button', name: 'Place Your Order', ref: 'r2' },
          whichLayer: 'L1'
        })
      }),
      goto,
      query: 'mushrooms',
      url: 'https://recalls-rappels.canada.ca/en/search'
    })
    assert.strictEqual(r.outcome, 'STOPPED_FOR_YOU')
    assert.ok(r.stop, 'a stop with no report is refused by the store')
    assert.strictEqual(r.stop.notPressed.name, 'Place Your Order')
    assert.ok(r.stop.where, 'he needs to know WHERE she is standing')
    assert.strictEqual(r.stop.whichLayer, 'L1')
  })

  test('⛔ and it round-trips through the REAL store as a stop, not a downgrade', async () => {
    // The seam. A shape the store rejects becomes BLOCKED_BY_SITE in the runner, and 首頁
    // would tell him a site blocked her when in fact she stopped for him.
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-'))
    const store = openErrandStore(d)
    const res = await runErrand({
      store,
      id: 'x1',
      title: '回收檢查',
      run: () => checkRecall({
        session: fakeSession([[SEARCH_BOX], [SEARCH_BOX, SEARCH_BTN]], {
          click: async () => ({ outcome: 'STOPPED_FOR_YOU', record: { role: 'button', name: 'Place Your Order', ref: 'r2' }, whichLayer: 'L1' })
        }),
        goto,
        query: 'mushrooms',
        url: 'https://recalls-rappels.canada.ca/en/search'
      })
    })
    assert.strictEqual(res.outcome, OUTCOME.STOPPED_FOR_YOU, 'it must survive the store, not be downgraded')
    assert.strictEqual(store.waiting().length, 1, 'and it must reach 首頁 waiting section')
    fs.rmSync(d, { recursive: true, force: true })
  })
})

describe('it stays inside its budget and never touches a credential', () => {
  test('⛔ the errand never asks for the profile directory', () => {
    const src = fs.readFileSync(path.join(__dirname, 'recallCheck.js'), 'utf8')
    assert.doesNotMatch(src, /browser-profile|profileDir/,
      'the recall register needs no login; reaching for the credential profile would be gratuitous')
  })

  test('a hung site is bounded — the errand gives up rather than running forever', async () => {
    let reads = 0
    const r = await checkRecall({
      session: fakeSession([[SEARCH_BOX], [SEARCH_BOX, SEARCH_BTN], [HIT, DATE]], {
        read: async () => { reads++; return { nodes: [SEARCH_BOX], totalCandidates: 1 } }
      }),
      goto,
      query: 'mushrooms',
      maxActions: 2
    })
    assert.strictEqual(r.outcome, 'BLOCKED_BY_SITE')
    assert.match(r.detail, /上限|budget/i)
    assert.ok(reads < 10, 'it stopped instead of looping')
  })
})
