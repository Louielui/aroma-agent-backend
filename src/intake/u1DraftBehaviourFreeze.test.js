'use strict'

/**
 * u1DraftBehaviourFreeze.test.js — the U1 email-draft path, frozen by BEHAVIOUR.
 *
 * WHY BEHAVIOUR AND NOT A FILE HASH. The gate on this work was originally a sha256 of the
 * standalone U1 parser. Five batch merges later the file has moved and been refactored, so
 * that hash cannot match anything current — it was a proxy for the thing that actually
 * matters, and the proxy expired while the thing did not.
 *
 * What must not regress is the EMAIL VOICE and the parse contract around it, which survived
 * three rounds of tuning. So this file pins the observable output for a set of fixtures:
 * what comes out for a valid draft, for a clarifying ask, for a null draft, and which
 * malformed inputs are rejected and with which reason. Captured BEFORE the shared distill
 * envelope is changed, asserted byte-identical after.
 *
 * These are frozen expectations, not descriptions. If a change to the shared parser alters
 * any of them, the change is wrong — do not update the expectation to make it pass.
 *
 * Pure module: no adapter, no network, no paid call.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { parseU1DraftResponse } = require('./u1DraftPrompt')
const { U1_DRAFT_SCHEMA, U1_DRAFT_SCHEMA_NAME } = require('./u1DraftSchema')

const parse = (obj) => parseU1DraftResponse(JSON.stringify(obj))

/* ── the fixtures: the three shapes the lane really produces ──────────────── */

const DRAFT_FIXTURE = {
  mode: 'draft_proposal',
  understanding: {
    recipient: { name: '陳生', email: 'sales@abfoods.example', confidence: 'high' },
    purpose: { value: '覆供應商報價', confidence: 'high' },
    tone: { value: 'neutral', confidence: 'high' },
    constraints: ['唔好承諾價錢'],
    understandingSignals: [
      { classification: 'FACT', statement: '報價已經收到', source: 'current_message', confidence: 'high' }
    ]
  },
  restatement: '你想我草擬一封覆 A&B Foods 報價嘅郵件。',
  clarifyingQuestion: null,
  draft: {
    to: 'sales@abfoods.example',
    subject: 'Re: 報價 — A&B Foods',
    body: '陳生你好,\n\n多謝你嘅報價,已經收到。我哋內部睇完之後,下星期覆你。\n\nLouie\nAroma Bistro',
    tone: 'neutral'
  }
}

const ASK_FIXTURE = {
  mode: 'ask',
  understanding: {
    recipient: { name: null, email: null, confidence: 'low' },
    purpose: { value: null, confidence: 'low' },
    tone: { value: null, confidence: 'low' },
    constraints: [],
    understandingSignals: [
      { classification: 'TEMPORARY', statement: '收件人未講明', source: 'current_message', confidence: 'low' }
    ]
  },
  restatement: '你想寄一封郵件,但我未知收件人。',
  clarifyingQuestion: '呢封郵件想寄畀邊位?',
  draft: null
}

const NULL_TO_FIXTURE = {
  mode: 'draft_proposal',
  understanding: {
    recipient: { name: null, email: null, confidence: 'medium' },
    purpose: { value: '內部通知', confidence: 'high' },
    tone: { value: 'neutral', confidence: 'high' },
    constraints: [],
    understandingSignals: [
      { classification: 'TEMPORARY', statement: '收件人未講明', source: 'current_message', confidence: 'low' }
    ]
  },
  restatement: '你想草擬一封內部通知。',
  clarifyingQuestion: null,
  draft: { to: null, subject: '本週盤點安排', body: '各位:\n\n本週盤點照舊星期四進行。\n\nLouie', tone: 'neutral' }
}

/* ── 1. the parsed output, byte-identical ─────────────────────────────────── */

test('*** U1 draft: the parsed envelope is byte-identical to today ***', () => {
  assert.deepEqual(parse(DRAFT_FIXTURE), DRAFT_FIXTURE)
})

