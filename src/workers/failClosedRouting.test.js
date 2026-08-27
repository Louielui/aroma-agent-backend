'use strict'

/**
 * failClosedRouting.test.js — AN UNROUTABLE CAPABILITY MUST NOT BECOME THE ARCHITECT'S WORK.
 *
 * ── THE DEFECT (OpenClaw Step A) ─────────────────────────────────────────────
 * `workerForCapability` ended with:
 *
 *     return WORKERS.find(w => w.capabilities.includes(c)) || WORKERS.find(w => w.id === 'architect')
 *
 * Every capability no employee declares — `openclaw_review`, a typo, a capability invented by
 * a future worker that is not connected yet — resolved to the Architect. The Architect is the
 * ONLY worker with `connected: true`, so the dispatcher gave that dispatch status `queued`
 * and `executeDispatch` would run it on a real model.
 *
 * ── WHY THAT IS ESCALATION, NOT A DEFAULT ────────────────────────────────────
 * A routing default sends unclaimed work to a worker that DECLARED it could do the work.
 * This sent unclaimed work to the one worker that could ACT on it. The failure is silent and
 * it is upward: the system answers a question nobody is qualified to answer, in the voice of
 * the highest authority it has, and nothing in the record says the capability was unmatched.
 * Before OpenClaw is connected, every OpenClaw capability takes exactly this path.
 *
 * ── THE LEGITIMATE PATH IS NOT TOUCHED ───────────────────────────────────────
 * `'ops'` IS one of the Architect's declared capabilities, and `enrichTasks` in
 * intakeService.js already defaults an absent capability to `'ops'` UPSTREAM. So ordinary
 * unclassified work still reaches the Architect, by declaration and not by fallback. What is
 * removed is the registry's own second `(cap || 'ops')` default, which turned an absent
 * capability at the REGISTRY boundary into Architect work without passing through enrichTasks.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-failclosed-test-'))

const test = require('node:test')
const assert = require('node:assert')

const { workerForCapability, getWorker } = require('../workers/registry')

// A capability no employee in the table declares. This is the OpenClaw case, today.
const UNMATCHED = 'openclaw_review'

test('A. an unmatched capability resolves to NO worker, never to the Architect', () => {
  const w = workerForCapability(UNMATCHED)
  assert.strictEqual(w, null, 'an unmatched capability must resolve to null, not to a worker')
})

test('A2. the Architect is the only connected worker, which is why the fallback was escalation', () => {
  const architect = getWorker('architect')
  assert.strictEqual(architect.connected, true)
  assert.strictEqual(architect.engine, 'llm')
  // Both conditions together are what executeDispatch requires in order to spend a real call.
})

test('B. the dispatcher must not produce an executable Architect dispatch for unmatched work', () => {
  const { createDispatchesForTasks } = require('../dispatch/dispatcher')
  const task = { id: 'task-unmatched-1', capability: UNMATCHED }
  const [out] = createDispatchesForTasks([task], 'decision-failclosed-1')

  assert.notStrictEqual(out.dispatch.worker_id, 'architect',
    'unmatched work must never be assigned to the Architect')
  assert.notStrictEqual(out.dispatch.status, 'queued',
    'unmatched work must never be queued for execution')
  assert.strictEqual(out.dispatch.status, 'failed',
    'the honest representation of "no employee can do this" is failed, from the existing vocabulary')
})

test('B2. the refusal records WHY, and is observable in the event stream', () => {
  const { createDispatchesForTasks } = require('../dispatch/dispatcher')
  const store = require('../store/store')
  const [out] = createDispatchesForTasks([{ id: 'task-unmatched-2', capability: UNMATCHED }], 'decision-failclosed-2')

  assert.match(out.dispatch.error, /no_employee_declares_capability/,
    'a failed dispatch with no reason repeats the original harm: the record not saying why')
  assert.match(out.dispatch.error, new RegExp(UNMATCHED), 'the unmatched capability must be named')

  const failedEvent = store.listEvents().find(e => e.type === 'dispatch.failed' && e.entity_id === out.dispatch.id)
  assert.ok(failedEvent, 'a refusal nobody can observe is not a refusal')
})

test('B3. the returned worker is safe to read, because callers read worker.connected unguarded', () => {
  const { createDispatchesForTasks } = require('../dispatch/dispatcher')
  const [out] = createDispatchesForTasks([{ id: 'task-unmatched-3', capability: UNMATCHED }], 'decision-failclosed-3')
  // This is exactly the expression intakeService.js runs on every dispatch it creates.
  assert.doesNotThrow(() => { const _ = out.worker.connected && out.worker.engine === 'llm' })
  assert.strictEqual(out.worker.connected, false)
  assert.strictEqual(out.worker.id, null)
})

test('C. an unmatched dispatch is never executed, even if something tries', async () => {
  const { createDispatchesForTasks, executeDispatch } = require('../dispatch/dispatcher')
  const [out] = createDispatchesForTasks([{ id: 'task-unmatched-4', capability: UNMATCHED }], 'decision-failclosed-4')

  let adapterCalled = false
  const adapter = { complete: async () => { adapterCalled = true; return { text: 'should never happen' } } }
  await executeDispatch(out.dispatch.id, adapter, { decisionStatement: 'x' })

  assert.strictEqual(adapterCalled, false, 'no model call may be spent on work no employee is qualified for')
})

test('D. LEGITIMATE routing is unchanged — this fix must not orphan real work', () => {
  assert.strictEqual(workerForCapability('ops').id, 'architect',
    "'ops' is a DECLARED Architect capability; unclassified work still reaches the Architect")
  assert.strictEqual(workerForCapability('architecture').id, 'architect')
  assert.strictEqual(workerForCapability('coding').id, 'engineer')
  assert.strictEqual(workerForCapability('browser').id, 'automation')
  assert.strictEqual(workerForCapability('OPS').id, 'architect', 'matching stays case-insensitive')
})

test('D2. a matched-but-unconnected worker still waits — it is not failed', () => {
  const { createDispatchesForTasks } = require('../dispatch/dispatcher')
  const [out] = createDispatchesForTasks([{ id: 'task-coding-1', capability: 'coding' }], 'decision-failclosed-5')
  assert.strictEqual(out.dispatch.worker_id, 'engineer')
  assert.strictEqual(out.dispatch.status, 'waiting_connection',
    'a real employee who is merely not connected is genuinely waiting; that is a different fact from unroutable')
})

test('D3. an ABSENT capability no longer becomes Architect work at the registry boundary', () => {
  // enrichTasks in intakeService.js defaults this to 'ops' UPSTREAM (see test D). The registry
  // must not silently repeat that default, or an absent capability bypasses that decision point.
  assert.strictEqual(workerForCapability(undefined), null)
  assert.strictEqual(workerForCapability(null), null)
  assert.strictEqual(workerForCapability(''), null)
  assert.strictEqual(workerForCapability('   '), null)
})

test('E. MUTATION GUARD — no unmatched capability may EVER reach a connected worker', () => {
  // Restoring `|| WORKERS.find(w => w.id === 'architect')`, or reinstating `(cap || 'ops')`,
  // fails here. This is the property the whole tranche exists to hold.
  const UNMATCHED_CAPABILITIES = [
    'openclaw_review', 'openclaw_browse', 'openclaw_execute', // the workers not connected yet
    'quantum_analysis', 'typo_capabilty', 'ADMIN', 'deploy_prod', '', null, undefined
  ]
  for (const cap of UNMATCHED_CAPABILITIES) {
    const w = workerForCapability(cap)
    if (w === null) continue
    assert.strictEqual(w.connected, false,
      'capability ' + JSON.stringify(cap) + ' resolved to a CONNECTED worker (' + w.id + ') — that is authority escalation')
  }
})
