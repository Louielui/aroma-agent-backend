'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createCapture, wrapConversationStore } = require('./capture')
function setup(t, client = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-capture-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const docs = new Map(); const calls = []
  const memory = { get: async id => docs.get(id) || null, retainAutomatic: async (id, text, source) => { calls.push({ id, text, source }); const d = { id, text, facts: 2 }; docs.set(id, d); return d }, ...client }
  return { capture: createCapture({ dir, client: memory }), dir, memory, calls }
}
const turn = { id: 'conversation-fixture', userText: 'I prefer green folders for reports.', replyText: 'I suggest filing the report tomorrow.' }

test('capture displays a verified zero-fact original without retrying extraction', async t => {
  let text; let writes = 0
  const { capture } = setup(t, { get: async id => ({ id, text, facts: 0, indexState: 'raw_only' }), retainAutomatic: async () => { writes++; throw Error('unexpected_write') } })
  const row = capture.turn(turn, 2); text = row.text
  await capture.work()
  assert.equal(capture.get(row.id).state, 'raw_only')
  assert.equal(capture.status().counts.raw_only, 1); assert.equal(writes, 0)
})
test('capture persists before background extraction, preserves roles and deduplicates source turns', async t => {
  const { capture, dir, memory, calls } = setup(t)
  const a = capture.turn(turn, 2)
  assert.equal(a.state, 'pending'); assert.equal(calls.length, 0)
  assert.equal(capture.turn(turn, 2).id, a.id)
  await capture.work(); assert.equal(calls.length, 1)
  assert.match(calls[0].text, /OWNER SAID/); assert.match(calls[0].text, /ASSISTANT SAID.*not verified/)
  assert.equal(capture.get(a.id).state, 'saved'); assert.equal(capture.get(a.id).facts, 2)
  const restarted = createCapture({ dir, client: memory }); await restarted.work(); assert.equal(calls.length, 1)
  assert.equal(restarted.search('green')[0].id, a.id)
})
test('opt out, secret-like content and paused capture never reach Hindsight', async t => {
  const { capture, calls } = setup(t)
  for (const text of ['不要記住這件事：I prefer blue.', 'Do not remember this: blue', 'password: fixture-secret', '我的密碼是fixture-secret', 'Bearer abc.def.ghi']) {
    const row = capture.turn({ ...turn, userText: text }, Math.random())
    assert.equal(row.state, 'skipped'); assert.equal(row.text, '')
  }
  capture.setEnabled(false); assert.equal(capture.turn(turn, 8).state, 'skipped')
  await capture.work(); assert.equal(calls.length, 0)
})
test('uncertain writes stay unconfirmed across restart, explicit retry reads back before writing, forgetting prevents replay', async t => {
  const { capture, dir, memory } = setup(t, { retainAutomatic: async () => { throw Error('private upstream detail') } })
  const a = capture.turn(turn, 2); await capture.work()
  assert.equal(capture.get(a.id).state, 'unconfirmed'); assert.ok(!JSON.stringify(capture.status()).includes('private'))
  const restarted = createCapture({ dir, client: { ...memory, get: async id => ({ id, text: a.text, facts: 3 }) } })
  await restarted.work(); assert.equal(restarted.get(a.id).state, 'unconfirmed')
  restarted.retry(a.id); await restarted.work(); assert.equal(restarted.get(a.id).state, 'saved')
  restarted.suppress(a.id, 'forgotten'); assert.equal(restarted.get(a.id).text, '')
  assert.throws(() => restarted.retry(a.id), /not_retryable/)
  assert.equal(restarted.turn(turn, 2).state, 'forgotten')
})
test('a busy extractor blocks edit/delete races and pause prevents pending extraction', async t => {
  let release; const gate = new Promise(r => { release = r })
  const { capture } = setup(t, { retainAutomatic: async (id, text) => { await gate; return { id, text, facts: 1 } } })
  const a = capture.turn(turn, 2); const working = capture.work()
  await new Promise(r => setImmediate(r))
  await assert.rejects(capture.mutate(a.id, 'forgotten', async () => {}), /memory_busy/)
  capture.setEnabled(false); release(); await working
  assert.equal(capture.get(a.id).state, 'saved')
  assert.equal(capture.turn({ ...turn, id: 'paused-new' }, 2).state, 'skipped')
  await capture.mutate(a.id, 'edited', async () => {})
  assert.equal(capture.get(a.id).state, 'edited')
  assert.equal(capture.get(a.id).text, '')
})
test('conversation hook runs only after archive success and a run records measured state, not raw tool content', async t => {
  const { capture, calls } = setup(t)
  const wrapped = wrapConversationStore({ appendTurn: () => ({ messageCount: 2 }), list: () => [] }, capture)
  wrapped.appendTurn(turn)
  const broken = wrapConversationStore({ appendTurn: () => { throw Error('disk full') } }, capture)
  assert.throws(() => broken.appendTurn({ ...turn, id: 'other' }))
  const r = capture.run({ id: 'run-fixture', state: 'partial', finishedAt: '2026-09-29T12:00:00Z', sections: [{ tool: 'drive.documents', state: 'unavailable', count: null, rows: ['secret raw data'] }] })
  assert.match(r.text, /partial/); assert.match(r.text, /null/); assert.ok(!r.text.includes('secret raw data'))
  await capture.work(); await capture.work(); assert.equal(calls.length, 2)
})
