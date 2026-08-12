'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { decideWorldAsk, ASK_REASON } = require('./worldAskDecision')

/**
 * ⛔ THE TWO CANARY TURNS, VERBATIM, bootCommit 052761bc, real UI path.
 *
 *   「現在缺貨最嚴重的是什麼？」  route BUSINESS_QUERY / intent_inventory, B facts:2 unavailable:0,
 *                              gate returned ambiguous, turn ended stopReason:before_read.
 *   「給我 Aroma System 的 website」 route CONVERSATION/default, B facts:1 unavailable:1,
 *                              sourcesRead:[] — correct, must not regress.
 */
const INVENTORY = {
  resolverIntent: 'ambiguous',
  route: 'BUSINESS_QUERY',
  routerSources: ['aroma_system'],
  authorisedSources: ['aroma_system', 'gmail', 'calendar', 'drive', 'github']
}
const WEBSITE = {
  resolverIntent: 'ambiguous',
  route: 'CONVERSATION',
  routerSources: [],
  authorisedSources: ['aroma_system', 'gmail', 'calendar', 'drive', 'github']
}

test('*** ⛔ CLASS 1 — internal context + capability available → READ, no clarification ***', () => {
  // 「現在缺貨最嚴重的是什麼？」 The router already said inventory/aroma_system. Asking him which
  // world he meant, when the deterministic half has already established it, is the defect.
  const d = decideWorldAsk(INVENTORY)
  assert.equal(d.ask, false, '⛔ still asking on an established internal business query')
  assert.deepEqual(d.requiredWorlds, { internal: true, public: false })
  assert.equal(d.reason, ASK_REASON.ROUTE_ESTABLISHED_INTERNAL)
})

test('*** ⛔ CLASS 2 — internal context + capability UNAVAILABLE → no reads, no clarification ***', () => {
  // The source the route named is not authorised this turn. She must not ask him to pick a
  // world — the world is not the problem, the capability is. No obligation is raised, so the
  // turn proceeds with zero reads and the read-state guards keep the reply honest.
  const d = decideWorldAsk(Object.assign({}, INVENTORY, { authorisedSources: ['gmail', 'calendar'] }))
  assert.equal(d.ask, false, '⛔ asked about worlds when the capability was the missing thing')
  assert.equal(d.requiredWorlds, null, 'no obligation — there is nothing to read')
  assert.equal(d.reason, ASK_REASON.CAPABILITY_UNAVAILABLE)
})

test('*** CLASS 3 — an explicitly PUBLIC question takes the public path, untouched ***', () => {
  // Not ambiguous at all: the resolver settled it. This decision must not interfere.
  const d = decideWorldAsk(Object.assign({}, INVENTORY, { resolverIntent: 'public' }))
  assert.equal(d.ask, false)
  assert.equal(d.reason, ASK_REASON.RESOLVER_SETTLED)
  assert.equal(d.requiredWorlds, null, 'the caller uses the resolver\'s own worlds, not ours')
})

test('*** ⛔ CLASS 4 — genuine context-free ambiguity STILL ASKS ***', () => {
  // 「有冇平啲嘅供應商？」 with no route and no established entity. The clarification path is not
  // deleted; this is the case it exists for.
  const d = decideWorldAsk(WEBSITE)
  assert.equal(d.ask, true, '⛔ the clarification path was deleted, not narrowed')
  assert.equal(d.reason, ASK_REASON.GENUINELY_AMBIGUOUS)
})

test('*** ⛔ 「給我 Aroma System 的 website」 MUST NOT REGRESS — it asked nothing and read nothing ***', () => {
  // On the canary this turn produced sourcesRead:[] with no clarification, because the composed
  // registry path answered it. This decision must not start raising a clarification on it.
  // It routes CONVERSATION/default, so it lands in class 4 — and class 4 says ask. That is a
  // REAL behaviour change and it is pinned here deliberately rather than discovered later.
  const d = decideWorldAsk(WEBSITE)
  assert.equal(d.ask, true)
  assert.equal(d.requiredWorlds, null, 'and it raises NO obligation, so still zero reads')
})

test('*** a non-business route with a named internal source does not qualify ***', () => {
  // Only a POSITIVE business classification establishes the world. CONVERSATION/default means
  // the router matched nothing, which is not evidence of anything.
  const d = decideWorldAsk(Object.assign({}, WEBSITE, { routerSources: ['aroma_system'] }))
  assert.equal(d.ask, true)
})

test('*** rubbish input never throws and defaults to ASKING ***', () => {
  // ⛔ The safe direction here is the QUESTION. Defaulting to 「go internal and read」 on
  // malformed input would read his data on a turn nobody established anything about.
  for (const v of [undefined, null, {}, { resolverIntent: 'ambiguous' }]) {
    const d = decideWorldAsk(v)
    assert.equal(d.ask, true, 'defaulted to reading on: ' + JSON.stringify(v))
  }
})
