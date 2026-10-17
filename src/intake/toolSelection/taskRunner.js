'use strict'
const { createSelection, digest } = require('./selection')
const runs = require('../../run/run')

// Browser Read limits text to 30k characters and its native response to 195k
// bytes. Do not duplicate complete Context Packs into the text. Retain packs
// when bounded; oversized bodies become explicitly labeled hash-bound read
// receipts, never silently truncated Context Packs or a claim of full content.
function readReceipt(pack) {
  return { kind: 'bounded_read_receipt', source: pack.source, resource: pack.resource, operation: pack.operation,
    state: pack.state, count: pack.count, contentPolicy: 'data_only', contentIncluded: false,
    packSha256: digest(pack), packBytes: Buffer.byteLength(JSON.stringify(pack)), scopeSha256: digest(pack.sourceId),
    coverage: { complete: pack.coverage?.complete ?? null, truncated: pack.coverage?.truncated ?? null },
    limitation: 'content_omitted_from_presentation; hash_binds_original_gateway_pack' }
}
function boundedExecution(execution) {
  if (!execution) return null
  const packs = execution.packs.map(pack => Buffer.byteLength(JSON.stringify(pack)) <= 36000 ? pack : readReceipt(pack))
  return { ...execution, packs, presentation: { contentOmitted: packs.some(pack => pack.kind === 'bounded_read_receipt'),
    maxPackBytes: 36000, fullContentIncluded: packs.every(pack => pack.kind !== 'bounded_read_receipt') } }
}

