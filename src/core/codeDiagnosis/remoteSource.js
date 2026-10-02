'use strict'
const { localRequest } = require('../../adapters/CodexSubscriptionAdapter')
// The existing Owner bridge reads the fixed committed profile. The LocalService
// backend does not change Git trust settings, impersonate Owner or gain tools.
function createRemoteCodeSource ({ env = process.env, bootCommit, request = localRequest } = {}) {
  function verify (actor) {
    if (actor?.id !== 'owner' || actor.role !== 'owner') throw Error('permission_denied')
    if (env.READ_ACCESS !== 'on') throw Error('read_access_disabled')
  }
  async function read (actor, { signal } = {}) {
    verify(actor)
    if (!/^[a-f0-9]{40}$/.test(bootCommit || '')) throw Error('context_unavailable')
    const bounded = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])])
    try {
      const packet = await request('/code-diagnosis-source', { bootCommit }, env, bounded)
      if (packet?.evidence?.bootCommit !== bootCommit) throw Error('context_unavailable')
      return packet
    } catch (_) { throw Error('context_unavailable') }
  }
  return { verify, read }
}
module.exports = { createRemoteCodeSource }
