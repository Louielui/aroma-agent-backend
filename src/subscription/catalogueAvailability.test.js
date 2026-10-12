'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { listModels, checkSubscription } = require('./claudeClient')
const { runClaude } = require('../core/workerFlow/providers')
const authArgs = ['--restricted', '--setting-sources', '', 'auth', 'status', '--json']
test('nonzero auth status identifies logout only for the exact auth command, without retaining account data', async () => {
  const { EventEmitter } = require('node:events'), { PassThrough, Writable } = require('node:stream')
  for (const args of [authArgs, []]) {
    await assert.rejects(runClaude(args, { resolveCommand: () => ({ ok: true, command: 'fixture' }), spawnImpl: () => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {}
      child.stdin = new Writable({ write(c, e, done) { done() }, final(done) { done(); process.nextTick(() => { child.stdout.end(JSON.stringify({ loggedIn: false, email: 'private-account' })); child.emit('close', 1) }) } }); return child
    } }), error => { assert.equal(error.message, args.length ? 'claude_login_required' : 'claude_unavailable'); assert.ok(!JSON.stringify(error).includes('private-account')); return true })
  }
})
test('catalogue distinguishes logout from transport failure and restores the exact model without inference', async () => {
  let calls = 0
  for (const [error, code] of [['claude_login_required', 'subscription_login_required'], ['worker_timeout', 'subscription_unavailable'], ['private failure', 'subscription_unavailable']]) {
    const result = await listModels({ run: async () => { calls++; throw Error(error) } })
    assert.deepEqual(result.providers, { claude: { state: 'unavailable', code } }); assert.ok(result.models.every(m => !m.available))
    assert.ok(!JSON.stringify(result).includes('private failure'))
    await assert.rejects(checkSubscription({ run: async () => { throw Error(error) } }), new RegExp(code))
  }
  const result = await listModels({ run: async args => { calls++; assert.deepEqual(args, authArgs); return { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' } }, catalogue: async () => [{ value: 'opus', resolvedModel: 'claude-opus-5-5', supportsEffort: true, supportedEffortLevels: ['medium'] }] })
  assert.deepEqual(result.providers, { claude: { state: 'ready', code: null } }); assert.equal(result.models[0].model, 'claude-opus-5-5'); assert.equal(calls, 4)
})
test('authenticated bridge preserves only closed Claude availability codes and never provider error details', async t => {
  const { createBridge } = require('./bridge'), token = 'a'.repeat(64)
  let code = 'subscription_login_required'
  const server = createBridge({ token, modelsFn: async () => ({ models: [] }), claudeModelsFn: async () => ({ models: [{ model: 'claude-sonnet', available: false, efforts: [] }], providers: { claude: { state: 'unavailable', code, account: 'private' } } }) })
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  for (const value of ['subscription_login_required', 'private']) {
    code = value
    const r = await fetch('http://127.0.0.1:' + server.address().port + '/models', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: '{}' })
    assert.equal(r.status, 200); const result = await r.json()
    assert.deepEqual(result.providers.claude, { state: 'unavailable', code: value === 'private' ? 'subscription_unavailable' : value }); assert.ok(!JSON.stringify(result).includes('private'))
  }
})
