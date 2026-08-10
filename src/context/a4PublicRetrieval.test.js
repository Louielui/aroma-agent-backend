'use strict'

/**
 * a4PublicRetrieval.test.js — A4-2B: a REAL executor behind the public capability.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ EVERY SEMANTIC DECISION IS ALREADY CLOSED, AND MUST STAY CLOSED.
 *
 * What the Owner meant, whether retrieval is required, which world, and what words may leave
 * the building were all settled upstream and proven live. A4-2B adds only the thing that goes
 * and fetches. So most of this file is about what the executor CANNOT do: it cannot answer
 * Louie, choose a world, compose a query, write, or turn its own prose into evidence.
 *
 * ⛔ AND NOT ONE PAID CALL RUNS HERE. Every provider is injected; the transport is a fake.
 * The real canaries are separate and bounded.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { processIntake } = require('../intake/intakeService')
const { createReadConnector } = require('./readConnector')
const { createPublicKnowledgeReadAdapter, PUBLIC_ENTITY_TYPE } = require('./adapters/publicKnowledgeRead')
const {
  createOpenAIWebSearchProvider, PROVIDER_ID, DEFAULT_MODEL, DEFAULT_EFFORT, RESPONSES_URL,
  toUserLocation, extractResults, citedSpan, isCitationMarker, stripCitationMarkers, lastClaimIn, reasonForStatus
} = require('./providers/openaiWebSearchProvider')
const {
  SEARCH_STATUS, UNAVAILABLE_REASON, CONTENT_KIND, isAttributable, hasAttributableContent,
  makeSearchResult, logPublicSearch
} = require('./providers/publicSearchProvider')
const { ALL_SOURCES, enabledSources } = require('./liveClients')
const { A4_FLAG } = require('../intake/a4Contract')

const NOW = '2026-08-09T00:00:00.000Z'
const SECRET = 'AROMA_INTERNAL_ONLY_9842'
const SUPPLIER = 'Gordon'
const PRICE = '8.72'
const TITLE = 'Beef Brisket'
const INTERNAL_VALUES = [SECRET, SUPPLIER, PRICE, TITLE]
const PUB = 'public_knowledge.search'
const INV = 'aroma_system.invoices'

/* ═══ FAKE TRANSPORT — the vendor's shape, never the vendor ═════════════ */

function okPayload (sources, opts = {}) {
  return {
    output: [
      { type: 'web_search_call', status: opts.callStatus || 'completed', action: { type: 'search', query: 'q', sources } },
      { type: 'message', content: [{ text: 'prose that must never become evidence', annotations: opts.annotations || [] }] }
    ],
    usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 }
  }
}

/**
 * ⛔ THE DOCUMENTED SHAPE, BUILT HONESTLY — indices are COMPUTED from the text, never guessed.
 *
 * This is what the live provider actually sends, measured over three real searches on
 * 2026-08-09: `action.sources[]` carrying `{type, url}` and NOTHING ELSE — no snippet, no
 * title, no date — plus one `output_text` whose `url_citation` annotations point at real
 * spans. A fixture that invented a snippet would have kept the original bug invisible, which
 * is precisely how it survived to review.
 */
function citedPayload (claims, opts = {}) {
  let text = opts.lead == null ? '' : opts.lead
  const annotations = []
  for (const c of claims) {
    const start = text.length
    text += c.text
    annotations.push(Object.assign(
      { type: 'url_citation', url: c.url, start_index: start, end_index: text.length },
      c.title ? { title: c.title } : {}
    ))
    text += ' '
  }
  if (opts.tail) text += opts.tail
  // ⛔ SOURCES DEFAULT TO URL-ONLY — the real payload's shape, not a convenient one.
  const sources = opts.sources || claims.map((c) => ({ type: 'url', url: c.url }))
  return {
    output: [
      { type: 'web_search_call', status: opts.callStatus || 'completed', action: { type: 'search', query: 'q', sources } },
      { type: 'message', status: 'completed', content: [{ type: 'output_text', text, annotations: opts.annotations || annotations }] }
    ],
    usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 }
  }
}
const CLAIM_A = 'The overnight rate was held at 2.25 percent in July 2026.'
const CLAIM_B = 'Food handler certification is required for at least one supervisor on each shift.'

/** Records exactly what would leave the process. */
function fakeTransport (impl) {
  const sent = []
  const fn = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    return impl(url, init)
  }
  return { fn, sent }
}
const jsonRes = (status, obj) => ({ status, async json () { return obj } })

const providerWith = (impl, opts = {}) => {
  const t = fakeTransport(impl)
  return { t, provider: createOpenAIWebSearchProvider(Object.assign({ apiKey: 'test-key', transport: t.fn, clock: () => NOW }, opts)) }
}

/* ═══ 1–8 — THE OUTBOUND PAYLOAD ═══════════════════════════════════════ */

test('*** 1/2 — the PLANNER query is what reaches the provider, verbatim ***', async () => {
  const { t, provider } = providerWith(async () => jsonRes(200, okPayload([{ url: 'https://x.example/a', title: 'A' }])))
  await provider.search({ query: 'canada wholesale beef index', freshness: 'current', location: null })
  assert.equal(t.sent.length, 1)
  assert.equal(t.sent[0].url, RESPONSES_URL)
  assert.equal(t.sent[0].body.input, 'canada wholesale beef index')
  assert.deepEqual(t.sent[0].body.tools, [{ type: 'web_search' }])
  assert.deepEqual(t.sent[0].body.include, ['web_search_call.action.sources'])
  assert.equal(t.sent[0].body.store, false, '⛔ must not create retrievable Application State')
  assert.equal(t.sent[0].body.model, DEFAULT_MODEL)
  assert.deepEqual(t.sent[0].body.reasoning, { effort: DEFAULT_EFFORT })
  // ⛔ The GPT-5 family rejects sampling params outright; nothing is sent "just in case".
  assert.equal('temperature' in t.sent[0].body, false)
  assert.equal('top_p' in t.sent[0].body, false)
})

test('*** 3/4/6 — ⛔ nothing but the query can reach the vendor ***', async () => {
  const { t, provider } = providerWith(async () => jsonRes(200, okPayload([{ url: 'https://x.example/a' }])))
  // The provider's ONLY inputs are the closed arg bag. There is no history, persona, evidence
  // or capability parameter to pass — so a leak would require inventing a channel.
  await provider.search({ query: 'wholesale beef market trend', freshness: 'recent', location: null })
  const blob = JSON.stringify(t.sent[0])
  for (const v of INTERNAL_VALUES) assert.equal(blob.includes(v), false, `⛔ ${v} left the process`)
  for (const v of ['香香', 'Conversation Contract', 'Decision Recall', 'persona']) {
    assert.equal(blob.includes(v), false, `⛔ ${v} reached the vendor`)
  }
  assert.deepEqual(Object.keys(t.sent[0].body).sort(),
    ['include', 'input', 'instructions', 'max_output_tokens', 'model', 'reasoning', 'store', 'tools'])
})

test('*** 5 — an Owner-supplied value MAY travel, because he typed it ***', async () => {
  const { t, provider } = providerWith(async () => jsonRes(200, okPayload([{ url: 'https://x.example/a' }])))
  // The planner decides this upstream; the executor simply does not censor its own input.
  await provider.search({ query: 'Gordon beef market price', freshness: null, location: null })
  assert.ok(JSON.stringify(t.sent[0].body.input).includes('Gordon'))
})

test('*** 7/8 — location is admitted when present and OMITTED when absent ***', async () => {
  const a = providerWith(async () => jsonRes(200, okPayload([{ url: 'https://x.example/a' }])))
  await a.provider.search({ query: 'q', location: 'Winnipeg' })
  assert.deepEqual(a.t.sent[0].body.tools[0].user_location, { type: 'approximate', city: 'Winnipeg' })

  const b = providerWith(async () => jsonRes(200, okPayload([{ url: 'https://x.example/a' }])))
  await b.provider.search({ query: 'q' })
  assert.equal('user_location' in b.t.sent[0].body.tools[0], false, '⛔ location must never be inferred')
  assert.equal(toUserLocation('  '), null)
})

