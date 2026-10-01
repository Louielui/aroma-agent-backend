'use strict'
const { readAccessEnabled } = require('./flags')
const ID = /^[A-Za-z0-9_-]{1,200}$/
const copy = value => JSON.parse(JSON.stringify(value))
function createOwnerDriveScope ({ registry, env = process.env, credentials = require('./googleAuth').credentialConfiguration }) {
  function projection () {
    const state = registry.snapshot({ readOnly: true }), owner = state.users.find(u => u.id === 'owner' && u.role === 'owner')
    const source = state.sources.find(s => s.id === 'company-drive')
    return { owner: owner ? { email: owner.email, suspended: owner.suspended, granted: owner.grants?.includes('company-drive') === true } : null,
      source: source ? { id: source.id, name: source.name, kind: source.kind, state: source.state, rootId: source.rootId, driveId: source.driveId } : null,
      enabled: readAccessEnabled(env, 'drive'), credentials: credentials() }
  }
  function valid (p) {
    return p.enabled && p.credentials?.client && p.credentials.token && typeof p.credentials.revision === 'string' &&
      p.owner?.granted && !p.owner.suspended && typeof p.owner.email === 'string' && p.owner.email.includes('@') &&
      p.source?.kind === 'drive' && p.source.state === 'registered' && ID.test(p.source.rootId || '') &&
      p.source.rootId === p.source.driveId
  }
  return Object.freeze({ source: () => copy(projection().source), lease () {
    const p = projection(); if (!valid(p)) throw Error('source_access_unavailable')
    const revision = JSON.stringify(p)
    return { source: copy(p.source), ownerEmail: p.owner.email.toLowerCase(), verify () {
      const current = projection()
      if (!valid(current) || JSON.stringify(current) !== revision) throw Error('source_access_changed')
    } }
  } })
}
module.exports = { createOwnerDriveScope, ID }
