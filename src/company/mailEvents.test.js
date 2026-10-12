'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createMailEvents } = require('./mailEvents')
const { createTestStore } = require('../memory/structuredStore')
function fixture () {
  const store = createTestStore(); let history = '100'; let fail = false; let acks = 0; const captured = []; let watched = 0
  const mailbox = { status: () => ({ mailbox: 'adm@example.test' }), lease: () => () => {},
    cursor: async () => history, watch: async () => { watched++; return { historyId: '100', expiration: String(Date.now() + 86400000 * 6) } },
    history: async () => { if (fail) throw Error('offline'); return { ids: ['abc'], historyId: '101', nextPageToken: null } },
    read: async (_, id) => ({ id }) }
  const pubsub = { status: () => ({ configured: true, topic: 'projects/test/topics/mail' }), prepare: async () => {},
    pull: async () => [{ ackId: 'ack', message: { data: Buffer.from(JSON.stringify({ emailAddress: 'adm@example.test', historyId: '101' })).toString('base64') } }], ack: async () => { acks++ } }
  const memory = { capture: async (_, row) => { captured.push(row.id); return {state:'saved'} }, sync: async () => ({hasMore:false}), enabled: () => true }
  return { store, mailbox, pubsub, memory, captured, fail: () => { fail = true }, acks: () => acks, watched: () => watched,
    events: () => createMailEvents({ store, mailbox, pubsub, memory }) }
}
test('notification pulls checkpoint before acknowledging, deduplicates, and resumes after restart', async () => {
  const f = fixture(); await f.events().tick(); assert.deepEqual(f.captured, ['abc']); assert.equal(f.acks(), 1)
  await f.events().tick(); assert.deepEqual(f.captured, ['abc']); assert.equal(f.acks(), 2); assert.equal(f.watched(), 1)
})
test('failed history read does not acknowledge or advance cursor; wrong mailbox cannot trigger reads', async () => {
  const f = fixture(); f.fail(); await f.events().tick(); assert.equal(f.acks(), 0)
  assert.equal((await f.events().status()).historyId, '100')
  const g = fixture(); g.pubsub.pull = async () => [{ackId:'bad',message:{data:Buffer.from(JSON.stringify({emailAddress:'other@example.test',historyId:'999'})).toString('base64')}}]
  await g.events().tick(); assert.equal((await g.events().status()).discarded, 1)
})
test('pagination never promotes a partial history page to the final cursor', async () => {
  const f = fixture(); let call = 0
  f.mailbox.history = async (_, p) => { call++; return p.pageToken ? {ids:['abd'],historyId:'110',nextPageToken:null} : {ids:['abc'],historyId:'110',nextPageToken:'next'} }
  const events = f.events(); await events.tick(); const state = await events.status()
  assert.equal(state.historyId, '100'); assert.equal(state.pageToken, 'next'); assert.equal(f.acks(), 0)
  await f.events().tick(); assert.equal((await events.status()).historyId, '110'); assert.equal(call, 2)
})

test('expired history performs a checkpointed full scan before replay and acknowledgement', async () => {
  const f = fixture(); let expired = true
  f.mailbox.history = async () => expired ? { expired: true } : { ids: ['abd'], historyId: '101' }
  f.mailbox.scan = async () => ({ messages: [{ id: 'abc' }], nextPageToken: null })
  await f.events().tick(); assert.ok((await f.events().status()).recovery); assert.equal(f.acks(), 0)
  expired = false; await f.events().tick(); assert.deepEqual(f.captured, ['abc']); assert.equal(f.acks(), 0)
  await f.events().tick(); assert.deepEqual(f.captured, ['abc', 'abd']); assert.equal(f.acks(), 1)
})

test('durable commit failure, source revocation or pause during pull never acknowledges mail', async () => {
  const f = fixture(); f.memory.capture = async () => { throw Error('disk_failed') }
  await f.events().tick(); assert.equal(f.acks(), 0); assert.equal((await f.events().status()).historyId, '100')
  const g = fixture(); const events = g.events(); const original = g.pubsub.pull
  g.pubsub.pull = async () => { await events.control({owner:true}, true); return original() }
  await events.tick(); assert.equal(g.captured.length, 0); assert.equal(g.acks(), 0)
  const h = fixture(); let revoked = false
  h.mailbox.lease = () => () => { if (revoked) throw Error('denied') }
  h.pubsub.pull = async () => { revoked = true; return [] }
  await h.events().tick(); assert.equal(h.captured.length, 0); assert.equal(h.acks(), 0)
})

test('large decimal history IDs are not rounded and disconnected Pub/Sub never performs cloud calls', async () => {
  const f = fixture(); f.pubsub.status = () => ({configured:false})
  await f.events().tick(); assert.equal(f.watched(), 0)
  const g = fixture(); g.mailbox.cursor = async () => '9007199254740992'
  g.pubsub.pull = async () => [{ackId:'large',message:{data:Buffer.from(JSON.stringify({emailAddress:'adm@example.test',historyId:'9007199254740993'})).toString('base64')}}]
  g.mailbox.history = async () => ({ids:['abc'],historyId:'9007199254740993'})
  await g.events().tick(); assert.equal((await g.events().status()).historyId,'9007199254740993'); assert.equal(g.acks(),1)
})

test('safe integer notification cursors are accepted without rounding unsafe numbers', async () => {
  const f = fixture()
  f.pubsub.pull = async () => [{ackId:'numeric',message:{data:Buffer.from(JSON.stringify({emailAddress:'adm@example.test',historyId:101})).toString('base64')}}]
  await f.events().tick(); assert.ok((await f.events().status()).lastNotificationAt)
  assert.equal((await f.events().status()).discarded,0)
  const g = fixture()
  g.pubsub.pull = async () => [{ackId:'unsafe',message:{data:Buffer.from('{"emailAddress":"adm@example.test","historyId":9007199254740993}').toString('base64')}}]
  await g.events().tick(); assert.equal((await g.events().status()).discardReasons.invalid_history,1)
})

test('explicit retry renews Watch for a real provider test notification without resetting the history cursor', async () => {
  const f = fixture(); const events = f.events(); await events.tick()
  assert.equal(f.watched(),1)
  await events.control({owner:true},false); await events.tick()
  assert.equal(f.watched(),2); assert.equal((await events.status()).historyId,'101')
})