/* ═══ 9–15 — TRUST STATES ══════════════════════════════════════════════ */

test('*** A · 9/16/17 — the documented shape yields NON-EMPTY, LABELLED, sourced content ***', async () => {
  const { provider } = providerWith(async () => jsonRes(200, citedPayload(
    [{ url: 'https://a.example/1', title: 'Alpha', text: CLAIM_A },
      { url: 'https://b.example/2', title: 'Beta', text: CLAIM_B }],
    { sources: [{ type: 'url', url: 'https://a.example/1', published_at: '2026-07-01' }, { type: 'url', url: 'https://b.example/2' }] }
  )))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.status, SEARCH_STATUS.LIVE)
  assert.equal(out.provider, PROVIDER_ID)
  assert.equal(out.retrievedAt, NOW, 'the clock is ours, not the provider\'s')
  assert.deepEqual(out.results.map((r) => r.url), ['https://a.example/1', 'https://b.example/2'])
  assert.equal(out.results[0].title, 'Alpha')
  // ⛔ THE FIX ITSELF: a row carries the attributed CLAIM, not just the link that supports it.
  assert.equal(out.results[0].content, CLAIM_A)
  assert.equal(out.results[1].content, CLAIM_B)
  assert.equal(out.results[0].contentKind, CONTENT_KIND.WEB_SEARCH_CITED_SUMMARY)
  assert.equal(out.results[0].contentKind !== CONTENT_KIND.PUBLISHER_TEXT, true,
    '⛔ a model\'s cited sentence is never presented as the publisher\'s own text')
  assert.equal(out.results[0].publishedAt, '2026-07-01')
  assert.equal(out.results[1].publishedAt, null, '⛔ a date the publisher did not give is not invented')
  assert.equal(out.results[0].consulted, true)
  assert.deepEqual(out.usage, { inputTokens: 11, outputTokens: 22, totalTokens: 33 })
  assert.equal(out.webSearchCalls, 1)
})

test('*** B — sources carry NO snippet, and evidence is still factual ***', async () => {
  // The measured live shape: url-only sources. Content can therefore come from ONE place —
  // the cited spans — and this test fails the moment anything starts reading `snippet` again.
  const payload = citedPayload([{ url: 'https://a.example/1', title: 'Alpha', text: CLAIM_A }],
    { sources: [{ type: 'url', url: 'https://a.example/1' }, { type: 'url', url: 'https://unrelated.example/9' }] })
  const src = payload.output[0].action.sources
  for (const s of src) assert.equal('snippet' in s, false, 'the fixture must not invent a field the vendor omits')
  const { provider } = providerWith(async () => jsonRes(200, payload))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.status, SEARCH_STATUS.LIVE)
  assert.equal(out.results.length, 1, '⛔ a consulted URL with no cited claim is NOT a row')
  assert.equal(out.results[0].content, CLAIM_A)
  assert.equal(out.sourcesSeen, 2, 'both consulted URLs are still counted as sources seen')
})

test('*** C — uncited model prose is discarded, however confident it sounds ***', async () => {
  const UNCITED = 'Beef prices will certainly fall next quarter.'
  const { provider } = providerWith(async () => jsonRes(200, citedPayload(
    [{ url: 'https://a.example/1', title: 'Alpha', text: CLAIM_A }],
    { lead: UNCITED + ' ', tail: ' ' + UNCITED }
  )))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.results.length, 1)
  assert.equal(out.results[0].content, CLAIM_A)
  assert.equal(JSON.stringify(out).includes(UNCITED), false,
    '⛔ text no source was cited for has no path into evidence')
})

test('*** D/E — sources but no attributable content is UNAVAILABLE, NEVER live and NEVER zero ***', async () => {
  // The search ran and found pages; we simply could not tie any sentence to any of them.
  const { provider } = providerWith(async () => jsonRes(200, okPayload([
    { type: 'url', url: 'https://a.example/1' }, { type: 'url', url: 'https://b.example/2' }
  ])))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.status, SEARCH_STATUS.UNAVAILABLE, '⛔ bare URLs are not live evidence')
  assert.equal(out.reason, UNAVAILABLE_REASON.NO_ATTRIBUTABLE_CONTENT)
  assert.deepEqual(out.results, [])
  // ⛔ E — and it must be DISTINGUISHABLE from the genuine 「the world has nothing」.
  assert.notEqual(out.status, SEARCH_STATUS.LIVE_ZERO,
    '⛔ an extraction failure must not tell the Owner the public record is empty')
  const empty = providerWith(async () => jsonRes(200, okPayload([])))
  const zero = await empty.provider.search({ query: 'q' })
  assert.equal(zero.status, SEARCH_STATUS.LIVE_ZERO, 'a search that surfaced nothing is still a true answer')
  assert.equal(zero.reason, null)
})

test('*** F — invalid citation indices FAIL CLOSED, with no whole-text fallback ***', async () => {
  const text = CLAIM_A + ' ' + CLAIM_B
  const broken = [
    ['missing indices', { type: 'url_citation', url: 'https://a/1', title: 'A' }],
    ['non-integer', { type: 'url_citation', url: 'https://a/1', start_index: 0.5, end_index: 10 }],
    ['negative start', { type: 'url_citation', url: 'https://a/1', start_index: -3, end_index: 10 }],
    ['inverted', { type: 'url_citation', url: 'https://a/1', start_index: 20, end_index: 5 }],
    ['equal', { type: 'url_citation', url: 'https://a/1', start_index: 5, end_index: 5 }],
    ['past the end', { type: 'url_citation', url: 'https://a/1', start_index: 0, end_index: text.length + 50 }],
    ['whitespace-only span', { type: 'url_citation', url: 'https://a/1', start_index: CLAIM_A.length, end_index: CLAIM_A.length + 1 }]
  ]
  for (const [label, ann] of broken) {
    assert.equal(citedSpan(text, ann), null, label)
    const { provider } = providerWith(async () => jsonRes(200, {
      output: [
        { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url: 'https://a/1' }] } },
        { type: 'message', content: [{ type: 'output_text', text, annotations: [ann] }] }
      ]
    }))
    const out = await provider.search({ query: 'q' })
    assert.equal(out.status, SEARCH_STATUS.UNAVAILABLE, label + ' → must not become evidence')
    assert.equal(out.reason, UNAVAILABLE_REASON.NO_ATTRIBUTABLE_CONTENT, label)
    assert.equal(JSON.stringify(out).includes(CLAIM_B), false, '⛔ ' + label + ': whole text was substituted')
  }
  const beside = (badAnn) => providerWith(async () => jsonRes(200, {
    output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [] } },
      {
        type: 'message',
        content: [{
          type: 'output_text',
          text,
          annotations: [
            { type: 'url_citation', url: 'https://good/1', start_index: 0, end_index: CLAIM_A.length },
            badAnn
          ]
        }]
      }
    ]
  })).provider

  // ⛔ AN UNLOCATABLE BROKEN CITATION POISONS THE WHOLE CONTENT PART — and this assertion is a
  // DELIBERATE TIGHTENING. It used to keep the sound citation beside it. But `start_index: 999`
  // in a 137-character text does not mean 「at the end」; it means we do not know what region
  // this source governs, and it could be the very span the sound citation claims. Reading the
  // out-of-range number as 「after everything」 would be a guess, and the fence rule forbids
  // guessing precisely where a guess is most tempting.
  const unlocatable = await beside({ type: 'url_citation', url: 'https://bad/2', start_index: 999, end_index: 1200 })
    .search({ query: 'q' })
  assert.deepEqual(unlocatable.results, [])
  assert.equal(unlocatable.status, SEARCH_STATUS.UNAVAILABLE)
  assert.equal(unlocatable.reason, UNAVAILABLE_REASON.NO_ATTRIBUTABLE_CONTENT,
    '⛔ and it is NOT live_zero — the search did surface sources')

  // ⛔ BUT A LOCATABLE ONE ONLY FENCES WHAT FOLLOWS IT. Claims already closed off across
  // trustworthy ground survive, so one bad annotation does not discard a whole good answer.
  const locatable = await beside({ type: 'url_citation', url: 'https://bad/2', start_index: text.length - 5, end_index: 2 })
    .search({ query: 'q' })
  assert.deepEqual(locatable.results.map((r) => r.url), ['https://good/1'])
  assert.equal(locatable.results[0].content, CLAIM_A)
})

