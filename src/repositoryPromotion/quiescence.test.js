'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

function fixture (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiescence-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const { createGate } = require('./quiescence')
  const gate = createGate({ directory: dir, participants: ['backend', 'bridge'], ownerPassword: () => 'fixture-owner-password' })
  const credentials = { password: 'fixture-owner-password' }
  gate.initialize(credentials)
  return { gate, dir, credentials, run: randomUUID() }
}

test('draining blocks new admissions and preserves admitted work until it finishes', t => {
  const { gate, credentials, run } = fixture(t)
  const lease = gate.admit('backend')
  gate.prepare({ ...credentials, run, expectedGeneration: 0 })
  assert.throws(() => gate.admit('bridge'), /deployment_draining/)
  assert.throws(() => gate.freeze({ ...credentials, run, expectedGeneration: 1 }), /writers_not_drained/)
  lease.write(() => {})
  lease.finish()
  assert.equal(gate.status().leases.length, 0)
})

test('freeze requires all independently checked participants and pending consent prevents acknowledgement', t => {
  const { gate, credentials, run } = fixture(t)
  gate.prepare({ ...credentials, run, expectedGeneration: 0 })
  assert.throws(() => gate.acknowledge('backend', () => ({ idle: false, reason: 'awaiting_consent' })), /participant_not_idle/)
  gate.acknowledge('backend', () => ({ idle: true }))
  assert.throws(() => gate.freeze({ ...credentials, run, expectedGeneration: 1 }), /participants_unconfirmed/)
  gate.acknowledge('bridge', () => ({ idle: true }))
  assert.equal(gate.freeze({ ...credentials, run, expectedGeneration: 1 }).phase, 'frozen')
  assert.throws(() => gate.admit('backend'), /deployment_frozen/)
})

function frozen (f) {
  f.gate.prepare({ ...f.credentials, run: f.run, expectedGeneration: 0 })
  f.gate.acknowledge('backend', () => ({ idle: true }))
  f.gate.acknowledge('bridge', () => ({ idle: true }))
  return f.gate.freeze({ ...f.credentials, run: f.run, expectedGeneration: 1 })
}

test('failed deployment and rollback cannot reopen or initialize over the persisted freeze', async t => {
  const f = fixture(t); frozen(f)
  const otherVersion = require('./quiescence').createGate({ directory: f.dir, participants: ['bridge', 'backend'], ownerPassword: () => 'fixture-owner-password' })
  assert.equal(otherVersion.initialize(f.credentials).phase, 'frozen')
  let imported = 0
  for (const participant of ['backend', 'bridge']) {
    await assert.rejects(otherVersion.start(participant, () => { imported++; fs.writeFileSync(path.join(f.dir, 'task.json'), 'mutated') }), /deployment_frozen/)
  }
  assert.equal(imported, 0)
  assert.equal(fs.existsSync(path.join(f.dir, 'task.json')), false)
  assert.equal(f.gate.status().phase, 'frozen')
})

test('Native token, Owner browser session, missing or wrong password cannot change deployment state', t => {
  const f = fixture(t)
  for (const credentials of [{}, { token: 'native-host-service-token' }, { authorization: 'Bearer service-token' }, { cookie: 'aroma_owner_session=fixture' }, { password: 'wrong' }]) {
    assert.throws(() => f.gate.prepare({ ...credentials, run: f.run, expectedGeneration: 0 }), /deployment_control_unauthorized/)
  }
  frozen(f)
  for (const credentials of [{}, { password: 'wrong' }, { authorization: 'Bearer fixture-owner-password' }]) {
    assert.throws(() => f.gate.release({ ...credentials, run: f.run, expectedGeneration: 2 }, () => ({ verified: true, receiptHash: 'a'.repeat(64) })), /deployment_control_unauthorized/)
  }
  assert.equal(f.gate.status().phase, 'frozen')
})

test('release requires exact deployment generation and independent successful recovery evidence', t => {
  const f = fixture(t); frozen(f)
  const request = { ...f.credentials, run: f.run, expectedGeneration: 2 }
  for (const evidence of [null, {}, { verified: false }, { verified: true }, { verified: true, receiptHash: 'not-a-hash' }, Promise.resolve({ verified: true, receiptHash: 'a'.repeat(64) })]) {
    assert.throws(() => f.gate.release(request, () => evidence), /recovery_unverified/)
    assert.equal(f.gate.status().phase, 'frozen')
  }
  assert.throws(() => f.gate.release({ ...request, run: randomUUID() }, () => { throw Error('must not run') }), /gate_identity_changed/)
  assert.throws(() => f.gate.release({ ...request, expectedGeneration: 1 }, () => { throw Error('must not run') }), /gate_identity_changed/)
  const s = f.gate.release(request, () => ({ verified: true, receiptHash: 'a'.repeat(64) }))
  assert.equal(s.phase, 'open'); assert.equal(s.generation, 3)
  assert.equal(s.events.at(-1).name, 'released')
  assert.equal(s.events.at(-1).receiptHash, 'a'.repeat(64))
  f.gate.admit('backend').finish()
})

