'use strict'
const { stableId } = require('../memory/governed')
// Operational checkpoints are source-bound and excluded from shared recall.
function createMailState ({ store, mailbox, kind, clock }) {
  const account = mailbox.status().mailbox
  const id = stableId('admin-mail:' + account + ':' + kind + ':checkpoint')
  let tail = Promise.resolve()
  const read = async () => (await store.get(id))?.details.state || {}
  function update (fn) {
    const next = tail.then(async () => {
      const old = await store.get(id); const at = clock()
      const state = fn(structuredClone(old?.details.state || {}))
      const row = { id, type: 'episodic', scope: 'domain:email', subject: 'Administrative mail ' + kind, text: 'Source-bound checkpoint',
        status: 'ignored', source: { kind: 'admin_mail_' + kind, id: 'checkpoint', at, attribution: 'external_claim' },
        confidence: null, owner: 'owner', createdAt: old?.createdAt || at, updatedAt: at, version: (old?.version || 0) + 1,
        supersedes: null, supersededBy: null, approval: null, decidedBy: null, decidedAt: null, expiresAt: null,
        details: { sourceId: 'admin-mail', mailbox: account, state },
        index: { state: 'source_only', attempts: 0, facts: null, reason: 'source_permission_required' } }
      await store.commit([{ expected: old?.version || 0, row }], { op: 'mail_' + kind + '_checkpoint', actor: 'owner', at })
      return state
    })
    tail = next.catch(() => {}); return next
  }
  return { read, update }
}
module.exports = { createMailState }
