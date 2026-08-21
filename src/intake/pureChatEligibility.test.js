'use strict'

/**
 * pureChatEligibility.test.js — L2-A. THE CLASSIFIER IS NARROW, AND IT OBSERVES ONLY.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE MEASUREMENT BEHIND THIS. requestId 8d82bdd2-d92a-4061-aadd-638d35938582,
 * 2026-08-21 12:27: 「你好」 cost 7,613 ms. The reply was 1,693 ms of it. The goal
 * decomposer spent 2,395 ms returning zero facts and the final verifier spent
 * 3,448 ms concluding no read was needed — 76.8% of the turn on two calls that did
 * not answer anything.
 *
 * ⛔ THIS TRANCHE MAKES NOTHING FASTER, AND THAT IS THE PROPERTY UNDER TEST. The
 * greeting still costs three model calls. What is new is only that the server can now
 * say, safely and deterministically, WHICH turns a future fast path could have taken.
 *
 * ⛔ THE PROPERTY THAT MATTERS MOST is not that 「你好」 is eligible. It is that
 * 「你好，幫我部署」 is NOT — that a greeting glued to a governed request stays on the
 * governed path. A mutation test exists for exactly that.
 *
 * Deterministic: pure function, scripted adapters, injected sinks. ZERO model calls,
 * ZERO connector calls, ZERO network, ZERO paid calls.
 *
 *   Run: node --test src/intake/pureChatEligibility.test.js
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  classifyPureChatEligibility, REASON, REQUIRED_ROUTE, MAX_SOCIAL_CHARS,
  GREETINGS, THANKS, FAREWELLS
} = require('./pureChatEligibility')
const { processIntake } = require('./intakeService')
const { A4_FLAG } = require('./a4Contract')

const CONV = Object.freeze({ route: 'CONVERSATION' })
const cls = (m, r) => classifyPureChatEligibility(m, r === undefined ? CONV : r)

/* ═══ 1. POSITIVE, NARROW, WHOLE-MESSAGE ═══════════════════════════════════ */

test('*** the acceptance target: 你好 is positively eligible as a greeting ***', () => {
  const out = cls('你好')
  assert.equal(out.eligible, true)
  assert.equal(out.reason, REASON.GREETING)
})

test('*** every listed social form is eligible as a COMPLETE message ***', () => {
  for (const [words, reason] of [[GREETINGS, REASON.GREETING], [THANKS, REASON.THANKS], [FAREWELLS, REASON.FAREWELL]]) {
    for (const w of words) {
      const out = cls(w)
      assert.equal(out.eligible, true, 'not eligible: ' + JSON.stringify(w))
      assert.equal(out.reason, reason, w + ' classified as ' + out.reason)
    }
  }
})

test('*** decoration around a complete greeting is tolerated; content is not ***', () => {
  for (const m of ['你好！', '  你好  ', '你好。', '你好？', 'Hello!', 'hi.', '您好～']) {
    assert.equal(cls(m).eligible, true, 'edge punctuation broke: ' + JSON.stringify(m))
  }
})

test('*** the vocabulary stays small — growing it is a decision, not a drift ***', () => {
  const total = GREETINGS.length + THANKS.length + FAREWELLS.length
  assert.ok(total <= 30, 'the closed social vocabulary grew to ' + total + ' entries')
  for (const w of [...GREETINGS, ...THANKS, ...FAREWELLS]) {
    assert.ok(w.length <= MAX_SOCIAL_CHARS, w + ' is longer than the structural cap')
    assert.equal(w, w.toLowerCase(), 'vocabulary must be pre-normalised: ' + w)
  }
})

/* ═══ 2. ⛔ THE COMPOUND-PREFIX FENCE — THE POINT OF THE TRANCHE ═══════════ */

/**
 * If greeting detection ever becomes prefix matching instead of whole-message
 * matching, every one of these becomes eligible and a future fast path would carry a
 * deploy request, a mailbox read and a work order past the governed path. This block
 * is the tripwire for that single mistake.
 */
const COMPOUND = Object.freeze([
  '你好，幫我改 README.md',
  '你好，幫我部署',
  '你好，幫我睇 Gmail',
  '你好，幫我查下庫存',
  '你好，今日天氣如何？',
  '你好，而家外面金價幾多？',
  '你好，可以幫我 send 個 email 嗎？',
  '你好，幫我批准呢張單',
  '你好，run 個 agent',
  '你好，刪除呢個 file',
  'Hello, please deploy',
  'Hi, check my email'
])

