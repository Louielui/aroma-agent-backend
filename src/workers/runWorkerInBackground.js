'use strict'

/**
 * runWorkerInBackground.js — B2-1 async trigger glue.
 *
 * Given the context of an authorised proposal (proposalId, runId, task, and the
 * authorising approval provenance), it: writes an Execution Artifact to
 * .aroma/tasks, mints a fresh throwaway sandbox under os.tmpdir(), invokes the
 * Step-2 worker adapter (which enforces the sandbox brake), and writes a Result
 * Artifact to .aroma/results linked back to the Execution by taskId.
 *
 * It is called FIRE-AND-FORGET from the confirm handler AFTER the HTTP response
 * has already been sent — it never blocks the response and never touches the
 * confirm / startRun / dispatch governance. All time and id generation are
 * injectable, so tests are deterministic and never spawn a real process.
 */

const { randomUUID } = require('node:crypto')
// Sandbox minting + init now come from the TmpdirSandbox WorkspaceProvider (B2-7).
// defaultPrepareSandbox is re-exported below for back-compat.
const { createTmpdirSandbox, defaultPrepareSandbox } = require('./workspace/tmpdirSandbox')

const NO_RELAY = { toUser: 0, fromUser: 0, manual: 0 }

/**
 * @param {{ worker, artifactStore, sandboxRoot?, clock?, newId?, prepareSandbox? }} options
 * @returns {{ run: (context: object) => Promise<{taskId, resultId, sandbox}> }}
 */
function createWorkerRunner (options = {}) {
  const worker = options.worker
  const artifactStore = options.artifactStore
  if (!worker || typeof worker.invoke !== 'function') {
    throw new TypeError('createWorkerRunner requires a worker with an invoke() method')
  }
  if (!artifactStore || typeof artifactStore.write !== 'function') {
    throw new TypeError('createWorkerRunner requires an artifactStore with write()')
  }
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()
  const newId = typeof options.newId === 'function' ? options.newId : (p) => `${p}_${randomUUID().slice(0, 8)}`
  // The workspace provider owns sandbox minting + init. Back-compat: the existing
  // sandboxRoot/prepareSandbox options are routed into the default TmpdirSandbox,
  // so callers that pass them behave exactly as before.
  const workspace = options.workspace || createTmpdirSandbox({ sandboxRoot: options.sandboxRoot, prepareSandbox: options.prepareSandbox })

  async function run (context = {}) {
    const { proposalId = null, runId = null, task, approval = null } = context || {}

    const taskId = newId('task')
    const { dir: sandbox } = workspace.prepare()

    // Execution Artifact — the authorised unit of work + its provenance.
    const execution = {
      id: taskId,
      createdAt: clock(),
      kind: 'execution',
      proposalId,
      runId,
      task,
      sandbox,
      approval // { confirmedBy, confirmedAt } — the human act that authorised this
    }
    artifactStore.write('tasks', execution)

    // Result Artifact — links back to the Execution by taskId (chain: tightening 2).
    let result
    try {
      const r = await worker.invoke('Invoke', 1, { task, sandbox })
      result = {
        id: newId('result'),
        createdAt: clock(),
        kind: 'result',
        taskId,
        proposalId,
        ok: r.ok,
        exit: r.output ? r.output.exit : null,
        result: r.output ? r.output.result : null,
        relay: (r.output && r.output.relay) || NO_RELAY,
        cost: r.cost,
        error: r.error,
        sandbox
      }
    } catch (err) {
      result = {
        id: newId('result'),
        createdAt: clock(),
        kind: 'result',
        taskId,
        proposalId,
        ok: false,
        error: err && err.message ? err.message : String(err),
        relay: NO_RELAY,
        sandbox
      }
    }
    artifactStore.write('results', result)
    return { taskId, resultId: result.id, sandbox }
  }

  return { run }
}

module.exports = { createWorkerRunner, defaultPrepareSandbox, NO_RELAY }
