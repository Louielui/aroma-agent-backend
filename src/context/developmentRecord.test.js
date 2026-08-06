'use strict'

/**
 * developmentRecord.test.js — she reads the development record, and cannot over-claim it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Everything decided this week lives in docs/ and in commit messages. She knows none of it,
 * so 「why was DEFECT-001 not fixed?」 is unanswerable. That gap is memory, not reasoning.
 *
 * ── THE THREE THINGS THE OWNER HELD ME TO ────────────────────────────────────
 * 1. GENERATED, never hand-maintained. His own example: the memory note saying 「GitHub OFF,
 *    waiting for a PAT」 was stale while the connector was live. A stale ruling index is
 *    worse than none.
 * 2. Every citation carries STATUS AND DATE in the same sentence. 「HR-6 講…」 is not a
 *    citation. Enforced where she cannot write the short form — the same discipline as
 *    server-supplied metric values.
 * 3. A recorded defect is NOT a fixed defect. DEFECT-001 is disproven; 002-006 are
 *    untouched. If she ever says a defect is handled because a file exists about it, that is
 *    the failure this feature could cause.
 *
 * ── AND THE DEFAULT IS FAIL-CLOSED ───────────────────────────────────────────
 * 42 files exist and most predate this design. An UNDECLARED document is a WORKING NOTE.
 * Getting that wrong loses authority she should have had; the opposite invents authority she
 * never had, and this project exists to not do the second one.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const {
  RECORD_STATUS, parseStatus, buildIndex, citationFor, DOCS_DIR
} = require('./developmentRecord')

describe('status declaration', () => {
  test('a declared status is read from the document itself', () => {
    const d = parseStatus('# Title\n\n<!-- record-status: ACTIVE 2026-08-06 -->\n\nbody')
    assert.strictEqual(d.status, RECORD_STATUS.ACTIVE)
    assert.strictEqual(d.declaredAt, '2026-08-06')
  })

  test('DISPROVEN and SUPERSEDED are distinct statuses, not one "not current"', () => {
    assert.strictEqual(parseStatus('<!-- record-status: DISPROVEN 2026-08-05 -->').status, RECORD_STATUS.DISPROVEN)
    assert.strictEqual(parseStatus('<!-- record-status: SUPERSEDED 2026-08-05 -->').status, RECORD_STATUS.SUPERSEDED)
  })

  test('NO DECLARATION MEANS WORKING NOTE — fail-closed, never ACTIVE', () => {
    const d = parseStatus('# Some old document\n\nlots of prose and no declaration at all')
    assert.strictEqual(d.status, RECORD_STATUS.WORKING_NOTE)
    assert.strictEqual(d.declaredAt, null)
  })

  test('a declaration buried past the header block does not count', () => {
    // A status line 400 lines down is not a declaration about the document, it is a
    // sentence inside it. It must be in a fixed place or it cannot be trusted.
    const d = parseStatus('# T\n' + 'filler\n'.repeat(200) + '<!-- record-status: ACTIVE 2026-08-06 -->')
    assert.strictEqual(d.status, RECORD_STATUS.WORKING_NOTE)
  })

  test('an unrecognised status word is NOT quietly treated as ACTIVE', () => {
    assert.strictEqual(parseStatus('<!-- record-status: PROBABLY_FINE 2026-08-06 -->').status, RECORD_STATUS.WORKING_NOTE)
  })
})

describe('the index is GENERATED from the documents', () => {
  test('it is built by reading docs/, not from a list in this file', () => {
    const src = require('fs').readFileSync(require.resolve('./developmentRecord'), 'utf8')
    // A hand-maintained list is the exact failure the Owner named: it goes stale silently.
    assert.ok(!/HR-1\b.*HR-2\b.*HR-3/s.test(src), 'must not enumerate rules by hand')
    assert.ok(/readdirSync|readdir/.test(src), 'must read the directory')
  })

  test('it finds the real rules file and splits it into one entry per rule', () => {
    const idx = buildIndex({ dir: DOCS_DIR })
    const rules = idx.filter((e) => e.id.startsWith('HR-'))
    assert.ok(rules.length >= 13, 'expected at least HR-1..HR-13, got ' + rules.length)
    const hr6 = rules.find((e) => e.id === 'HR-6')
    assert.ok(hr6, 'HR-6 must be indexed')
    assert.ok(hr6.title && hr6.title.length > 5)
    assert.strictEqual(hr6.sourceFile, 'HOUSE-RULES.md')
  })

  test('each entry is SMALL — four must fit a source budget of 6000 chars shared five ways', () => {
    const idx = buildIndex({ dir: DOCS_DIR })
    for (const e of idx) {
      const rendered = citationFor(e)
      assert.ok(rendered.length <= 400, 'entry too long (' + rendered.length + '): ' + e.id)
    }
  })

  test('a DISPROVEN defect is indexed AS disproven — not merely present', () => {
    const idx = buildIndex({ dir: DOCS_DIR })
    const d1 = idx.find((e) => e.id === 'DEFECT-001')
    assert.ok(d1, 'DEFECT-001 must be indexed')
    assert.strictEqual(d1.status, RECORD_STATUS.DISPROVEN)
  })

  test('the untouched defects are NOT marked as anything resembling handled', () => {
    const idx = buildIndex({ dir: DOCS_DIR })
    for (const id of ['DEFECT-002', 'DEFECT-003', 'DEFECT-005', 'DEFECT-006']) {
      const e = idx.find((x) => x.id === id)
      assert.ok(e, id + ' must be indexed')
      assert.notStrictEqual(e.status, RECORD_STATUS.DISPROVEN, id + ' is open, not disproven')
      assert.ok(!/fixed|handled|resolved|已修/i.test(e.title), id + ' title must not read as handled')
    }
  })

  test('a plan for a disproven fix does not read as a ruling', () => {
    const idx = buildIndex({ dir: DOCS_DIR })
    const plan = idx.find((e) => e.sourceFile === 'PLAN-DEFECT-001-FIX.md')
    if (plan) {
      assert.notStrictEqual(plan.status, RECORD_STATUS.ACTIVE,
        'a complete plan for a fix that must never be applied cannot be ACTIVE')
    }
  })

  test('undeclared documents appear as WORKING NOTE rather than being hidden', () => {
    const idx = buildIndex({ dir: DOCS_DIR })
    const notes = idx.filter((e) => e.status === RECORD_STATUS.WORKING_NOTE)
    assert.ok(notes.length > 0, 'the 30-odd undeclared documents must still be findable')
  })
})

describe('citations cannot be written short', () => {
  test('a citation ALWAYS carries the status and the date', () => {
    const c = citationFor({ id: 'HR-6', title: 'Assert the VALUE', status: RECORD_STATUS.ACTIVE, declaredAt: '2026-08-05', sourceFile: 'HOUSE-RULES.md' })
    assert.match(c, /HR-6/)
    assert.match(c, /2026-08-05/)
    assert.match(c, /現行/)
  })

  test('a WORKING NOTE citation says so in the citation itself', () => {
    const c = citationFor({ id: 'X', title: 'something', status: RECORD_STATUS.WORKING_NOTE, declaredAt: null, sourceFile: 'OLD.md' })
    assert.match(c, /工作筆記/)
    assert.ok(!/現行/.test(c), 'a working note must never render as current')
  })

  test('a DISPROVEN entry renders as disproven — this is the DEFECT-001 case', () => {
    const c = citationFor({ id: 'DEFECT-001', title: 'order-planning omits short items', status: RECORD_STATUS.DISPROVEN, declaredAt: '2026-08-05', sourceFile: 'DEFECT-001.md' })
    assert.match(c, /已推翻/)
  })

  test('an undeclared entry has no date, and says that rather than inventing one', () => {
    const c = citationFor({ id: 'X', title: 't', status: RECORD_STATUS.WORKING_NOTE, declaredAt: null, sourceFile: 'O.md' })
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(c), 'must not print a date it does not have')
    assert.match(c, /未標日期/)
  })

  test('there is no exported way to render an entry WITHOUT its status', () => {
    const mod = require('./developmentRecord')
    for (const [name, fn] of Object.entries(mod)) {
      if (typeof fn !== 'function' || name === 'citationFor') continue
      if (!/cite|render|format|label/i.test(name)) continue
      assert.fail('a second rendering path exists and could omit the status: ' + name)
    }
  })
})

describe('the record is history, never permission', () => {
  test('no entry carries anything an executor could read as authorisation', () => {
    const idx = buildIndex({ dir: DOCS_DIR })
    for (const e of idx) {
      assert.ok(!('approved' in e), e.id + ' must not carry an approval field')
      assert.ok(!('authorised' in e) && !('authorized' in e), e.id + ' must not carry an authorisation field')
    }
  })

  test('every entry names the file it came from, so a claim can be checked', () => {
    const idx = buildIndex({ dir: DOCS_DIR })
    for (const e of idx) {
      assert.ok(e.sourceFile && e.sourceFile.endsWith('.md'), 'entry without a source: ' + e.id)
    }
  })
})
