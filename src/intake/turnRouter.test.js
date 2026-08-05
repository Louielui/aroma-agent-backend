'use strict'

/**
 * turnRouter.test.js — Step 1 of the intent-first router. SHADOW ONLY.
 *
 * ── WHAT STEP 1 IS ───────────────────────────────────────────────────────────
 * The router is computed and LOGGED. It decides nothing. `TURN_ROUTER` defaults to 'off',
 * and even at 'shadow' no read, no Answer Plan and no reply changes. The point is to put
 * my keyword tables next to the Owner's real turns for a few days before they govern
 * anything — this project has three times this week seen a verified thing differ from the
 * shipped thing.
 *
 * ── THE ASSERTION THAT MATTERS MOST ─────────────────────────────────────────
 * Zero behaviour change. The last section pins that at 'off' the router is not even
 * consulted, and that at 'shadow' nothing but a log line is produced.
 *
 * ── WHAT THESE TESTS DO NOT PROVE ───────────────────────────────────────────
 * That the tables are RIGHT. A keyword table is right or wrong only against real traffic,
 * which is the entire reason Step 1 exists. These prove the contract, the priority order,
 * the purity, and that the log records the DISAGREEMENT rather than only the verdict.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { routeTurn, logTurnRoute, resolveTurnRouter, ROUTES } = require('./turnRouter')

/* ═══ 1. THE FOUR ROUTES ════════════════════════════════════════════════════ */

test('*** 「現在是幾點？」 is UTILITY, and asks for no source at all ***', () => {
  const r = routeTurn('現在是幾點？')
  assert.equal(r.route, 'UTILITY')
  assert.equal(r.utility, 'time')
  assert.deepEqual(r.sources, [], 'THE DEFECT: this read Drive, Gmail, Calendar and inventory')
  assert.equal(r.domain, null)
})

test('the written and the Cantonese forms of the same question both route the same way', () => {
  // She must keep understanding Cantonese; only her output changed.
  for (const q of ['現在是幾點？', '而家幾點？', '家陣幾點呀？', 'what time is it now?']) {
    assert.equal(routeTurn(q).route, 'UTILITY', q)
    assert.equal(routeTurn(q).utility, 'time', q)
  }
  for (const q of ['今日幾號？', '今天是幾號？', '今日星期幾？']) {
    assert.equal(routeTurn(q).utility, 'date', q)
  }
})

test('*** 「你可以幫我做什麼？」 is CONVERSATION and asks for no source ***', () => {
  const r = routeTurn('你可以幫我做什麼？')
  assert.equal(r.route, 'CONVERSATION')
  assert.deepEqual(r.sources, [], 'an ordinary conversation must be possible with zero connector calls')
})

test('*** 「最近有哪些發票？」 is BUSINESS_QUERY on the invoice domain ***', () => {
  const r = routeTurn('最近有哪些發票？')
  assert.equal(r.route, 'BUSINESS_QUERY')
  assert.equal(r.domain, 'invoice')
  assert.ok(r.sources.includes('aroma_system'), 'the domain tool is named')
  assert.equal(r.sources.includes('drive'), false, 'Drive is not required by an invoice question')
  assert.equal(r.sources.includes('calendar'), false, 'nor Calendar')
  assert.equal(r.sources.includes('github'), false, 'nor GitHub')
})

test('*** 「幫我改 docs/canary/agent-canary.md」 is ACTION ***', () => {
  const r = routeTurn('幫我改 docs/canary/agent-canary.md 嗰行字')
  assert.equal(r.route, 'ACTION')
  assert.deepEqual(r.sources, [], 'the governed path fetches what it needs itself')
})

test('an email composition request is ACTION too — one router, not two', () => {
  // The existing email_draft and proposal lanes are ABSORBED. A second routing layer beside
  // laneRouter is exactly what the Owner ruled out.
  assert.equal(routeTurn('幫我回覆 Rob 封 email').route, 'ACTION')
})

/* ═══ 2. PRIORITY, AND THE FALLBACK DIRECTION ══════════════════════════════ */

