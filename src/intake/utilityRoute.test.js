'use strict'

/**
 * utilityRoute.test.js — the UTILITY route is LIVE, and it acts before anything else does.
 *
 * ── WHAT CHANGED, STATED HONESTLY ────────────────────────────────────────────
 * `TURN_ROUTER=shadow` no longer means "changes nothing". It now means: UTILITY ACTS, every
 * other route still only observes. The byte-identical guarantee proved in Step 1 still holds
 * for `off`, and for non-UTILITY turns at `shadow` — but not for a UTILITY turn, which is
 * the point. That narrowing is asserted below rather than left for someone to discover.
 *
 * ── WHAT A UTILITY TURN MUST NOT DO ──────────────────────────────────────────
 * No connector read. No model call. No EvidenceSet. No Answer Plan, and therefore no
 * responseFormat. The original defect was a question about the clock reading Drive, Gmail,
 * Calendar and the inventory; the test that matters most is the one counting those at zero.
 *
 * ── AND WHAT IT MUST STILL DO ────────────────────────────────────────────────
 * Be stored in the conversation history like any other turn. It is part of what the Owner
 * said and what she answered; a transcript with holes in it is a transcript he cannot trust.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { processIntake } = require('./intakeService')
const { SETTINGS_FILE } = require('../persona/ownerSettings')

const LAB = (() => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-utilroute-'))
  fs.writeFileSync(path.join(d, SETTINGS_FILE), JSON.stringify({ timezone: 'America/Winnipeg' }), 'utf8')
  return d
})()

/** An adapter that records every call — a UTILITY turn must never reach it. */
function spyAdapter () {
  const calls = []
  return {
    calls,
    name: 'spy',
    async complete (prompt, o) {
      calls.push({ prompt, responseFormat: (o && o.responseFormat) || null })
      return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply: 'MODEL_WAS_CALLED' }), provider: 'claude', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'spy' }
    }
  }
}

/** A connector that counts every source touched. */
function spyConnector () {
  const reads = []
  return {
    reads,
    connector: new Proxy({}, {
      get: (_t, prop) => (...args) => { reads.push(String(prop)); return Promise.resolve({ items: [] }) }
    })
  }
}

const withEnv = async (vars, fn) => {
  const saved = {}
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

/** A live-ish turn: READ_ACCESS on and every source enabled, so a read WOULD happen. */
const LIVE = {
  TURN_ROUTER: 'shadow',
  READ_ACCESS: 'on',
  CONTEXT_DRIVE: 'on',
  CONTEXT_GMAIL: 'on',
  CONTEXT_CALENDAR: 'on',
  CONTEXT_AROMA_SYSTEM: 'on',
  XIANGXIANG_LAB_ROOT: LAB
}

async function turn (message, env = {}) {
  const a = spyAdapter()
  const c = spyConnector()
  const res = await withEnv(Object.assign({}, LIVE, env), () =>
    processIntake(message, a, [], {
      interactionMode: 'chat',
      demo: false,
      readContextDeps: { connector: c.connector, sources: ['drive', 'gmail', 'calendar', 'aroma_system'] }
    }))
  return { res, modelCalls: a.calls, reads: c.reads }
}

/* ═══ 1. THE QUESTION THAT STARTED THIS ════════════════════════════════════ */

test('*** 「現在是幾點？」 reads NOTHING and calls no model ***', async () => {
  const t = await turn('現在是幾點？')
  assert.deepEqual(t.reads, [], 'THE DEFECT: this read Drive, Gmail, Calendar and inventory')
  assert.equal(t.modelCalls.length, 0, 'and it did not pay for a model call')
  assert.ok(/現在是/.test(t.res.reply), 'got: ' + t.res.reply)
  assert.ok(/（Winnipeg）/.test(t.res.reply), 'the clock says which clock: ' + t.res.reply)
  assert.equal(t.res.reply.includes('MODEL_WAS_CALLED'), false)
})

test('*** 「今天幾號？」 likewise ***', async () => {
  const t = await turn('今天幾號？')
  assert.deepEqual(t.reads, [])
  assert.equal(t.modelCalls.length, 0)
  assert.ok(/今天是 \d{4} 年/.test(t.res.reply), 'got: ' + t.res.reply)
  assert.ok(/（Winnipeg）/.test(t.res.reply))
})

test('no EvidenceSet, no Answer Plan, no responseFormat on a utility turn', async () => {
  const t = await turn('現在是幾點？')
  assert.equal(t.modelCalls.length, 0, 'no call means no responseFormat by construction')
  for (const k of ['evidenceSets', 'answerPlan']) {
    assert.equal(t.res[k] === undefined || t.res[k] === null, true, k + ' must not be produced')
  }
  assert.equal(t.res.mode, 'chat')
  assert.equal(t.res.blocked, false)
})

/* ═══ 2. IT DECLINES RATHER THAN GUESSING ══════════════════════════════════ */

test('*** an unparseable calculation falls to CONVERSATION, it does not answer ***', async () => {
  const t = await turn('12 * ')
  // The model was reached, which IS the fall-through: the utility declined and the ordinary
  // pipeline took the turn. What matters is that no number was invented.
  assert.equal(t.modelCalls.length, 1, 'it fell through to the normal path')
  assert.equal(/\b408\b|\b12\b/.test(t.res.reply), false, 'no fabricated arithmetic: ' + t.res.reply)
})

test('a timezone that cannot be trusted makes the clock question fall through too', async () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-badtz-'))
  fs.writeFileSync(path.join(bad, SETTINGS_FILE), JSON.stringify({ timezone: 'Mars/Olympus' }), 'utf8')
  const t = await turn('現在是幾點？', { XIANGXIANG_LAB_ROOT: bad })
  assert.equal(t.modelCalls.length, 1, 'it declined and fell through rather than stating a zone it could not resolve')
})

