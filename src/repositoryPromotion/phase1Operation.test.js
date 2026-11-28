'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createPhase1Operation } = require('./phase1Operation')

const candidate = 'a'.repeat(40)
const deployment = '00000000-0000-4000-8000-000000000001'

function fixture() {
  let time = 1000000
  let checked = { boot: candidate, marker: null }
  const rows = []
  const calls = []
  const service = createPhase1Operation({
    store: { save: row => rows.push(structuredClone(row)) },
    inspect: async () => checked,
    apply: async (scope, _state, guard) => {
      guard()
      calls.push(scope)
      return { complete: true }
    },
    now: () => time
  })
  const make = operation => service.prepare({ operation, candidate, deployment })
  return { make, rows, calls, advance: amount => { time += amount }, update: state => { checked = state } }
}

test('each fixed operation requires a separate fingerprint-bound native answer and records a claim before effects', async () => {
  const f = fixture()
  for (const operation of ['enable', 'disable', 'recover']) {
    const p = await f.make(operation)
    assert.equal(p.material.expiresAt, 1600000)
    await p.confirm(p.challenge)
    await assert.rejects(p.confirm(p.challenge), /phase1_approval_unavailable/)
  }
  assert.deepEqual(f.calls.map(call => call.operation), ['enable', 'disable', 'recover'])
  assert.deepEqual(f.rows.map(row => row.state), ['claimed', 'complete', 'claimed', 'complete', 'claimed', 'complete'])
  assert.equal(new Set(f.rows.map(row => row.fingerprint)).size, 3)
})

test('fails closed for changed state, an expired prompt, wrong confirmation and unsupported operations', async () => {
  const f = fixture()
  const stale = await f.make('enable')
  f.update({ boot: 'b'.repeat(40), marker: null })
  await assert.rejects(stale.confirm(stale.challenge), /phase1_material_changed/)
  const wrong = await f.make('enable')
  await assert.rejects(wrong.confirm(wrong.challenge + ' '), /phase1_approval_unavailable/)
  await assert.rejects(wrong.confirm(wrong.challenge), /phase1_approval_unavailable/)
  const expired = await f.make('disable')
  f.advance(600000)
  await assert.rejects(expired.confirm(expired.challenge), /phase1_approval/)
  await assert.rejects(f.make('run-command'), /invalid_phase1_operation/)
  assert.deepEqual(f.rows, [])
  assert.deepEqual(f.calls, [])
})
