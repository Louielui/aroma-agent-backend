'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const cp = require('node:child_process')
const { randomUUID, createHash } = require('node:crypto')
const { createGate } = require('./quiescence')
const { snapshot } = require('./offlineMaintenance')
const password = 'fixture-owner-password'
const boundaries = ['backend', 'bridge', 'native-host', 'scheduled-task', 'supervisor', 'background', 'hindsight', 'independent-entry']
function setup () {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'imagine-adapter-'))
  // The same strict UUID scope is checked inside every separate fixture process.
  const exact = path.join(path.dirname(root), 'imagine-adapter-' + randomUUID())
  fs.renameSync(root, exact)
  fs.mkdirSync(path.join(exact, 'protected'))
  fs.writeFileSync(path.join(exact, 'entry.cjs'), "require('node:fs').writeFileSync(require('node:path').join(__dirname,'protected','initialized'),'startup write')")
  const gate = createGate({ directory: path.join(exact, 'gate'), participants: ['offline-host'],
    ownerPassword: () => password, serviceCredentials: () => ['fixture-service-token'] })
  gate.initialize({ password })
  return { root: exact, gate }
}
function launch (root, boundary) {
  const child = cp.fork(path.join(__dirname, 'optionBAdmission.fixture.cjs'), [root, boundary], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  const queue = [], waiters = []
  let failure
  child.on('message', value => waiters.length ? waiters.shift().resolve(value.result) : queue.push(value.result))
  const fail = error => { failure = error; for (const waiter of waiters.splice(0)) waiter.reject(error) }
  child.on('error', fail)
  child.on('exit', () => fail(Error('fixture_exited')))
  const next = () => new Promise((resolve, reject) => {
    if (queue.length) return resolve(queue.shift())
    if (failure) return reject(failure)
    const timer = setTimeout(() => reject(Error('fixture_deadline')), 10000)
    waiters.push({ resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
  })
  return { child, next, send: value => child.send(value), close: async () => {
    if (child.exitCode !== null) return
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.send('complete'); child.send('exit'); await exited
  } }
}

test('proposed explicit boundaries: one durable prepare closes every new admission before existing writes finish', { timeout: 40000 }, async () => {
  const { root, gate } = setup(), workers = []
  try {
    // Sequential OPEN admission avoids treating a transient gate_busy as success.
    for (const boundary of boundaries) {
      const worker = launch(root, boundary); workers.push(worker)
      assert.equal(await worker.next(), 'ready')
      worker.send('write'); assert.equal(await worker.next(), 'admitted')
    }
    const state = gate.prepare({ password, run: randomUUID(), expectedGeneration: 0 })
    assert.equal(state.leases.length, boundaries.length)
    assert.deepEqual(snapshot(path.join(root, 'protected')), {})
    for (const worker of workers) {
      worker.send('write'); assert.equal(await worker.next(), 'deployment_draining')
    }
    // A new host instance sees the same latch; prepare never cancels prior work.
    for (const boundary of boundaries) {
      const attempt = launch(root, boundary); workers.push(attempt)
      assert.equal(await attempt.next(), 'ready')
      attempt.send('startup'); assert.equal(await attempt.next(), 'deployment_draining')
      await attempt.close()
    }
    for (const worker of workers.slice(0, boundaries.length)) {
      worker.send('complete'); assert.equal(await worker.next(), 'finished'); await worker.close()
    }
    assert.equal(gate.status().leases.length, 0)
    for (const boundary of boundaries) assert.equal(fs.readFileSync(path.join(root, 'protected', boundary), 'utf8'), 'final persistence')
    const baseline = snapshot(path.join(root, 'protected'))
    gate.acknowledge('offline-host', () => {
      assert.ok(workers.every(w => w.child.exitCode === 0), 'observe real fixture process exit, not an idle acknowledgement supplied by caller')
      assert.deepEqual(snapshot(path.join(root, 'protected')), baseline)
      return { idle: true }
    })
    const frozen = gate.freeze({ password, run: state.run, expectedGeneration: state.generation })
    assert.equal(frozen.phase, 'frozen')
    for (const version of ['candidate', 'old-rollback']) {
      const attempt = launch(root, 'supervisor'); workers.push(attempt)
      assert.equal(await attempt.next(), 'ready')
      attempt.send('startup'); assert.equal(await attempt.next(), 'deployment_frozen', version)
      await attempt.close()
    }
    assert.deepEqual(snapshot(path.join(root, 'protected')), baseline)
    assert.throws(() => gate.release({ password: 'fixture-service-token', run: state.run, expectedGeneration: frozen.generation }, () => ({ verified: true })), /unauthorized/)
    // Snapshot verification is only one fixture requirement, not production recovery proof.
    const reopened = gate.release({ password, run: state.run, expectedGeneration: frozen.generation }, () => {
      assert.ok(workers.every(w => w.child.exitCode === 0))
      assert.deepEqual(snapshot(path.join(root, 'protected')), baseline)
      const evidence = { baseline, exitedPids: workers.map(w => w.child.pid), run: state.run, generation: frozen.generation }
      return { verified: true, receiptHash: createHash('sha256').update(JSON.stringify(evidence)).digest('hex') }
    })
    assert.equal(reopened.phase, 'open')
  } finally { for (const worker of workers) await worker.close() }
})

test('unknown independent writer is a real bypass: gate membership alone cannot authorize installation', () => {
  const { root, gate } = setup()
  const state = gate.prepare({ password, run: randomUUID(), expectedGeneration: 0 })
  const baseline = snapshot(path.join(root, 'protected'))
  // No acknowledge/freeze: an uncontained writer prevents the isolation precondition.
  cp.execFileSync(process.execPath, ['-e', "require('node:fs').writeFileSync(process.argv[1],'unexplained')", path.join(root, 'protected', 'unknown')], { windowsHide: true })
  assert.notDeepEqual(snapshot(path.join(root, 'protected')), baseline)
  assert.throws(() => gate.freeze({ password, run: state.run, expectedGeneration: state.generation }), /participants_unconfirmed/)
  assert.equal(gate.status().phase, 'draining')
})
