'use strict'

/**
 * conversationStore.test.js — conversation history that survives a refresh.
 *
 * The sidebar had 「開新對話」 and no history: everything lived in the page, so a refresh or
 * a new chat threw the conversation away. This store is the durable half.
 *
 * IT IS DELIBERATELY SMALL AND CLOSED. Read, append, delete — nothing else, and only the
 * UI path calls it. It holds conversation TEXT, so the two things that matter most here are
 * that a browser-supplied id can never escape the directory, and that nothing it stores
 * reaches a log.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  createConversationStore, CONVERSATION_DIR_NAME, TITLE_MAX
} = require('./conversationStore')

function tmpStore () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-conv-'))
  return { store: createConversationStore({ dataDir: root }), root }
}

const ID = '11111111-2222-4333-8444-555555555555'
const ID2 = '99999999-2222-4333-8444-555555555555'

/* ── shape and persistence ───────────────────────────────────────────────── */

test('*** a completed turn is appended and survives a reload ***', () => {
  const { store, root } = tmpStore()
  store.appendTurn({ id: ID, userText: '而家倉存入面有咩？', replyText: '餐廳系統有 199 項。', servedBy: 'claude' })

  const onDisk = JSON.parse(fs.readFileSync(path.join(root, CONVERSATION_DIR_NAME, ID + '.json'), 'utf8'))
  assert.equal(onDisk.id, ID)
  assert.equal(typeof onDisk.createdAt, 'string')
  assert.equal(typeof onDisk.updatedAt, 'string')
  assert.equal(onDisk.messages.length, 2, 'the question and the answer are one turn, two messages')
  assert.deepEqual(onDisk.messages.map((m) => m.role), ['user', 'assistant'])
  assert.equal(onDisk.messages[0].content, '而家倉存入面有咩？')
  assert.equal(onDisk.messages[1].servedBy, 'claude')
  assert.equal(typeof onDisk.messages[0].ts, 'string')

  // a fresh store instance reads the same thing — this is the refresh case
  const again = createConversationStore({ dataDir: root }).get(ID)
  assert.equal(again.messages.length, 2)
})

test('*** the title is the first user message, trimmed — and never changes after ***', () => {
  const { store } = tmpStore()
  const long = '呢句好長好長好長好長好長好長好長好長好長好長好長好長好長好長好長好長好長'
  store.appendTurn({ id: ID, userText: long, replyText: 'ok' })
  const t = store.get(ID).title
  assert.ok(t.length <= TITLE_MAX + 1, 'trimmed to about ' + TITLE_MAX + ' characters')
  assert.ok(long.startsWith(t.replace(/…$/, '')), 'and it is the beginning of what he asked')

  store.appendTurn({ id: ID, userText: '第二句完全唔同', replyText: 'ok' })
  assert.equal(store.get(ID).title, t, 'a later turn does not rename the conversation')
  assert.equal(store.get(ID).messages.length, 4)
})

test('an empty or whitespace first message still yields a usable title', () => {
  const { store } = tmpStore()
  store.appendTurn({ id: ID, userText: '   ', replyText: 'ok' })
  assert.ok(store.get(ID).title.length > 0)
})

test('updatedAt moves with each turn; createdAt does not', () => {
  const { store } = tmpStore()
  store.appendTurn({ id: ID, userText: 'a', replyText: 'b', now: '2026-08-01T00:00:00.000Z' })
  store.appendTurn({ id: ID, userText: 'c', replyText: 'd', now: '2026-08-02T00:00:00.000Z' })
  const c = store.get(ID)
  assert.equal(c.createdAt, '2026-08-01T00:00:00.000Z')
  assert.equal(c.updatedAt, '2026-08-02T00:00:00.000Z')
})

/* ── listing ─────────────────────────────────────────────────────────────── */

