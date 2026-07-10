'use strict'

/**
 * dispatcher.test.js — unit tests for the Dispatcher.
 *
 * Uses the built-in Node test runner (node:test), no extra dependencies.
 *   Run: node --test src/capability/
 *
 * These tests NEVER invoke the real Claude Code (or any real worker): every
 * agent is backed by a FAKE adapter whose invoke is a stub with an invocation
 * counter, so we can assert exactly when — and how often — an adapter was hit.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createDispatcher } = require('./dispatcher')
const { register } = require('./registry')
const { registerAgent, getHealth, agentsProviding, rankByHealth } = require('./agents')

/**
 * Build a fake Run Timeline sink exposing appendStage(stage, facts), the shape
 * the Dispatcher expects for its optional runContext. It simply records every
 * appended stage in order so tests can assert exactly what the Dispatcher
 * observed — no real Run store, no run.js, no I/O.
 */
function makeRunContext () {
  const stages = []
  return {
    stages,
    appendStage (stage, facts) {
      stages.push({ stage, facts: facts || {} })
    }
  }
}

/** Convenience: the ordered list of stage names appended to a runContext. */
function stageNames (rc) {
  return rc.stages.map(s => s.stage)
}

/**
 * Build a fake Worker Adapter that satisfies the adapter contract (invoke +
 * health) and tracks how many times invoke was called.
 *
 * @param {{ ok?: boolean, throws?: boolean, output?: object, cost?: number,
 *           latencyMs?: number, error?: string }} [behavior]
 */
function makeFakeAdapter (behavior = {}) {
  const adapter = {
    calls: 0,
    invoke (capabilityId, version, input) {
      adapter.calls++
      if (behavior.throws) throw new Error(behavior.error || 'boom')
      return {
        ok: behavior.ok !== false,
        output: behavior.output || { echoed: input || null },
        error: behavior.error || null,
        cost: typeof behavior.cost === 'number' ? behavior.cost : 1,
        latencyMs: typeof behavior.latencyMs === 'number' ? behavior.latencyMs : 5
      }
    },
    health () {
      return { availability: 'up', latencyMs: 1 }
    }
  }
  return adapter
}

// --- Shared, deterministic test fixtures (registered once at module load) ------
// A dedicated agent for the high-risk Deploy@1 contract.
registerAgent({
  id: 'deploy-agent',
  role: 'Release Manager',
  adapter: 'adapters/fake-deploy',
  provides: [{ capability: 'Deploy', version: 1, seed_quality: 0.9, seed_cost: '$$' }],
  availability: 'cloud',
  status: 'active'
})

// A brand-new, routable Develop@2 with NO agent providing it — used to prove
// the no_agent path (Develop@1 is already provided by the seeded claude-code).
register({ id: 'Develop', version: 2, lifecycle: 'active', risk_tier: 'low' })

// Two agents for Verify@1 so we can prove ranked fall-back. The higher seed
// quality ranks first, so 'verify-hi' is selected before 'verify-lo'.
registerAgent({
  id: 'verify-hi',
  role: 'Verifier (primary)',
  adapter: 'adapters/fake-verify-hi',
  provides: [{ capability: 'Verify', version: 1, seed_quality: 0.9, seed_cost: '$' }],
  availability: 'cloud',
  status: 'active'
})
registerAgent({
  id: 'verify-lo',
  role: 'Verifier (backup)',
  adapter: 'adapters/fake-verify-lo',
  provides: [{ capability: 'Verify', version: 1, seed_quality: 0.5, seed_cost: '$' }],
  availability: 'cloud',
  status: 'active'
})

// A second Develop@1 provider so an all-agents-fail dispatch has more than one
// candidate to try, letting the attempts array name each agent in turn. The
// seeded claude-code (seed_quality 0.9) ranks ahead of this backup (0.5).
registerAgent({
  id: 'develop-backup',
  role: 'Engineer (backup)',
  adapter: 'adapters/fake-develop-backup',
  provides: [{ capability: 'Develop', version: 1, seed_quality: 0.5, seed_cost: '$' }],
  availability: 'cloud',
  status: 'active'
})

