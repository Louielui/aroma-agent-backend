'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createTestStore } = require('../memory/structuredStore')
const { createMailMemory } = require('./mailMemory')
const { createMailAnalyzer } = require('./mailAnalysis')

async function fixture () {
  const store = createTestStore(); const owner = { owner: true }
  let at = '2026-10-02T05:01:35.000Z'; let authorized = true; let checks = 0; let retains = 0
  let code = 'subscription_limit_reached'; let providerFailure = null; let failAfterCheck = false
  const mailbox = { status: () => ({ mailbox: 'adm@example.test' }), lease: actor => () => {
    if (!authorized || actor?.owner !== true) throw Error('mail_access_denied')
  }, check: async actor => mailbox.lease(actor)(), read: async actor => { mailbox.lease(actor)(); return {} } }
  const analyzer = { preflight: async () => { checks++; if (code) throw Object.assign(Error('private-provider-detail'), { code }); if (failAfterCheck) authorized = false },
    analyze: async () => { throw Object.assign(Error('private-provider-detail'), { code: 'subscription_limit_reached' }) } }
  const client = { get: async () => null, retainAutomatic: async (id, text) => {
    retains++; if (providerFailure) { code = failAfterCheck ? 'subscription_limit_reached' : null; throw Error(providerFailure) }
    return { id, text, facts: 1 }
  } }
  const engine = { forMailSource: () => client }
  const create = () => createMailMemory({ store, mailbox, engine, analyzer, clock: () => at })
  const memory = create()
  await memory.capture(owner, { id: 'abc', threadId: 'aaa', mailbox: 'adm@example.test', subject: 'Delivery', from: 'Vendor',
    body: 'Please deliver blue crates.', date: '2026-10-01T12:00:00Z', internalDate: '1790856000000', bodyState: 'available', bodyTruncated: false })
  const original = (await store.all()).find(row => row.source.kind === 'admin_mail_message')
  return { store, owner, memory, create, original, mailbox, analyzer, checks: () => checks, retains: () => retains,
    time: value => { at = value }, ready: () => { code = null }, fail: value => { providerFailure = value },
    revokeAfterCheck: () => { code = null; failAfterCheck = true } }
}

test('expired shared cooldown rechecks actual subscription before touching an original or provider', async () => {
  const f = await fixture()
  await require('./mailState').createMailState({ store: f.store, mailbox: f.mailbox, kind: 'scheduler',
    clock: () => '2026-10-02T05:01:35.000Z' }).update(() => ({ reason: 'subscription_limit_reached', nextAt: '2026-10-02T05:01:17.000Z' }))
  const before = structuredClone(await f.store.get(f.original.id))
  const result = await f.memory.indexNext(f.owner)
  assert.deepEqual(result, { state: 'backoff', reason: 'subscription_limit_reached', retryAt: '2026-10-02T06:01:35.000Z' })
  assert.equal(f.checks(), 1); assert.equal(f.retains(), 0)
  assert.deepEqual(await f.store.get(f.original.id), before)
  const restarted = f.create(); assert.equal((await restarted.indexNext(f.owner)).state, 'backoff')
  assert.equal(f.checks(), 1); assert.equal((await restarted.status()).hindsight.backoffReason, 'subscription_limit_reached')
  f.time('2026-10-02T06:01:36.000Z'); f.ready()
  assert.equal((await restarted.indexNext(f.owner)).state, 'saved'); assert.equal(f.retains(), 1)
  assert.equal((await f.store.get(f.original.id)).index.attempts, 1)
})

test('a Hindsight failure after quota changes waits without exhausting an eligible source', async () => {
  const f = await fixture(); f.ready(); f.fail('memory_unavailable')
  // The first status is ready; the provider then encounters newly exhausted quota.
  let checks = 0
  f.analyzer.preflight = async () => { if (++checks === 2) throw Object.assign(Error('private'), { code: 'subscription_limit_reached' }) }
  const before = structuredClone(await f.store.get(f.original.id))
  assert.equal((await f.memory.indexNext(f.owner)).reason, 'subscription_limit_reached')
  assert.equal(checks, 2); assert.equal(f.retains(), 1)
  assert.deepEqual(await f.store.get(f.original.id), before)
})