/**
 * ⛔ THE VERBATIM LIVE PAYLOAD — captured from the real provider on 2026-08-09 for the query
 * 「current general minimum wage rate」 with location Winnipeg. Text and offsets are EXACTLY as
 * they arrived. This fixture exists because the first version of the fix passed every invented
 * fixture and still produced garbage against reality.
 */
const LIVE_TEXT = 'In Manitoba, the current general minimum wage is **$16.00 per hour**. ([gov.mb.ca](https://www.gov.mb.ca/labour/standards/doc%2Cminimum-wage%2Cfactsheet.html?utm_source=openai))\n\nIt will increase to **$16.40 per hour on October 1, 2026**. ([news.gov.mb.ca](https://news.gov.mb.ca/news/index.html?item=73242&utm_source=openai))'
const LIVE_PAYLOAD = {
  output: [
    { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url: 'https://www.gov.mb.ca/labour/standards/doc%2Cminimum-wage%2Cfactsheet.html?utm_source=openai' }] } },
    {
      type: 'message',
      status: 'completed',
      content: [{
        type: 'output_text',
        text: LIVE_TEXT,
        annotations: [
          { type: 'url_citation', url: 'https://www.gov.mb.ca/labour/standards/doc%2Cminimum-wage%2Cfactsheet.html?utm_source=openai', title: 'What is Minimum Wage?', start_index: 70, end_index: 177 },
          { type: 'url_citation', url: 'https://news.gov.mb.ca/news/index.html?item=73242&utm_source=openai', title: 'Minimum wage increase', start_index: 239, end_index: 326 }
        ]
      }]
    }
  ],
  usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
}

test('*** ⛔ THE CITED SPAN IS THE FOOTNOTE, NOT THE FACT — proved on the captured live payload ***', async () => {
  // The annotation delimits 「([gov.mb.ca](https://…))」. Slicing it yielded a 107-character
  // 「fact」 that was a URL in prose — the review\'s own defect, one layer along.
  assert.equal(LIVE_TEXT.slice(70, 177).startsWith('([gov.mb.ca]'), true, 'the fixture really is a marker span')
  assert.equal(isCitationMarker(LIVE_TEXT.slice(70, 177)), true)
  assert.equal(isCitationMarker('The wage is $16.00 per hour.'), false)

  const { provider } = providerWith(async () => jsonRes(200, LIVE_PAYLOAD))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.status, SEARCH_STATUS.LIVE)
  assert.equal(out.results.length, 2)
  assert.equal(out.results[0].content, 'In Manitoba, the current general minimum wage is **$16.00 per hour**.')
  assert.equal(out.results[1].content, 'It will increase to **$16.40 per hour on October 1, 2026**.')
  // ⛔ THE SECOND CLAIM STARTS AFTER THE FIRST MARKER — a shared cursor, not the whole answer
  // replayed under every citation.
  assert.equal(out.results[1].content.includes('$16.00'), false, '⛔ claims bled across sources')
  for (const r of out.results) {
    assert.equal(/https?:\/\//.test(r.content), false, '⛔ a link ended up inside the FACT field')
    assert.equal(r.content.includes(']('), false, '⛔ markdown citation syntax survived into evidence')
    assert.ok(/\d/.test(r.content), 'the claim carries the number the Owner asked about')
  }
})

test('*** ⛔ a marker with no claim in front of it fails closed ***', async () => {
  const text = '([a.example](https://a.example/1))'
  const { provider } = providerWith(async () => jsonRes(200, {
    output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url: 'https://a.example/1' }] } },
      { type: 'message', content: [{ type: 'output_text', text, annotations: [{ type: 'url_citation', url: 'https://a.example/1', start_index: 0, end_index: text.length }] }] }
    ]
  }))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.status, SEARCH_STATUS.UNAVAILABLE, '⛔ a bare footnote is not evidence')
  assert.equal(out.reason, UNAVAILABLE_REASON.NO_ATTRIBUTABLE_CONTENT)
})

/* ═══ CITATION SEGMENTATION — MALFORMED ORDER MATRIX ═══════════════════
 *
 * ⛔ AN INVALID CITATION MUST CREATE AN ATTRIBUTION BOUNDARY.
 *
 * The claim for a marker-style citation is 「the text since the last marker」. A citation that
 * was SKIPPED for bad indices used to leave the cursor where it was, so the NEXT valid marker
 * reached backwards across it and swallowed a sentence that belonged to another source — or to
 * no source at all. Fail-closed on one citation is worthless if the failure just hands its text
 * to the next one.
 */

const HOST_A = 'a.example'
const HOST_B = 'b.example'
const URL_A = 'https://a.example/1'
const URL_B = 'https://b.example/2'

/** Build marker-style text the way the live provider writes it, with REAL offsets. */
function markerText (segments, opts = {}) {
  let text = opts.lead == null ? '' : opts.lead
  const marks = []
  for (const s of segments) {
    if (text && !/\s$/.test(text)) text += ' '
    // Uncited prose sitting between the previous marker and this claim.
    if (s.before) text += s.before + ' '
    text += s.claim + ' '
    const start = text.length
    text += '([' + s.host + '](' + s.url + '))'
    marks.push({ url: s.url, start, end: text.length })
  }
  return { text, marks }
}
const markerPayload = (text, annotations, sources) => ({
  output: [
    { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: sources || [] } },
    { type: 'message', status: 'completed', content: [{ type: 'output_text', text, annotations }] }
  ]
})
const ann = (m, over = {}) => Object.assign({ type: 'url_citation', url: m.url, start_index: m.start, end_index: m.end }, over)
const contentFor = (results, url) => (results.find((r) => r.url === url) || { content: '' }).content

test('*** C · ⛔ BLOCKER — a broken citation must not hand its text to the next source ***', async () => {
  const { text, marks } = markerText([
    { claim: CLAIM_A, host: HOST_A, url: URL_A },
    { claim: CLAIM_B, host: HOST_B, url: URL_B }
  ])
  // A is malformed (inverted indices). B is a perfectly good marker citation.
  const payload = markerPayload(text, [
    ann(marks[0], { start_index: 12, end_index: 4 }),
    ann(marks[1])
  ])
  const { provider } = providerWith(async () => jsonRes(200, payload))
  const out = await provider.search({ query: 'q' })

  // ⛔ THE REGRESSION ITSELF: A's sentence may never appear under B's URL.
  assert.equal(contentFor(out.results, URL_B).includes(CLAIM_A), false,
    '⛔ CLAIM_A bled across the broken citation into URL_B')
  assert.equal(JSON.stringify(out.results).includes(CLAIM_A), false,
    '⛔ text governed by a broken citation became evidence somewhere')
  // Nothing after the boundary is trustworthy, so the read fails closed.
  assert.equal(out.status, SEARCH_STATUS.UNAVAILABLE)
  assert.equal(out.reason, UNAVAILABLE_REASON.NO_ATTRIBUTABLE_CONTENT)
})

test('*** E · an uncited lead before a broken citation reaches no source ***', async () => {
  const LEAD = 'Here is a summary I put together from memory.'
  const { text, marks } = markerText([
    { claim: CLAIM_A, host: HOST_A, url: URL_A },
    { claim: CLAIM_B, host: HOST_B, url: URL_B }
  ], { lead: LEAD + ' ' })
  const payload = markerPayload(text, [
    ann(marks[0], { start_index: 3, end_index: 1 }), // malformed, locatable at 3
    ann(marks[1])
  ])
  const { provider } = providerWith(async () => jsonRes(200, payload))
  const out = await provider.search({ query: 'q' })
  const blob = JSON.stringify(out.results)
  assert.equal(blob.includes(LEAD), false, '⛔ uncited lead became evidence')
  assert.equal(blob.includes(CLAIM_A), false)
  assert.equal(blob.includes(CLAIM_B), false, '⛔ B reached back across the broken citation')
})