// A dedicated agent for Monitor@1 so the health-increment assertion is isolated.
registerAgent({
  id: 'monitor-agent',
  role: 'Observer',
  adapter: 'adapters/fake-monitor',
  provides: [{ capability: 'Monitor', version: 1, seed_quality: 0.8, seed_cost: 'free' }],
  availability: 'cloud',
  status: 'active'
})

// --- Tests --------------------------------------------------------------------

test('CRITICAL: Deploy to production without approval is pending, adapter NEVER invoked', async () => {
  const deployAdapter = makeFakeAdapter()
  const d = createDispatcher({ adapters: { 'deploy-agent': deployAdapter } })

  const result = await d.dispatch({
    capabilityId: 'Deploy',
    version: 1,
    target: 'production',
    input: { release: 'v1.2.3' }
  }) // approval defaults to null

  assert.equal(result.status, 'pending_approval')
  assert.equal(result.rule_id, 'prod-deploy-approval')
  assert.equal(typeof result.reason, 'string')

  // The whole point: no agent was selected, no adapter was touched.
  assert.equal(deployAdapter.calls, 0)
})

test('Deploy to production WITH approval proceeds to the adapter', async () => {
  const deployAdapter = makeFakeAdapter({ output: { deployed: true }, cost: 3, latencyMs: 42 })
  const d = createDispatcher({ adapters: { 'deploy-agent': deployAdapter } })

  const result = await d.dispatch(
    { capabilityId: 'Deploy', version: 1, target: 'production', input: { release: 'v1.2.3' } },
    { approved: true, approvedBy: 'louie@aromabistro741.com' }
  )

  assert.equal(result.status, 'ok')
  assert.equal(result.agentId, 'deploy-agent')
  assert.deepEqual(result.output, { deployed: true })
  assert.equal(deployAdapter.calls, 1)
})

test("request touching the 'banking' data domain is denied and no adapter is called", async () => {
  const claudeAdapter = makeFakeAdapter()
  const d = createDispatcher({ adapters: { 'claude-code': claudeAdapter } })

  const result = await d.dispatch({
    capabilityId: 'Apply',
    version: 1,
    target: 'dev',
    input: { payload: {} },
    context: { data_domains: ['banking'] }
  })

  assert.equal(result.status, 'denied')
  assert.equal(result.rule_id, 'deny-sensitive-data')
  assert.equal(claudeAdapter.calls, 0)
})

test('Apply to dev returns ok and the adapter is called exactly once', async () => {
  const claudeAdapter = makeFakeAdapter({ output: { result: { applied: true } } })
  const d = createDispatcher({ adapters: { 'claude-code': claudeAdapter } })

  const result = await d.dispatch({
    capabilityId: 'Apply',
    version: 1,
    target: 'dev',
    input: { payload: { file: 'menu.json' } }
  })

  assert.equal(result.status, 'ok')
  assert.equal(result.agentId, 'claude-code')
  assert.equal(claudeAdapter.calls, 1)
})

test('Develop request to dev with no registered agent returns no_agent', async () => {
  const d = createDispatcher({ adapters: {} })

  // Develop@2 is routable but nobody provides it.
  const result = await d.dispatch({ capabilityId: 'Develop', version: 2, target: 'dev', input: {} })

  assert.equal(result.status, 'no_agent')
})

test("when the top-ranked agent's adapter throws, the dispatcher falls back to the next and succeeds", async () => {
  const hiAdapter = makeFakeAdapter({ throws: true, error: 'primary exploded' })
  const loAdapter = makeFakeAdapter({ output: { verified: true } })
  const d = createDispatcher({
    adapters: { 'verify-hi': hiAdapter, 'verify-lo': loAdapter }
  })

  const result = await d.dispatch({ capabilityId: 'Verify', version: 1, target: 'dev', input: {} })

  assert.equal(result.status, 'ok')
  assert.equal(result.agentId, 'verify-lo') // fell back from the higher-ranked verify-hi
  assert.equal(hiAdapter.calls, 1) // the primary was tried once...
  assert.equal(loAdapter.calls, 1) // ...then the backup succeeded

  // Both attempts are logged: one failure (verify-hi), one success (verify-lo).
  const events = d.getEvents()
  assert.equal(events.length, 2)
  assert.equal(events[0].agentId, 'verify-hi')
  assert.equal(events[0].success, false)
  assert.equal(events[1].agentId, 'verify-lo')
  assert.equal(events[1].success, true)
})