test('*** ⛔ A GREETING PREFIX NEVER MAKES A COMPOUND REQUEST ELIGIBLE ***', () => {
  for (const m of COMPOUND) {
    const out = cls(m)
    assert.equal(out.eligible, false, '⛔ COMPOUND REQUEST BECAME ELIGIBLE: ' + JSON.stringify(m))
    assert.equal(out.reason, REASON.NO_POSITIVE_SOCIAL_MATCH)
  }
})

/* ═══ 3. HIGH-RISK NEGATIVE CORPUS ═════════════════════════════════════════ */

const HIGH_RISK = Object.freeze([
  // action / governance shaped
  '幫我改 src/index.js', '寫封 email 畀 Rob', '幫我執行呢個 Work Order', '批准呢張單',
  'run agent', 'delete README.md', '幫我部署', 'restart 個 server',
  // business / private read shaped
  '今日庫存有幾多？', '邊啲貨低過 PAR？', '幫我睇 Calendar', '幫我查 Drive', '今日有冇 email？',
  // current-world shaped
  '而家外面發生咩事？', '今日天氣點？', '而家幾點？', '最近金價點？', 'TD 今日幾錢？',
  // short continuations — meaning depends on the previous turn
  '好', '可以', '係', '1', 'yes', 'go', 'ok'
])

test('*** every high-risk form stays INELIGIBLE ***', () => {
  for (const m of HIGH_RISK) {
    assert.equal(cls(m).eligible, false, '⛔ high-risk message became eligible: ' + JSON.stringify(m))
  }
})

test('*** a bare greeting is refused on any route that is not CONVERSATION ***', () => {
  for (const route of ['UTILITY', 'ACTION', 'BUSINESS_QUERY', 'SOMETHING_NEW']) {
    const out = cls('你好', { route })
    assert.equal(out.eligible, false, 'eligible on route ' + route)
    assert.equal(out.reason, REASON.NOT_CONVERSATION_ROUTE)
  }
  assert.equal(REQUIRED_ROUTE, 'CONVERSATION')
})

test('*** ⛔ CONVERSATION ALONE IS NEVER A REASON — it only ever subtracts ***', () => {
  // turnRouter documents CONVERSATION as the FALLBACK route. If the route were
  // sufficient, every question it failed to classify would become "small talk".
  for (const m of ['今日庫存有幾多？', '而家外面發生咩事？', '幫我部署', '好']) {
    assert.equal(cls(m, CONV).eligible, false,
      '⛔ CONVERSATION route alone made this eligible: ' + JSON.stringify(m))
  }
})

/* ═══ 4. FAIL-CLOSED ═══════════════════════════════════════════════════════ */

test('*** malformed, empty, oversized and hostile inputs all fail CLOSED ***', () => {
  for (const m of [null, undefined, 123, {}, [], '', '   ', true]) {
    assert.equal(cls(m).eligible, false, 'failed open on ' + JSON.stringify(m))
  }
  assert.equal(cls(null).reason, REASON.MALFORMED_INPUT)
  // Longer than any bare social phrase: refused before any comparison.
  assert.equal(cls('你好' + 'x'.repeat(MAX_SOCIAL_CHARS)).eligible, false)
  // A missing route decision is not an opportunity.
  assert.equal(cls('你好', null).reason, REASON.NO_ROUTE_DECISION)
  assert.equal(cls('你好', undefined === undefined ? null : null).eligible, false)
})

test('*** the answer shape is closed — no prose, no confidence, no source names ***', () => {
  for (const m of ['你好', '幫我部署', '', null]) {
    const out = cls(m)
    assert.deepEqual(Object.keys(out).sort(), ['eligible', 'reason'])
    assert.equal(typeof out.eligible, 'boolean')
    assert.ok(Object.values(REASON).includes(out.reason), 'reason not in the closed set: ' + out.reason)
  }
})

test('*** it is PURE — no I/O, no model, no clock, no env, no connector ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'pureChatEligibility.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n')
  for (const banned of ['require\\(', 'process\\.env', 'Date\\.now', 'new Date', 'fs\\.', 'fetch\\(', 'child_process', 'adapter', 'connector']) {
    assert.equal(new RegExp(banned).test(src), false, '⛔ the classifier can reach ' + banned)
  }
  // Deterministic: the same input always gives the same answer.
  for (let i = 0; i < 3; i++) assert.deepEqual(cls('你好'), { eligible: true, reason: REASON.GREETING })
})

/* ═══ 5. ⛔ SHADOW MEANS SHADOW ════════════════════════════════════════════ */

