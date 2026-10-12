'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
function fixture (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-topics-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return { dir, store: require('./workspaces').createTopicStore({ dataDir: dir }) }
}
test('topic membership and Owner follow-ups survive reopening without mixing topics', t => {
  const { dir, store } = fixture(t)
  store.link('email', 'email-fixture'); store.link('calendar', 'calendar-fixture')
  const note = store.createNote('email', { requestId: 'note-request-fixture', title: 'Reply to supplier', nextStep: 'Check delivery date', source: { mailbox: 'admin', messageId: 'abcdef123' } })
  const opened = require('./workspaces').createTopicStore({ dataDir: dir })
  assert.deepEqual(opened.get('email').conversationIds, ['email-fixture'])
  assert.equal(opened.get('email').lastConversationId, 'email-fixture')
  assert.deepEqual(opened.get('calendar').notes, [])
  assert.equal(opened.get('email').notes[0].nextStep, 'Check delivery date')
  assert.equal(note.origin, 'owner_note'); assert.equal(note.state, 'todo')
  assert.equal(opened.updateNote('email', note.id, { revision: 1, state: 'doing', nextStep: 'Await confirmation' }).revision, 2)
  assert.throws(() => opened.updateNote('email', note.id, { revision: 1, state: 'done', nextStep: '' }), /revision_conflict/)
  assert.equal(opened.get('email').notes[0].state, 'doing')
})
test('closed topics, cross-topic membership, forged commands and damaged stores fail without writes', t => {
  const { dir, store } = fixture(t)
  store.link('email', 'email-fixture')
  assert.throws(() => store.link('calendar', 'email-fixture'), /topic_conflict/)
  assert.throws(() => store.link('../private', 'other'), /invalid_topic/)
  assert.throws(() => store.createNote('email', { requestId: 'x', title: 'Hello', nextStep: '', command: 'send' }), /invalid_request/)
  assert.equal(store.get('email').notes.length, 0)
  const file = path.join(dir, 'topic-workspaces.json'); fs.writeFileSync(file, '{damaged')
  const before = fs.readFileSync(file)
  assert.throws(() => store.get('email'), /topic_store_unavailable/)
  assert.throws(() => store.link('email', 'new-fixture'), /topic_store_unavailable/)
  assert.deepEqual(fs.readFileSync(file), before)
})
test('note creation is idempotent and source references do not claim a provider read or email operation', t => {
  const { store } = fixture(t), input = { requestId: 'note-request', title: 'Follow up', nextStep: '', source: null }
  const a = store.createNote('email', input), b = store.createNote('email', input)
  assert.equal(a.id, b.id); assert.equal(store.get('email').notes.length, 1)
  assert.equal(a.source, null); assert.equal(a.origin, 'owner_note')
  assert.throws(() => store.createNote('email', { ...input, title: 'Different' }), /request_conflict/)
})
