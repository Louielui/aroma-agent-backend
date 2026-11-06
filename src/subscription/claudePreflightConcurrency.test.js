'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { complete, isMetadataOnly } = require('./claudeClient')
const authOK = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }
const catalogueOK = { models: [{ value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', supportsEffort: true, supportedEffortLevels: ['medium'] }] }
const request = { model: 'claude-sonnet', effort: 'medium', prompt: 'offline test' }
function deferred () {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture () {
  const auth = deferred(), catalogue = deferred(), events = []; let sends = 0
  const run = async (args, options) => {
    const stage = args.includes('status') ? 'auth' : options.controlRequestId ? 'catalogue' : 'completion'
    events.push(stage)
    if (stage !== 'completion') {
      assert.equal(isMetadataOnly(args, options), true)
      assert.equal(options.onDispatch, undefined)
      return stage === 'auth' ? auth.promise : catalogue.promise
    }
    options.onDispatch?.()
    return { type: 'result', subtype: 'success', result: 'ok', modelUsage: { 'claude-sonnet-5-5': {} } }
  }
  return { auth, catalogue, events, options: { run, onDispatch: () => sends++ }, sends: () => sends }
}

for (const first of ['auth', 'catalogue']) test(`both metadata reads start together; ${first} alone cannot authorize dispatch`, async () => {
  const f = fixture(), pending = complete(f.options, request)
  const started = f.events.slice()
  f[first].resolve(first === 'auth' ? authOK : catalogueOK)
  await new Promise(resolve => setImmediate(resolve))
  const earlySends = f.sends()
  f[first === 'auth' ? 'catalogue' : 'auth'].resolve(first === 'auth' ? catalogueOK : authOK)
  assert.equal((await pending).text, 'ok')
  assert.deepEqual(started, ['auth', 'catalogue']); assert.equal(earlySends, 0)
  assert.equal(f.sends(), 1); assert.deepEqual(f.events, ['auth', 'catalogue', 'completion'])
})

test('auth failure wins over simultaneous catalogue failure and never sends a completion', async () => {
  const f = fixture(), pending = complete(f.options, request)
  const observed = assert.rejects(pending, { code: 'subscription_login_required' })
  f.auth.resolve({ loggedIn: false })
  // Resolve a malformed catalogue so the old serial implementation also finishes.
  f.catalogue.resolve({ models: null })
  await observed
  assert.equal(f.sends(), 0)
})

test('catalogue failure remains visible with valid auth, without dispatch or retry', async () => {
  const f = fixture(), pending = complete(f.options, request)
  const observed = assert.rejects(pending, { code: 'subscription_unavailable' })
  f.auth.resolve(authOK); f.catalogue.resolve({ models: null })
  await observed
  assert.equal(f.sends(), 0); assert.deepEqual(f.events, ['auth', 'catalogue'])
})

test('preflight is never cached across completions and revoked login blocks the next send', async () => {
  let authReads = 0, catalogueReads = 0, sends = 0
  const options = { onDispatch: () => sends++, run: async (args, opts) => {
    if (args.includes('status')) return ++authReads === 1 ? authOK : { loggedIn: false }
    if (opts.controlRequestId) { catalogueReads++; return catalogueOK }
    opts.onDispatch?.()
    return { type: 'result', subtype: 'success', result: 'ok', modelUsage: { 'claude-sonnet-5-5': {} } }
  } }
  await complete(options, request)
  await assert.rejects(complete(options, request), { code: 'subscription_login_required' })
  assert.equal(authReads, 2); assert.equal(catalogueReads, 2); assert.equal(sends, 1)
})

test('a rejected metadata child is joined before returning a failure; it cannot continue after completion', async () => {
  const f = fixture(); let settled = false
  const pending = complete(f.options, request)
  const observed = pending.then(() => assert.fail('failed auth must refuse'), error => {
    settled = true; assert.equal(error.code, 'subscription_login_required')
  })
  f.auth.reject(Error('claude_login_required'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false); assert.equal(f.sends(), 0)
  f.catalogue.reject(Error('catalogue transport failed'))
  await observed
  assert.equal(settled, true); assert.deepEqual(f.events, ['auth', 'catalogue'])
})

test('cancellation reaches both metadata children and no completion is sent', async () => {
  const controller = new AbortController(), signals = []; let sends = 0
  const pending = complete({ signal: controller.signal, onDispatch: () => sends++, run: async (args, opts) => {
    assert.equal(isMetadataOnly(args, opts), true)
    signals.push(opts.signal)
    return new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(Error('worker_cancelled')), { once: true })
    })
  } }, request)
  const observed = assert.rejects(pending, { code: 'subscription_unavailable' })
  assert.deepEqual(signals, [controller.signal, controller.signal])
  controller.abort(); await observed
  assert.equal(sends, 0)
})