test('a Develop dispatch where every agent fails returns failed carrying agentId, cost, latencyMs, error and an attempts array', async () => {
  // The higher-ranked claude-code throws; the backup reports an honest failure
  // with its own cost and latency. Every candidate fails.
  const primary = makeFakeAdapter({ throws: true, error: 'primary exploded' })
  const backup = makeFakeAdapter({ ok: false, error: 'backup produced no patch', cost: 2, latencyMs: 7 })
  const d = createDispatcher({
    adapters: { 'claude-code': primary, 'develop-backup': backup }
  })

  const result = await d.dispatch({ capabilityId: 'Develop', version: 1, target: 'dev', input: { task: 'x' } })

  assert.equal(result.status, 'failed')
  // An honest failure carries the same facts as an honest success: the last
  // agent attempted, its cost and latency, plus an error string.
  assert.equal(result.agentId, 'develop-backup')
  assert.equal(result.cost, 2)
  assert.equal(result.latencyMs, 7)
  assert.ok(typeof result.error === 'string' && result.error.length > 0)

  // The attempts array names every agent tried, in order, each with its error.
  assert.ok(Array.isArray(result.attempts))
  assert.equal(result.attempts.length, 2)
  assert.deepEqual(result.attempts.map(a => a.agentId), ['claude-code', 'develop-backup'])
  assert.ok(result.attempts.every(a => typeof a.error === 'string' && a.error.length > 0))

  // Both attempts were really made against the fakes.
  assert.equal(primary.calls, 1)
  assert.equal(backup.calls, 1)
})

test('getEvents records an Event for every dispatch, including denied and pending_approval', async () => {
  const d = createDispatcher({ adapters: { 'deploy-agent': makeFakeAdapter() } })

  await d.dispatch({
    capabilityId: 'Apply', version: 1, target: 'dev', input: {},
    context: { data_domains: ['banking'] }
  }) // denied
  await d.dispatch({ capabilityId: 'Deploy', version: 1, target: 'production', input: {} }) // pending

  const events = d.getEvents()
  assert.equal(events.length, 2)

  const [denied, pending] = events
  assert.equal(denied.verdict, 'deny')
  assert.equal(denied.rule_id, 'deny-sensitive-data')
  assert.equal(denied.agentId, null)

  assert.equal(pending.verdict, 'require_approval')
  assert.equal(pending.rule_id, 'prod-deploy-approval')
  assert.equal(pending.agentId, null)

  // Every Event carries a verdict and a rule_id.
  assert.ok(events.every(e => typeof e.verdict === 'string' && typeof e.rule_id === 'string'))
})

test("a successful dispatch increments the agent's runtime health sample_count", async () => {
  const d = createDispatcher({ adapters: { 'monitor-agent': makeFakeAdapter() } })

  // No samples exist for this dedicated agent before the dispatch.
  assert.equal(getHealth('monitor-agent', 'Monitor', 1), null)

  const result = await d.dispatch({ capabilityId: 'Monitor', version: 1, target: 'dev', input: {} })
  assert.equal(result.status, 'ok')

  const health = getHealth('monitor-agent', 'Monitor', 1)
  assert.ok(health)
  assert.equal(health.sample_count, 1)
})

// --- Run Timeline instrumentation --------------------------------------------
// The Dispatcher records its own timeline as facts, at the moment each thing
// actually happens — but ONLY when a runContext is supplied. Every fake below is
// still a plain adapter with an invoke counter; the real Claude Code is never hit.

