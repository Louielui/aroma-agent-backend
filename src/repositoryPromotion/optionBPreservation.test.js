'use strict'
// Executable contract experiments only. No production adapter imports this file.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { createGate } = require('./quiescence')
const { snapshot } = require('./offlineMaintenance')
const { createRegistry } = require('../company/access')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
// Reuse the existing pure external verifier; never initialize a live registry.
const verifierPath = path.join(os.homedir(), '.imagine/gmail-reply-e1-packaging-repair-20261015/controlled-promotion-a8f05ce/preservation-option-a-v1/verify.cjs')
assert.equal(digest(fs.readFileSync(verifierPath)), '8154cd60f7a4d3e39cbbd12445aee4b1d2b247d0cea27c4ad71c306b767fe268')
const retention = require(verifierPath)
const password = 'fixture-owner-password'

function fixture () {
  const root = path.join(fs.realpathSync(os.tmpdir()), 'imagine-preservation-' + randomUUID())
  fs.mkdirSync(root)
  const protectedRoot = path.join(root, 'protected'), archive = path.join(root, 'sealed')
  fs.mkdirSync(protectedRoot)
  const auth = path.join(protectedRoot, 'company-access.json'), logical = path.join(root, 'logical.json')
  const start = Date.parse('2026-01-01T00:00:00Z')
  const initial = { version: 1, revision: 500, tenantDomain: 'fixture.invalid', adminMailboxRegistered: true,
    users: [{ id: 'owner', role: 'owner', grants: ['admin-mail'], sub: 'fixture-subject', suspended: false }],
    principals: [{ id: 'fixture-principal', binding: 'fixture-subject' }],
    sources: [{ id: 'admin-mail', kind: 'mail', state: 'connected', mailbox: 'synthetic@fixture.invalid', checkedAt: new Date(start + 499000).toISOString() }],
    audit: Array.from({ length: 500 }, (_, i) => ({ id: randomUUID(), revision: i + 1, at: new Date(start + i * 1000).toISOString(), actor: 'owner', action: 'mail_connected', target: 'admin-mail' })) }
  fs.writeFileSync(auth, JSON.stringify(initial, null, 2))
  for (let i = 0; i < 548; i++) fs.writeFileSync(path.join(protectedRoot, 'protected-' + String(i).padStart(3, '0')), 'synthetic protected bytes ' + i)
  fs.writeFileSync(logical, JSON.stringify({ schema: 1, banks: [{ id: 'synthetic', memory: 'synthetic', vectors: [0, 1] }], principals: [{ id: 'synthetic-owner' }], authorization: [{ grant: 'synthetic-only' }], audit: [{ event: 'synthetic' }], operations: [] }))
  let tick = start + 500000
  const registry = createRegistry({ file: auth, clock: () => new Date(tick += 1000).toISOString() })
  const gate = createGate({ directory: path.join(root, 'gate'), participants: ['offline-host'], ownerPassword: () => password, serviceCredentials: () => ['fixture-service-token'] })
  gate.initialize({ password })
  const failure = path.join(root, 'maintenance-failure.json')
  let sealed, pin
  const readAuth = () => retention.parseStrict(fs.readFileSync(auth))
  function isolate () {
    const draining = gate.prepare({ password, run: randomUUID(), expectedGeneration: 0 })
    // This fixture has one known synchronous in-process writer and no external
    // service/child/DB. Real Windows Job/PG isolation is covered separately.
    gate.acknowledge('offline-host', () => {
      assert.equal(gateParticipantLeases(draining), 0)
      return { idle: true }
    })
    return gate.freeze({ password, run: draining.run, expectedGeneration: draining.generation })
  }
  function gateParticipantLeases (state) { return state.leases.length }
  function capture () {
    const state = gate.status()
    if (state.phase !== 'frozen' || state.leases.length) throw Error('isolation_required')
    const hashes = snapshot(protectedRoot)
    assert.equal(Object.keys(hashes).length, 549)
    fs.mkdirSync(archive)
    for (const name of Object.keys(hashes)) fs.copyFileSync(path.join(protectedRoot, name), path.join(archive, name), fs.constants.COPYFILE_EXCL)
    fs.copyFileSync(logical, path.join(root, 'sealed-logical.json'), fs.constants.COPYFILE_EXCL)
    assert.deepEqual(snapshot(archive), hashes, 'independent archive read-back proves complete snapshot bytes')
    assert.deepEqual(snapshot(protectedRoot), hashes, 'second independent source pass under maintained fixture isolation')
    const manifest = { schema: 'fixture-isolated-snapshot-v1', run: state.run, generation: state.generation,
      files: hashes, authorizationSha256: digest(fs.readFileSync(auth)), logicalSha256: digest(fs.readFileSync(logical)) }
    sealed = path.join(root, 'sealed-manifest.json')
    fs.writeFileSync(sealed, JSON.stringify(manifest), { flag: 'wx' })
    pin = digest(fs.readFileSync(sealed))
    return manifest
  }
  function verify () {
    if (fs.existsSync(failure)) throw Error('attempt_previously_failed')
    try {
      const state = gate.status()
      assert.equal(state.phase, 'frozen')
      assert.equal(digest(fs.readFileSync(sealed)), pin)
      const manifest = JSON.parse(fs.readFileSync(sealed))
      assert.equal(state.run, manifest.run); assert.equal(state.generation, manifest.generation)
      assert.deepEqual(snapshot(archive), manifest.files)
      assert.deepEqual(snapshot(protectedRoot), manifest.files)
      assert.equal(digest(fs.readFileSync(logical)), manifest.logicalSha256)
      assert.equal(digest(fs.readFileSync(path.join(root, 'sealed-logical.json'))), manifest.logicalSha256)
      retention.parseStrict(fs.readFileSync(path.join(archive, 'company-access.json')))
      assert.equal(digest(fs.readFileSync(auth)), manifest.authorizationSha256)
      return { verified: true, receiptHash: pin }
    } catch (_) {
      fs.writeFileSync(failure, JSON.stringify({ reason: 'fixture_preservation_failed', run: gate.status().run }), { flag: 'wx' })
      throw Error('isolated_preservation_failed')
    }
  }
  function release (secret = password) {
    // Verify before the locked Gate callback; gate.status cannot reenter its lock.
    // This is a single-process fixture, not the production host journal binding.
    const state = gate.status(), proof = verify()
    return gate.release({ password: secret, run: state.run, expectedGeneration: state.generation }, () => proof)
  }
  return { root, protectedRoot, archive, auth, logical, registry, gate, readAuth, isolate, capture, verify, release, failure }
}

