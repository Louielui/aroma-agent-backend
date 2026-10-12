'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createStructuredStore } = require('./structuredStore')
const row = (id, mailbox = 'adm@example.test', kind = 'admin_mail_message') => ({ id,
  text: 'Private source 中文 😀', source: { kind }, details: { mailbox } })
test('mail transport uses a fixed source snapshot and progressing keyset pages', async () => {
  const calls = []
  const store = createStructuredStore({ invoke: async input => {
    calls.push(input)
    return input.after === 0 ? { items: [row('first')], nextSequence: 5, snapshotSequence: 12, hasMore: true }
      : { items: [row('second')], nextSequence: 12, snapshotSequence: 12, hasMore: false }
  } })
  assert.deepEqual((await store.mailRows('adm@example.test')).map(r => r.id), ['first','second'])
  assert.deepEqual(calls, [
    { op: 'mail_page', mailbox: 'adm@example.test', kinds: ['admin_mail_message','admin_mail_thread'], after: 0, snapshotSequence: null },
    { op: 'mail_page', mailbox: 'adm@example.test', kinds: ['admin_mail_message','admin_mail_thread'], after: 5, snapshotSequence: 12 }
  ])
})
test('mail transport rejects foreign sources, invalid cursors and moving snapshots without fallback', async () => {
  for (const bad of [
    { items: [row('other','ivy@example.test')], nextSequence: 1, snapshotSequence: 2, hasMore: false },
    { items: [row('other','adm@example.test','conversation')], nextSequence: 1, snapshotSequence: 2, hasMore: false },
    { items: [], nextSequence: 0, snapshotSequence: 2, hasMore: true },
    { items: [row('ok')], nextSequence: 3, snapshotSequence: 2, hasMore: false }
  ]) {
    const store = createStructuredStore({ invoke: async () => bad })
    await assert.rejects(store.mailRows('adm@example.test'), /memory_database_unavailable/)
  }
  let calls = 0
  const store = createStructuredStore({ invoke: async () => ++calls === 1
    ? { items: [row('first')], nextSequence: 1, snapshotSequence: 2, hasMore: true }
    : { items: [row('second')], nextSequence: 2, snapshotSequence: 3, hasMore: false } })
  await assert.rejects(store.mailRows('adm@example.test'), /memory_database_unavailable/)
  assert.equal(calls, 2)
})
test('invalid mailbox/kinds fail before transport; thread-only projection is explicit', async () => {
  const calls = []
  const store = createStructuredStore({ invoke: async input => { calls.push(input); return { items:[],nextSequence:0,snapshotSequence:0,hasMore:false } } })
  for (const [mailbox,kinds] of [['bad',undefined],['adm@example.test',['conversation']],['adm@example.test',[]],['adm@example.test',['admin_mail_thread','admin_mail_thread']]]) {
    await assert.rejects(store.mailRows(mailbox,kinds), /memory_database_unavailable/)
  }
  assert.equal(calls.length,0)
  assert.deepEqual(await store.mailRows('adm@example.test',['admin_mail_thread']),[])
  assert.deepEqual(calls[0].kinds,['admin_mail_thread'])
})
test('index manifests use the same source cutoff without transporting original bodies', async () => {
  const calls = [], projection = { id: 'one', version: 1, status: 'active', createdAt: '2026-10-01T00:00:00Z',
    source: { kind: 'admin_mail_message' }, details: { mailbox: 'adm@example.test' } }
  const store = createStructuredStore({ invoke: async request => { calls.push(request); return {
    items: [projection], nextSequence: 1, snapshotSequence: 1, hasMore: false } } })
  assert.deepEqual(await store.mailIndexRows('adm@example.test'), [projection])
  assert.equal(calls[0].op, 'mail_index_page'); assert.equal(calls[0].snapshotSequence, null)
  for (const bad of [{ ...projection, text: 'private body' }, { ...projection, details: { ...projection.details, body: 'private body' } },
    { ...projection, version: 0 }, { ...projection, details: { mailbox: 'ivy@example.test' } }]) {
    const unsafe = createStructuredStore({ invoke: async () => ({ items: [bad], nextSequence: 1, snapshotSequence: 1, hasMore: false }) })
    await assert.rejects(unsafe.mailIndexRows('adm@example.test'), /memory_database_unavailable/)
  }
})
test('the larger manifest page bound never enlarges full-original or general-memory pages', async () => {
  const make = (size, kind, projected) => Array.from({ length: size }, (_, n) => ({
    id: String(n), version: 1, status: 'active', createdAt: '2026-10-01T00:00:00Z',
    ...(!projected ? { text: 'body' } : {}), source: { kind }, details: { mailbox: 'adm@example.test' } }))
  const build = items => createStructuredStore({ invoke: async () => ({ items, nextSequence: items.length, snapshotSequence: items.length, hasMore: false }) })
  assert.equal((await build(make(10000, 'admin_mail_message', true)).mailIndexRows('adm@example.test')).length, 10000)
  await assert.rejects(build(make(10001, 'admin_mail_message', true)).mailIndexRows('adm@example.test'), /memory_database_unavailable/)
  await assert.rejects(build(make(2001, 'admin_mail_message', false)).mailRows('adm@example.test'), /memory_database_unavailable/)
  assert.equal((await build(make(1, 'conversation', false)).generalRows()).length, 1)
  await assert.rejects(build(make(2001, 'conversation', false)).generalRows(), /memory_database_unavailable/)
})
test('Python source pages are bounded, Unicode-exact and parameterized', { skip: !fs.existsSync('C:/Aroma/hindsight-runtime/Scripts/python.exe') }, () => {
  const result = spawnSync('C:/Aroma/hindsight-runtime/Scripts/python.exe', ['-B','-X','utf8',path.resolve(__dirname,'../../scripts/memory/mailRows.fixture.py')], {encoding:'utf8',windowsHide:true,timeout:10000})
  assert.equal(result.status,0,result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { passed:true, sourceIsolation:true, fixedSnapshot:true, byteBound:true, unicode:true })
})
