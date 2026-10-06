'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createModelCenter } = require('./service')
const catalogue = { models: [
  { model: 'claude-sonnet', name: 'Claude Sonnet 5.5', available: true, efforts: ['low', 'medium', 'high'] },
  { model: 'claude-opus-5-5', name: 'Claude Opus 5.5', available: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { model: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', available: true, efforts: ['low', 'medium', 'high'] },
  { model: 'claude-haiku-4-5-20251001', available: true, supportsEffort: false, efforts: [] }
] }
function fixture (t) { const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-center-')); t.after(() => fs.rmSync(dataDir, { recursive: true, force: true })); return { dataDir, catalogue: async () => catalogue, topicForConversation: id => id === 'email-conversation' ? 'email' : null } }
test('central defaults, topic overrides and conversation overrides survive reload independently', async t => {
  const opts = fixture(t), center = createModelCenter(opts)
  assert.deepEqual(center.selection('topic', 'email').effective, { model: 'claude-sonnet', effort: 'medium' })
  await center.saveBrain({ revision: 0, model: 'claude-opus-5-5', effort: 'medium' })
  await center.saveSelection('topic', 'email', { revision: 0, mode: 'custom', model: 'claude-sonnet', effort: 'low' })
  await center.saveSelection('conversation', 'other-conversation', { revision: 0, mode: 'custom', model: 'gpt-6.1-sol', effort: 'high' })
  const loaded = createModelCenter(opts)
  assert.deepEqual(loaded.selection('topic', 'development').effective, { model: 'claude-opus-5-5', effort: 'medium' })
  assert.equal(loaded.resolveConversation('email-conversation').model, 'claude-sonnet')
  assert.equal(loaded.resolveConversation('other-conversation').model, 'gpt-6.1-sol')
})
test('follow-central changes on the next resolution; captured running selection remains frozen', async t => {
  const center = createModelCenter(fixture(t)), running = center.resolveConversation('new-conversation')
  await center.saveBrain({ revision: 0, model: 'claude-opus-5-5', effort: 'high' })
  assert.equal(running.model, 'claude-sonnet'); assert.equal(Object.isFrozen(running), true)
  assert.equal(center.resolveConversation('new-conversation').model, 'claude-opus-5-5')
  await center.saveSelection('topic', 'email', { revision: 0, mode: 'custom', model: 'claude-sonnet', effort: 'low' })
  await center.saveBrain({ revision: 1, model: 'gpt-6.1-sol', effort: 'medium' })
  assert.equal(center.selection('topic', 'email').effective.effort, 'low')
  await center.saveSelection('topic', 'email', { revision: 1, mode: 'central' })
  assert.equal(center.selection('topic', 'email').effective.model, 'gpt-6.1-sol')
})
test('stale concurrent settings refuse without losing another scope', async t => {
  const center = createModelCenter(fixture(t))
  await center.saveBrain({ revision: 0, model: 'claude-opus-5-5', effort: 'medium' })
  await assert.rejects(center.saveBrain({ revision: 0, model: 'gpt-6.1-sol', effort: 'medium' }), /revision_conflict/)
  await center.saveSelection('topic', 'email', { revision: 0, mode: 'custom', model: 'claude-sonnet', effort: 'low' })
  await center.saveSelection('topic', 'development', { revision: 0, mode: 'custom', model: 'gpt-6.1-sol', effort: 'high' })
  assert.equal(center.selection('topic', 'email').effective.model, 'claude-sonnet')
  assert.equal(center.read().brain.model, 'claude-opus-5-5')
})
test('unknown models, unsupported effort, unconnected roles, and malformed scope are refused', async t => {
  const center = createModelCenter(fixture(t))
  for (const input of [ { revision: 0, model: 'made-up', effort: 'medium' }, { revision: 0, model: 'claude-sonnet', effort: 'max' }, { revision: 0, model: 'claude-opus-5-5', effort: 'medium', allowCredits: true } ]) await assert.rejects(center.saveBrain(input))
  await assert.rejects(center.saveSelection('topic', 'not-a-topic', { revision: 0, mode: 'central' }))
  await center.saveBrain({ revision: 0, model: 'claude-haiku-4-5-20251001', effort: 'auto' })
  assert.equal(center.read().brain.effort, 'auto')
})
test('corrupt store fails visibly and is never reset; history remains untouched', async t => {
  const opts = fixture(t), file = path.join(opts.dataDir, 'model-center.json'), history = path.join(opts.dataDir, 'conversations.json')
  fs.writeFileSync(file, '{broken'); fs.writeFileSync(history, 'original history')
  const center = createModelCenter(opts)
  assert.throws(() => center.read(), /model_settings_unavailable/)
  await assert.rejects(center.saveBrain({ revision: 0, model: 'claude-opus-5-5', effort: 'medium' }))
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken'); assert.equal(fs.readFileSync(history, 'utf8'), 'original history')
})
test('catalogue read failure cannot save, charge or substitute a model', async t => {
  const center = createModelCenter({ ...fixture(t), catalogue: async () => { throw Error('account_unavailable') } })
  await assert.rejects(center.saveBrain({ revision: 0, model: 'claude-opus-5-5', effort: 'medium' }))
  assert.equal(center.read().revision, 0)
})
