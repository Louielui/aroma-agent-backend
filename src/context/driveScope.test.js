'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
let api = {}; try { api = require('./driveScope') } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }
function fixture () {
  const state = { users: [{ id: 'owner', role: 'owner', email: 'owner@example.com', suspended: false, grants: ['company-drive'] }],
    sources: [{ id: 'company-drive', kind: 'drive', state: 'registered', rootId: 'rootDrive', driveId: 'rootDrive', name: 'Company root' }], audit: [] }
  const env = { READ_ACCESS: 'on', CONTEXT_DRIVE: 'on' }; let revision = 'first'
  return { state, env, changeCredentials: () => { revision = 'second' }, create: () => api.createOwnerDriveScope({ registry: { snapshot: () => state }, env,
    credentials: () => ({ revision, client: true, token: true }) }) }
}
test('Owner source lease ignores mail read receipts but fails on grant, flag, credentials or root change', () => {
  const stable = fixture(), scope = stable.create(), lease = scope.lease()
  stable.state.audit.push({ action: 'mail_connected' }); stable.state.revision = 99
  assert.doesNotThrow(() => lease.verify()); assert.equal(lease.source.rootId, 'rootDrive')
  for (const mutate of [f => { f.state.users[0].grants = [] }, f => { f.env.CONTEXT_DRIVE = 'off' }, f => f.changeCredentials(),
    f => { f.state.sources[0].rootId = 'elsewhere' }, f => { f.state.users[0].suspended = true }]) {
    const f = fixture(), current = f.create().lease(); mutate(f); assert.throws(() => current.verify(), /source_access/)
  }
})
test('unregistered, non-shared-root and missing credentials do not produce a live lease', () => {
  for (const mutate of [f => { f.state.sources[0].state = 'not_connected' }, f => { f.state.sources[0].rootId = 'department' },
    f => { f.state.sources = [] }, f => { f.env.READ_ACCESS = 'off' }]) {
    const f = fixture(); mutate(f); assert.throws(() => f.create().lease(), /source_access/)
  }
})
