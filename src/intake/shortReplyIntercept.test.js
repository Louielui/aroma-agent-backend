'use strict'

/**
 * shortReplyIntercept.test.js — answering 「1」 to a numbered list must not be treated as
 * an attempt to make 心燈 do something.
 *
 * WHAT ACTUALLY HAPPENED, from the live log. 心燈 offered options; the Owner replied
 * 「1」; the classifier read that as mode:'commit'; the chat-lane interception fired and
 * REPLACED her real 622-token answer with a canned notice about proposals. The routing
 * was already correct (lane=chat, laneReason=continuation) — the previous fix changed the
 * router, which for this case was a no-op. The symptom lives HERE.
 *
 * THE SAFE DIRECTION IS NOT RELAXED. This is still the interception: nothing is created
 * on either path — no Decision, no Task, no Proposal, no dispatch — and chat opts do not
 * even carry the proposal seam. Only the words returned change.
 *
 * No paid call: the adapter is a fake.
 */

const test = require('node:test')
const assert = require('node:assert')

const { processIntake } = require('./intakeService')

/** An envelope the classifier would emit for a turn it read as an instruction. */
const COMMIT = JSON.stringify({
  intent: 'do_it',
  mode: 'commit',
  reply: '好，我幫你睇咗第一個選項：先接 POS，因為佢影響每日落單。',
  understanding: 'u',
  judgment: 'j',
  decision: { statement: 's', rationale: 'r' },
  tasks: [{ title: 't', note: 'n', capability: 'ops' }],
  risks: [],
  next_step: 'n'
})

function fake (text) {
  return { async complete () { return { text, usage: { inputTokens: 10, outputTokens: 622, totalTokens: 632 }, model: 'f', latencyMs: 1 } } }
}
const HISTORY = [
  { role: 'user', text: '而家有咩可以做?' },
  { role: 'assistant', text: '1. 接 POS\n2. 補價錢\n3. 執 recipe' }
]

/* ── the fix ──────────────────────────────────────────────────────────────── */

test('*** 「1」 after a numbered list keeps 香香\'s real answer ***', async () => {
  const res = await processIntake('1', fake(COMMIT), HISTORY, { demo: true, interactionMode: 'chat' })
  assert.equal(res.reply, '好，我幫你睇咗第一個選項：先接 POS，因為佢影響每日落單。',
    'her actual answer is returned, not a canned notice')
  assert.ok(!res.reply.includes('我未有建立提案'), 'the proposal notice is not shown for a continuation')
  assert.ok(!res.reply.includes('請切換到'), 'and certainly not the removed mode button')
})

test('every short confirmation behaves the same way', async () => {
  for (const m of ['1', '2', '好', '係', 'yes', 'ok', '可以', '繼續']) {
    const res = await processIntake(m, fake(COMMIT), HISTORY, { demo: true, interactionMode: 'chat' })
    assert.ok(!res.reply.includes('我未有建立提案'), 'continuation kept for: ' + m)
  }
})

/* ── the safe direction, unchanged ────────────────────────────────────────── */

test('*** a short reply still creates NOTHING — no decision, task, proposal or dispatch ***', async () => {
  const res = await processIntake('1', fake(COMMIT), HISTORY, { demo: true, interactionMode: 'chat' })
  assert.equal(res.talkOnly, true, 'it is still the interception, still talk-only')
  assert.equal(res.decision, null, 'no decision, even though the envelope carried one')
  assert.deepEqual(res.tasks, [], 'no task, even though the envelope carried one')
  assert.equal('proposals' in res, false, 'no proposal')
  assert.equal('workOrder' in res, false)
  assert.equal('agentExecute' in res, false)
  assert.equal(res.mode, 'chat')
})

test('the chat lane cannot promote even when the envelope is a full commit', async () => {
  // The proposal seam is not present in chat opts, so there is nothing to call.
  let promoted = 0
  const res = await processIntake('1', fake(COMMIT), HISTORY, {
    demo: true, interactionMode: 'chat', promoteToProposal: async () => { promoted++; return { ok: true, proposal: { id: 'p1' } } }
  })
  assert.equal(promoted, 0, 'the promote seam is NEVER called from the chat lane')
  assert.equal('proposals' in res, false)
})

/* ── a real instruction is still handled as before ────────────────────────── */

test('a REAL instruction in the chat lane still gets the "say what to change" notice', async () => {
  const res = await processIntake('幫我搞掂晒啲嘢', fake(COMMIT), HISTORY, { demo: true, interactionMode: 'chat' })
  assert.ok(res.reply.includes('我未有建立提案'), 'a genuine commit attempt is still intercepted with the notice')
  assert.equal(res.decision, null)
  assert.deepEqual(res.tasks, [])
})

test('a short reply with NO history is not a continuation', async () => {
  // Nothing to continue: the first thing said in a conversation being 「好」 carries no
  // prior turn, so the notice is the honest answer.
  const res = await processIntake('好', fake(COMMIT), [], { demo: true, interactionMode: 'chat' })
  assert.ok(res.reply.includes('我未有建立提案'))
})

test('a short reply that the classifier did NOT read as a commit is untouched', async () => {
  const CHAT = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '收到,我跟住做。' })
  const res = await processIntake('1', fake(CHAT), HISTORY, { demo: true, interactionMode: 'chat' })
  assert.equal(res.reply, '收到,我跟住做。', 'the ordinary chat path is unchanged')
})