test('late completion invalidates earlier idle acknowledgements and stale leases cannot write', t => {
  const f = fixture(t), lease = f.gate.admit('backend')
  f.gate.prepare({ ...f.credentials, run: f.run, expectedGeneration: 0 })
  assert.throws(() => f.gate.acknowledge('bridge', () => ({ idle: true })), /writers_not_drained/)
  const file = path.join(f.dir, 'result.json')
  lease.write(() => fs.writeFileSync(file, 'completed-before-freeze'))
  lease.finish(); lease.finish()
  f.gate.acknowledge('backend', () => ({ idle: true }))
  f.gate.acknowledge('bridge', () => ({ idle: true }))
  f.gate.freeze({ ...f.credentials, run: f.run, expectedGeneration: 1 })
  assert.throws(() => lease.write(() => fs.writeFileSync(file, 'late')), /writer_not_admitted/)
  assert.equal(fs.readFileSync(file, 'utf8'), 'completed-before-freeze')
})

test('processing work drains without cancellation and prevents freeze until its final write', async t => {
  const f = fixture(t)
  let complete
  const result = f.gate.run('backend', async lease => {
    await new Promise(resolve => { complete = resolve })
    lease.write(() => fs.writeFileSync(path.join(f.dir, 'result'), 'done'))
    return 'done'
  })
  f.gate.prepare({ ...f.credentials, run: f.run, expectedGeneration: 0 })
  assert.throws(() => f.gate.freeze({ ...f.credentials, run: f.run, expectedGeneration: 1 }), /writers_not_drained/)
  complete(); assert.equal(await result, 'done')
  assert.equal(fs.readFileSync(path.join(f.dir, 'result'), 'utf8'), 'done')
  assert.equal(f.gate.status().leases.length, 0)
})

test('unexpected corruption, participant changes and stale lock fail closed without rewriting evidence', t => {
  const f = fixture(t), file = path.join(f.dir, 'gate.json')
  const original = fs.readFileSync(file)
  fs.writeFileSync(path.join(f.dir, 'gate.lock'), 'crashed writer')
  assert.throws(() => f.gate.status(), /gate_busy/)
  assert.throws(() => f.gate.admit('backend'), /gate_busy/)
  assert.deepEqual(fs.readFileSync(file), original)
  fs.unlinkSync(path.join(f.dir, 'gate.lock'))
  fs.writeFileSync(file, '{broken')
  assert.throws(() => f.gate.status(), /gate_integrity_unconfirmed/)
  assert.throws(() => f.gate.initialize(f.credentials), /gate_integrity_unconfirmed/)
  fs.writeFileSync(file, original)
  const other = require('./quiescence').createGate({ directory: f.dir, participants: ['backend'], ownerPassword: () => 'fixture-owner-password' })
  assert.throws(() => other.status(), /gate_integrity_unconfirmed/)
  assert.throws(() => f.gate.admit('unknown'), /unknown_gate_participant/)
})

test('unknown and asynchronous idle observations cannot become proof', t => {
  const f = fixture(t)
  f.gate.prepare({ ...f.credentials, run: f.run, expectedGeneration: 0 })
  for (const value of [null, {}, { idle: false }, Promise.resolve({ idle: true })]) {
    assert.throws(() => f.gate.acknowledge('backend', () => value), /participant_not_idle/)
  }
  assert.equal(f.gate.status().acknowledged.length, 0)
})

test('concurrent cross-process prepare requests have exactly one winner', async t => {
  const f = fixture(t)
  const { spawn } = require('node:child_process')
  const script = `const g=require(${JSON.stringify(require.resolve('./quiescence'))}).createGate({directory:process.argv[1],participants:['backend','bridge'],ownerPassword:()=> 'fixture-owner-password'});try{g.prepare({password:'fixture-owner-password',run:process.argv[2],expectedGeneration:0});process.stdout.write('winner')}catch(e){process.stdout.write(e.message)}`
  const results = await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, f.dir, randomUUID()], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; let errors = ''
    child.stdout.on('data', d => { output += d }); child.stderr.on('data', d => { errors += d })
    child.once('error', reject); child.once('close', code => code === 0 ? resolve(output) : reject(Error(errors)))
  })))
  assert.equal(results.filter(r => r === 'winner').length, 1)
  assert.ok(results.every(r => ['winner', 'gate_busy', 'gate_identity_changed'].includes(r)))
  assert.equal(f.gate.status().generation, 1)
})

test('failed operations still release their admission, without fabricating completion', async t => {
  const f = fixture(t)
  await assert.rejects(f.gate.run('bridge', async () => { throw Error('fixture-failure') }), /fixture-failure/)
  assert.equal(f.gate.status().leases.length, 0)
  assert.ok(!JSON.stringify(f.gate.status()).includes('fixture-owner-password'))
})

test('unwrapped filesystem writes remain a proven integration blocker, never a claimed enforcement success', t => {
  const f = fixture(t); frozen(f)
  // Deliberately demonstrate the boundary of this protocol. Existing stores do
  // not consult it. A release must not call this a complete persistence fence.
  const file = path.join(f.dir, 'unwrapped-task.json')
  fs.writeFileSync(file, 'bypass')
  assert.equal(fs.readFileSync(file, 'utf8'), 'bypass')
  assert.equal(f.gate.status().phase, 'frozen')
})