test('*** U1 ask: a clarifying question with a null draft is byte-identical ***', () => {
  assert.deepEqual(parse(ASK_FIXTURE), ASK_FIXTURE)
})

test('*** U1 draft with a null recipient is byte-identical ***', () => {
  assert.deepEqual(parse(NULL_TO_FIXTURE), NULL_TO_FIXTURE)
})

/* ── 2. THE EMAIL VOICE — the thing three rounds of tuning produced ───────── */

test('*** the draft body survives the parser EXACTLY — every newline and character ***', () => {
  const out = parse(DRAFT_FIXTURE)
  assert.equal(out.draft.body, DRAFT_FIXTURE.draft.body)
  assert.equal(out.draft.body.split('\n').length, 6, 'paragraph breaks are structure, not whitespace')
  assert.equal(out.draft.subject, 'Re: 報價 — A&B Foods') // the em dash and colon survive
  assert.equal(out.draft.tone, 'neutral')
  assert.equal(out.draft.to, 'sales@abfoods.example')
  // no trimming, no normalising, no re-encoding anywhere on this path
  assert.equal(JSON.stringify(out.draft), JSON.stringify(DRAFT_FIXTURE.draft))
})

test('the restatement and understanding survive exactly', () => {
  const out = parse(DRAFT_FIXTURE)
  assert.deepEqual(out.understanding, DRAFT_FIXTURE.understanding)
  assert.equal(out.restatement, DRAFT_FIXTURE.restatement)
  assert.equal(out.clarifyingQuestion, null)
})

/* ── 3. the rejection contract, with its reasons ──────────────────────────── */

test('*** an unknown key is still rejected, with reason unknown_key ***', () => {
  assert.throws(
    () => parse(Object.assign({}, DRAFT_FIXTURE, { extra: 1 })),
    (e) => e.reason === 'unknown_key'
  )
  // and a legacy standalone-parser shape is still rejected — this is the shape that
  // existed when the sha256 gate was written, and it must NOT quietly start parsing
  assert.throws(() => parse({ draft_subject: 'x', draft_body: 'y' }), (e) => e.reason === 'unknown_key')
})

test('*** malformed input is still rejected on this path ***', () => {
  for (const bad of ['', 'not json', '[1,2]', '{"mode":"ask"']) {
    assert.throws(() => parseU1DraftResponse(bad))
  }
  // a missing required key is still a rejection, not a default
  const { clarifyingQuestion, ...missing } = ASK_FIXTURE
  assert.throws(() => parse(missing))
})

/* ── 4. the schema itself is unchanged ────────────────────────────────────── */

test('*** the U1 schema keys and name are frozen ***', () => {
  assert.equal(U1_DRAFT_SCHEMA_NAME, 'u1_draft_shadow')
  assert.deepEqual(U1_DRAFT_SCHEMA.required, ['mode', 'understanding', 'restatement', 'clarifyingQuestion', 'draft'])
  assert.deepEqual(Object.keys(U1_DRAFT_SCHEMA.properties), ['mode', 'understanding', 'restatement', 'clarifyingQuestion', 'draft'])
  assert.deepEqual(U1_DRAFT_SCHEMA.properties.mode.enum, ['ask', 'draft_proposal'])
  assert.deepEqual(U1_DRAFT_SCHEMA.properties.draft.required, ['to', 'subject', 'body', 'tone'])
  assert.equal(U1_DRAFT_SCHEMA.properties.draft.additionalProperties, false)
})

test('*** the U1 path does not share the distill envelope projection ***', () => {
  // The two parsers are separate, and adding answerPlan to the distill envelope must not
  // reach here. This asserts the separation itself, so the blast radius is provable.
  const { parseDistillResponse } = require('./distillPrompt')
  const crossed = parseDistillResponse(JSON.stringify(DRAFT_FIXTURE))
  assert.equal('draft' in crossed, false, 'a U1 envelope carries nothing into the distill projection')
  assert.equal('restatement' in crossed, false)
  assert.throws(() => parse({ intent: 'chit_chat', mode: 'chat', reply: 'x' }), 'and a distill envelope is not a U1 envelope')
})