test('known admitted bookkeeping may finish before isolation; complete snapshots then permit unchanged release', () => {
  const f = fixture(), before = fs.readFileSync(f.auth)
  assert.throws(() => f.capture(), /isolation_required/)
  const lease = f.gate.admit('offline-host')
  const draining = f.gate.prepare({ password, run: randomUUID(), expectedGeneration: 0 })
  assert.throws(() => f.capture(), /isolation_required/)
  f.registry.recordMailState('connected')
  lease.finish()
  const preIsolation = fs.readFileSync(f.auth), explained = retention.verify(before, preIsolation)
  assert.equal(explained.pass, true)
  assert.equal(explained.nonAudit.immutableFieldsEqual, true)
  assert.equal(explained.audit.appendedCount, 1)
  assert.equal(explained.audit.overlapCount, 499)
  assert.equal(explained.ownerFieldIsFreshApproval, false)
  assert.notEqual(digest(before), digest(preIsolation))
  f.gate.acknowledge('offline-host', () => ({ idle: true }))
  f.gate.freeze({ password, run: draining.run, expectedGeneration: draining.generation })
  const bundle = f.capture()
  assert.equal(Object.keys(bundle.files).length, 549)
  assert.deepEqual(fs.readFileSync(path.join(f.archive, 'company-access.json')), preIsolation)
  assert.equal(f.verify().verified, true)
  assert.throws(() => f.release('fixture-service-token'), /unauthorized/)
  assert.equal(f.gate.status().phase, 'frozen')
  assert.equal(f.release().phase, 'open')
})

const changes = {
  users: state => { state.users.push({ id: 'unexpected' }) },
  role: state => { state.users[0].role = 'unexpected' },
  grants: state => { state.users[0].grants.push('unexpected') },
  principal: state => { state.principals[0].id = 'unexpected' },
  subjectBinding: state => { state.users[0].sub = 'unexpected' },
  identityBinding: state => { state.principals[0].binding = 'unexpected' },
  suspension: state => { state.users[0].suspended = true },
  sourceBinding: state => { state.sources[0].mailbox = 'unexpected@fixture.invalid' },
  tenant: state => { state.tenantDomain = 'unexpected.invalid' },
  futureSecurityField: state => { state.newAuthorizationPolicy = { permit: true } },
  checkedAt: state => { state.sources[0].checkedAt = '2026-02-01T00:00:00Z' },
  revision: state => { state.revision++ },
  auditModification: state => { state.audit[0].target = 'unexpected' },
  auditRemoval: state => { state.audit.shift() },
  auditOrder: state => { state.audit.reverse() }
}
for (const [name, change] of Object.entries(changes)) {
  test('isolated window rejects ' + name + ' and keeps the failed attempt closed', () => {
    const f = fixture(); f.isolate(); f.capture()
    const original = fs.readFileSync(f.auth), state = f.readAuth()
    change(state); fs.writeFileSync(f.auth, JSON.stringify(state, null, 2))
    assert.throws(() => f.verify(), /isolated_preservation_failed/)
    assert.equal(f.gate.status().phase, 'frozen')
    // Only disposable bytes are restored to prove a failed run stays failed.
    fs.writeFileSync(f.auth, original)
    assert.throws(() => f.release(), /attempt_previously_failed/)
    assert.equal(f.gate.status().phase, 'frozen')
  })
}

