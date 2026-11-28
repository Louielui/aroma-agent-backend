'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createStore } = require('../../src/actions/store')
const { promotionDirectory } = require('../../src/repositoryPromotion/paths')
const { command } = require('../../src/repositoryPromotion/repository')
const { health, createRuntime } = require('../../src/repositoryPromotion/runtime')
const { interactiveOwner } = require('./approvePromotion.cjs')
const { createPhase1Operation, OPERATIONS, SHA, ID } = require('../../src/repositoryPromotion/phase1Operation')
const { PILOT, PRODUCTION, control, directory } = require('../../src/localBrain/next/experimentControl')
const { makeSpool, transport } = require('../../src/localBrain/next/experiment')

function argumentsOf([operation, candidate, deployment, ...extra]) {
  if (extra.length || !OPERATIONS.includes(operation) || !SHA.test(candidate) || !ID.test(deployment)) {
    throw Error('invalid_phase1_operation')
  }
  return { operation, candidate, deployment }
}

function readEvidence(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2000000 ||
      fs.realpathSync(file).toLowerCase() !== path.resolve(file).toLowerCase()) throw Error('phase1_evidence_invalid')
  const bytes = fs.readFileSync(file)
  return { data: JSON.parse(bytes.toString('utf8')), digest: createHash('sha256').update(bytes).digest('hex') }
}

function verifyDeployment(row, { candidate, deployment, boot, tree }) {
  if (!SHA.test(boot) || !SHA.test(tree) || row.id !== deployment || row.state !== 'complete' || !row.authorizationId ||
      row.approvalMaterial?.commit !== candidate || row.committed?.commit !== candidate ||
      row.committed?.tree !== tree || row.approvalMaterial?.tree !== tree ||
      row.merge?.commit !== boot || row.runtime?.verified !== true || row.runtime.bootCommit !== boot) {
    throw Error('phase1_deployment_unconfirmed')
  }
}

function shutdownState(row, scope, before) {
  const boot = row.merge?.commit, tree = row.committed?.tree
  verifyDeployment(row, { ...scope, boot, tree })
  if (before === null && scope.operation === 'disable') throw Error('phase1_disable_state')
  if (before !== null && before !== boot) throw Error('phase1_marker_owner_mismatch')
  return { boot, tree, before }
}

function relay() {
  const root = path.join(PILOT, 'spool')
  for (const dir of [root, path.join(root, 'requests'), path.join(root, 'responses')]) directory(dir)
  const key = fs.readFileSync(path.join(root, 'key.hex'), 'utf8').trim()
  return transport(makeSpool(root, key), { timeoutMs: 15000 })
}

async function main() {
  const scope = argumentsOf(process.argv.slice(2))
  if (!interactiveOwner()) throw Error('interactive_owner_terminal_required')
  const artifacts = promotionDirectory(), marker = control()
  const store = createStore({ dir: path.join(artifacts, 'phase1-actions') })
  const runtime = createRuntime({ repository: { runtimeRoot: PRODUCTION } })
  const root = path.resolve(__dirname, '../..')
  const lock = path.join(artifacts, 'promotion.lock')
  let locked = false

  async function inspect({ operation, deployment, candidate }) {
    const row = readEvidence(path.join(artifacts, 'runs', deployment + '.json'))
    const before = marker.current()
    if (operation !== 'enable') {
      // The original, verified deployment owns the marker even after a
      // subsequent boot or a service outage. Clearing it needs no live health.
      const state = shutdownState(row.data, { operation, deployment, candidate }, before)
      if (command(root, ['rev-parse', 'HEAD^{tree}']) !== state.tree ||
          command(root, ['status', '--porcelain=v1'])) throw Error('phase1_control_source_drift')
      return { ...state, deploymentHash: row.digest }
    }
    const boot = command(PRODUCTION, ['rev-parse', 'HEAD'])
    const tree = command(PRODUCTION, ['rev-parse', 'HEAD^{tree}'])
    verifyDeployment(row.data, { candidate, deployment, boot, tree })
    const live = await health('http://127.0.0.1:8090/health')
    if (command(root, ['rev-parse', 'HEAD^{tree}']) !== tree ||
        command(root, ['status', '--porcelain=v1']) || live.bootCommit !== boot ||
        !Number.isFinite(Date.parse(live.bootedAt))) throw Error('phase1_source_drift')
    if (before !== null || (await runtime.idle()).state !== 'idle_verified') throw Error('phase1_enable_state')
    if (!relay().ready()) throw Error('phase1_worker_not_ready')
    const proof = readEvidence(path.join(artifacts, 'phase1-service-proof.json'))
    const { service, logonSid, serviceSid, verified, checkedAtUtc, bootCommit, bootedAt, checks } = proof.data
    const checkedAt = Date.parse(checkedAtUtc)
    const required = ['request_create_read_delete', 'response_read_delete', 'preference_atomic_replace',
      'key_heartbeat_read_only', 'diagnostics_read_delete_denied', 'out_of_scope_canary_denied', 'parent_delete_child_denied']
    if (service !== 'AromaXiangXiangBackend' || logonSid !== 'S-1-5-19' ||
        serviceSid !== 'S-1-5-80-949002174-267234052-1105664803-670341952-899816923' ||
        bootCommit !== boot || bootedAt !== live.bootedAt || verified !== true ||
        !required.every(check => Array.isArray(checks) && checks.includes(check)) ||
        !Number.isFinite(checkedAt) || checkedAt < Date.parse(live.bootedAt) || checkedAt > Date.now()) {
      throw Error('phase1_service_proof_unconfirmed')
    }
    return { boot, bootedAt, tree, before, deploymentHash: row.digest, serviceProofHash: proof.digest }
  }

  async function apply({ operation }, state, guard) {
    if (!locked) throw Error('phase1_lock_required')
    guard()
    marker.set(state.before, operation === 'enable' ? state.boot : null)
    if (operation === 'enable') return { complete: marker.current() === state.boot, enabled: true }
    try {
      guard()
      await relay().call('release', {})
      return { complete: marker.current() === null, enabled: false, unloaded: true }
    } catch {
      return { complete: false, enabled: false, unloaded: null }
    }
  }

  const pending = await createPhase1Operation({ store, inspect, apply }).prepare(scope)
  console.log(JSON.stringify({ ...pending.material, fingerprint: pending.fingerprint,
    scope: scope.operation === 'enable'
      ? 'Enable the two local Phase 1 profiles on the exact loaded build.'
      : 'Disable the Phase 1 profiles and request release of the dedicated local inference engine.',
    existingDefault: 'local:qwen3.5:9b' }, null, 2))
  const prompt = require('node:readline/promises').createInterface({ input: process.stdin, output: process.stdout })
  let answer
  try { answer = await prompt.question('Type ' + pending.challenge + ' to continue: ') }
  finally { prompt.close() }
  if (answer !== pending.challenge) throw Error('owner_declined')
  let fd
  try {
    try { fd = fs.openSync(lock, 'wx') } catch { throw Error('promotion_lock_requires_inspection') }
    locked = true
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, operation: 'phase1' }))
    const result = await pending.confirm(answer)
    console.log(JSON.stringify(result))
    if (!result.complete) process.exitCode = 1
  } finally {
    if (locked) { fs.closeSync(fd); fs.unlinkSync(lock) }
  }
}

if (require.main === module) main().catch(error => {
  console.error(/^[a-z_]+$/.test(error.message) ? error.message : 'phase1_entry_unavailable')
  process.exitCode = 1
})
module.exports = { argumentsOf, verifyDeployment, shutdownState }
