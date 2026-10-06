'use strict'
const path = require('node:path')
const { createRunStore, ID } = require('../core/operating/runStore')
const { resolveDataDir } = require('../store/dataDir')
function createReceipts ({ dir = path.join(resolveDataDir(), 'investigation-runs') } = {}) {
  const store = createRunStore({ dir, workflow: 'investigation' }), active = new Set()
  const clock = () => new Date().toISOString()
  function begin (id, conversationId) {
    if (!ID.test(id || '')) throw Error('invalid_run_id')
    if (store.get(id)) throw Error('investigation_already_exists')
    store.save({ id, workflow: 'investigation', conversationId, readOnly: true, state: 'planning', createdAt: clock(), updatedAt: clock(), steps: [], sections: [], events: [{ state: 'planning', at: clock() }] })
    active.add(id)
  }
  function record (id, event) {
    const r = store.get(id); if (!r || !active.has(id)) return
    if (!['planning', 'reading', 'source_complete', 'evaluating'].includes(event.state)) return
    r.state = event.state; r.updatedAt = clock()
    r.events.push({ state: event.state, section: event.section || null, sourceState: event.sourceState || null, at: r.updatedAt }); r.events = r.events.slice(-40)
    if (event.investigation) r.investigation = structuredClone(event.investigation)
    store.save(r)
  }
  function finish (id, result, failed = false) {
    const r = store.get(id); if (!r || !active.has(id)) return
    r.state = failed ? 'failed' : 'completed'; r.updatedAt = clock(); r.reply = typeof result?.reply === 'string' ? result.reply : null
    if (result?.investigation) r.investigation = structuredClone(result.investigation)
    r.events.push({ state: r.state, at: r.updatedAt }); store.save(r); active.delete(id)
  }
  function get (id) {
    const r = store.get(id)
    if (r && !['completed', 'failed'].includes(r.state) && !active.has(id)) return { ...r, state: 'interrupted' }
    return r
  }
  return { begin, record, finish, get }
}
module.exports = { createReceipts }
