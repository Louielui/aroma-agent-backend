'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { complete } = require('./claudeClient')

test('auth and catalogue metadata cannot claim an actual model dispatch', async () => {
  const calls = []; let dispatches = 0
  const run = async (args, options) => {
    const stage = args.includes('status') ? 'auth' : options.controlRequestId ? 'catalogue' : 'completion'
    options.onDispatch?.(); calls.push({ stage, dispatches })
    if (stage === 'auth') return { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }
    if (stage === 'catalogue') return { models: [{ value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', supportsEffort: true, supportedEffortLevels: ['medium'] }] }
    return { type: 'result', subtype: 'success', result: 'ok', modelUsage: { 'claude-sonnet-5-5': {} } }
  }
  await complete({ run, onDispatch: () => dispatches++ }, { model: 'claude-sonnet', effort: 'medium', prompt: 'offline test' })
  assert.deepEqual(calls, [{ stage: 'auth', dispatches: 0 }, { stage: 'catalogue', dispatches: 0 }, { stage: 'completion', dispatches: 1 }])
})

test('failed or unavailable preflight records zero completion sends', async () => {
  for (const failAt of ['auth', 'catalogue']) {
    let dispatches = 0
    await assert.rejects(complete({ onDispatch: () => dispatches++, run: async (args, options) => {
      options.onDispatch?.()
      if (failAt === 'auth' || !args.includes('status')) throw Error('offline')
      return { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }
    } }, { model: 'claude-sonnet', prompt: 'offline' }))
    assert.equal(dispatches, 0)
  }
})
