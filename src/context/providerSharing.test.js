'use strict'

/**
 * providerSharing.test.js — the Owner's decision to share his data with a second vendor
 * must be REVERSIBLE from configuration, per source, without a code change.
 *
 * The fail-closed direction here is the opposite of the capability flags in flags.js.
 * There, unset means "no capability". Here the flag controls whether data LEAVES for
 * OpenAI, so closed means WITHHOLD — a typo must be able to send less, never more.
 */

const test = require('node:test')
const assert = require('node:assert')

const {
  isSharedWith, sourcesForProvider, decisionRecallSharedWith, withheldFrom,
  sharingVarName, SHARABLE, DECISIONS, CLAUDE, OPENAI
} = require('./providerSharing')

const ALL = ['drive', 'gmail', 'calendar', 'github']

test('by default every source is shared with both providers — the Owner said so', () => {
  for (const s of SHARABLE) {
    assert.equal(isSharedWith(CLAUDE, s, {}), true, 'claude: ' + s)
    assert.equal(isSharedWith(OPENAI, s, {}), true, 'openai: ' + s)
  }
  assert.deepEqual(sourcesForProvider(OPENAI, ALL, {}), ALL)
  assert.deepEqual(withheldFrom(OPENAI, {}), [], 'nothing withheld by default')
})

test('ONE source can be withheld from OpenAI while Claude keeps it', () => {
  const env = { CONTEXT_GMAIL_OPENAI: 'off' }
  assert.deepEqual(sourcesForProvider(OPENAI, ALL, env), ['drive', 'calendar', 'github'])
  assert.deepEqual(sourcesForProvider(CLAUDE, ALL, env), ALL, 'Claude is untouched')
  assert.deepEqual(withheldFrom(OPENAI, env), ['gmail'])
})

test('each source has its own switch, and they compose', () => {
  for (const s of ALL) {
    const env = { [sharingVarName(s, OPENAI)]: 'off' }
    assert.equal(isSharedWith(OPENAI, s, env), false, s + ' can be withheld alone')
    for (const other of ALL.filter((x) => x !== s)) {
      assert.equal(isSharedWith(OPENAI, other, env), true, other + ' unaffected')
    }
  }
  const allOff = Object.fromEntries(ALL.map((s) => [sharingVarName(s, OPENAI), 'off']))
  assert.deepEqual(sourcesForProvider(OPENAI, ALL, allOff), [])
})

test('the Decision Recall block is gated the same way', () => {
  assert.equal(decisionRecallSharedWith(OPENAI, {}), true)
  assert.equal(decisionRecallSharedWith(OPENAI, { CONTEXT_DECISIONS_OPENAI: 'off' }), false)
  assert.equal(decisionRecallSharedWith(CLAUDE, { CONTEXT_DECISIONS_OPENAI: 'off' }), true, 'Claude unaffected')
  assert.ok(SHARABLE.includes(DECISIONS))
})

test('FAIL-CLOSED: any unrecognised value withholds, and never shares', () => {
  for (const bad of ['yes', 'true', 'ON', 'On', 'OFF', 'Off', '1', '0', 'enabled', ' on', 'on ', 'null']) {
    const env = { CONTEXT_GMAIL_OPENAI: bad }
    assert.equal(isSharedWith(OPENAI, 'gmail', env), false, 'must withhold on: ' + JSON.stringify(bad))
  }
  // only the two exact strings are honoured
  assert.equal(isSharedWith(OPENAI, 'gmail', { CONTEXT_GMAIL_OPENAI: 'on' }), true)
  assert.equal(isSharedWith(OPENAI, 'gmail', { CONTEXT_GMAIL_OPENAI: 'off' }), false)
})

test('the Claude path is not gated here at all', () => {
  // Gating Claude would be a capability change, which READ_ACCESS / CONTEXT_* already own.
  assert.equal(sharingVarName('gmail', CLAUDE), null)
  for (const bad of ['off', 'nonsense']) {
    assert.equal(isSharedWith(CLAUDE, 'gmail', { CONTEXT_GMAIL_OPENAI: bad }), true)
  }
})

test('an unknown source name is shared by default (it is not a secret list)', () => {
  // The gate is a per-source OPT-OUT, not an allowlist: a source that exists but has no
  // flag behaves like the others. A future source therefore fails VISIBLY (it is shared,
  // as the Owner decided) rather than silently vanishing from GPT's context.
  assert.equal(isSharedWith(OPENAI, 'somefuturesource', {}), true)
  assert.equal(isSharedWith(OPENAI, 'somefuturesource', { CONTEXT_SOMEFUTURESOURCE_OPENAI: 'off' }), false)
})

test('order is preserved when filtering', () => {
  const env = { CONTEXT_CALENDAR_OPENAI: 'off' }
  assert.deepEqual(sourcesForProvider(OPENAI, ['github', 'drive', 'calendar', 'gmail'], env), ['github', 'drive', 'gmail'])
})