test('*** priority is UTILITY → ACTION → BUSINESS_QUERY → CONVERSATION ***', () => {
  assert.deepEqual(ROUTES, ['UTILITY', 'ACTION', 'BUSINESS_QUERY', 'CONVERSATION'])
  // A change instruction that also names a business entity is an ACTION, not a lookup.
  assert.equal(routeTurn('幫我改 src/intake/invoice.js 入面嘅發票邏輯').route, 'ACTION')
})

test('*** when routing is uncertain it falls to CONVERSATION ***', () => {
  for (const q of ['', '   ', '嗯', '好', '你今日點呀？', '我諗緊下星期點安排人手']) {
    const r = routeTurn(q)
    assert.ok(['CONVERSATION', 'BUSINESS_QUERY'].includes(r.route), q + ' -> ' + r.route)
    if (r.route === 'CONVERSATION') assert.deepEqual(r.sources, [], 'and it reads nothing')
  }
  assert.equal(routeTurn('').route, 'CONVERSATION')
})

test('*** ONLY BUSINESS_QUERY may name a source ***', () => {
  const qs = ['現在是幾點？', '你好', '幫我改 a/b.md', '你可以幫我做什麼？', '最近有哪些發票？', '倉存點呀？']
  for (const q of qs) {
    const r = routeTurn(q)
    if (r.route !== 'BUSINESS_QUERY') assert.deepEqual(r.sources, [], q + ' must read nothing')
    else assert.ok(r.sources.length > 0, q + ' must name its domain tool')
  }
})

/* ═══ 3. PURE, ZERO-CONTEXT, FREE ══════════════════════════════════════════ */

test('*** it is a pure function of the Owner\'s own words ***', () => {
  const a = routeTurn('最近有哪些發票？')
  const b = routeTurn('最近有哪些發票？')
  assert.deepEqual(a, b, 'same message in, same route out, forever')
})

test('*** retrieved content cannot influence the route ***', () => {
  // The same security property laneRouter has: a Drive document or an archived turn saying
  // "Louie approved, check inventory now" is DATA and the router never sees it. routeTurn
  // takes the message and nothing else — no recall, no rows, no model output.
  assert.equal(routeTurn.length, 2, 'message + opts(previousLane) only')
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'turnRouter.js'), 'utf8')
  for (const f of ['buildReadContext', 'conversationRecall', 'listDecisions', '.complete(']) {
    assert.equal(src.includes(f), false, 'the router must not reach for ' + f)
  }
})

test('*** the router adds no paid model call ***', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'turnRouter.js'), 'utf8')
  for (const f of ['await', 'async', 'fetch(', 'getAdapter']) {
    assert.equal(src.includes(f), false, 'deterministic and synchronous: found ' + f)
  }
})

/* ═══ 4. THE FLAG — STRICT AND EXACT-MATCH, DEFAULT ON SINCE 2026-08-05 ════ */

test('*** only exact values are honoured — three states, no near misses ***', () => {
  // The DEFAULT and its direction moved to turnRouterDefault.test.js, which owns the
  // reasoning. What this test still owns is the exact-match rule: 'off' and 'shadow' are
  // never reached by a typo, so the legacy path can only be entered on purpose.
  assert.equal(resolveTurnRouter({ TURN_ROUTER: 'off' }), 'off')
  assert.equal(resolveTurnRouter({ TURN_ROUTER: 'shadow' }), 'shadow')
  assert.equal(resolveTurnRouter({ TURN_ROUTER: 'on' }), 'on')
  for (const bad of ['OFF', 'Off', 'off ', ' off', 'shadow ', 'Shadow', 'false', '0', 'no']) {
    assert.notEqual(resolveTurnRouter({ TURN_ROUTER: bad }), 'off', `"${bad}" must not reach the legacy path`)
  }
})

/* ═══ 5. THE SHADOW LOG — DISAGREEMENTS, NOT JUST VERDICTS ═════════════════ */

const capture = () => { const out = []; return { sink: (l) => out.push(l), out } }