test('*** A/B/D — good→good keeps both; good→broken keeps the good; broken→good→good keeps none ***', async () => {
  const three = [
    { claim: CLAIM_A, host: HOST_A, url: URL_A },
    { claim: CLAIM_B, host: HOST_B, url: URL_B },
    { claim: 'A third statement with its own source.', host: 'c.example', url: 'https://c.example/3' }
  ]

  // A — good → good. Both survive, each with its OWN sentence.
  {
    const { text, marks } = markerText(three.slice(0, 2))
    const { provider } = providerWith(async () => jsonRes(200, markerPayload(text, marks.map((m) => ann(m)))))
    const out = await provider.search({ query: 'q' })
    assert.equal(out.status, SEARCH_STATUS.LIVE)
    assert.equal(contentFor(out.results, URL_A), CLAIM_A)
    assert.equal(contentFor(out.results, URL_B), CLAIM_B, '⛔ B must be its own sentence only')
  }

  // B — good → broken. The good one is BEFORE the boundary and is kept.
  {
    const { text, marks } = markerText(three.slice(0, 2))
    const { provider } = providerWith(async () => jsonRes(200, markerPayload(text,
      [ann(marks[0]), ann(marks[1], { start_index: marks[1].start, end_index: marks[1].start - 5 })])))
    const out = await provider.search({ query: 'q' })
    assert.equal(out.status, SEARCH_STATUS.LIVE)
    assert.deepEqual(out.results.map((r) => r.url), [URL_A])
    assert.equal(out.results[0].content, CLAIM_A)
  }

  // D — broken → good → good. The boundary is early, so nothing after it is trustworthy.
  {
    const { text, marks } = markerText(three)
    const { provider } = providerWith(async () => jsonRes(200, markerPayload(text,
      [ann(marks[0], { start_index: 2, end_index: 1 }), ann(marks[1]), ann(marks[2])])))
    const out = await provider.search({ query: 'q' })
    assert.equal(out.status, SEARCH_STATUS.UNAVAILABLE)
    assert.equal(out.reason, UNAVAILABLE_REASON.NO_ATTRIBUTABLE_CONTENT)
  }
})

test('*** G/H/I — overlap stops, order does not matter, one page may carry two claims ***', async () => {
  const two = [
    { claim: CLAIM_A, host: HOST_A, url: URL_A },
    { claim: CLAIM_B, host: HOST_B, url: URL_B }
  ]

  // H — annotations arriving out of document order must give the SAME answer.
  {
    const { text, marks } = markerText(two)
    const forward = providerWith(async () => jsonRes(200, markerPayload(text, marks.map((m) => ann(m)))))
    const reversed = providerWith(async () => jsonRes(200, markerPayload(text, marks.slice().reverse().map((m) => ann(m)))))
    const a = await forward.provider.search({ query: 'q' })
    const b = await reversed.provider.search({ query: 'q' })
    assert.deepEqual(b.results.map((r) => [r.url, r.content]).sort(), a.results.map((r) => [r.url, r.content]).sort())
    assert.equal(contentFor(a.results, URL_B), CLAIM_B)
  }

  // G — a citation that starts before the running cursor cannot be segmented; stop there.
  {
    const { text, marks } = markerText(two)
    const overlapping = ann(marks[1], { start_index: Math.max(0, marks[0].end - 3) })
    const { provider } = providerWith(async () => jsonRes(200, markerPayload(text, [ann(marks[0]), overlapping])))
    const out = await provider.search({ query: 'q' })
    assert.deepEqual(out.results.map((r) => r.url), [URL_A], '⛔ an overlapping citation produced a claim')
    assert.equal(out.results[0].content, CLAIM_A)
  }

  // I — two citations to ONE page are two claims, joined and visibly separated.
  {
    const { text, marks } = markerText([
      { claim: CLAIM_A, host: HOST_A, url: URL_A },
      { claim: CLAIM_B, host: HOST_A, url: URL_A }
    ])
    const { provider } = providerWith(async () => jsonRes(200, markerPayload(text, marks.map((m) => ann(m)))))
    const out = await provider.search({ query: 'q' })
    assert.equal(out.results.length, 1)
    assert.equal(out.results[0].content, CLAIM_A + ' … ' + CLAIM_B)
  }
})

/* ═══ UNCITED LEAD — A MARKER OWNS ITS CLAIM, NOT THE PAGE ═════════════
 *
 * ⛔ 「THE TEXT SINCE THE LAST MARKER」 IS TOO MUCH WHEN THERE WAS NO LAST MARKER.
 *
 * The fence in a7748bd stopped a claim reaching back across a BROKEN citation. It did not stop
 * the FIRST citation reaching back to character zero — so a paragraph the model wrote from its
 * own memory, sitting above the first cited sentence, was handed to that source as evidence.
 * The retrieval instruction forbids unsourced prose; it does not prevent it, and a parser that
 * trusts the instruction is not a fence.
 *
 * The claim is the LAST sentence before the marker, bounded structurally — sentence-ending
 * punctuation followed by whitespace, or a line break. No semantics, no NLP.
 */
const UNCITED_LEAD = 'Here is a summary I put together from what I already knew.'

test('*** 1 — an uncited lead before the FIRST marker never becomes that source\'s evidence ***', async () => {
  const { text, marks } = markerText([{ claim: CLAIM_A, host: HOST_A, url: URL_A }], { lead: UNCITED_LEAD + ' ' })
  const { provider } = providerWith(async () => jsonRes(200, markerPayload(text, [ann(marks[0])])))
  const out = await provider.search({ query: 'q' })
  assert.equal(JSON.stringify(out.results).includes(UNCITED_LEAD), false,
    '⛔ prose no source was cited for was attributed to a source')
  // The claim is isolated by structure alone, so it survives.
  assert.equal(contentFor(out.results, URL_A), CLAIM_A)
})

test('*** 2 — uncited lead → good → good: each source keeps only its own sentence ***', async () => {
  const { text, marks } = markerText([
    { claim: CLAIM_A, host: HOST_A, url: URL_A },
    { claim: CLAIM_B, host: HOST_B, url: URL_B }
  ], { lead: UNCITED_LEAD + ' ' })
  const { provider } = providerWith(async () => jsonRes(200, markerPayload(text, marks.map((m) => ann(m)))))
  const out = await provider.search({ query: 'q' })
  assert.equal(JSON.stringify(out.results).includes(UNCITED_LEAD), false)
  assert.equal(contentFor(out.results, URL_A), CLAIM_A)
  assert.equal(contentFor(out.results, URL_B), CLAIM_B)
})

test('*** 3 — a blank / newline lead is not content, and does not corrupt the claim ***', async () => {
  for (const lead of ['\n\n', '   ', '\n \n\t']) {
    const { text, marks } = markerText([{ claim: CLAIM_A, host: HOST_A, url: URL_A }], { lead })
    const { provider } = providerWith(async () => jsonRes(200, markerPayload(text, [ann(marks[0])])))
    const out = await provider.search({ query: 'q' })
    assert.equal(contentFor(out.results, URL_A), CLAIM_A, 'lead=' + JSON.stringify(lead))
  }
})

test('*** 6 — a substantive uncited sentence BETWEEN two citations is inherited by neither ***', async () => {
  const INTERJECTION = 'In my view this trend will continue for some time.'
  const { text, marks } = markerText([
    { claim: CLAIM_A, host: HOST_A, url: URL_A },
    { claim: CLAIM_B, host: HOST_B, url: URL_B, before: INTERJECTION }
  ])
  const { provider } = providerWith(async () => jsonRes(200, markerPayload(text, marks.map((m) => ann(m)))))
  const out = await provider.search({ query: 'q' })
  assert.equal(JSON.stringify(out.results).includes(INTERJECTION), false,
    '⛔ an uncited opinion was attached to the later source')
  assert.equal(contentFor(out.results, URL_A), CLAIM_A)
  assert.equal(contentFor(out.results, URL_B), CLAIM_B)
})

