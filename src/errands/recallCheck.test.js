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
const { CATALOGUE } = require('../i18n/catalogue')
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
    // CONVERTED: which statement. 「no recalls」 is the good news, and it is still news.
    assert.ok(r.answer.includes(CATALOGUE['recall.none'].zh.split('{')[0]) || /沒有找到/.test(r.answer),
      'the zero answer is still an answer: ' + r.answer)
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
    // Quoted since 2026-08-07 — the register OR-matches otherwise. The rule this test protects
    // is unchanged: the QUERY must reach the page, and it must be the right ingredient.
    assert.strictEqual(typed, '"chicken"')
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
    // ⛔ THE SUBJECT MUST EXIST BEFORE ITS ABSENCE MEANS ANYTHING. With `|| ''` this passed
    // for free whenever detail was missing — a BLOCKED result that said nothing at all
    // satisfied 「it must not read as a clean page」.
    assert.ok(r.detail, 'BLOCKED must say why; with no detail the check below is vacuous')
    assert.doesNotMatch(r.detail, /沒有找到相關回收/,
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

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ 「個站搵到,我掉咗」 — THE SHAPE THAT MUST NEVER SHIP INTO A DAILY 「冇嘢」.
 *
 * > **Owner: 「Report what the site actually returns rather than filtering it. Noise is fine;
 * > I will read six lines and dismiss four. Silence I cannot audit.」**
 * > **「A false all-clear on a recall is the one case where the cost is not my time.」**
 *
 * The old extractor kept only recalls whose TITLE contained the query word. So a romaine recall
 * titled 「Caesar Salad Kit」 — which the site returned — was dropped, and the errand reported
 * 「冇搵到相關回收」. Every morning, unattended, in a sentence that reads like good news.
 *
 * Measured page structure (scripts/probes/probeRecallResults.js, "cheese"):
 *     link       「Coaticook brand White Cheddar cheeses recalled due to Listeria monocytogenes」
 *     StaticText 「Recall」
 *     StaticText 「Food recall warning | 2026-08-03」
 *     …and 「Displaying 1 - 15 of 89 items.」 for the count.
 *
 * ⛔ TWO RULINGS BUILT IN:
 *   1. KEEP THE SITE'S ORDER. Re-ranking by our own relevance guess is the same filter one
 *      step later.
 *   2. SAY FOUND vs SHOWN. 「4 條,顯示頭 3」 is a different fact from 「3 條」.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const resultsPage = (items, countLine) => {
  const nodes = [
    { ref: 'rA', domId: 90, role: 'link', name: 'Skip to main content', interactive: true },
    { ref: 'rB', domId: 91, role: 'heading', name: 'All recalls', interactive: false }
  ]
  items.forEach((it, i) => {
    nodes.push({ ref: 'l' + i, domId: 200 + i, role: 'link', name: it.title, interactive: true })
    nodes.push({ ref: 's' + i, domId: 300 + i, role: 'StaticText', name: 'Recall', interactive: false })
    nodes.push({ ref: 'd' + i, domId: 400 + i, role: 'StaticText', name: (it.kind || 'Food recall warning') + ' | ' + it.when, interactive: false })
  })
  if (countLine) nodes.push({ ref: 'rC', domId: 99, role: 'StaticText', name: countLine, interactive: false })
  return nodes
}
const searched = (resultNodes) => fakeSession([[SEARCH_BOX], [SEARCH_BOX, SEARCH_BTN], resultNodes])

describe('⛔ it reports what the SITE returned, not what matched the query word', () => {
  test('a recall the site returned but whose title lacks the query word is KEPT', async () => {
    // The exact false-all-clear: searching romaine, the site returns a salad kit.
    const r = await checkRecall({
      session: searched(resultsPage([
        { title: 'Certain Caesar Salad Kits recalled due to E. coli', when: '2026-08-05' }
      ], 'Displaying 1 - 1 of 1 items.')),
      goto,
      query: 'romaine'
    })
    assert.strictEqual(r.outcome, 'ANSWERED')
    assert.match(r.answer, /Caesar Salad Kit/, 'the site judged this relevant; dropping it is the defect')
  })

  test('⛔ the SITE\'s order is preserved — no re-ranking by our own relevance guess', async () => {
    const r = await checkRecall({
      session: searched(resultsPage([
        { title: 'AAA brand item recalled due to Listeria', when: '2019-01-01' },
        { title: 'BBB brand item recalled due to Listeria', when: '2026-08-06' },
        { title: 'CCC brand item recalled due to Listeria', when: '2022-05-05' }
      ], 'Displaying 1 - 3 of 3 items.')),
      goto,
      query: 'cheese'
    })
    const iA = r.answer.indexOf('AAA'); const iB = r.answer.indexOf('BBB'); const iC = r.answer.indexOf('CCC')
    assert.ok(iA < iB && iB < iC, 'sorting by date would be our judgement replacing the site\'s')
  })

  test('⛔ it says FOUND vs SHOWN, taking the total from the site\'s own count line', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: 'Item ' + i + ' brand thing recalled due to Listeria', when: '2026-0' + ((i % 8) + 1) + '-01' }))
    const r = await checkRecall({
      session: searched(resultsPage(many, 'Displaying 1 - 15 of 89 items.')),
      goto,
      query: 'cheese'
    })
    assert.match(r.answer, /89/, 'he wants to know when a search returns forty')
    assert.match(r.answer, /顯示前/, 'and that he is not seeing all of them')
    assert.strictEqual(r.found, 89)
    assert.ok(r.shown < 89)
  })
})

