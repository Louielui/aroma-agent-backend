'use strict'
const { createSelection, digest } = require('./selection')
const runs = require('../../run/run')

// Opt-in host injection only. No HTTP route, startup registration or production
// default changes. U1's existing prepare/consent/linkage owns the outer attempt.
function createSelectionTaskRunner({ bindings, authorize, evidenceMode }) {
  if (!['synthetic_fixture', 'connected_source'].includes(evidenceMode)) throw Error('evidence_mode_required')
  function describe() {
    const context = authorize()
    if (context?.actor?.role !== 'owner' || context.providerSharing !== true) return []
    return bindings.filter(b => context.sources.includes(b.descriptor.source)).map(b => ({
      id: b.descriptor.id, source: b.descriptor.source, readOnly: true, version: 1,
      contractHash: digest(b.descriptor), scopeHash: digest(context), evidenceMode
    }))
  }
  async function run({ question, adapter, capabilities, actor, page, conversation, signal, onEvent }) {
    // This slice accepts no browser context or conversation-derived authority.
    if (page || conversation?.length || actor?.role !== 'owner' || !Array.isArray(capabilities) || digest(capabilities) !== digest(describe()) || typeof onEvent !== 'function') throw Error('task_not_authorised')
    const context = authorize()
    const run = runs.createRun({ owner: context.actor.id, conversationId: context.conversationId, goal: question, task: question, capabilityId: 'Research', version: 1 })
    const record = event => {
      onEvent({ ...event, runId: run.id, evidenceMode }) // Durable outer receipt before further dispatch.
      if (event.stage === 'u2_policy_checked') runs.appendStage(run.id, 'POLICY_EVALUATED', { verdict: event.verdict, rule_id: event.ruleId })
      else if (event.stage === 'u2_model_started') runs.appendStage(run.id, 'AGENT_RUNNING', { purpose: 'bounded_tool_selection', inputSha256: event.inputSha256 })
      else if (event.stage === 'u2_selection_validated') runs.appendStage(run.id, 'AGENT_FINISHED', { purpose: 'bounded_tool_selection', selection: event })
    }
    try {
      const selector = createSelection({ bindings, authorize, model: adapter, record, signal })
      const selection = await selector.select(question)
      const execution = selection.status === 'read_tool_needed' ? await selector.execute(selection) : null
      // This terminal means the bounded selection/read attempt finished, never
      // that the Owner's goal, approval, or an external action was completed.
      runs.appendStage(run.id, 'SUCCEEDED', { executor: 'context_tool_gateway', selectionStatus: selection.status, executionStatus: execution?.status || 'not_executed', goalCompleted: false })
      const evidence = { version: 1, operation: 'u2.bounded_selection', state: evidenceMode === 'synthetic_fixture' ? 'synthetic' : 'unverified_goal',
        evidenceMode, selection, execution, run: runs.getRun(run.id), goalCompleted: false }
      return { model: adapter.model, actualModel: selection.actualModel || null, billing: adapter.billing || null,
        text: JSON.stringify({ evidenceMode, selectionStatus: selection.status, interpretation: selection.interpretedOutcome || null,
          executionStatus: execution?.status || 'not_executed', sources: execution?.packs || [], goalCompleted: false }), evidence }
    } catch (error) {
      runs.appendStage(run.id, 'FAILED', { error: 'selection_or_read_failed' })
      onEvent({ stage: 'u2_failed_no_retry', runId: run.id, evidenceMode })
      throw error
    }
  }
  return Object.freeze({ describe, run })
}
module.exports = { createSelectionTaskRunner }
