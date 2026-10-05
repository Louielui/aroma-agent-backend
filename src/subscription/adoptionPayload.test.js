'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createBridge } = require('./bridge')

test('large adoption receipts remain observable without transporting sealed source copies', async t => {
  const token = 'e'.repeat(64), head = 'a'.repeat(40), calls = []
  const row = {
    id: 'adoption-fixture', workRunId: 'work-fixture', action: 'adopt', state: 'completed', commit: head,
    source: { evidence: { revision: head, bootCommit: head }, hash: 'b'.repeat(64), order: { files: { protected: 'source'.repeat(140000) } } },
    accepted: { before: 'duplicate-before'.repeat(30000), after: 'duplicate-after'.repeat(30000), dependencies: { protected: 'source'.repeat(140000) }, patchHash: 'c'.repeat(64), evidenceHash: 'd'.repeat(64), baseline: { passed: 5, failed: 4 } },
    before: { 'sidebar.js': 'original' }, after: { 'sidebar.js': 'repair' },
    tests: { total: 9, passed: 9, failed: 0, browser: [{ name: 'browser-en-390.png', screenshotHash: 'f'.repeat(64) }] },
    steps: [{ stage: 'completed' }], loaded: { bootCommit: head }, appliedToLive: true
  }
  const original = JSON.stringify(row), approval = { id: 'approval-fixture', hash: '1'.repeat(64), nonce: '2'.repeat(48) }
  assert.ok(JSON.stringify({ runs: [row, row, row, row] }).length > 2000000)
  const adoption = {
    isActive: () => false, refresh: async () => {}, enabled: () => true, list: () => [row, row, row, row],
    prepare: (actor, input) => { calls.push({ actor, input }); return { run: row, approval } },
    approve: (actor, input) => { calls.push({ actor, input }); return row },
    cancel: () => row, reload: async () => row
  }
  const server = createBridge({ token, projectAdoption: adoption })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const send = body => fetch('http://127.0.0.1:' + server.address().port + '/project-adoption', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const response = await send({ op: 'list' }), bytes = await response.text()
  assert.equal(response.status, 200)
  assert.ok(bytes.length < 2000000, 'the unchanged local transport limit must contain the visible history')
  const value = JSON.parse(bytes)
  assert.equal(value.runs.length, 4)
  function inspect (visible) {
    assert.deepEqual(visible.before, row.before); assert.deepEqual(visible.after, row.after)
    assert.deepEqual(visible.tests, row.tests); assert.deepEqual(visible.steps, row.steps)
    assert.deepEqual(visible.loaded, row.loaded); assert.equal(visible.appliedToLive, true)
    assert.deepEqual(visible.source.evidence, row.source.evidence)
    assert.equal(visible.source.hash, row.source.hash)
    assert.equal(visible.source.order, undefined)
    assert.deepEqual(visible.accepted, { patchHash: row.accepted.patchHash, evidenceHash: row.accepted.evidenceHash, baseline: row.accepted.baseline })
  }
  for (const visible of value.runs) inspect(visible)
  const input = { action: 'adopt', runId: 'work-fixture', requestId: 'request-fixture', bootCommit: head }
  const prepared = await (await send({ op: 'prepare', ...input })).json()
  inspect(prepared.run); assert.deepEqual(prepared.approval, approval)
  inspect((await (await send({ op: 'approve', ...approval })).json()).run)
  inspect((await (await send({ op: 'cancel', id: row.id })).json()).run)
  inspect((await (await send({ op: 'reload', id: row.id })).json()).run)
  assert.deepEqual(calls, [{ actor: { id: 'owner', role: 'owner' }, input }, { actor: { id: 'owner', role: 'owner' }, input: approval }])
  assert.equal(JSON.stringify(row), original, 'the canonical receipt used for source checks and approval must remain intact')
})