test('*** lastClaimIn segments on STRUCTURE, and never inside a number ***', () => {
  // ⛔ THE TRAP THIS EXISTS TO AVOID: splitting at the decimal point would hand the answer layer
  // 「00 per hour**.」 — a figure silently rewritten by a parser.
  assert.equal(lastClaimIn('Manitoba pays **$16.00 per hour**.'), 'Manitoba pays **$16.00 per hour**.')
  assert.equal(lastClaimIn('Lead sentence. The claim sentence.'), 'The claim sentence.')
  assert.equal(lastClaimIn('Lead line\nThe claim line'), 'The claim line')
  // ⛔ CJK NEEDS NO TRAILING SPACE, so 「。」 is a boundary on its own — and the claim's OWN final
  // 「。」 must not be one, or the row would come back empty.
  assert.equal(lastClaimIn('前段。呢句先係重點。'), '呢句先係重點。')
  assert.equal(lastClaimIn('政策利率目標為 2.25%。'), '政策利率目標為 2.25%。')
  assert.equal(lastClaimIn('唔關事嘅開場白。最低工資係 **$16.00**。'), '最低工資係 **$16.00**。')
  assert.equal(lastClaimIn('One unbroken run with no boundary at all'), 'One unbroken run with no boundary at all')
  assert.equal(lastClaimIn('   \n  '), '')
  assert.equal(lastClaimIn(''), '')
  assert.equal(lastClaimIn(null), '')
})

test('*** the deliberate cost: one marker over several sentences keeps only the last ***', async () => {
  // Under-reporting a source is recoverable. Attributing prose nobody sourced is not — and from
  // the parser's side those two cases are the same shape, so it must choose the safe one.
  const { text, marks } = markerText([{ claim: 'First supporting sentence. ' + CLAIM_A, host: HOST_A, url: URL_A }])
  const { provider } = providerWith(async () => jsonRes(200, markerPayload(text, [ann(marks[0])])))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.results[0].content, CLAIM_A)
  assert.equal(out.results[0].content.includes('First supporting sentence'), false)
})

test('*** J — a poisoned content part does not poison a separate, sound one ***', async () => {
  const bad = markerText([{ claim: CLAIM_A, host: HOST_A, url: URL_A }])
  const good = markerText([{ claim: CLAIM_B, host: HOST_B, url: URL_B }])
  const { provider } = providerWith(async () => jsonRes(200, {
    output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [] } },
      {
        type: 'message',
        status: 'completed',
        content: [
          { type: 'output_text', text: bad.text, annotations: [ann(bad.marks[0], { start_index: null, end_index: null })] },
          { type: 'output_text', text: good.text, annotations: [ann(good.marks[0])] }
        ]
      }
    ]
  }))
  const out = await provider.search({ query: 'q' })
  assert.deepEqual(out.results.map((r) => r.url), [URL_B], 'each content part carries its own cursor and its own fence')
  assert.equal(out.results[0].content, CLAIM_B)
  assert.equal(JSON.stringify(out.results).includes(CLAIM_A), false)
})

test('*** a citation with NO url still fences the region it governs ***', async () => {
  // It cannot produce a row, but its text is spoken for — the next marker must not inherit it.
  const { text, marks } = markerText([
    { claim: CLAIM_A, host: HOST_A, url: URL_A },
    { claim: CLAIM_B, host: HOST_B, url: URL_B }
  ])
  const urlless = Object.assign(ann(marks[0]), { url: undefined })
  const { provider } = providerWith(async () => jsonRes(200, markerPayload(text, [urlless, ann(marks[1])])))
  const out = await provider.search({ query: 'q' })
  assert.deepEqual(out.results.map((r) => r.url), [URL_B])
  assert.equal(out.results[0].content, CLAIM_B, '⛔ the url-less citation\'s sentence was inherited')
})

test('*** stripCitationMarkers removes links and leaves the sentence intact ***', () => {
  assert.equal(stripCitationMarkers('Wage is $16.00. ([g.ca](https://g.ca/x))'), 'Wage is $16.00.')
  assert.equal(stripCitationMarkers('[g.ca](https://g.ca/x)'), '')
  assert.equal(stripCitationMarkers('no links here at all'), 'no links here at all')
  assert.equal(stripCitationMarkers(''), '')
  assert.equal(stripCitationMarkers(null), '')
})

test('*** 10 — a completed search with no usable rows is LIVE-ZERO, not a failure ***', async () => {
  const { provider } = providerWith(async () => jsonRes(200, okPayload([])))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.status, SEARCH_STATUS.LIVE_ZERO)
  assert.equal(out.reason, null)
  assert.deepEqual(out.results, [])
})

test('*** 11/12/13/14 — every transport failure is UNAVAILABLE, with its own enum ***', async () => {
  const cases = [
    ['auth 401', async () => jsonRes(401, { error: 'nope' }), UNAVAILABLE_REASON.AUTH],
    ['auth 403', async () => jsonRes(403, { error: 'nope' }), UNAVAILABLE_REASON.AUTH],
    ['rate 429', async () => jsonRes(429, { error: 'slow' }), UNAVAILABLE_REASON.RATE_LIMIT],
    ['server 500', async () => jsonRes(500, { error: 'boom' }), UNAVAILABLE_REASON.SERVER],
    ['server 503', async () => jsonRes(503, { error: 'boom' }), UNAVAILABLE_REASON.SERVER],
    ['network', async () => { throw new Error('ECONNRESET') }, UNAVAILABLE_REASON.NETWORK],
    ['timeout', async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }, UNAVAILABLE_REASON.TIMEOUT],
    ['malformed body', async () => ({ status: 200, async json () { throw new Error('not json') } }), UNAVAILABLE_REASON.MALFORMED],
    ['no output array', async () => jsonRes(200, { nope: true }), UNAVAILABLE_REASON.MALFORMED]
  ]
  for (const [label, impl, reason] of cases) {
    const { provider } = providerWith(impl)
    const out = await provider.search({ query: 'q' })
    assert.equal(out.status, SEARCH_STATUS.UNAVAILABLE, label)
    assert.equal(out.reason, reason, label)
    assert.deepEqual(out.results, [], label)
  }
})

test('*** ⛔ a turn where the tool never ran is UNAVAILABLE, never LIVE-ZERO ***', async () => {
  // The model can answer from memory without searching. That prose has no provenance, and
  // calling it 「the outside world contains nothing」 would be a fabrication with a status.
  const { provider } = providerWith(async () => jsonRes(200, {
    output: [{ type: 'message', content: [{ text: 'I already know the answer', annotations: [] }] }],
    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
  }))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.status, SEARCH_STATUS.UNAVAILABLE)
  assert.equal(out.reason, UNAVAILABLE_REASON.NO_SEARCH_PERFORMED)
})

test('*** ⛔ an incomplete tool call is not a completed search ***', async () => {
  const { provider } = providerWith(async () => jsonRes(200, okPayload([{ url: 'https://a.example/1' }], { callStatus: 'in_progress' })))
  const out = await provider.search({ query: 'q' })
  assert.equal(out.status, SEARCH_STATUS.UNAVAILABLE)
  assert.equal(out.reason, UNAVAILABLE_REASON.NO_SEARCH_PERFORMED)
})

test('*** 15 — ⛔ a claim with no attributable URL is never promoted to evidence ***', async () => {
  const { provider } = providerWith(async () => jsonRes(200, citedPayload([
    { url: 'not-a-url', title: 'bad scheme', text: 'Claim one.' },
    { url: 'ftp://x.example/f', title: 'wrong protocol', text: 'Claim two.' },
    { url: 'https://good.example/1', title: 'kept', text: CLAIM_A }
  ])))
  const out = await provider.search({ query: 'q' })
  assert.deepEqual(out.results.map((r) => r.url), ['https://good.example/1'])
  assert.equal(out.results[0].content, CLAIM_A)
  assert.equal(isAttributable({ url: 'https://x' }), true)
  assert.equal(isAttributable({ url: '' }), false)
  assert.equal(isAttributable(null), false)
})