test('*** ⛔ NOTHING IN intakeService BRANCHES ON ELIGIBILITY ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'intakeService.js'), 'utf8')
  const lines = src.split('\n')
  const uses = lines
    .map((l, i) => ({ n: i + 1, l }))
    .filter((x) => /\bpureChat\b/.test(x.l))

  assert.ok(uses.length > 0, 'the classifier is not wired at all')
  for (const u of uses) {
    const code = u.l.trim()
    if (code.startsWith('*') || code.startsWith('//')) continue
    const isAssignment = /^const pureChat = classifyPureChatEligibility\(/.test(code)
    const isTelemetry = /pureChat\.(eligible|reason)/.test(code) && !/\bif\s*\(|\?|&&|\|\|/.test(code)
    assert.ok(isAssignment || isTelemetry,
      '⛔ pureChat is used outside assignment/telemetry at line ' + u.n + ': ' + code)
  }
  // And it must never appear in a conditional anywhere in the file.
  assert.equal(/if\s*\([^)]*pureChat/.test(src), false, '⛔ a branch reads pureChat')
  assert.equal(/pureChat[^\n]*\?[^:]*:/.test(src.replace(/pureChat\.eligible === true/g, '')), false,
    '⛔ a ternary reads pureChat')
})

test('*** the shadow telemetry line carries only allowlisted structural fields ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'intakeService.js'), 'utf8')
  const block = src.slice(src.indexOf('[AROMA-PURE-CHAT]'), src.indexOf('[AROMA-PURE-CHAT]') + 500)
  for (const allowed of ['requestId', 'event', 'eligible', 'reason', 'route', 'shadow', 'timestamp']) {
    assert.ok(block.includes(allowed), 'missing allowlisted field: ' + allowed)
  }
  for (const banned of ['message', 'prompt', 'system', 'reply', 'history', 'rows', 'items', 'credential', 'token', '...']) {
    assert.equal(block.includes(banned + ':') || block.includes(banned + ','), false,
      '⛔ the shadow line can carry ' + banned)
  }
  assert.equal(block.includes('shadow: true'), true, 'the line must declare itself shadow')
})

/* ═══ 6. THE GREETING IS OBSERVED, NOT ACCELERATED ════════════════════════ */

const REQ = '11111111-2222-4333-8444-555555555555'
const REPLY = '你好，Louie。最近如何？'

function greetingAdapter () {
  const calls = []
  return {
    calls,
    async complete (prompt, opts = {}) {
      calls.push({ schemaName: opts.responseFormat ? opts.responseFormat.name : null })
      const body = calls.length === 1
        ? { facts: [] }
        : { intent: 'question', mode: 'chat', reply: REPLY, nextRead: null, answerPlan: null }
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'spy', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const BASE_ENV = {
  READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off',
  GOAL_DECOMPOSER: 'on', [A4_FLAG]: 'on'
}
async function withEnv (over, fn) {
  const all = Object.assign({}, BASE_ENV, over); const prev = {}
  for (const k of Object.keys(all)) { prev[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k] }
  }
}

async function turn (message) {
  const adapter = greetingAdapter()
  const verifierCalls = []
  const out = await processIntake(message, adapter, [], {
    demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: REQ,
    readContextDeps: { finalVerifier: async (i) => { verifierCalls.push(i); return { decision: 'allow_final', question: null } } }
  })
  return { out, adapter, verifierCalls }
}

test('*** ⛔ 你好 IS ELIGIBLE AND STILL COSTS THREE MODEL CALLS ***', async () => {
  await withEnv({}, async () => {
    // the classifier says yes...
    assert.deepEqual(cls('你好'), { eligible: true, reason: REASON.GREETING })
    // ...and the live turn is completely unaffected by that.
    const t = await turn('你好')
    assert.equal(t.adapter.calls.length, 2, 'goal decomposer + main still run')
    assert.equal(t.adapter.calls[0].schemaName, 'goal_plan', 'the goal decomposer was NOT skipped')
    assert.equal(t.verifierCalls.length, 1, 'the final verifier was NOT skipped')
    assert.equal(t.out.reply, REPLY, 'and the reply is unchanged')
  })
})

test('*** a governed compound request is untouched, exactly as before ***', async () => {
  await withEnv({}, async () => {
    assert.equal(cls('你好，幫我部署').eligible, false)
    const t = await turn('你好，幫我部署')
    // Whatever the pipeline did before, it still does: the classifier changed nothing.
    assert.ok(t.adapter.calls.length >= 1, 'the ordinary path still ran')
  })
})
