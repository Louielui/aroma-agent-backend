'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { resolveDataDir } = require('../store/dataDir')
const SEED = require('./seed.json')
const clone = value => JSON.parse(JSON.stringify(value))
const fail = () => { throw Error('access_denied') }
function initial () { return clone(SEED) }
function createRegistry ({ file = path.join(resolveDataDir(), 'company-access.json'), clock = () => new Date().toISOString(), rename = fs.renameSync } = {}) {
  let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : initial()
  if (state.version !== 1 || !Array.isArray(state.users) || !Array.isArray(state.sources) || !Array.isArray(state.audit)) throw Error('access_store_invalid')
  function update (actor, action, target, fn) {
    const next = clone(state); fn(next); next.revision++
    next.audit.push({ id: randomUUID(), at: clock(), actor, action, target, revision: next.revision })
    next.audit = next.audit.slice(-500)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temp = file + '.' + randomUUID() + '.tmp'
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 })
    try {
      for (let attempt = 0; ; attempt++) {
        try { rename(temp, file); break } catch (e) {
          if (attempt >= 19 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
        }
      }
    } catch (e) { try { fs.unlinkSync(temp) } catch (_) {} ; throw e }
    state = next
  }
  function identity (sub) { return state.users.find(u => typeof sub === 'string' && sub && u.sub === sub && !u.suspended) }
  function bind (claims) {
    if (!claims || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 ||
        claims.email_verified !== true || claims.hd !== SEED.tenantDomain || typeof claims.email !== 'string') fail()
    const email = claims.email.toLowerCase()
    const user = state.users.find(u => u.email === email)
    if (!user || user.suspended || (user.sub && user.sub !== claims.sub) || state.users.some(u => u.id !== user.id && u.sub === claims.sub)) fail()
    ensureMailboxRegistered()
    update(user.id, 'verified_login', user.id, s => {
      const u = s.users.find(u => u.id === user.id); u.sub = claims.sub; u.lastLoginAt = clock()
    })
    return user.id
  }
  function allowed (sub, sourceId) {
    const user = identity(sub); const source = state.sources.find(s => s.id === sourceId)
    return !!(user && source && source.kind === 'drive' && source.state === 'registered' && user.grants.includes(sourceId))
  }
  function setGrant (userId, sourceId, enabled) {
    ensureMailboxRegistered()
    const user = state.users.find(u => u.id === userId); const source = state.sources.find(s => s.id === sourceId)
    if (!user || user.role === 'owner' || !source || source.department !== user.role ||
        !(source.kind === 'drive' || (source.id === 'admin-mail' && source.mailbox)) || typeof enabled !== 'boolean') fail()
    update('owner', enabled ? 'grant' : 'revoke', userId + '/' + sourceId, s => {
      const u = s.users.find(u => u.id === userId)
      u.grants = u.grants.filter(id => id !== sourceId); if (enabled) u.grants.push(sourceId)
    })
  }
  function suspend (userId, suspended) {
    if (typeof suspended !== 'boolean' || !state.users.some(u => u.id === userId && u.role !== 'owner')) fail()
    update('owner', suspended ? 'suspend' : 'resume', userId, s => { s.users.find(u => u.id === userId).suspended = suspended })
  }
  function recordProbe (sourceId, connected) {
    if (!state.sources.some(s => s.id === sourceId && s.kind === 'drive')) fail()
    update('owner', 'source_probe', sourceId, s => {
      s.sources.find(s => s.id === sourceId).ownerProbe = { state: connected ? 'connected' : 'failed', at: clock() }
    })
  }
  // One-time migration records the Owner's mailbox instruction without resetting
  // existing subjects, Drive revocations, suspension or subsequent mail revocations.
  function ensureMailboxRegistered () {
    if (state.adminMailboxRegistered) return
    update('owner', 'register_mailbox', 'admin-mail', s => {
      s.sources.find(s => s.id === 'admin-mail').mailbox = SEED.sources.find(s => s.id === 'admin-mail').mailbox
      for (const u of s.users.filter(u => ['owner', 'ivy'].includes(u.id))) {
        if (!u.grants.includes('admin-mail')) u.grants.push('admin-mail')
      }
      s.adminMailboxRegistered = true
    })
  }
  function recordMailState (status, actor = 'owner') {
    if (!['connected', 'failed', 'not_connected'].includes(status)) fail()
    ensureMailboxRegistered()
    update(actor, 'mail_' + status, 'admin-mail', s => {
      const mail = s.sources.find(s => s.id === 'admin-mail')
      mail.state = status; mail.checkedAt = clock()
    })
  }
  return { bind, allowed, setGrant, suspend, recordProbe, recordMailState, revision: () => state.revision,
    // Read receipts are audit changes, not authorization changes. Concurrent
    // successful reads must not invalidate each other's source leases.
    mailRevision: () => JSON.stringify([state.users.map(u => [u.id, u.sub, u.suspended, u.grants]),
      state.sources.filter(s => s.id === 'admin-mail').map(s => [s.mailbox, s.state === 'not_connected'])]),
    mailAllowed: sub => { ensureMailboxRegistered(); const u = identity(sub); return !!(u && u.grants.includes('admin-mail') && state.sources.find(s => s.id === 'admin-mail')?.mailbox) },
    identity: sub => { const u = identity(sub); return u ? { id: u.id, name: u.name, role: u.role } : null },
    source: id => { ensureMailboxRegistered(); return clone(state.sources.find(s => s.id === id) || null) },
    snapshot: ({ readOnly = false } = {}) => { if (!readOnly) ensureMailboxRegistered(); return { ...clone(state), users: state.users.map(({ sub, ...u }) => ({ ...clone(u), verified: !!sub })) } }
  }
}
function createGateway ({ registry, getFile, listFiles }) {
  const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id)
  async function read (session, sourceId, fileId) {
    if (!session || !validId(fileId) || !registry.allowed(session.sub, sourceId)) fail()
    const revision = registry.revision(); const source = registry.source(sourceId)
    let current = fileId; let original; const seen = new Set()
    for (let depth = 0; depth < 40; depth++) {
      if (seen.has(current) || !validId(current)) fail()
      seen.add(current)
      const file = await getFile(session, current)
      if (!file || file.id !== current || file.trashed || file.mimeType === 'application/vnd.google-apps.shortcut' || file.driveId !== source.driveId) fail()
      if (!original) original = file
      if (current === source.rootId) {
        if (!registry.allowed(session.sub, sourceId) || registry.revision() !== revision) fail()
        return { id: original.id, name: original.name || null, mimeType: original.mimeType || null,
          modifiedTime: original.modifiedTime || null, sourceId, url: 'https://drive.google.com/file/d/' + original.id + '/view' }
      }
      if (!Array.isArray(file.parents) || file.parents.length !== 1) fail()
      current = file.parents[0]
    }
    fail()
  }
  async function list (session, sourceId, folderId) {
    const revision = registry.revision()
    const parent = await read(session, sourceId, folderId)
    if (parent.mimeType !== 'application/vnd.google-apps.folder') fail()
    const page = await listFiles(session, folderId, registry.source(sourceId).driveId)
    const files = []
    for (const item of page.files || []) {
      if (item.mimeType === 'application/vnd.google-apps.shortcut') continue
      files.push(await read(session, sourceId, item.id))
    }
    if (registry.revision() !== revision || !registry.allowed(session.sub, sourceId)) fail()
    return { files, truncated: !!page.nextPageToken || !!page.incompleteSearch, shortcutsExcluded: true }
  }
  async function referencesAllowed (session, refs) {
    if (!Array.isArray(refs) || !refs.length || refs.length > 30) return false
    const revision = registry.revision()
    try { for (const r of refs) await read(session, r.sourceId, r.fileId) } catch (_) { return false }
    return revision === registry.revision()
  }
  return { read, list, referencesAllowed }
}
module.exports = { createRegistry, createGateway }
