'use strict'
const { OWNER, stableId } = require('../../memory/governed')
const { ID } = require('./runStore')
const KINDS = Object.freeze({ decision: 'decision', preference: 'preference', todo: 'semantic' })
function createBriefingMemory ({ gateway, getRun, clock = () => new Date().toISOString() }) {
  const current = r => r.status === 'active' && r.approval?.kind === 'owner' && (!r.expiresAt || r.expiresAt > clock())
  async function recall () {
    const rows = (await gateway.list(OWNER, { status: 'active' })).filter(r => current(r) &&
      (r.type === 'decision' || r.type === 'preference' || (r.type === 'semantic' && r.details.category === 'todo' && r.details.taskState === 'open')))
    return rows.sort((a, b) => b.approval.at.localeCompare(a.approval.at) || a.id.localeCompare(b.id)).map(r => ({
      id: r.id, title: r.subject, content: r.text, originalDate: r.source.at, approvalBy: r.approval.actor,
      approvedAt: r.approval.at, memoryType: r.type === 'semantic' ? 'todo' : r.type, taskState: r.details.taskState || null
    }))
  }
  async function propose (actor, runId, input) {
    if (actor?.id !== 'owner' || actor?.role !== 'owner') throw Error('permission_denied')
    if (!ID.test(runId || '') || !input || Object.keys(input).some(k => !['requestId', 'kind', 'subject', 'text', 'supersedes', 'taskState'].includes(k)) ||
      !ID.test(input.requestId || '') || !Object.hasOwn(KINDS, input.kind) ||
      typeof input.subject !== 'string' || !input.subject.trim() || input.subject.length > 240 ||
      typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000) throw Error('invalid_request')
    if (input.taskState !== undefined && (input.kind !== 'todo' || !['open', 'completed'].includes(input.taskState))) throw Error('invalid_request')
    const run = getRun(runId)
    if (!run) throw Error('run_not_found')
    if (!run.finishedAt || ['queued', 'running'].includes(run.state)) throw Error('run_not_finished')
    const id = stableId('briefing-followup:' + runId + ':' + input.requestId)
    const previous = await gateway.get(actor, id)
    if (previous) {
      if (previous.subject !== input.subject.trim() || previous.text !== input.text.trim() || previous.details.category !== input.kind || previous.supersedes !== (input.supersedes || null) ||
        (input.kind === 'todo' && previous.details.taskState !== (input.taskState || 'open'))) throw Error('request_conflict')
      return previous
    }
    let old
    if (input.supersedes) {
      old = await gateway.get(actor, input.supersedes)
      if (!old || !current(old) || old.type !== KINDS[input.kind] || old.subject !== input.subject.trim() ||
        (input.kind === 'todo' && old.details.category !== 'todo')) throw Error('invalid_supersession')
    }
    return gateway.propose(actor, { id, type: KINDS[input.kind], scope: old?.scope || 'private:owner', subject: input.subject, text: input.text,
      source: { kind: 'briefing_owner', id: runId, at: clock(), attribution: 'owner_statement', url: 'http://127.0.0.1:8090/manager?run=' + runId },
      ...(input.supersedes ? { supersedes: input.supersedes } : {}),
      details: { category: input.kind, runId, runFinishedAt: run.finishedAt, runState: run.state, quote: input.text.trim(), reason: 'Explicit owner follow-up to this briefing.',
        ...(old ? { replaces: { id: old.id, text: old.text } } : {}),
        ...(input.kind === 'todo' ? { taskState: input.taskState || 'open' } : {}) } })
  }
  return { recall, propose }
}
module.exports = { createBriefingMemory }