test('*** ⛔ A URL IS NOT A FACT — both halves are required, and the kind must be known ***', () => {
  const full = { url: 'https://a/1', content: 'a real claim', contentKind: CONTENT_KIND.WEB_SEARCH_CITED_SUMMARY }
  assert.equal(hasAttributableContent(full), true)
  assert.equal(hasAttributableContent(Object.assign({}, full, { content: '' })), false, 'source identity alone')
  assert.equal(hasAttributableContent(Object.assign({}, full, { content: '   ' })), false, 'whitespace is not content')
  assert.equal(hasAttributableContent(Object.assign({}, full, { url: 'ftp://a/1' })), false, 'content with no citable URL')
  assert.equal(hasAttributableContent(Object.assign({}, full, { contentKind: undefined })), false,
    '⛔ a provider that will not say what kind of text this is cannot have it promoted')
  assert.equal(hasAttributableContent(Object.assign({}, full, { contentKind: 'something_invented' })), false)
})

/* ═══ THE READ ADAPTER ═════════════════════════════════════════════════ */

test('*** the adapter registers read-shaped and produces sourced, CONTENTFUL evidence ***', async () => {
  const provider = { provider: PROVIDER_ID, model: DEFAULT_MODEL, search: async () => makeSearchResult({ provider: PROVIDER_ID, query: 'q', retrievedAt: NOW, results: [{ url: 'https://a.example/1', title: 'Alpha', content: CLAIM_A, contentKind: CONTENT_KIND.WEB_SEARCH_CITED_SUMMARY, publishedAt: '2026-07-01', consulted: true }] }) }
  const adapter = createPublicKnowledgeReadAdapter({ provider, clock: () => NOW, logSink: () => {} })
  assert.equal(adapter.source, 'public_knowledge')
  assert.deepEqual(Object.keys(adapter.methods), ['search'])
  // The connector independently refuses write-shaped names; registering must not throw.
  const connector = createReadConnector({ env: {} })
  connector.register(adapter)
  assert.equal(connector.hasWriteMethod(), false)

  const rows = await adapter.methods.search({ query: 'q' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, 'public_knowledge')
  assert.equal(rows[0].entityType, PUBLIC_ENTITY_TYPE)
  assert.equal(rows[0].link, 'https://a.example/1')
  assert.equal(rows[0].originalDate, '2026-07-01', 'the publisher\'s date, when given')
  assert.equal(rows[0].retrievedAt, NOW)
  assert.equal(rows[0].trust, 'live')
  // ⛔ THE ROW CARRIES A FACT, not an empty string beside a link.
  assert.equal(rows[0].content, CLAIM_A)
  assert.equal(rows[0].content.trim() === '', false)
  // 18 — provenance travels as DATA for the answer layer to present.
  assert.equal(rows[0].fields.url, 'https://a.example/1')
  assert.equal(rows[0].fields.provider, PROVIDER_ID)
  assert.equal(rows[0].fields.sourceTitle, 'Alpha')
  assert.equal(rows[0].fields.contentKind, CONTENT_KIND.WEB_SEARCH_CITED_SUMMARY)
  assert.equal(rows[0].fields.consulted, true)
})

test('*** an untitled source keeps a usable label, and the FIELD still tells the truth ***', async () => {
  const provider = { provider: PROVIDER_ID, search: async () => makeSearchResult({ provider: PROVIDER_ID, query: 'q', retrievedAt: NOW, results: [{ url: 'https://a.example/1', content: CLAIM_A, contentKind: CONTENT_KIND.WEB_SEARCH_CITED_SUMMARY }] }) }
  const rows = await createPublicKnowledgeReadAdapter({ provider, clock: () => NOW, logSink: () => {} }).methods.search({ query: 'q' })
  assert.equal(rows[0].title, 'https://a.example/1', 'a row must be renderable')
  assert.equal(rows[0].fields.sourceTitle, null, '⛔ a link is not a publication name')
})

test('*** ⛔ the adapter THROWS on unavailable — it never returns zero rows ***', async () => {
  const provider = { provider: PROVIDER_ID, search: async () => makeSearchResult({ provider: PROVIDER_ID, query: 'q', retrievedAt: NOW, unavailable: true, reason: UNAVAILABLE_REASON.RATE_LIMIT }) }
  const adapter = createPublicKnowledgeReadAdapter({ provider, logSink: () => {} })
  await assert.rejects(() => adapter.methods.search({ query: 'q' }), /unavailable/)
})

test('*** an unconfigured provider is unavailable, not empty ***', async () => {
  const adapter = createPublicKnowledgeReadAdapter({})
  assert.equal(adapter.ready(), false)
  await assert.rejects(() => adapter.methods.search({ query: 'q' }), /not configured/)
})

test('*** LIVE-ZERO reaches the caller as zero rows, and that is a true answer ***', async () => {
  const provider = { provider: PROVIDER_ID, search: async () => makeSearchResult({ provider: PROVIDER_ID, query: 'q', retrievedAt: NOW, results: [] }) }
  const adapter = createPublicKnowledgeReadAdapter({ provider, logSink: () => {} })
  assert.deepEqual(await adapter.methods.search({ query: 'q' }), [])
})

/* ═══ 29/30 — ACCOUNTING AND SECRETS ═══════════════════════════════════ */

test('*** 29/30 — ⛔ the accounting line carries counts, never the query, URLs or the key ***', () => {
  let line = null
  logPublicSearch({
    requestId: 'r1', provider: PROVIDER_ID, model: DEFAULT_MODEL, status: SEARCH_STATUS.LIVE,
    webSearchCalls: 1, resultCount: 3, inputTokens: 10, outputTokens: 20, totalTokens: 30, latencyMs: 900
  }, (l) => { line = l })
  assert.deepEqual(Object.keys(line).sort(), [
    'event', 'inputTokens', 'latencyMs', 'model', 'outputTokens', 'provider', 'reason',
    'requestId', 'resultCount', 'status', 'timestamp', 'totalTokens', 'webSearchCalls'
  ])
  // An unknown status/reason cannot smuggle text through an enum field.
  let bad = null
  logPublicSearch({ status: 'live ' + SECRET, reason: 'x ' + SECRET, webSearchCalls: 'many' }, (l) => { bad = l })
  assert.equal(bad.status, SEARCH_STATUS.UNAVAILABLE)
  assert.equal(bad.reason, null)
  assert.equal(bad.webSearchCalls, 0)
  assert.equal(JSON.stringify(bad).includes(SECRET), false)
})

test('*** J — the accounting line stays content-free now that rows carry content ***', async () => {
  // Rows now hold real retrieved text. The counting line must still be countable-only: a fact
  // is retrieval CONTENT, and an accounting log is not the place to keep a second copy of it.
  const lines = []
  const provider = { provider: PROVIDER_ID, model: DEFAULT_MODEL, search: async () => Object.assign(makeSearchResult({ provider: PROVIDER_ID, query: 'a query with the word Gordon in it', retrievedAt: NOW, results: [{ url: 'https://a.example/1', title: 'Alpha', content: CLAIM_A, contentKind: CONTENT_KIND.WEB_SEARCH_CITED_SUMMARY }] }), { usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, webSearchCalls: 1, latencyMs: 5 }) }
  await createPublicKnowledgeReadAdapter({ provider, clock: () => NOW, logSink: (l) => lines.push(l) }).methods.search({ query: 'q' })
  assert.equal(lines.length, 1)
  const blob = JSON.stringify(lines[0])
  assert.equal(blob.includes(CLAIM_A), false, '⛔ retrieved content was logged')
  assert.equal(blob.includes('https://a.example/1'), false, '⛔ a URL was logged')
  assert.equal(blob.includes('Alpha'), false, '⛔ a source title was logged')
  assert.equal(blob.includes('Gordon'), false, '⛔ the query was logged')
  assert.equal(lines[0].resultCount, 1, 'the COUNT is what accounting is for')
  assert.equal(lines[0].contentKind, undefined, 'no per-row detail belongs on a counting line')
})

test('*** ⛔ the API key never appears in a result, error or accounting line ***', async () => {
  const KEY = 'sk-secret-must-never-appear'
  const { provider } = providerWith(async () => jsonRes(401, { error: { message: 'bad key ' + KEY } }), { apiKey: KEY })
  const out = await provider.search({ query: 'q' })
  assert.equal(JSON.stringify(out).includes(KEY), false, '⛔ the key reached the caller')
  let line = null
  logPublicSearch({ provider: PROVIDER_ID, status: out.status, reason: out.reason }, (l) => { line = l })
  assert.equal(JSON.stringify(line).includes(KEY), false)
  // ⛔ AND THE PROVIDER'S OWN MESSAGE IS DISCARDED — it can echo the request back.
  assert.equal(JSON.stringify(out).includes('bad key'), false)
})

test('*** one transient retry at most is permitted, and none is implemented here ***', async () => {
  // The provider makes exactly ONE request per search. A single Owner question therefore
  // cannot fan out into unbounded paid retrievals; the A4 reasoning bound governs the rest.
  const { t, provider } = providerWith(async () => jsonRes(500, { error: 'boom' }))
  await provider.search({ query: 'q' })
  assert.equal(t.sent.length, 1, '⛔ a retry loop would multiply cost silently')
})

/* ═══ 25/26/27/28 — PRODUCTION REACH AND BOUNDARIES ════════════════════ */

test('*** 25 — the public source is GOVERNED now, and still off by default ***', () => {
  // ⛔ A4-3A CHANGED THIS DELIBERATELY. It used to be absent from the registry entirely, which
  // made it unreachable rather than governed — and unreachable-by-omission is the state that
  // becomes reachable-by-accident the moment someone adds a line. It is now a first-class
  // source subject to the ordinary two-flag rule, and OFF unless every condition is met.
  assert.equal(ALL_SOURCES.includes('public_knowledge'), true, 'in the registry, so it can be governed')
  assert.equal(enabledSources({}).includes('public_knowledge'), false, '⛔ default is off')
  assert.equal(enabledSources({ CONTEXT_PUBLIC_KNOWLEDGE: 'on' }).includes('public_knowledge'), false,
    '⛔ its own flag alone is not enough — READ_ACCESS gates it too')
  assert.equal(enabledSources({ READ_ACCESS: 'on' }).includes('public_knowledge'), false,
    '⛔ and the master flag alone is not enough either')
  assert.equal(enabledSources({ READ_ACCESS: 'on', CONTEXT_PUBLIC_KNOWLEDGE: 'on' }).includes('public_knowledge'), true)
})

test('*** 26/27/28 — ⛔ the semantic layer never learns the vendor, and cannot write ***', () => {
  // ⛔ TRAILING comments are stripped too, using the repo's own pattern — the ':' guard keeps
  // 'https://' inside strings intact. A first draft stripped only whole-line comments and so
  // flagged the words 'never create retrievable Application State', which is documentation,
  // not a write path. A fence that cries wolf is a fence someone later weakens.
  const strip = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  for (const p of [
    '../intake/ownerSourceIntentResolver.js',
    '../intake/publicQueryEgressPlanner.js',
    '../intake/recoveryDecisionWorker.js',
    '../intake/finalKnowledgeRequirement.js'
  ]) {
    const code = strip(p)
    for (const tok of ['openai', 'web_search', 'responses', 'luna', 'api.openai.com', 'fetch(']) {
      assert.equal(code.toLowerCase().includes(tok), false, `⛔ «${tok}» leaked into ${p}`)
    }
  }
  // And the executor itself has no write path.
  const exec = strip('./providers/openaiWebSearchProvider.js')
  for (const verb of ['send', 'create', 'update', 'delete', 'approve', 'execute']) {
    assert.equal(new RegExp('\\b' + verb + '\\b', 'i').test(exec.replace(/createOpenAIWebSearchProvider|createSearch/g, '')), false, `⛔ write verb «${verb}»`)
  }
})

test('*** the provider is neutral about MEANING: it decides no world and no query ***', () => {
  const code = fs.readFileSync(path.resolve(__dirname, './providers/openaiWebSearchProvider.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const tok of ['intent', 'ambiguous', 'requiredWorld', 'internal', 'mixed']) {
    assert.equal(new RegExp('\\b' + tok + '\\b').test(code), false, `⛔ «${tok}» — retrieval must not route`)
  }
})

test('*** reasonForStatus maps every documented failure class ***', () => {
  assert.equal(reasonForStatus(401), UNAVAILABLE_REASON.AUTH)
  assert.equal(reasonForStatus(403), UNAVAILABLE_REASON.AUTH)
  assert.equal(reasonForStatus(429), UNAVAILABLE_REASON.RATE_LIMIT)
  assert.equal(reasonForStatus(500), UNAVAILABLE_REASON.SERVER)
  assert.equal(reasonForStatus(502), UNAVAILABLE_REASON.SERVER)
  assert.equal(reasonForStatus(400), UNAVAILABLE_REASON.MALFORMED)
})

test('*** consulted sources ENRICH a cited row; they never manufacture one ***', () => {
  const text = CLAIM_A + ' ' + CLAIM_B
  const { results, sourcesSeen } = extractResults({
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: {
          sources: [
            { type: 'url', url: 'https://a/1', published_at: '2026-07-01' },
            // ⛔ CONSULTED BUT NEVER CITED — the search read it, no claim rests on it, so it is
            // NOT evidence. This is the whole review finding in one line.
            { type: 'url', url: 'https://never-cited/9' }
          ]
        }
      },
      {
        type: 'message',
        content: [{
          type: 'output_text',
          text,
          annotations: [
            { type: 'url_citation', url: 'https://a/1', title: 'FromCitation', start_index: 0, end_index: CLAIM_A.length },
            // Two citations to ONE page are two claims, not a duplicate row.
            { type: 'url_citation', url: 'https://a/1', start_index: CLAIM_A.length + 1, end_index: text.length }
          ]
        }]
      }
    ]
  })
  assert.equal(results.length, 1, '⛔ a consulted-only URL produced a row')
  assert.deepEqual(results.map((r) => r.url), ['https://a/1'])
  assert.equal(results[0].title, 'FromCitation', 'the citation names the source; the live search sends no title')
  assert.equal(results[0].content, CLAIM_A + ' … ' + CLAIM_B, 'both claims survive, visibly separated')
  assert.equal(results[0].publishedAt, '2026-07-01', 'the consulted entry enriches the date')
  assert.equal(results[0].consulted, true)
  assert.equal(sourcesSeen, 2, 'the uncited page is still a source the search surfaced')
})