test('a normal rolling audit append is not a post-isolation exception', () => {
  const f = fixture(); f.isolate(); f.capture()
  const before = fs.readFileSync(f.auth)
  // Deliberate ungated disposable write: the known writer pattern is still rejected.
  f.registry.recordMailState('connected')
  assert.equal(retention.verify(before, fs.readFileSync(f.auth)).pass, true)
  assert.throws(() => f.release(), /isolated_preservation_failed/)
  assert.equal(f.gate.status().phase, 'frozen')
})

const evidenceChanges = {
  addedProtectedMember: f => fs.writeFileSync(path.join(f.protectedRoot, 'unknown'), 'unexpected'),
  deletedProtectedMember: f => fs.unlinkSync(path.join(f.protectedRoot, 'protected-000')),
  renamedProtectedMember: f => fs.renameSync(path.join(f.protectedRoot, 'protected-000'), path.join(f.protectedRoot, 'renamed')),
  unrelatedProtectedContent: f => fs.writeFileSync(path.join(f.protectedRoot, 'protected-000'), 'unexpected'),
  serializationOnly: f => fs.writeFileSync(f.auth, JSON.stringify(f.readAuth())),
  addedSnapshotMember: f => fs.writeFileSync(path.join(f.archive, 'unknown'), 'unexpected'),
  modifiedSnapshotBytes: f => fs.writeFileSync(path.join(f.archive, 'protected-000'), 'unexpected'),
  missingSnapshotBytes: f => fs.unlinkSync(path.join(f.archive, 'protected-000')),
  modifiedManifest: f => fs.writeFileSync(path.join(f.root, 'sealed-manifest.json'), '{}'),
  missingManifest: f => fs.unlinkSync(path.join(f.root, 'sealed-manifest.json')),
  logicalMemory: f => { const state = JSON.parse(fs.readFileSync(f.logical)); state.banks[0].memory = 'unexpected'; fs.writeFileSync(f.logical, JSON.stringify(state)) },
  logicalAuthorization: f => { const state = JSON.parse(fs.readFileSync(f.logical)); state.authorization[0].grant = 'unexpected'; fs.writeFileSync(f.logical, JSON.stringify(state)) },
  logicalPrincipal: f => { const state = JSON.parse(fs.readFileSync(f.logical)); state.principals[0].id = 'unexpected'; fs.writeFileSync(f.logical, JSON.stringify(state)) },
  logicalOperations: f => { const state = JSON.parse(fs.readFileSync(f.logical)); state.operations.push({ state: 'processing' }); fs.writeFileSync(f.logical, JSON.stringify(state)) },
  logicalAudit: f => { const state = JSON.parse(fs.readFileSync(f.logical)); state.audit.push({ event: 'unexpected' }); fs.writeFileSync(f.logical, JSON.stringify(state)) },
  logicalSnapshot: f => fs.writeFileSync(path.join(f.root, 'sealed-logical.json'), '{}')
}
for (const [name, change] of Object.entries(evidenceChanges)) {
  test('complete snapshot precheck/release rejects ' + name, () => {
    const f = fixture(); f.isolate(); f.capture(); change(f)
    assert.throws(() => f.verify(), /isolated_preservation_failed/)
    assert.throws(() => f.release(), /attempt_previously_failed/)
    assert.equal(f.gate.status().phase, 'frozen')
  })
}

test('release independently rechecks after a previously successful promotion precheck', () => {
  const f = fixture(); f.isolate(); f.capture()
  assert.equal(f.verify().verified, true)
  fs.writeFileSync(path.join(f.protectedRoot, 'protected-000'), 'later unexplained write')
  assert.throws(() => f.release(), /isolated_preservation_failed/)
  assert.equal(f.gate.status().phase, 'frozen')
})

test('pre-isolation writer compatibility never approves a security change or missing retention proof', () => {
  const f = fixture(), before = fs.readFileSync(f.auth), state = f.readAuth()
  state.users[0].grants.push('unexpected')
  assert.equal(retention.verify(before, Buffer.from(JSON.stringify(state))).pass, false)
  state.users[0].grants.pop(); state.revision += 500
  assert.equal(retention.verify(before, Buffer.from(JSON.stringify(state))).pass, false)
  assert.throws(() => retention.parseStrict(Buffer.from('{"users":[],"users":[]}')), /duplicate_key/)
})