test('genuine provider failure with ready subscription retains its bounded source failure', async () => {
  const f = await fixture(); f.ready(); f.fail('memory_unavailable')
  assert.equal((await f.memory.indexNext(f.owner)).state, 'unconfirmed')
  const after = await f.store.get(f.original.id)
  assert.equal(after.index.reason, 'memory_unavailable'); assert.equal(after.index.attempts, 1)
  assert.equal(after.details.hash, f.original.details.hash); assert.equal(after.text, f.original.text)
})

test('unknown subscription errors fail closed without leaking details or consuming source attempts', async () => {
  const f = await fixture(); f.analyzer.preflight = async () => { throw Error('secret credential and private body') }
  const before = structuredClone(await f.store.get(f.original.id))
  const result = await f.memory.indexNext(f.owner)
  assert.deepEqual(result, { state: 'backoff', reason: 'subscription_unavailable', retryAt: '2026-10-02T05:06:35.000Z' })
  assert.deepEqual(await f.store.get(f.original.id), before); assert.equal(f.retains(), 0)
  assert.doesNotMatch(JSON.stringify(await f.store.all()), /secret credential|private body/)
})

test('revocation during the subscription status read cannot retain or change a source', async () => {
  const f = await fixture(); f.revokeAfterCheck()
  const before = structuredClone(await f.store.get(f.original.id))
  await assert.rejects(f.memory.indexNext(f.owner), /mail_access_denied/)
  assert.deepEqual(await f.store.get(f.original.id), before); assert.equal(f.retains(), 0)
})

test('new analysis quota failures persist their exact safe code and retain Owner decisions', async () => {
  const f = await fixture(); const row = (await f.memory.list(f.owner)).items[0]
  await f.memory.update(f.owner, row.id, row.version, { action: 'approve', text: 'Owner will check delivery', assignee: null, deadline: null, taskState: 'open' })
  const before = await f.store.get(row.id)
  await assert.rejects(f.memory.analyze(f.owner, row.id), error => error.code === 'subscription_limit_reached')
  const after = await f.store.get(row.id)
  assert.equal(after.details.analysis.reason, 'subscription_limit_reached')
  assert.equal(after.details.analysis.retryAt, '2026-10-02T06:01:35.000Z')
  assert.deepEqual(after.approval, before.approval); assert.equal(after.text, before.text)
  assert.doesNotMatch(JSON.stringify(after), /private-provider-detail/)
})

test('mail analyzer status check uses a bounded signal and never completes a model task', async () => {
  let checks = 0; let completes = 0
  const analyzer = createMailAnalyzer({ adapterFactory: () => ({ preflight: async options => {
    checks++; assert.ok(options.signal instanceof AbortSignal); assert.equal(options.signal.aborted, false)
    throw Object.assign(Error('quota'), { code: 'subscription_limit_reached' })
  }, complete: async () => { completes++; throw Error('not_expected') } }) })
  await assert.rejects(analyzer.preflight(), error => error.code === 'subscription_limit_reached')
  assert.equal(checks, 1); assert.equal(completes, 0)
})

test('subscription adapter carries the status deadline through to its fixed local request', async () => {
  const { CodexSubscriptionAdapter } = require('../adapters/CodexSubscriptionAdapter')
  const { MODEL } = require('../subscription/codexClient'); const signal = AbortSignal.timeout(10000)
  const adapter = new CodexSubscriptionAdapter({ request: async (route, input, env, received) => {
    assert.equal(route, '/status'); assert.deepEqual(input, { model: MODEL, effort: 'low' }); assert.equal(received, signal)
    return { model: MODEL, billing: 'chatgpt-subscription' }
  } })
  assert.equal((await adapter.preflight({ signal })).billing, 'chatgpt-subscription')
})