test('*** the list is newest-first by updatedAt and carries no message bodies ***', () => {
  const { store } = tmpStore()
  store.appendTurn({ id: ID, userText: '舊嗰個', replyText: 'x', now: '2026-08-01T00:00:00.000Z' })
  store.appendTurn({ id: ID2, userText: '新嗰個', replyText: 'SECRET_BODY', now: '2026-08-03T00:00:00.000Z' })

  const list = store.list()
  assert.deepEqual(list.map((c) => c.id), [ID2, ID], 'newest first')
  assert.equal(JSON.stringify(list).includes('SECRET_BODY'), false, 'the list is metadata, not transcripts')
  assert.equal(list[0].messageCount, 2)
  assert.ok(list[0].title.length > 0)
})

test('a directory that does not exist yet lists as empty rather than throwing', () => {
  const { store } = tmpStore()
  assert.deepEqual(store.list(), [])
  assert.equal(store.get(ID), null)
})

test('a corrupt file is skipped, not fatal — one bad file may not hide the rest', () => {
  const { store, root } = tmpStore()
  store.appendTurn({ id: ID, userText: 'good', replyText: 'x' })
  fs.writeFileSync(path.join(root, CONVERSATION_DIR_NAME, ID2 + '.json'), '{ not json')
  const list = store.list()
  assert.deepEqual(list.map((c) => c.id), [ID])
})

/* ── delete ──────────────────────────────────────────────────────────────── */

test('*** delete removes the file and the listing ***', () => {
  const { store, root } = tmpStore()
  store.appendTurn({ id: ID, userText: 'a', replyText: 'b' })
  assert.equal(store.remove(ID), true)
  assert.equal(fs.existsSync(path.join(root, CONVERSATION_DIR_NAME, ID + '.json')), false)
  assert.deepEqual(store.list(), [])
  assert.equal(store.remove(ID), false, 'deleting what is not there is false, not an error')
})

/* ── the id comes from a browser, so it is the attack surface ────────────── */

test('*** a traversing id can never escape the conversations directory ***', () => {
  const { store, root } = tmpStore()
  const outside = path.join(root, 'aroma-truth.json')
  fs.writeFileSync(outside, '{"decisions":[]}')

  const evil = ['../aroma-truth', '..\\aroma-truth', '/etc/passwd', 'a/b', 'a\\b', '.', '..', '', null, 42, 'x'.repeat(200)]
  for (const id of evil) {
    assert.equal(store.get(id), null, 'get: ' + String(id))
    assert.equal(store.remove(id), false, 'remove: ' + String(id))
    assert.throws(() => store.appendTurn({ id, userText: 'a', replyText: 'b' }), /invalid_conversation_id/, 'append: ' + String(id))
  }
  assert.equal(fs.readFileSync(outside, 'utf8'), '{"decisions":[]}', 'the neighbouring truth store is untouched')
  assert.deepEqual(store.list(), [], 'and nothing was created')
})

test('only files this store wrote are listed — a stray file is not a conversation', () => {
  const { store, root } = tmpStore()
  fs.mkdirSync(path.join(root, CONVERSATION_DIR_NAME), { recursive: true })
  fs.writeFileSync(path.join(root, CONVERSATION_DIR_NAME, 'notes.txt'), 'hello')
  fs.writeFileSync(path.join(root, CONVERSATION_DIR_NAME, 'not-an-id.json'), '{"id":"x"}')
  assert.deepEqual(store.list(), [])
})

/* ── the store holds conversation text, so it may not narrate it ─────────── */

test('*** nothing the store logs contains message content ***', () => {
  const { store } = tmpStore()
  const lines = []
  const original = console.log
  console.log = (...a) => lines.push(a.map(String).join(' '))
  try {
    store.appendTurn({ id: ID, userText: 'SECRET_QUESTION', replyText: 'SECRET_ANSWER' })
    store.list()
    store.get(ID)
    store.remove(ID)
  } finally { console.log = original }
  const all = lines.join('\n')
  assert.equal(all.includes('SECRET_QUESTION'), false)
  assert.equal(all.includes('SECRET_ANSWER'), false)
})