/**
 * ⛔ THE GUARD THAT MATTERS MOST: A PARSER FAILURE MUST NEVER RENDER AS 「冇回收」.
 *
 * If the site changes its markup, the extractor recognises nothing — and the old code would
 * have said 「冇搵到相關回收」 with total confidence. That is the same false all-clear arriving
 * through a different door, and on an unattended daily task nobody would notice for months.
 */
describe('⛔ 「I recognised nothing」 is never reported as 「there is nothing」', () => {
  test('the site says 89 items but nothing parses → BLOCKED, not a clean 「冇回收」', async () => {
    const broken = [
      { ref: 'x1', domId: 1, role: 'StaticText', name: 'Displaying 1 - 15 of 89 items.', interactive: false },
      { ref: 'x2', domId: 2, role: 'generic', name: 'something restructured', interactive: false }
    ]
    const r = await checkRecall({ session: searched(broken), goto, query: 'cheese' })
    assert.strictEqual(r.outcome, 'BLOCKED_BY_SITE')
    assert.match(r.detail, /89/, 'it must name the contradiction it detected')
    assert.doesNotMatch(r.detail, /沒有找到相關回收/) // detail proved a string by the line above
  })

  test('⛔ no count line AND nothing parsed → refuses to call it 「no recalls」', async () => {
    const r = await checkRecall({ session: searched([{ ref: 'y1', domId: 1, role: 'generic', name: 'hello', interactive: false }]), goto, query: 'cheese' })
    assert.notStrictEqual(r.outcome, 'ANSWERED')
    // ⛔ Both defaulted to '' meant a result carrying NEITHER field passed this test — the
    // silence it exists to forbid was the one input it could not catch.
    const said = (r.detail || '') + (r.answer || '')
    assert.ok(said, 'it must say something; silence is the failure this test is about')
    assert.doesNotMatch(said, /沒有找到相關回收/,
      'unable to read is not the same as nothing to read, and only one of them is good news')
  })

  test('the site explicitly reporting ZERO is a real, clean answer', async () => {
    const r = await checkRecall({
      session: searched([{ ref: 'z1', domId: 1, role: 'StaticText', name: 'Your search yielded no results.', interactive: false }]),
      goto,
      query: 'unobtainium'
    })
    assert.strictEqual(r.outcome, 'ANSWERED')
    assert.match(r.answer, /沒有找到/)
    assert.strictEqual(r.found, 0)
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ NARROW THE QUESTION, NEVER THE ANSWER — AND SAY WHICH NARROWING WAS APPLIED.
 *
 * > **Owner: 「say in the line which narrowing was applied, every time — 「只計 2026」 is a claim
 * > about what I was shown and it belongs on screen, not in a config file.」**
 *
 * MEASURED (scripts/probes/measureRecallNarrowing.js, 2026-08-07):
 *
 *   green onion   unquoted  349  top = 「Femyso: … two green Mifepristone cartons」
 *   green onion   QUOTED      1  top = 「Old Dutch … Sour Cream, Green Onion & Bacon … Chips」
 *   cheese        unquoted   89  ·  QUOTED 89   (single words are unaffected)
 *
 * The register OR-matches words, so 「green onion」 was returning everything containing 「green」.
 * Quoting is a narrower QUESTION — the site still decides what matches and in what order — and
 * it dropped nothing to zero on any ingredient.
 * ══════════════════════════════════════════════════════════════════════════════
 */
describe('⛔ the query is quoted, and the line says so', () => {
  const oneHit = resultsPage([{ title: 'Some brand thing recalled due to Listeria', when: '2026-08-01' }], 'Displaying 1 - 1 of 1 items.')

  test('the phrase is sent to the site in quotes', async () => {
    let typed = null
    await checkRecall({
      session: fakeSession([[SEARCH_BOX], [SEARCH_BOX, SEARCH_BTN], oneHit], {
        type: async (req) => { typed = req.text; return { outcome: 'TYPED', record: { length: 5, shape: 'plain' } } }
      }),
      goto,
      query: 'green onion'
    })
    assert.strictEqual(typed, '"green onion"', 'unquoted, the register OR-matches and returns 349 items')
  })

  test('⛔ the narrowing is stated in the ANSWER, every time — not left in a config file', async () => {
    const r = await checkRecall({ session: searched(oneHit), goto, query: 'green onion' })
    assert.match(r.answer, /詞組/, 'it is a claim about what he was shown, so it belongs on screen')
    assert.ok(Array.isArray(r.narrowing) && r.narrowing.length >= 1)
  })

  test('the stated narrowing appears even when the answer is 「冇搵到」', async () => {
    // ⛔ This is the case where it matters MOST: a zero produced by a narrowed question is a
    // different fact from a zero produced by an open one, and only the line can say which.
    const r = await checkRecall({
      session: searched([{ ref: 'n1', domId: 1, role: 'StaticText', name: 'Your search yielded no results.', interactive: false }]),
      goto,
      query: 'green onion'
    })
    assert.strictEqual(r.outcome, 'ANSWERED')
    assert.match(r.answer, /詞組/)
    assert.match(r.answer, /沒有找到/)
  })

  test('the query still reaches the page unmangled inside the quotes', async () => {
    let typed = null
    await checkRecall({
      session: fakeSession([[SEARCH_BOX], [SEARCH_BOX, SEARCH_BTN], oneHit], {
        type: async (req) => { typed = req.text; return { outcome: 'TYPED', record: { length: 5, shape: 'plain' } } }
      }),
      goto,
      query: 'romaine'
    })
    assert.strictEqual(typed, '"romaine"')
  })
})
