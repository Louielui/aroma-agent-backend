'use strict'

/**
 * morningBriefing.test.js — the rules of the brief, each one proven able to fail.
 *
 * The brief's whole value is that the Owner can trust it without checking it. That rests
 * on rules an assembler could quietly stop honouring — a padded Top 3, a fact with no
 * source, "no results" rendered the same as "could not read". Each is asserted here, and
 * each has a control showing the assertion can go red.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildMorningBriefing, makeItem, localDay, stamp,
  TIMEZONE, AROMA_SYSTEM_COVERAGE, SECOND_REPO
} = require('./morningBriefing')
const { narrativeAssertsBusinessState, scopeForSource } = require('./statementScope')

const NOW = '2026-08-02T14:00:00.000Z' // 09:00 in Winnipeg (CDT)

function item (source, id, date, title, extra) {
  return Object.assign({
    source, sourceId: id, title, originalDate: date, content: '', link: 'https://example.invalid/' + id,
    retrievedAt: NOW, trust: 'live', error: null, usedFallback: false
  }, extra || {})
}

/** A read-context double speaking the REAL return shape, including `items`. */
function readContext (perSource, items) {
  return async () => ({ block: 'x', status: 'READY', perSource, items })
}

const LIVE_FOUR = [
  { source: 'drive', trust: 'live', count: 1, error: null, usedFallback: false },
  { source: 'gmail', trust: 'live', count: 1, error: null, usedFallback: false },
  { source: 'calendar', trust: 'live', count: 1, error: null, usedFallback: false },
  { source: 'github', trust: 'live', count: 1, error: null, usedFallback: false }
]

/** A connector double for the second-repo read. `mode` picks the outcome. */
function connector (mode) {
  return {
    async read (source, method, params) {
      assert.equal(source, 'github')
      assert.equal(method, 'listPullRequests')
      assert.equal(params.repo, 'aroma-system', 'the second repo is the one asked for')
      if (mode === 'forbidden') return { source: 'github', trust: 'unavailable', error: 'read failed: Not Found', retrievedAt: NOW }
      if (mode === 'throws') throw new Error('boom')
      return { asOf: NOW, source: 'github', count: 1, results: [item('github', 'aroma-system#9', '2026-08-02T12:00:00.000Z', 'PR nine')] }
    }
  }
}

function run (opts = {}) {
  return buildMorningBriefing({
    buildReadContextFn: opts.readContextFn || readContext(LIVE_FOUR, opts.items || []),
    connector: opts.connector || connector('ok'),
    sources: ['drive', 'gmail', 'calendar', 'github'],
    listPendingProposals: opts.listPendingProposals || (async () => []),
    buildDecisionRecall: opts.buildDecisionRecall || (async () => ({ count: 0 })),
    clock: () => NOW,
    env: {}
  })
}

const cov = (brief, source) => brief.sections.dataCoverage.find((c) => c.source === source)

/* ── 1. the three states, never merged ────────────────────────────────────── */

test('*** all sources live → every coverage row reads live ***', async () => {
  const { brief } = await run({ items: [item('drive', 'd1', NOW, 'A file')] })
  for (const s of ['drive', 'gmail', 'calendar', 'github']) {
    assert.equal(cov(brief, s).state, 'live', s + ' is live')
  }
})

test('*** live_zero and unavailable are DIFFERENT states ***', async () => {
  const perSource = [
    { source: 'drive', trust: 'live', count: 0, error: null, usedFallback: false },      // read OK, nothing there
    { source: 'gmail', trust: 'unavailable', count: 0, error: 'token expired', usedFallback: false },
    { source: 'calendar', trust: 'live', count: 2, error: null, usedFallback: true },
    { source: 'github', trust: 'live', count: 1, error: null, usedFallback: false }
  ]
  const { brief } = await run({ readContextFn: readContext(perSource, []) })

  assert.equal(cov(brief, 'drive').state, 'live_zero', 'read OK with nothing is NOT unavailable')
  assert.equal(cov(brief, 'drive').error, null, 'and it has no error, because nothing failed')
  assert.equal(cov(brief, 'gmail').state, 'unavailable', 'a failed read is unavailable')
  assert.equal(cov(brief, 'gmail').error, 'token expired', 'with its reason kept')
  assert.notEqual(cov(brief, 'drive').state, cov(brief, 'gmail').state, 'the two must never collapse')
  assert.equal(cov(brief, 'calendar').usedFallback, true, 'a fallback read is flagged as such')
})

