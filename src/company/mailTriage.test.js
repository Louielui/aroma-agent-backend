'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createMailMemory } = require('./mailMemory')
const { createTestStore } = require('../memory/structuredStore')
const owner = { owner: true }
function fixture () {
  const store = createTestStore(); let access = true; let enabled = true; let calls = 0; let classify; const rows = new Map()
  const mailbox = { status: () => ({ mailbox: 'adm@example.test' }), lease: () => () => { if (!access) throw Error('denied') },
    check: async () => { mailbox.lease()() }, read: async (_, id) => { mailbox.lease()(); return rows.get(id) } }
  const analyzer = { analyze: async input => { calls++; return classify(input) } }
  const memory = createMailMemory({ store, mailbox, analyzer, allowed: () => enabled })
  async function add (id, threadId = id, body = 'Please confirm invoice.') {
    const row = { id, threadId, mailbox: 'adm@example.test', body, subject: 'Invoice', bodyState: 'available', internalDate: String(Date.now() + rows.size) }
    rows.set(id, row); return memory.capture(owner, row)
  }
  const output = (input, category = 'decision') => ({ category, summary: 'Invoice summary', messageId: input.evidence.at(-1).id, quote: input.evidence.at(-1).body,
    task: ['decision', 'follow_up'].includes(category) ? { text: 'Check invoice', assignee: null, deadline: null, messageId: input.evidence.at(-1).id, quote: input.evidence.at(-1).body } : null,
    change: { kind: input.evidence.length > 1 ? 'cancellation' : 'none', messageId: input.evidence.at(-1).id, quote: input.evidence.at(-1).body } })
  classify = output
  return { store, mailbox, memory, add, output, classify: fn => { classify = fn }, revoke: () => { access = false }, pause: () => { enabled = false }, calls: () => calls }
}
test('analysis deduplicates and follow-up changes never overwrite Owner decisions', async () => {
  const f = fixture(); const { id } = await f.add('abc', 'aaa')
  await f.memory.analyze(owner, id); await f.memory.analyze(owner, id); assert.equal(f.calls(), 1)
  let row = (await f.memory.detail(owner, id)).record
  assert.equal(row.details.analysis.category, 'decision'); assert.equal(row.status, 'candidate'); assert.equal(row.details.assignee, null)
  await f.memory.update(owner, id, row.version, { action: 'approve', text: 'Owner decision', assignee: 'Louie', deadline: null, taskState: 'open' })
  await f.add('abd', 'aaa', 'Invoice cancelled.'); await f.memory.analyze(owner, id)
  row = (await f.memory.detail(owner, id)).record
  assert.equal(row.text, 'Owner decision'); assert.equal(row.details.taskState, 'open'); assert.equal(row.details.needsReview, true)
  assert.equal(row.details.analysis.change.kind, 'cancellation')
  assert.equal((await f.memory.briefing(owner)).items[0].id, id)
})
test('promotion is retained but filtered out of attention; unresolved classification is visible', async () => {
  const f = fixture(); const { id } = await f.add('abc'); f.classify(input => f.output(input, 'promotion'))
  await f.memory.analyze(owner, id)
  assert.equal((await f.memory.list(owner, '', 'attention')).items.length, 0)
  assert.equal((await f.memory.list(owner, '', 'promotion')).items[0].id, id)
  await f.add('abd'); f.classify(() => { throw Error('offline') })
  await assert.rejects(f.memory.analyze(owner, (await f.memory.list(owner, '', 'attention')).items[0].id))
  assert.equal((await f.memory.briefing(owner)).items.length, 1)
  assert.equal((await f.memory.status()).analysis.pending, 1)
})
test('new evidence, Owner edits and revocation during inference cannot save stale analysis', async () => {
  for (const change of ['reply', 'owner', 'revoke', 'pause']) {
    const f = fixture(); const { id } = await f.add('abc', 'aaa'); let release; let started
    const ready = new Promise(r => { started = r })
    f.classify(input => new Promise(r => { release = () => r(f.output(input)); started() }))
    const pending = f.memory.analyze(owner, id); await ready
    if (change === 'reply') await f.add('abd', 'aaa')
    if (change === 'owner') { const row = (await f.memory.detail(owner, id)).record; await f.memory.update(owner, id, row.version, { action: 'reject' }) }
    if (change === 'revoke') f.revoke()
    if (change === 'pause') f.pause()
    release(); await assert.rejects(pending)
    assert.notEqual((await f.store.get(id)).details.analysis?.state, 'ready')
  }
})
test('bounded batch works beyond the first twenty threads and enforces owner access', async () => {
  const f = fixture()
  for (let i = 1; i <= 23; i++) await f.add(i.toString(16))
  for (let i = 0; i < 12; i++) await f.memory.analyzeBatch(owner)
  assert.equal(f.calls(), 23); assert.equal((await f.memory.status()).analysis.pending, 0)
  await assert.rejects(f.memory.analyzeBatch({ owner: false }), /mail_access_denied/)
  const view = await f.memory.briefing(owner); assert.equal(view.total, 23); assert.equal(view.truncated, true)
})
test('restart preserves failure backoff and unchanged analyses, while manual retry remains available', async () => {
  const f = fixture(); const { id } = await f.add('abc')
  f.classify(() => { throw Error('offline') })
  await assert.rejects(f.memory.analyze(owner, id))
  let calls = 0
  const restarted = createMailMemory({ store: f.store, mailbox: f.mailbox, analyzer: { analyze: async input => { calls++; return f.output(input) } } })
  assert.deepEqual(await restarted.analyzeBatch(owner), { completed: 0, failed: 0 }); assert.equal(calls, 0)
  assert.equal((await restarted.analyze(owner, id)).state, 'ready'); assert.equal(calls, 1)
  await restarted.analyzeBatch(owner); assert.equal(calls, 1)
})

test('independent scheduler selects approved replies before newest mail and offers oldest backfill slots', async () => {
  const f = fixture(); const old = await f.add('abc'); const approved = await f.add('abd')
  let row = (await f.memory.detail(owner, approved.id)).record
  await f.memory.update(owner, row.id, row.version, { action: 'approve', text: 'Owner decision', assignee: null, deadline: null, taskState: 'open' })
  await f.add('abe', 'abd'); const newest = await f.add('abf')
  assert.equal((await f.memory.analyzeNext(owner)).id, approved.id)
  assert.equal((await f.memory.analyzeNext(owner)).id, newest.id)
  assert.equal((await f.memory.analyzeNext(owner, { oldest: true })).id, old.id)
  assert.equal((await f.memory.analyzeNext(owner)).state, 'idle')
})
