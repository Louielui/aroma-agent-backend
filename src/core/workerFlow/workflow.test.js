'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createWorkflow } = require('./workflow')

function setup(t, changes = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiang-worker-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const calls = []
  const providers = {
    status: async () => ({ codex: { ready: true, billing: 'chatgpt-subscription' }, claude: { ready: true, billing: 'claude-subscription' } }),
    code: async ({ emit }) => { calls.push('code'); emit('tests_started', {}); return { model: 'fixture-codex', billing: 'chatgpt-subscription', changedFiles: ['duration.js'], before: 'old', after: 'new', baseline: { exitCode: 1 }, tests: { exitCode: 0, stdout: '5 passed' } } },
    review: async packet => { calls.push('review'); assert.equal(packet.after, 'new'); assert.equal(packet.tests.exitCode, 0); return { model: 'fixture-claude', billing: 'claude-subscription', verdict: 'pass', findings: [], summary: 'Reviewed.' } },
    ...changes
  }
  return { flow: createWorkflow({ dir, providers, enabled: () => true }), calls, dir }
}
test('an approved fixed work order produces durable code, test and review evidence', async t => {
  const { flow, calls, dir } = setup(t)
  assert.throws(() => flow.start({ recipe: 'duration-v1', approved: false }), /approval_required/)
  assert.throws(() => flow.start({ recipe: 'duration-v1', approved: true, command: 'anything' }), /invalid_work_order/)
  const run = flow.start({ recipe: 'duration-v1', approved: true })
  await flow.settled()
  const result = flow.get(run.id)
  assert.equal(result.state, 'completed')
  assert.deepEqual(calls, ['code', 'review'])
  assert.equal(result.coding.tests.exitCode, 0)
  assert.equal(result.review.model, 'fixture-claude')
  assert.ok(result.events.find(e => e.stage === 'tests_started'))
  assert.equal(createWorkflow({ dir, providers: {}, enabled: () => true }).get(run.id).state, 'completed')
})
test('failed tests are retained for review but never become a completed run', async t => {
  const { flow } = setup(t, { code: async () => ({ after: 'new', tests: { exitCode: 1 }, changedFiles: ['duration.js'] }), review: async () => ({ verdict: 'pass', findings: [] }) })
  const run = flow.start({ recipe: 'duration-v1', approved: true }); await flow.settled()
  assert.equal(flow.get(run.id).state, 'needs_attention')
  assert.equal(flow.get(run.id).coding.tests.exitCode, 1)
})
test('missing provider stops before coding, concurrent work is refused, and errors are bounded', async t => {
  const { flow, calls } = setup(t, { status: async () => ({ codex: { ready: true }, claude: { ready: false } }) })
  const run = flow.start({ recipe: 'duration-v1', approved: true })
  assert.throws(() => flow.start({ recipe: 'duration-v1', approved: true }), /worker_busy/)
  await flow.settled(); assert.equal(flow.get(run.id).error, 'provider_not_ready'); assert.deepEqual(calls, [])
})
test('a restart marks unfinished work interrupted and never repeats execution', t => {
  const { flow, dir } = setup(t)
  fs.writeFileSync(path.join(dir, 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.json'), JSON.stringify({ id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', state: 'coding', events: [] }))
  const restarted = createWorkflow({ dir, providers: {}, enabled: () => false })
  assert.equal(restarted.list()[0].state, 'interrupted')
  assert.throws(() => restarted.start({ recipe: 'duration-v1', approved: true }), /not_enabled/)
  assert.equal(flow.get('../anything'), null)
})
test('an explicitly approved review retry reuses measured code and tests without invoking coding again', async t => {
  let reviews = 0
  const { flow, calls } = setup(t, { review: async () => { if (++reviews === 1) throw Error('claude_unavailable'); return { verdict: 'pass', findings: [] } } })
  const run = flow.start({ recipe: 'duration-v1', approved: true }); await flow.settled()
  assert.equal(flow.get(run.id).state, 'failed')
  assert.throws(() => flow.reviewAgain({ id: run.id, approved: false }), /approval_required/)
  flow.reviewAgain({ id: run.id, approved: true }); await flow.settled()
  assert.equal(flow.get(run.id).state, 'completed'); assert.deepEqual(calls, ['code']); assert.equal(reviews, 2)
})