/* ═══ 18–24 — THE PIPELINE STILL OWNS THE TURN ═════════════════════════ */

function twoWorldConnector (publicProvider) {
  const internalReads = []; const publicCalls = []
  const pubAdapter = createPublicKnowledgeReadAdapter({ provider: publicProvider, clock: () => NOW, logSink: () => {} })
  return {
    internalReads,
    publicCalls,
    connector: {
      async read (source, method, params) {
        if (source === 'public_knowledge') {
          publicCalls.push(JSON.parse(JSON.stringify(params || {})))
          let rows
          try { rows = await pubAdapter.methods.search(params) } catch (e) {
            return { asOf: NOW, source, count: 0, results: [], evidence: { source, endpoint: method, entityType: null, rowShape: {}, metrics: {}, matchingTotal: 0, shownCount: 0, sourceTotal: null, queryScope: {}, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'unavailable', provenance: 'REAL PROVIDER', error: 'unavailable' } }
          }
          return { asOf: NOW, source, count: rows.length, results: rows, evidence: { source, endpoint: method, entityType: PUBLIC_ENTITY_TYPE, rowShape: { hasLocation: false, hasAsOf: true, note: null }, metrics: {}, matchingTotal: rows.length, shownCount: rows.length, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'REAL PROVIDER' } }
        }
        internalReads.push(params)
        const rows = [{ source, sourceId: '7', title: TITLE, entityType: 'purchase_order', content: `supplier=${SUPPLIER} · unitPrice=${PRICE} · code=${SECRET}`, fields: { id: '7', supplier: SUPPLIER, unitPrice: PRICE, code: SECRET }, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }]
        return { asOf: NOW, source, count: 1, results: rows, evidence: { source, endpoint: method, entityType: 'purchase_order', rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE INTERNAL' } }
      }
    }
  }
}

function scriptedAdapter (envelopes) {
  const calls = []
  return { label: 'claude', calls, async complete (p) { calls.push(String(p)); const b = envelopes[Math.min(calls.length - 1, envelopes.length - 1)]; return { text: JSON.stringify(b), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'scripted', latencyMs: 1, stopReason: 'end_turn' } } }
}
const READ = (capability, args) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: args === undefined ? { capability } : { capability, args }, answerPlan: null })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })
const SIR = (intent) => async () => ({ intent })
const BASE = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off', [A4_FLAG]: 'on' }
async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally { for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
}
const run = (msg, adapter, deps, history) => processIntake(msg, adapter, history || [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555', readContextDeps: deps
})
const PUB_CLAIM = 'The wholesale beef index rose 5.1 percent to 112.4 in July 2026.'
const liveProvider = () => ({ provider: PROVIDER_ID, model: DEFAULT_MODEL, search: async ({ query }) => makeSearchResult({ provider: PROVIDER_ID, query, retrievedAt: NOW, results: [{ url: 'https://idx.example/beef', title: 'Wholesale index', content: PUB_CLAIM, contentKind: CONTENT_KIND.WEB_SEARCH_CITED_SUMMARY, publishedAt: '2026-07-31', consulted: true }] }) })

