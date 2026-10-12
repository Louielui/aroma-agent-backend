'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createManager } = require('./manager')
function fixture (probe) {
  const env = { READ_ACCESS: 'on', CONTEXT_GMAIL: 'on', CONTEXT_DRIVE: 'on', CONTEXT_CALENDAR: 'on' }
  let state = {}; let flags = { CONTEXT_GITHUB: 'off' }; const events = []
  const store = { load: () => state, save: s => { state = structuredClone(s) }, event: e => events.push(e) }
  const provider = { configuration: () => ({ client: true, token: true, revision: 'r1', canAuthorize: true }), probe }
  const manager = createManager({ env, provider, store, settings: { load: () => ({ flags }), save: v => { flags = v.flags; Object.assign(env, flags); return { ok: true } } } })
  return { manager, env, events, flags: () => flags }
}
test('a configured credential is unverified until an actual bounded read; failures clear counts and do not erase last success', async () => {
  let calls = 0; let fails = false
  const f = fixture(async () => { calls++; if (fails) throw Object.assign(Error('SECRET'), { connectionCode: 'permission' }); return { account: 'owner@example.test', scopes: ['readonly'], count: 1 } })
  assert.equal(f.manager.list().connections[0].state, 'unverified'); assert.equal(calls, 0)
  let row = await f.manager.test('gmail'); assert.equal(row.state, 'connected'); assert.equal(row.lastProbe.count, 1)
  fails = true; row = await f.manager.test('gmail'); assert.equal(row.state, 'permission'); assert.equal(row.lastProbe.count, null); assert.ok(row.lastSuccessAt)
  assert.ok(!JSON.stringify(row).includes('SECRET'))
  f.manager.toggle('gmail', false); assert.equal(f.manager.list().connections[0].state, 'disabled')
  await assert.rejects(f.manager.test('gmail'), /disabled/); assert.equal(calls, 2)
  assert.equal(f.flags().CONTEXT_GITHUB, 'off'); assert.ok(f.events.length >= 3)
})
test('invalid sources and malformed probe results never become connected', async () => {
  const f = fixture(async () => ({ count: null }))
  await assert.rejects(f.manager.test('arbitrary'), /invalid_source/)
  assert.equal((await f.manager.test('drive')).state, 'error')
  assert.throws(() => f.manager.toggle('drive', 'on'), /invalid/)
})
test('probe results expire, credentials invalidate evidence, and concurrent changes cannot publish a stale success', async () => {
  const env = { READ_ACCESS: 'on', CONTEXT_GMAIL: 'on' }
  let now = Date.parse('2026-09-29T00:00:00Z'); let revision = 'a'; let saved = {}; let release
  const provider = { configuration: () => ({ client: true, token: true, revision }), probe: async () => ({ account: null, scopes: [], count: 0 }) }
  const manager = createManager({ env, provider, clock: () => now, store: { load: () => saved, save: v => { saved = v }, event: () => {} }, settings: {} })
  await manager.test('gmail'); assert.equal(manager.list().connections[0].state, 'connected')
  now += 900001; assert.equal(manager.list().connections[0].state, 'stale')
  revision = 'b'; assert.equal(manager.list().connections[0].state, 'unverified')
  provider.probe = () => new Promise(resolve => { release = resolve })
  const pending = manager.test('gmail')
  await assert.rejects(manager.test('gmail'), /busy/); assert.throws(() => manager.toggle('gmail', false), /busy/)
  revision = 'c'; release({ account: null, scopes: [], count: 1 })
  await assert.rejects(pending, /state_changed/); assert.equal(manager.list().connections[0].state, 'unverified')
})