test('*** POSITIVE CONTROL — a merged state would be caught ***', () => {
  const merged = [{ source: 'drive', state: 'unavailable' }, { source: 'gmail', state: 'unavailable' }]
  assert.throws(() => {
    assert.notEqual(merged[0].state, merged[1].state, 'the two must never collapse')
  })
})

/* ── 2. one source failing must not cost the brief ────────────────────────── */

test('*** a single source failing does not take the brief down ***', async () => {
  const perSource = [
    { source: 'drive', trust: 'unavailable', count: 0, error: 'drive exploded', usedFallback: false },
    { source: 'gmail', trust: 'live', count: 1, error: null, usedFallback: false },
    { source: 'calendar', trust: 'live', count: 1, error: null, usedFallback: false },
    { source: 'github', trust: 'live', count: 1, error: null, usedFallback: false }
  ]
  const { brief } = await run({
    readContextFn: readContext(perSource, [item('gmail', 'g1', NOW, 'Subject line')])
  })
  assert.ok(brief.briefId, 'a brief was still produced')
  assert.equal(cov(brief, 'drive').state, 'unavailable')
  assert.equal(cov(brief, 'gmail').state, 'live')
  assert.ok(brief.sections.risks.some((r) => /drive could not be read/.test(r.text)),
    'and the failure is surfaced as a risk, with evidence')
})

test('*** the read layer throwing entirely still yields a brief ***', async () => {
  const { brief } = await run({ readContextFn: async () => { throw new Error('total failure') } })
  assert.ok(brief.briefId)
  assert.equal(cov(brief, 'gmail').state, 'unavailable')
  assert.match(String(cov(brief, 'gmail').error), /total failure/)
})

/* ── 3. provenance rules — refuse, do not emit ────────────────────────────── */

test('*** a fact WITHOUT provenance is refused, not emitted ***', () => {
  const rejected = []
  const it = makeItem({ id: 'a', kind: 'fact', text: 'something happened', provenance: null }, rejected)
  assert.equal(it, null, 'no item is produced')
  assert.equal(rejected[0].why, 'fact without provenance', 'and the refusal is recorded')
})

test('*** a recommendation with NO cited fact is refused ***', () => {
  const rejected = []
  assert.equal(makeItem({ id: 'r', kind: 'recommendation', text: 'do this', basedOnFactIds: [] }, rejected), null)
  assert.equal(makeItem({ id: 'i', kind: 'inference', text: 'therefore', basedOnFactIds: [] }, rejected), null)
  assert.deepEqual(rejected.map((r) => r.why),
    ['recommendation without a cited fact', 'inference without a cited fact'])
})

test('*** POSITIVE CONTROL — the same items WITH provenance/citations are accepted ***', () => {
  const rejected = []
  const f = makeItem({ id: 'f1', kind: 'fact', text: 'x', provenance: { source: 'gmail', sourceId: '1' } }, rejected)
  const r = makeItem({ id: 'r1', kind: 'recommendation', text: 'y', basedOnFactIds: ['f1'] }, rejected)
  assert.ok(f && r, 'both are produced')
  assert.deepEqual(rejected, [], 'nothing was refused')
})

test('*** every emitted fact in a real brief carries provenance ***', async () => {
  const { brief } = await run({
    items: [item('calendar', 'c1', '2026-08-02T16:00:00.000Z', 'Service prep')],
    listPendingProposals: async () => [{ id: 'p1', status: 'pending', task: 'Decide X', createdAt: NOW }]
  })
  const facts = ['today', 'recentActivity', 'risks', 'decisionsNeeded']
    .flatMap((k) => brief.sections[k]).filter((i) => i.kind === 'fact')
  assert.ok(facts.length > 0, 'there are facts to check')
  for (const f of facts) assert.ok(f.provenance && f.provenance.source, f.id + ' has provenance')

  for (const r of brief.sections.topPriorities) {
    assert.ok(r.basedOnFactIds.length > 0, 'every priority cites a fact')
  }
})

/* ── 4. Top 3 is a ceiling, never a quota ─────────────────────────────────── */

test('*** Top Priorities is NOT padded when there is little to say ***', async () => {
  // Everything readable, nothing happening: no events today, no pending proposals.
  const { brief } = await run({ items: [] })
  assert.equal(brief.sections.today.length, 0)
  assert.equal(brief.sections.decisionsNeeded.length, 0)
  assert.ok(brief.sections.topPriorities.length < 3,
    'fewer than three real inputs must yield fewer than three priorities, got ' + brief.sections.topPriorities.length)
})