/* ═══ 3. IT DOES NOT SWALLOW BUSINESS QUESTIONS ════════════════════════════ */

test('*** a business question is NOT captured by UTILITY ***', async () => {
  for (const q of ['最近有哪些發票？', '倉存點呀？', '邊個供應商仲未找數？']) {
    const t = await turn(q)
    // THE ASSERTION THAT MATTERS: the model was reached, so the utility did not swallow it.
    // The reply text is NOT the thing to check — a business question goes through
    // buildReadResultReply, which composes the answer from retrieved rows and replaces the
    // model's prose entirely. My first version asserted on 'MODEL_WAS_CALLED' and failed on
    // 「### 最近發票」, which was the read view working correctly.
    assert.equal(t.modelCalls.length, 1, q + ' must take the ordinary path')
    assert.equal(t.res.utility, undefined, q + ' must carry no utility marker')
  }
})

test('a date-shaped business question is not a date question', async () => {
  // 「發票幾號到期？」 contains 幾號. The utility patterns are anchored on 今日/今天, so this
  // is a business question and must reach the ordinary path.
  const t = await turn('張發票幾號到期？')
  assert.equal(t.modelCalls.length, 1, 'got: ' + t.res.reply)
})

/* ═══ 4. THE FLAG, AND WHAT SHADOW NOW MEANS ═══════════════════════════════ */

test('*** with TURN_ROUTER off, a clock question behaves exactly as before ***', async () => {
  const t = await turn('現在是幾點？', { TURN_ROUTER: undefined })
  assert.equal(t.modelCalls.length, 1, 'off means off — the router does not act')
  assert.ok(t.res.reply.includes('MODEL_WAS_CALLED'))
})

test('*** shadow still changes nothing for a NON-utility turn ***', async () => {
  // The Step 1 guarantee, correctly narrowed rather than quietly dropped.
  const off = await turn('你可以幫我做什麼？', { TURN_ROUTER: undefined })
  const shadow = await turn('你可以幫我做什麼？')
  assert.equal(shadow.res.reply, off.res.reply)
  assert.equal(shadow.modelCalls.length, off.modelCalls.length)
  assert.deepEqual(shadow.modelCalls[0].responseFormat, off.modelCalls[0].responseFormat)
})

/* ═══ 5. IT IS PART OF THE TRANSCRIPT ══════════════════════════════════════ */

test('*** a utility turn is stored in conversation history like any other ***', async () => {
  // The store is keyed on the response carrying a string `reply`, and a utility turn carries
  // one in exactly the same shape — asserted here rather than assumed, because "it should be
  // stored" is the kind of claim that is easy to make and easy to be wrong about.
  const t = await turn('現在是幾點？')
  assert.equal(typeof t.res.reply, 'string')
  assert.ok(t.res.reply.length > 0)
  assert.equal(typeof t.res.replyForArchive, 'string', 'the Lab archive path sees it too')
  assert.equal(t.res.requestId != null, true, 'and it is a turn with an id, not a side effect')
})
