'use strict'

const { randomUUID } = require('node:crypto')
const { hash } = require('../actions/contract')
const { createOwnerApprovalStore } = require('../agent/ownerApprovalStore')

const OPERATIONS = Object.freeze(['enable', 'disable', 'recover'])
const TTL_MS = 600000
const SHA = /^[a-f0-9]{40}$/
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

function createPhase1Operation({ store, inspect, apply, now = Date.now }) {
  const approvals = createOwnerApprovalStore({ now, approvalTtlMs: TTL_MS })
  async function prepare({ operation, candidate, deployment }) {
    if (!OPERATIONS.includes(operation) || !SHA.test(candidate) || !ID.test(deployment)) {
      throw Error('invalid_phase1_operation')
    }
    const scope = { operation, candidate, deployment }
    const observed = await inspect(scope)
    const id = randomUUID()
    const material = { ...scope, observed, expiresAt: now() + TTL_MS }
    const fingerprint = hash(material)
    const sessionId = approvals.createSession()
    if (!approvals.seal({ workOrder: { approvalId: id, hash: fingerprint }, proposalId: id }).ok) {
      throw Error('phase1_approval_unavailable')
    }
    const nonce = approvals.issueNonce({ approvalId: id, workOrderHash: fingerprint, sessionId })
    const challenge = 'AUTHORIZE PHASE1 ' + operation + ' ' + candidate + ' ' + fingerprint
    const guard = () => {
      if (now() >= material.expiresAt) throw Error('phase1_approval_expired')
    }
    async function confirm(answer) {
      const consumed = approvals.consumeNonce({ nonce, approvalId: id, displayedHash: fingerprint, sessionId })
      if (!consumed.ok || !approvals.validSession(sessionId) || !approvals.loadSealed(id).ok || answer !== challenge) {
        throw Error('phase1_approval_unavailable')
      }
      guard()
      const fresh = await inspect(scope)
      guard()
      if (hash(fresh) !== hash(observed)) throw Error('phase1_material_changed')
      const row = { id, material, fingerprint, state: 'claimed', timeline: [] }
      function record(state) {
        row.state = state
        row.timeline.push({ at: new Date(now()).toISOString(), state })
        store.save(row)
      }
      record('claimed')
      try {
        const result = await apply(scope, fresh, guard)
        record(result.complete ? 'complete' : 'disabled_release_unconfirmed')
        return { id, fingerprint, ...result }
      } catch (error) {
        record('failed_needs_inspection')
        throw error
      }
    }
    return { material: structuredClone(material), fingerprint, challenge, confirm }
  }
  return { prepare }
}

module.exports = { createPhase1Operation, OPERATIONS, SHA, ID, TTL_MS }