test('*** Top Priorities never exceeds three, and each cites a real fact ***', async () => {
  const pending = [1, 2, 3, 4, 5].map((n) => ({ id: 'p' + n, status: 'pending', task: 'Decide ' + n, createdAt: NOW }))
  const { brief } = await run({ listPendingProposals: async () => pending })
  assert.equal(brief.sections.topPriorities.length, 3, 'three is the ceiling')

  const ids = new Set(['today', 'recentActivity', 'risks', 'decisionsNeeded']
    .flatMap((k) => brief.sections[k]).map((i) => i.id))
  for (const p of brief.sections.topPriorities) {
    for (const cited of p.basedOnFactIds) assert.ok(ids.has(cited), 'cites a fact that is IN this brief: ' + cited)
  }
})

test('*** an empty brief says "none" with empty arrays, and invents nothing ***', async () => {
  const { brief } = await run({ items: [] })
  assert.deepEqual(brief.sections.today, [], 'empty array, not a placeholder sentence')
  assert.deepEqual(brief.sections.decisionsNeeded, [])
  assert.equal(Array.isArray(brief.sections.recentActivity), true)
})

/* ── 5. the operational wall ──────────────────────────────────────────────── */

test('*** Aroma System is ALWAYS present and ALWAYS unavailable ***', async () => {
  const { brief } = await run({})
  const row = cov(brief, 'aroma-system')
  assert.ok(row, 'the gap is reported, not omitted')
  assert.equal(row.state, 'unavailable')
  assert.equal(row.error, 'read-only connection not configured',
    'and in the exact words the Owner specified')
  assert.equal(AROMA_SYSTEM_COVERAGE.trust, 'unavailable', 'it is a constant, not a probe result')
})