// Opt-in host injection only. No HTTP route, startup registration or production
// default changes. U1's existing prepare/consent/linkage owns the outer attempt.
function createSelectionTaskRunner({ bindings, authorize, evidenceMode, synthesizeResults = false, dependentReads = false, clarificationEnabled = false }) {
  if (!['synthetic_fixture', 'connected_source'].includes(evidenceMode)) throw Error('evidence_mode_required')
  function describe() {
    const context = authorize()
    if (context?.actor?.role !== 'owner' || context.providerSharing !== true) return []
    return bindings.filter(b => context.sources.includes(b.descriptor.source)).map(b => ({
      id: b.descriptor.id, source: b.descriptor.source, readOnly: true, version: 1,
      contractHash: digest(b.descriptor), scopeHash: digest(context), evidenceMode
    }))
  }
  async function run({ question, adapter, capabilities, actor, page, conversation, signal, onEvent, clarification = null, assertActive = () => {} }) {
    // This slice accepts no browser context or conversation-derived authority.
    if (page || conversation?.length || actor?.role !== 'owner' || !Array.isArray(capabilities) || digest(capabilities) !== digest(describe()) || typeof onEvent !== 'function') throw Error('task_not_authorised')
    const context = authorize()
    const run = runs.createRun({ owner: context.actor.id, conversationId: context.conversationId, goal: question, task: question, capabilityId: 'Research', version: 1 })
    const record = event => {
      onEvent({ ...event, runId: run.id, evidenceMode }) // Durable outer receipt before further dispatch.
      if (event.stage === 'u2_policy_checked') runs.appendStage(run.id, 'POLICY_EVALUATED', { verdict: event.verdict, rule_id: event.ruleId })
      else if (event.stage === 'u2_model_started') runs.appendStage(run.id, 'AGENT_RUNNING', { purpose: 'bounded_tool_selection', inputSha256: event.inputSha256 })
      else if (event.stage === 'u2_selection_validated') runs.appendStage(run.id, 'AGENT_FINISHED', { purpose: 'bounded_tool_selection', selection: event })
      else if (event.stage === 'u2_synthesis_started') runs.appendStage(run.id, 'AGENT_RUNNING', { purpose: 'grounded_result_synthesis', inputSha256: event.inputSha256 })
      else if (event.stage === 'u2_synthesis_recorded') runs.appendStage(run.id, 'AGENT_FINISHED', { purpose: 'grounded_result_synthesis', state: event.state, evidenceSha256: event.evidenceSha256 })
      else if (dependentReads && event.stage === 'u2_read_started') runs.appendStage(run.id, 'AGENT_RUNNING', { purpose: 'authorized_read_attempt', tool: event.tool, argumentsSha256: digest(event.arguments) })
      else if (dependentReads && event.stage === 'u2_read_finished') runs.appendStage(run.id, 'AGENT_FINISHED', { purpose: 'authorized_read_attempt', tool: event.tool, state: event.state, packSha256: event.packSha256 })
    }
    try {
      const selector = createSelection({ bindings, authorize, model: adapter, record, signal, dependentReads, clarificationEnabled, assertActive })
      if (clarification && !clarificationEnabled) throw Error('clarification_not_authorized')
      const selection = clarification ? await selector.resume(question, clarification) : await selector.select(question)
      const synthesisSelection = selection.dependency ? { ...selection, tools: [...selection.tools, { id: selection.dependency.id }] } : selection
      const leases = synthesizeResults && selection.status === 'read_tool_needed' ? synthesisSelection.tools.map(t => bindings.find(b => b.descriptor.id === t.id).capture()) : []
      const execution = selection.status === 'read_tool_needed' ? await selector.execute(selection) : null
      let synthesis = null
      if (synthesizeResults && execution && (!selection.dependency || execution.status === 'read_completed')) {
        const check = () => {
          assertActive()
          if (signal?.aborted) throw Error('synthesis_cancelled')
          const current = authorize()
          // Sharing source bodies is a separate trusted-host decision from
          // sharing the Owner goal/catalog during U2-A tool selection.
          if (context.synthesisSharing !== true || current.synthesisSharing !== true || digest(current) !== digest(context)) throw Error('synthesis_not_authorized')
          for (const verify of leases) verify()
        }
        const synthesisModel = { model: adapter.model, billing: adapter.billing, complete(prompt, options) { return adapter.complete(prompt, { ...options, signal }) } }
        const synthesisInput = clarification ? { selection: { ...selection, tools: [{ id: selection.dependency.id }] }, execution: { ...execution, packs: [execution.packs[1]] } } : { selection: synthesisSelection, execution }
        synthesis = await require('./synthesis').synthesize({ question, selection: synthesisInput.selection, execution: boundedExecution(synthesisInput.execution), model: synthesisModel, check, record })
      }
      // This terminal means the bounded selection/read attempt finished, never
      // that the Owner's goal, approval, or an external action was completed.
      runs.appendStage(run.id, 'SUCCEEDED', { executor: 'context_tool_gateway', selectionStatus: selection.status, executionStatus: execution?.status || 'not_executed', goalCompleted: false })
      const evidence = { version: 1, operation: dependentReads ? 'u3.bounded_dependent_read' : synthesizeResults ? 'u2.grounded_synthesis' : 'u2.bounded_selection', state: evidenceMode === 'synthetic_fixture' ? 'synthetic' : 'unverified_goal',
        evidenceMode, selection, execution: boundedExecution(execution), ...(synthesizeResults ? { synthesis } : {}), run: runs.getRun(run.id), goalCompleted: false }
      return { model: adapter.model, actualModel: selection.actualModel || null, billing: adapter.billing || null,
        text: (clarification && selection.status === 'ambiguous_goal' ? 'I could not identify one record from that reply. Which of the previously listed records should I read? No source read was performed; the original Owner goal remains open.' : null) || require('./dependency').dependencyReply(execution) || (synthesis ? (evidenceMode === 'synthetic_fixture' ? '【隔離合成資料示範】\n' : '') + synthesis.text : JSON.stringify({ evidenceMode, selectionStatus: selection.status, interpretation: selection.interpretedOutcome || null,
          executionStatus: execution?.status || 'not_executed', sources: execution?.packs.map(readReceipt) || [], goalCompleted: false })), evidence }
    } catch (error) {
      runs.appendStage(run.id, 'FAILED', { error: 'selection_or_read_failed' })
      onEvent({ stage: 'u2_failed_no_retry', runId: run.id, evidenceMode })
      throw error
    }
  }
  return Object.freeze({ describe, run, clarificationEnabled })
}
module.exports = { createSelectionTaskRunner }
