'use strict'
// Main-only composition of the accepted bounded runner. AsyncLocalStorage binds
// authorization to the current HTTP request, never a mutable shared principal.
const { AsyncLocalStorage } = require('node:async_hooks')
const { CodexSubscriptionAdapter } = require('../adapters/CodexSubscriptionAdapter')
const { billingFor, isClaudeModel } = require('../subscription/chatModels')
const { digest } = require('./toolSelection/selection')

function verifiedSubscription(choice, options = {}) {
  const pinned = Object.freeze({ model: choice.model, effort: choice.effort })
  const adapter = new CodexSubscriptionAdapter({ ...options, ...pinned })
  let verified = false
  return Object.freeze({ model: pinned.model, billing: billingFor(pinned.model), effort: pinned.effort,
    async preflight(options) { verified = false; const out = await adapter.preflight(options); if (out.effort !== undefined && out.effort !== pinned.effort) throw Error('subscription_identity_changed'); verified = true; return out },
    async complete(prompt, options) { if (!verified) throw Error('subscription_preflight_required'); const out = await adapter.complete(prompt, options); if (out.effort !== undefined && out.effort !== pinned.effort) throw Error('subscription_identity_changed'); return out }
  })
}
function createOwnerIntegration({ liveContext, registry, enabled, selection, env = process.env, request, evidenceMode = 'connected_source' }) {
  const requests = new AsyncLocalStorage()
  const current = () => { const r = requests.getStore(); if (!r || !enabled()) throw Error('owner_coordination_disabled'); r.verifyOwner(); return r }
  const provider = choice => { current(); return verifiedSubscription(choice, { env, ...(request ? { request } : {}) }) }
  function authorize() {
    const r = current(), state = registry.snapshot({ readOnly: true })
    const owner = state.users.find(u => u.id === 'owner' && u.role === 'owner')
    if (!owner || owner.suspended) throw Error('owner_session_required')
    // Source leases remain authoritative for credential/configuration changes.
    // Audit timestamps and rolling audit are not permission revision identities.
    const security = { users: state.users.map(u => ({ id: u.id, role: u.role, email: u.email, verified: u.verified, suspended: u.suspended, grants: u.grants })), sources: state.sources.map(s => ({ id: s.id, kind: s.kind, state: s.state, rootId: s.rootId, driveId: s.driveId })) }
    const choice = selection(), provider = isClaudeModel(choice.model) ? 'claude' : 'openai'
    const sources = ['aroma_system', 'calendar', 'drive'].filter(source => require('../context/providerSharing').isSharedWith(provider, source, env))
    return { actor: { id: 'owner', role: 'owner' }, surface: 'main', conversationId: r.body.conversationId,
      authorizationRevision: digest({ security, choice, sharing: sources }), sources,
      providerSharing: env.OWNER_TASK_GOAL_SHARING === 'true', synthesisSharing: env.OWNER_TASK_CONTENT_SHARING === 'true' }
  }
  const runner = Object.freeze({ clarificationEnabled: true, describe(...args) { return current().runner.describe(...args) }, async run(input) {
    const r = current()
    if (authorize().synthesisSharing !== true) throw Error('synthesis_not_authorized')
    const verified = await input.adapter.preflight({ signal: input.signal }); current()
    const synthetic = evidenceMode === 'synthetic_fixture'
    const provenance = synthetic ? { executionMode: 'synthetic_fixture', synthetic: true, billingVerified: false,
      evidenceSource: 'host_owned_synthetic_adapters', modelInvocationVerified: false, sourceReadVerification: 'not_yet_observed' } : null
    const identity = { requestedModel: input.adapter.model, executionMode: 'synthetic_fixture', verifiedActualModel: null, modelInvocationVerified: false }
    const projectEvent = event => synthetic ? { ...event, ...identity,
      ...(Object.hasOwn(event, 'actualModel') ? { actualModel: 'synthetic_fixture' } : {}),
      ...(Object.hasOwn(event, 'billing') ? { billing: 'synthetic-not-verified' } : {}) } : event
    const onEvent = event => input.onEvent(projectEvent(event))
    const adapter = synthetic ? Object.create(input.adapter) : input.adapter
    if (synthetic) Object.defineProperty(adapter, 'complete', { value: async (...args) => ({ ...await input.adapter.complete(...args), actualModel: 'synthetic_fixture' }) })
    onEvent({ stage: synthetic ? 'r1_synthetic_contract_exercised' : 'r1_subscription_verified', model: verified.model, billing: synthetic ? 'synthetic-not-verified' : verified.billing, effort: input.adapter.effort, goalId: input.ownerGoal?.goalId,
      ...(synthetic ? { evidenceMode, executionProvenance: provenance } : {}) })
    const out = await r.runner.run(synthetic ? { ...input, adapter, onEvent } : input); current()
    if (!synthetic) return out
    const executionProvenance = { ...provenance, sourceReadVerification: out.evidence?.execution?.packs?.some(p => p.state === 'ok' && p.coverage?.provenance === 'synthetic_disposable_fixture') ? 'synthetic_adapter_observed' : 'not_verified' }
    const synthesis = out.evidence?.synthesis
    return { ...out, ...identity, actualModel: 'synthetic_fixture', billing: 'synthetic-not-verified', executionProvenance, evidence: { ...out.evidence,
      ...(synthesis ? { synthesis: { ...synthesis, ...(synthesis.review ? { review: { ...synthesis.review, ...identity, billing: 'synthetic-not-verified' } } : {}) } } : {}), executionProvenance,
      run: { ...out.evidence?.run, executionProvenance } } }
  } })
  function withOwner(body, verifyOwner, execute) {
    if (!enabled()) return execute()
    verifyOwner()
    const description = liveContext.drive?.describe(), driveSource = description?.registered ? { id: description.id, name: description.name, rootId: description.rootId, driveId: description.rootId, state: 'registered' } : null
    const bindings = require('./toolSelection/bindings').contextBindings({ ...liveContext, driveSource })
    const runner = require('./toolSelection/taskRunner').createSelectionTaskRunner({ bindings, authorize, evidenceMode, synthesizeResults: true, dependentReads: true, clarificationEnabled: true, crossSourceEnabled: true })
    return requests.run({ body, verifyOwner, runner }, execute)
  }
  return Object.freeze({ runner, provider, withOwner })
}
module.exports = { createOwnerIntegration, verifiedSubscription }