test('*** a gmail subject about stock is SHOWN as a source_record, not hidden ***', async () => {
  // The Owner's ruling: do not hide an item just because its title says "stock". The
  // subject IS the email's title and the Owner wants to see it. What must never happen
  // is the brief presenting it as the state of the restaurant.
  const { brief, audit } = await run({
    items: [item('gmail', 'g9', NOW, 'Invoice: 40 cases stock delivered, sales up 12%')]
  })
  const found = brief.sections.recentActivity.find((i) => i.provenance && i.provenance.sourceId === 'g9')
  assert.ok(found, 'the record is present — it was not suppressed')
  assert.equal(found.scope, 'source_record', 'and its scope came from the SOURCE, not the words')
  assert.match(found.text, /^gmail contains a record: "/, 'the wording is containment, not assertion')
  assert.match(found.text, /40 cases stock delivered/, 'with the subject quoted verbatim')

  // The backstop sees only OUR words. The quoted subject is invisible to it.
  assert.equal(narrativeAssertsBusinessState(found.text), null,
    'a quoted subject is not a narrative claim')
  assert.equal(audit.outcome, undefined, 'the builder no longer names an outcome it cannot know')
})

test('*** POSITIVE CONTROL — the backstop DOES fire on an unquoted claim ***', () => {
  // Without this, "returns null" could mean the scan matches nothing at all.
  assert.equal(narrativeAssertsBusinessState('Inventory is down to 4 cases'), 'inventory')
  assert.equal(narrativeAssertsBusinessState('gmail contains a record: "Team meeting"'), null,
    'and it does not fire on ordinary text')
})

test('*** scope is decided by SOURCE, and an unknown source has none ***', () => {
  assert.equal(scopeForSource('gmail'), 'source_record')
  assert.equal(scopeForSource('proposals'), 'owner_work_item')
  assert.equal(scopeForSource('coverage:drive'), 'coverage_state')
  assert.equal(scopeForSource('aroma-system'), 'business_state')
  assert.equal(scopeForSource('something-invented'), null, 'closed, not open')
})

test('*** permanent gaps are coverage, NOT daily risks ***', async () => {
  const { brief } = await run({})
  const riskSources = brief.sections.risks.map((r) => r.provenance.source)
  for (const gap of ['coverage:aroma-system', 'coverage:deadlines', 'coverage:awaiting-reply']) {
    assert.equal(riskSources.includes(gap), false, gap + ' must not be reported as a fresh blocker')
  }
  // But they ARE fully visible where a standing gap belongs.
  for (const s of ['aroma-system', 'deadlines', 'awaiting-reply']) {
    assert.equal(cov(brief, s).state, 'unavailable', s + ' is still on the coverage list')
  }
})

/* ── 6. the second GitHub repo degrades alone ─────────────────────────────── */

test('*** the second repo gets its OWN coverage row, never merged into github ***', async () => {
  const { brief } = await run({ connector: connector('ok') })
  assert.ok(cov(brief, 'github'), 'the configured repo is its own row')
  assert.ok(cov(brief, SECOND_REPO.key), 'and aroma-system is a separate one')
  assert.equal(cov(brief, SECOND_REPO.key).state, 'live')
})

test('*** no permission on the second repo degrades safely and blocks nothing ***', async () => {
  const { brief } = await run({ connector: connector('forbidden'), items: [item('drive', 'd1', NOW, 'A file')] })
  assert.equal(cov(brief, SECOND_REPO.key).state, 'unavailable')
  assert.match(String(cov(brief, SECOND_REPO.key).error), /Not Found/)
  assert.equal(cov(brief, 'github').state, 'live', 'the first repo is unaffected')
  assert.ok(brief.briefId, 'and the brief was still produced')
})

test('*** the second-repo read THROWING is caught, not propagated ***', async () => {
  const { brief } = await run({ connector: connector('throws') })
  assert.equal(cov(brief, SECOND_REPO.key).state, 'unavailable')
  assert.match(String(cov(brief, SECOND_REPO.key).error), /boom/)
})

/* ── 7. proposals and Decision Recall stay separate sources ───────────────── */

test('*** pending proposals and Decision Recall are never one source ***', async () => {
  const { brief } = await run({
    listPendingProposals: async () => [{ id: 'p1', status: 'pending', task: 'Approve the thing', createdAt: NOW }],
    buildDecisionRecall: async () => ({ count: 0 })
  })
  assert.ok(cov(brief, 'proposals'), 'proposals is its own coverage row')
  assert.ok(cov(brief, 'decision-recall'), 'and so is decision-recall')
  assert.equal(cov(brief, 'proposals').state, 'live')
  // Empty Decision Recall is live_zero — read successfully, nothing on record. NOT unavailable.
  assert.equal(cov(brief, 'decision-recall').state, 'live_zero',
    'an empty store was READ; it is not a failure to read')

  const d = brief.sections.decisionsNeeded
  assert.equal(d.length, 1)
  assert.equal(d[0].provenance.source, 'proposals', 'the decision item is attributed to proposals only')
})

test('*** only PENDING proposals become decisions needed ***', async () => {
  const { brief } = await run({
    listPendingProposals: async () => [
      { id: 'p1', status: 'pending', task: 'Still open', createdAt: NOW },
      { id: 'p2', status: 'confirmed', task: 'Already decided', createdAt: NOW }
    ]
  })
  assert.equal(brief.sections.decisionsNeeded.length, 1)
  assert.match(brief.sections.decisionsNeeded[0].text, /Still open/)
})

/* ── 8. time ─────────────────────────────────────────────────────────────── */

test('*** times are shown in America/Winnipeg and keep the original ISO ***', async () => {
  const s = stamp('2026-08-02T14:00:00.000Z')
  assert.equal(s.iso, '2026-08-02T14:00:00.000Z', 'the evidence is preserved exactly')
  assert.match(s.display, /America\/Winnipeg/, 'and the display names its zone')
  assert.match(s.display, /09:00/, '14:00Z is 09:00 in Winnipeg in August (CDT)')
  assert.equal(TIMEZONE, 'America/Winnipeg')
})

test('*** "today" is the Owner\'s local day, not a UTC boundary ***', async () => {
  // 03:00Z on the 3rd is still the EVENING OF THE 2nd in Winnipeg.
  assert.equal(localDay('2026-08-03T03:00:00.000Z'), '2026-08-02')

  const { brief } = await run({
    items: [item('calendar', 'c1', '2026-08-03T01:00:00.000Z', 'Late service')]
  })
  assert.equal(brief.sections.today.length, 1, 'a 20:00 local event on the 2nd belongs to today')
})

test('*** a calendar fallback event is NOT presented as today ***', async () => {
  const { brief } = await run({
    items: [item('calendar', 'c2', '2026-09-20T16:00:00.000Z', 'Far future', { usedFallback: true })]
  })
  assert.equal(brief.sections.today.length, 0,
    'an event returned only because the window was empty is not today\'s business')
})
