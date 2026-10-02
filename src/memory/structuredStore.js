'use strict'
const path = require('node:path')
const { spawn } = require('node:child_process')
const { isTestProcess } = require('../testProcess')
function readUtf8(stream, append) {
  // A multibyte character may cross child-process pipe chunks.
  stream.setEncoding('utf8'); stream.on('data', append)
}
function createStructuredStore({ invoke, local = false, env = process.env } = {}) {
  const runLocal = request => new Promise((resolve, reject) => {
    if (isTestProcess()) return reject(Error('memory_database_test_fence'))
    const backup = request.op === 'backup'
    const slow = backup || request.op === 'queue_index'
    const args = backup
      ? ['-B', '-X', 'utf8', path.join(__dirname, '../../scripts/memory/backupStructured.py'), 'backup-and-verify', path.join('C:/Aroma/hindsight-runtime/backups', 'memory-' + require('node:crypto').randomUUID() + '.json')]
      : ['-B', '-X', 'utf8', path.join(__dirname, '../../scripts/memory/structured.py')]
    const child = spawn('C:/Aroma/hindsight-runtime/Scripts/python.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let raw = ''; let failed = false
    const timeout = setTimeout(() => { failed = true; child.kill(); reject(Error('memory_database_unavailable')) }, slow ? 60000 : 15000)
    readUtf8(child.stdout, chunk => { raw += chunk; if (raw.length > 64000000) { failed = true; child.kill() } })
    child.stderr.resume()
    child.on('error', () => { clearTimeout(timeout); reject(Error('memory_database_unavailable')) })
    child.on('close', code => {
      clearTimeout(timeout)
      if (failed || code) return reject(Error('memory_database_unavailable'))
      try { const value = JSON.parse(raw); if (value.error) reject(Error(value.error)); else resolve(Object.hasOwn(value, 'result') ? value.result : value) } catch (_) { reject(Error('memory_database_unavailable')) }
    })
    child.stdin.end(JSON.stringify(request))
  })
  const remote = async request => {
    if (!/^[a-f0-9]{64}$/.test(env.CODEX_CHAT_BRIDGE_TOKEN || '')) throw Error('memory_database_unavailable')
    const res = await require('../adapters/liveEgressFence').fencedFetch('memory_gateway')('http://127.0.0.1:8091/memory-store', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(['backup', 'queue_index'].includes(request.op) ? 65000 : 20000),
      headers: { authorization: 'Bearer ' + env.CODEX_CHAT_BRIDGE_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(request) })
    if (!res.ok) throw Error('memory_database_unavailable')
    const value = await res.json()
    if (value.error) throw Error(['revision_conflict', 'decision_conflict'].includes(value.error) ? value.error : 'memory_database_unavailable')
    return value.result
  }
  const run = invoke || (local ? runLocal : remote)
  return {
    request: run, backup: () => run({ op: 'backup' }),
    queueIndex: request => run({ ...request, op: 'queue_index' }),
    get: id => run({ op: 'get', id }),
    generalRows: async () => {
      const fail = () => { throw Error('memory_database_unavailable') }
      const rows = []; let after = 0; let snapshotSequence = null
      for (;;) {
        const page = await run({ op: 'general_page', after, snapshotSequence })
        if (!page || !Array.isArray(page.items) || page.items.length > 2000 || typeof page.hasMore !== 'boolean' ||
          !Number.isSafeInteger(page.snapshotSequence) || page.snapshotSequence < after ||
          (snapshotSequence !== null && page.snapshotSequence !== snapshotSequence) ||
          !Number.isSafeInteger(page.nextSequence) || page.nextSequence < after || page.nextSequence > page.snapshotSequence ||
          (page.items.length && page.nextSequence <= after) ||
          (page.hasMore && (!page.items.length || page.nextSequence <= after)) ||
          page.items.some(row => typeof row?.source?.kind !== 'string' || row.source.kind.startsWith('admin_mail_'))) fail()
        rows.push(...page.items)
        if (!page.hasMore) return rows
        after = page.nextSequence; snapshotSequence = page.snapshotSequence
      }
    },
    mailRows: async (mailbox, kinds = ['admin_mail_message', 'admin_mail_thread']) => {
      const fail = () => { throw Error('memory_database_unavailable') }
      if (typeof mailbox !== 'string' || mailbox.length > 254 || !/^[a-z0-9.!#$%&'*+_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(mailbox) ||
        !Array.isArray(kinds) || !kinds.length || new Set(kinds).size !== kinds.length ||
        kinds.some(k => !['admin_mail_message', 'admin_mail_thread'].includes(k))) fail()
      const rows = []; let after = 0; let snapshotSequence = null
      for (;;) {
        const page = await run({ op: 'mail_page', mailbox, kinds, after, snapshotSequence })
        if (!page || !Array.isArray(page.items) || page.items.length > 2000 || typeof page.hasMore !== 'boolean' ||
          !Number.isSafeInteger(page.snapshotSequence) || page.snapshotSequence < after ||
          (snapshotSequence !== null && page.snapshotSequence !== snapshotSequence) ||
          !Number.isSafeInteger(page.nextSequence) || page.nextSequence < after || page.nextSequence > page.snapshotSequence ||
          (page.items.length && page.nextSequence <= after) ||
          (page.hasMore && (!page.items.length || page.nextSequence <= after)) ||
          page.items.some(row => row?.details?.mailbox !== mailbox || !kinds.includes(row?.source?.kind))) fail()
        rows.push(...page.items)
        if (!page.hasMore) return rows
        after = page.nextSequence; snapshotSequence = page.snapshotSequence
      }
    },
    all: async () => {
      const rows = []
      for (let offset = 0; ; offset += 200) {
        const page = await run({ op: 'all', offset })
        rows.push(...page)
        if (page.length < 200) return rows
      }
    },
    commit: (changes, event) => run({ op: 'commit', changes, event }),
    audit: id => run({ op: 'audit', id }),
    grants: () => run({ op: 'grants' }),
    grant: value => run({ op: 'grant', value }),
    health: () => run({ op: 'health' })
  }
}
// Injected only by tests. Runtime has no file or in-memory fallback for canonical data.
function createTestStore() {
  const rows = new Map(); const events = []; const grants = new Map()
  const store = {
    get: async id => structuredClone(rows.get(id) || null), all: async () => structuredClone([...rows.values()]),
    commit: async (changes, event) => {
      for (const c of changes) if ((rows.get(c.row.id)?.version || 0) !== c.expected) throw Error('revision_conflict')
      const next = new Map(rows)
      for (const c of changes) next.set(c.row.id, structuredClone(c.row))
      const active = [...next.values()].filter(r => r.status === 'active' && ['decision','preference'].includes(r.type))
      if (new Set(active.map(r => JSON.stringify([r.type,r.scope,r.subject]))).size !== active.length) throw Error('decision_conflict')
      for (const c of changes) { rows.set(c.row.id, structuredClone(c.row)); events.push({ ...event, recordId: c.row.id, version: c.row.version, sequence: events.length + 1 }) }
      return changes.map(c => structuredClone(c.row))
    },
    audit: async id => structuredClone(events.filter(e => e.recordId === id)),
    grants: async () => structuredClone([...grants.values()]),
    grant: async g => { grants.set(g.id, structuredClone(g)); return g },
    health: async () => ({ state: 'connected', database: 'test', vector: true })
  }
  const queueIndex = async ({ id, at, scope }) => {
    let queued = 0, sourceOnly = 0
    const changes = [...rows.values()].filter(r => r.status === 'active' && (!r.expiresAt || r.expiresAt > at) &&
      !r.source?.kind?.startsWith('admin_mail_') && (!scope || r.scope === scope)).map(previous => {
      const row = structuredClone(previous), reason = require('./indexPolicy').sourceOnlyReason(row.text)
      row.index = { state: reason ? 'source_only' : 'pending', attempts: 0, facts: null, reason: reason || null,
        checkedAt: reason ? at : null, nextRetryAt: null, rebuildId: id, queuedAt: at }
      row.version++; row.updatedAt = at
      if (reason) sourceOnly++; else queued++
      return { expected: previous.version, row }
    })
    await store.commit(changes, { op: 'index_rebuild_queued', actor: 'owner', at, rebuildId: id })
    return { id, queued, sourceOnly, scope }
  }
  store.queueIndex = queueIndex
  return store
}
module.exports = { createStructuredStore, createTestStore, readUtf8 }