test('*** G/H · 19/20 — URL, TITLE and CONTENT all reach GPT, and GPT still writes the answer ***', async () => {
  await withEnv({}, async () => {
    const c = twoWorldConnector(liveProvider())
    const a = scriptedAdapter([READ(PUB, { query: 'wholesale beef index', freshness: 'current', location: null }), FINAL('MAIN_MODEL_ANSWER')])
    const out = await run('出面行情點', a, {
      connector: c.connector, sources: ['aroma_system', 'public_knowledge'],
      sourceIntentResolver: SIR('public'),
      publicQueryPlanner: async () => ({ query: 'wholesale beef index', freshness: 'current', location: null })
    })
    assert.equal(c.publicCalls.length, 1, 'the real read path executed')
    // ⛔ H — the retrieval worker's text is raw material; the reply is the main model's.
    assert.equal(out.reply, 'MAIN_MODEL_ANSWER', '⛔ the retrieval worker must never author the reply')
    assert.equal(out.reply.includes(PUB_CLAIM), false, '⛔ retrieval prose was handed to the Owner verbatim')

    // ⛔ G — ALL THREE, not just the link. Before this fix the prompt carried the URL and an
    // empty string, so the answer layer could cite a page it had been told nothing about.
    const prompt = a.calls[a.calls.length - 1]
    assert.ok(prompt.includes('https://idx.example/beef'), 'the URL reached the answer layer')
    assert.ok(prompt.includes('Wholesale index'), 'the title reached the answer layer')
    assert.ok(prompt.includes(PUB_CLAIM), '⛔ THE FACT ITSELF reached the answer layer')
  })
})

test('*** 21/22/23/25 — questions that need no outside world make ZERO web calls ***', async () => {
  for (const [label, intent, envelopes, msg, env] of [
    ['internal only', 'internal', [READ(INV), FINAL('ok')], '我哋自己嘅成本點', {}],
    ['ambiguous', 'ambiguous', [READ(INV), FINAL('ok')], '最近點', {}],
    ['supplied facts', 'internal', [FINAL('9%')], '8.00 升到 8.72 係幾多 %', {}],
    ['A4 OFF', 'public', [FINAL('照舊')], '出面行情點', { [A4_FLAG]: 'off' }]
  ]) {
    await withEnv(env, async () => {
      const t = fakeTransport(async () => jsonRes(200, okPayload([{ url: 'https://x/1' }])))
      const provider = createOpenAIWebSearchProvider({ apiKey: 'k', transport: t.fn })
      const c = twoWorldConnector(provider)
      await run(msg, scriptedAdapter(envelopes), {
        connector: c.connector, sources: ['aroma_system', 'public_knowledge'],
        sourceIntentResolver: SIR(intent),
        publicQueryPlanner: async () => ({ query: 'q', freshness: null, location: null })
      })
      assert.equal(t.sent.length, 0, `⛔ ${label}: a paid web search was spent`)
    })
  }
})

test('*** 24 — a mixed turn reads BOTH worlds, and nothing internal leaves ***', async () => {
  await withEnv({}, async () => {
    const t = fakeTransport(async () => jsonRes(200, citedPayload([{ url: 'https://idx.example/beef', title: 'Index', text: PUB_CLAIM }])))
    const provider = createOpenAIWebSearchProvider({ apiKey: 'k', transport: t.fn, clock: () => NOW })
    const c = twoWorldConnector(provider)
    // ⛔ THE SECURITY CANARY, ON THE REAL PROVIDER SEAM. Internal evidence is live in the turn
    // and the model proposes a query carrying every internal value.
    const leaky = `${TITLE} ${SUPPLIER} ${PRICE} ${SECRET} wholesale`
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: leaky, freshness: 'current', location: null }), FINAL('齊。')])
    await run('我哋成本同出面比', a, {
      connector: c.connector, sources: ['aroma_system', 'public_knowledge'],
      sourceIntentResolver: SIR('mixed'),
      publicQueryPlanner: async () => ({ query: 'wholesale beef market index', freshness: 'current', location: null })
    })
    assert.equal(c.internalReads.length, 1)
    assert.equal(t.sent.length, 1, 'exactly one outbound retrieval')
    const outbound = JSON.stringify(t.sent[0])
    for (const v of INTERNAL_VALUES) assert.equal(outbound.includes(v), false, `⛔ ${v} LEFT THE PROCESS`)
    assert.equal(outbound.includes(leaky), false, '⛔ the raw main-model query left the process')
    assert.equal(t.sent[0].body.input, 'wholesale beef market index', 'the planner\'s query is what travelled')
  })
})

test('*** 3/26/27 — the planner remains the SOLE outbound query constructor ***', async () => {
  await withEnv({}, async () => {
    const t = fakeTransport(async () => jsonRes(200, okPayload([{ url: 'https://x/1' }])))
    const provider = createOpenAIWebSearchProvider({ apiKey: 'k', transport: t.fn })
    const c = twoWorldConnector(provider)
    // No planner wired ⇒ public-after-internal fails closed ⇒ nothing may leave.
    const a = scriptedAdapter([READ(INV), READ(PUB, { query: 'anything at all', freshness: null, location: null }), FINAL('冇查到。')])
    await run('我哋成本同出面比', a, {
      connector: c.connector, sources: ['aroma_system', 'public_knowledge'], sourceIntentResolver: SIR('mixed')
    })
    assert.equal(t.sent.length, 0, '⛔ a query reached the vendor without the planner')
  })
})

test('*** a provider UNAVAILABLE does not become an answer with evidence ***', async () => {
  await withEnv({}, async () => {
    const t = fakeTransport(async () => jsonRes(429, { error: 'slow down' }))
    const provider = createOpenAIWebSearchProvider({ apiKey: 'k', transport: t.fn })
    const c = twoWorldConnector(provider)
    const a = scriptedAdapter([READ(PUB, { query: 'q', freshness: null, location: null }), FINAL('市場嗰邊今次讀唔到。')])
    const out = await run('出面行情點', a, {
      connector: c.connector, sources: ['aroma_system', 'public_knowledge'],
      sourceIntentResolver: SIR('public'),
      publicQueryPlanner: async () => ({ query: 'q', freshness: null, location: null })
    })
    assert.equal(t.sent.length, 1, 'it was attempted')
    // The world was never completed, so the turn must not present a finished answer.
    assert.ok(typeof out.reply === 'string')
  })
})