test('with no runContext the result shape is unchanged and nothing is appended', async () => {
  // A spy is built but deliberately NOT supplied: the Dispatcher must behave
  // exactly as it did before the timeline existed.
  const spy = makeRunContext()
  const claudeAdapter = makeFakeAdapter({ output: { result: { applied: true } }, cost: 4, latencyMs: 9 })
  const d = createDispatcher({ adapters: { 'claude-code': claudeAdapter } })

  const result = await d.dispatch({ capabilityId: 'Apply', version: 1, target: 'dev', input: { payload: {} } })

  // Exactly the classic result shape — no extra timeline field leaked in.
  assert.equal(result.status, 'ok')
  assert.deepEqual(Object.keys(result).sort(), ['agentId', 'cost', 'latencyMs', 'output', 'status'])
  assert.equal(claudeAdapter.calls, 1)

  // No runContext was supplied, so nothing was appended anywhere.
  assert.equal(spy.stages.length, 0)
})

test('runContext: Deploy to production without approval appends POLICY_EVALUATED then PENDING_APPROVAL, never selects or runs an agent', async () => {
  const rc = makeRunContext()
  const deployAdapter = makeFakeAdapter()
  const d = createDispatcher({ adapters: { 'deploy-agent': deployAdapter }, runContext: rc })

  const result = await d.dispatch({
    capabilityId: 'Deploy', version: 1, target: 'production', input: { release: 'v1.2.3' }
  }) // approval defaults to null

  assert.equal(result.status, 'pending_approval')
  assert.deepEqual(stageNames(rc), ['POLICY_EVALUATED', 'PENDING_APPROVAL'])
  assert.equal(rc.stages[0].facts.verdict, 'require_approval')
  assert.equal(rc.stages[1].facts.rule_id, 'prod-deploy-approval')

  // No agent was selected and no adapter was ever invoked.
  assert.ok(!stageNames(rc).includes('AGENT_SELECTED'))
  assert.ok(!stageNames(rc).includes('AGENT_RUNNING'))
  assert.equal(deployAdapter.calls, 0)
})

test("runContext: a 'banking' data domain appends POLICY_EVALUATED then DENIED, never selects an agent", async () => {
  const rc = makeRunContext()
  const claudeAdapter = makeFakeAdapter()
  const d = createDispatcher({ adapters: { 'claude-code': claudeAdapter }, runContext: rc })

  const result = await d.dispatch({
    capabilityId: 'Apply', version: 1, target: 'dev', input: { payload: {} },
    context: { data_domains: ['banking'] }
  })

  assert.equal(result.status, 'denied')
  assert.deepEqual(stageNames(rc), ['POLICY_EVALUATED', 'DENIED'])
  assert.equal(rc.stages[0].facts.verdict, 'deny')
  assert.equal(rc.stages[1].facts.rule_id, 'deny-sensitive-data')
  assert.equal(typeof rc.stages[1].facts.reason, 'string')

  assert.ok(!stageNames(rc).includes('AGENT_SELECTED'))
  assert.equal(claudeAdapter.calls, 0)
})

test('runContext: a successful Develop to dev appends POLICY_EVALUATED, AGENT_SELECTED, AGENT_RUNNING, AGENT_FINISHED, PATCH_READY in order with the patchPath', async () => {
  const rc = makeRunContext()
  const patchPath = '/tmp/patches/dev-777.zip'
  // Both Develop@1 providers succeed and produce the patch, so whichever ranks
  // first succeeds on the first try — no fall-back, a single run.
  const primary = makeFakeAdapter({ output: { patchPath } })
  const backup = makeFakeAdapter({ output: { patchPath } })
  const d = createDispatcher({
    adapters: { 'claude-code': primary, 'develop-backup': backup }, runContext: rc
  })

  const result = await d.dispatch({ capabilityId: 'Develop', version: 1, target: 'dev', input: { task: 'x' } })

  assert.equal(result.status, 'ok')
  assert.deepEqual(stageNames(rc), [
    'POLICY_EVALUATED', 'AGENT_SELECTED', 'AGENT_RUNNING', 'AGENT_FINISHED', 'PATCH_READY'
  ])

  const selected = rc.stages.find(s => s.stage === 'AGENT_SELECTED')
  assert.equal(typeof selected.facts.agentId, 'string')
  assert.ok(['live', 'seed'].includes(selected.facts.healthBasis))

  const patchReady = rc.stages.find(s => s.stage === 'PATCH_READY')
  assert.equal(patchReady.facts.patchPath, patchPath)
})

