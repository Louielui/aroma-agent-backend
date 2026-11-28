'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { control } = require('./experimentControl')
const { controlled, publish } = require('./experiment')
const { argumentsOf, verifyDeployment, shutdownState } = require('../../../scripts/repository/phase1Owner.cjs')

const candidate = 'a'.repeat(40), boot = 'b'.repeat(40), tree = 'c'.repeat(40)
const deployment = '00000000-0000-4000-8000-000000000001'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-phase1-control-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, marker: control(root) }
}

test('a marker admits exactly the selected boot SHA and removal restores default-off', t => {
  const { root, marker } = fixture(t)
  assert.equal(marker.current(), null)
  marker.set(null, boot)
  assert.equal(marker.current(), boot)
  assert.deepEqual(fs.readdirSync(root), ['enabled.json'])
  assert.throws(() => marker.set(null, candidate), /phase1_marker_drift/)
  marker.set(boot, null)
  assert.equal(marker.current(), null)
})

test('marker handling rejects malformed state, linked paths and arbitrary replacements', t => {
  const { root, marker } = fixture(t)
  const file = path.join(root, 'enabled.json')
  assert.throws(() => marker.set(null, '..'), /phase1_marker_drift/)
  fs.writeFileSync(file, 'invalid')
  assert.throws(() => marker.set(null, boot), /phase1_marker_invalid/)
  fs.writeFileSync(file, boot + '\n')
  fs.linkSync(file, path.join(root, 'other'))
  assert.throws(() => marker.current(), /phase1_marker_invalid/)
})

test('the closed spool and preferences become available only on the bound boot and close on the same process', t => {
  const { root, marker } = fixture(t)
  const spool = path.join(root, 'spool'), replies = path.join(spool, 'responses')
  const key = 'a'.repeat(64)
  fs.mkdirSync(replies, { recursive: true })
  fs.writeFileSync(path.join(spool, 'key.hex'), key)
  publish(replies, 'ready.json', key, { boot: '1'.repeat(32), at: Date.now(), network: 'ENETUNREACH' })
  const running = controlled(root, boot), different = controlled(root, candidate)
  assert.equal(running.active(), false)
  assert.throws(() => running.ready(), /experiment_disabled/)
  marker.set(null, boot)
  assert.equal(running.ready(), true)
  assert.equal(running.preference.read().selected, 'default')
  assert.equal(different.active(), false)
  marker.set(boot, null)
  assert.throws(() => running.preference.read(), /experiment_disabled/)
})

test('native command accepts only a fixed operation and a completed exact deployment', () => {
  const scope = { candidate, deployment, boot, tree }
  const record = {
    id: deployment, state: 'complete', authorizationId: 'fixture',
    approvalMaterial: { commit: candidate, tree }, committed: { commit: candidate, tree },
    merge: { commit: boot }, runtime: { verified: true, bootCommit: boot }
  }
  assert.deepEqual(argumentsOf(['enable', candidate, deployment]), { operation: 'enable', candidate, deployment })
  assert.throws(() => argumentsOf(['enable', candidate, deployment, '--command']), /invalid_phase1_operation/)
  assert.throws(() => argumentsOf(['execute', candidate, deployment]), /invalid_phase1_operation/)
  assert.doesNotThrow(() => verifyDeployment(record, scope))
  assert.throws(() => verifyDeployment({ ...record, state: 'reviewed_hold' }, scope), /deployment_unconfirmed/)
  assert.throws(() => verifyDeployment(record, { ...scope, tree: 'd'.repeat(40) }), /deployment_unconfirmed/)
})

test('disable and recovery use the marker’s verified deployment even when there is no healthy live boot', () => {
  const record = {
    id: deployment, state: 'complete', authorizationId: 'fixture',
    approvalMaterial: { commit: candidate, tree }, committed: { commit: candidate, tree },
    merge: { commit: boot }, runtime: { verified: true, bootCommit: boot }
  }
  const scope = { candidate, deployment }
  assert.deepEqual(shutdownState(record, { ...scope, operation: 'disable' }, boot), { boot, tree, before: boot })
  assert.deepEqual(shutdownState(record, { ...scope, operation: 'recover' }, null), { boot, tree, before: null })
  assert.throws(() => shutdownState(record, { ...scope, operation: 'recover' }, candidate), /marker_owner_mismatch/)
  assert.throws(() => shutdownState(record, { ...scope, operation: 'disable' }, null), /disable_state/)
})