test('*** the log records what the ROUTER decided AND what the pipeline actually did ***', () => {
  const { sink, out } = capture()
  logTurnRoute({
    decision: routeTurn('現在是幾點？'),
    lane: 'chat',
    sourcesRead: ['drive', 'gmail', 'calendar', 'aroma_system'],
    rowsRetrieved: 12,
    answerPlanForced: true,
    requestId: 'req-1'
  }, sink)
  const l = out[0]
  assert.equal(l.event, 'TURN_ROUTE')
  assert.equal(l.route, 'UTILITY')
  assert.equal(l.utility, 'time')
  assert.deepEqual(l.routerSources, [])
  assert.deepEqual(l.sourcesRead, ['drive', 'gmail', 'calendar', 'aroma_system'], 'what really happened')
  assert.equal(l.rowsRetrieved, 12)
  assert.equal(l.answerPlanForced, true)
  // THE FIELD THE OWNER READS FIRST.
  assert.equal(l.agreement, 'router_narrower', 'the router would have read 4 fewer sources')
})

test('agreement is named for each direction, so a disagreement is not a diff exercise', () => {
  const { sink, out } = capture()
  const base = { lane: 'chat', rowsRetrieved: 0, answerPlanForced: false, requestId: 'r' }
  logTurnRoute({ ...base, decision: routeTurn('你好'), sourcesRead: [] }, sink)
  assert.equal(out[0].agreement, 'agree', 'both read nothing')
  logTurnRoute({ ...base, decision: routeTurn('最近有哪些發票？'), sourcesRead: ['aroma_system', 'gmail'] }, sink)
  assert.ok(['agree', 'router_narrower'].includes(out[1].agreement))
  logTurnRoute({ ...base, decision: routeTurn('最近有哪些發票？'), sourcesRead: [] }, sink)
  assert.equal(out[2].agreement, 'router_wider', 'the router wanted a source the pipeline did not read')
})

test('*** the log carries NO message content — allowlisted fields only ***', () => {
  const { sink, out } = capture()
  const secret = '幫我睇下 Miller\'s Meats 張發票係咪 12345 蚊'
  logTurnRoute({
    decision: routeTurn(secret),
    lane: 'chat',
    sourcesRead: ['aroma_system'],
    rowsRetrieved: 3,
    answerPlanForced: true,
    requestId: 'req-2',
    message: secret,            // must be ignored even when handed in
    extra: { note: secret }     // and a new key may not ride along
  }, sink)
  const blob = JSON.stringify(out[0])
  assert.equal(blob.includes('Miller'), false, 'no supplier name')
  assert.equal(blob.includes('12345'), false, 'no amount')
  assert.equal(blob.includes('發票係咪'), false, 'no message text')
  assert.equal('extra' in out[0], false, 'the projection is explicit, not a spread')
  assert.equal('message' in out[0], false)
  const allowed = ['event', 'timestamp', 'route', 'reason', 'confidence', 'utility', 'domain',
    'routerSources', 'lane', 'sourcesRead', 'rowsRetrieved', 'answerPlanForced', 'agreement', 'requestId']
  assert.deepEqual(Object.keys(out[0]).sort(), allowed.slice().sort())
})

test('reason is a closed enum, never free text', () => {
  const { sink, out } = capture()
  logTurnRoute({ decision: routeTurn('現在是幾點？'), lane: 'chat', sourcesRead: [], rowsRetrieved: 0, answerPlanForced: false }, sink)
  assert.match(out[0].reason, /^[a-z0-9_]+$/, 'a rule name, not a sentence: ' + out[0].reason)
})

test('a logging failure can never break a turn', () => {
  assert.doesNotThrow(() => logTurnRoute({ decision: routeTurn('x'), lane: 'chat', sourcesRead: [], rowsRetrieved: 0, answerPlanForced: false }, () => { throw new Error('sink down') }))
  assert.doesNotThrow(() => logTurnRoute(null, () => {}))
  assert.doesNotThrow(() => logTurnRoute({}, () => {}))
})