test('runContext: Develop where the top-ranked agent throws and the next succeeds appends two AGENT_RUNNING and two AGENT_FINISHED, the first with success false', async () => {
  const rc = makeRunContext()
  // Rank the Develop@1 providers exactly as the Dispatcher will, so we can hand
  // the throwing adapter to the top-ranked agent and a success to the next.
  const ranked = rankByHealth(agentsProviding('Develop', 1), 'Develop', 1)
  const [top, next] = [ranked[0].id, ranked[1].id]
  const throwing = makeFakeAdapter({ throws: true, error: 'top exploded' })
  const succeeding = makeFakeAdapter({ output: { patchPath: '/tmp/patches/dev-fallback.zip' } })
  const d = createDispatcher({
    adapters: { [top]: throwing, [next]: succeeding }, runContext: rc
  })

  const result = await d.dispatch({ capabilityId: 'Develop', version: 1, target: 'dev', input: {} })

  assert.equal(result.status, 'ok')
  assert.equal(result.agentId, next)

  const running = rc.stages.filter(s => s.stage === 'AGENT_RUNNING')
  const finished = rc.stages.filter(s => s.stage === 'AGENT_FINISHED')
  assert.equal(running.length, 2)
  assert.equal(finished.length, 2)
  assert.equal(finished[0].facts.success, false) // the top-ranked attempt failed...
  assert.equal(finished[1].facts.success, true) // ...the fall-back succeeded
})

test('runContext: a Develop where every agent fails appends FAILED carrying error, agentId, cost, latencyMs and an attempts array', async () => {
  const rc = makeRunContext()
  const primary = makeFakeAdapter({ throws: true, error: 'primary exploded' })
  const backup = makeFakeAdapter({ ok: false, error: 'backup produced no patch', cost: 2, latencyMs: 7 })
  const d = createDispatcher({
    adapters: { 'claude-code': primary, 'develop-backup': backup }, runContext: rc
  })

  const result = await d.dispatch({ capabilityId: 'Develop', version: 1, target: 'dev', input: { task: 'x' } })

  assert.equal(result.status, 'failed')

  const failed = rc.stages.find(s => s.stage === 'FAILED')
  assert.ok(failed, 'a FAILED stage must be appended')
  assert.ok(typeof failed.facts.error === 'string' && failed.facts.error.length > 0)
  assert.equal(typeof failed.facts.agentId, 'string')
  assert.ok('cost' in failed.facts)
  assert.ok('latencyMs' in failed.facts)
  assert.ok(Array.isArray(failed.facts.attempts))
  assert.equal(failed.facts.attempts.length, 2)

  // The Dispatcher recorded neither a COMPLETED nor a PATCH_READY on this path.
  assert.ok(!stageNames(rc).includes('COMPLETED'))
  assert.ok(!stageNames(rc).includes('PATCH_READY'))
})

test('runContext: AGENT_FINISHED carries cost null rather than zero when the adapter reports an unprovable cost', async () => {
  const rc = makeRunContext()
  // Monitor@1 has a single provider, so it is always the selected agent. Its
  // adapter succeeds but proves NO cost (cost is absent, not a number).
  const costlessAdapter = {
    calls: 0,
    invoke () {
      this.calls++
      return { ok: true, output: { observed: true }, error: null, cost: undefined, latencyMs: 5 }
    },
    health () {
      return { availability: 'up', latencyMs: 1 }
    }
  }
  const d = createDispatcher({ adapters: { 'monitor-agent': costlessAdapter }, runContext: rc })

  const result = await d.dispatch({ capabilityId: 'Monitor', version: 1, target: 'dev', input: {} })

  assert.equal(result.status, 'ok')
  const finished = rc.stages.find(s => s.stage === 'AGENT_FINISHED')
  assert.ok(finished)
  assert.equal(finished.facts.success, true)
  assert.equal(finished.facts.cost, null) // null, not 0 — the cost was never proven
})
