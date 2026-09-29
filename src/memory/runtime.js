'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createGateway, OWNER, stableId } = require('./governed')
const { createStructuredStore } = require('./structuredStore')
const { createHindsight } = require('./hindsight')
const { resolveDataDir } = require('../store/dataDir')
const { exclusionReason } = require('./capturePolicy')
let singleton
function createRuntime({ store = createStructuredStore(), engine = createHindsight(), dir = path.join(resolveDataDir(), 'memory-outbox') } = {}) {
  const gateway = createGateway({ store, engine })
  let timer; let active = false; let lastError = null; let nextIndexAt = 0
  function enabled() {
    try { return JSON.parse(fs.readFileSync(path.join(dir, '../memory-capture/settings.json'), 'utf8')).enabled !== false }
    catch (e) { if (e.code === 'ENOENT') return true; throw Error('memory_setting_unavailable') }
  }
  function enqueue(input) {
    if (!enabled()) return { state: 'paused' }
    const excluded = exclusionReason(input.text) || exclusionReason(JSON.stringify(input.source), false)
    if (excluded) return { state: 'excluded', reason: excluded }
    fs.mkdirSync(dir, { recursive: true })
    const id = input.id || stableId(JSON.stringify([input.source, input.text]))
    const target = path.join(dir, id + '.json')
    if (!fs.existsSync(target)) {
      const temp = target + '.' + process.pid + '.tmp'
      const fd = fs.openSync(temp, 'w', 0o600)
      try { fs.writeFileSync(fd, JSON.stringify({ ...input, id })); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      fs.renameSync(temp, target)
    }
    return { id, state: 'queued' }
  }
  function event(kind, sourceId, content, attribution, at = new Date().toISOString(), details = {}) {
    return enqueue({ type: 'episodic', subject: kind + ' · ' + sourceId, text: content, scope: 'private:owner',
      source: { kind, id: sourceId, at, attribution }, details, policy: 'owner_history' })
  }
  function observeRead(source, result) {
    if (!result || !Array.isArray(result.results)) return { state: 'not_observed' }
    let count = 0
    for (const row of result.results) {
      if (!row || row.trust === 'unavailable' || typeof row.content !== 'string' || !row.content.trim()) continue
      const link = row.link && /^https?:\/\//.test(row.link) ? row.link : null
      const r = enqueue({ type: 'episodic', subject: String(row.title || source).slice(0, 240), text: row.content.slice(0, 30000), scope: 'private:owner',
        source: { kind: source, id: String(row.sourceId || row.id || stableId(row.content)), at: row.originalDate && Number.isFinite(Date.parse(row.originalDate)) ? row.originalDate : null,
          attribution: 'external_claim', ...(link ? { url: link } : {}) },
        details: { observedAt: result.asOf || null, domain: source === 'gmail' ? 'email' : source === 'github' || source === 'development_record' ? 'development' : 'operations',
          completeWithinScope: result.evidence?.completeWithinScope === true, truncated: row.truncated === true } })
      if (r.state === 'queued') count++
    }
    return { state: 'candidate_queue', count }
  }
  async function drain() {
    if (active || !enabled()) return
    active = true
    try {
      fs.mkdirSync(dir, { recursive: true })
      for (const f of fs.readdirSync(dir).filter(n => /^xx-[a-f0-9-]+\.json$/.test(n)).slice(0, 10)) {
        const file = path.join(dir, f); const input = JSON.parse(fs.readFileSync(file, 'utf8'))
        await gateway.observe(OWNER, input); fs.unlinkSync(file)
      }
      // Index at most one approved record per tick; failed/zero-fact records need explicit retry.
      const rows = await gateway.list(OWNER)
      for (const r of rows.filter(r => r.status === 'temporary' && r.expiresAt && r.expiresAt <= new Date().toISOString())) await gateway.transition(OWNER, r.id, r.version, 'archive')
      const pending = rows.slice().reverse().find(r => r.status === 'active' && r.index.state === 'pending' && r.text.length <= 32000)
      if (pending && Date.now() >= nextIndexAt) {
        const result = await gateway.index(OWNER, pending.id)
        nextIndexAt = Date.now() + (result.index.state === 'unconfirmed' ? 15 * 60000 : 10000)
      }
      lastError = null
    } catch (_) { lastError = 'memory_background_unavailable' }
    finally { active = false }
  }
  const ownerClient = {
    engine: 'memory_gateway',
    recall: query => gateway.recall(OWNER, query),
    get: async id => {
      const r = await gateway.get(OWNER, id)
      if (!r) return null
      return { id, text: r.text, facts: r.index.facts || 0, createdAt: r.createdAt, updatedAt: r.updatedAt }
    },
    list: async () => {
      const rows = await gateway.list(OWNER, { status: 'active' })
      return { items: rows.slice(-50).reverse().map(r => ({ id: r.id, text: r.text, facts: r.index.facts, createdAt: r.createdAt, updatedAt: r.updatedAt })), total: rows.length, limit: 50 }
    },
    retain: async (id, value) => {
      // Legacy manual editor creates an explicit proposal/approval with a new revision.
      const old = await gateway.get(OWNER, id)
      const row = await gateway.propose(OWNER, { type: old?.type || 'preference', subject: old?.subject || 'Owner memory ' + id, text: value, scope: old?.scope || 'private:owner',
        source: { kind: 'owner', id, at: new Date().toISOString(), attribution: 'owner_statement' }, ...(old ? { supersedes: id } : { id }) })
      await gateway.transition(OWNER, row.id, row.version, 'approve')
      return { id: row.id, text: row.text, state: 'approved', facts: null }
    },
    retainAutomatic: async (id, value, source) => {
      let row = await gateway.get(OWNER, id)
      if (!row) row = await gateway.observe(OWNER, { id, type: 'episodic', subject: source.kind + ' · ' + source.id, text: value, scope: 'private:owner', policy: 'owner_history',
        source: { kind: source.kind, id: source.id + ':' + (source.turn || ''), at: source.at, attribution: source.kind === 'briefing' ? 'measured_result' : 'historical_import' } })
      if (row.status !== 'active') throw Error('memory_not_active')
      row = await gateway.index(OWNER, row.id)
      return { id: row.id, text: row.text, facts: row.index.facts || 0 }
    },
    forget: async id => {
      const r = await gateway.get(OWNER, id)
      if (r && ['active', 'candidate', 'temporary'].includes(r.status)) await gateway.transition(OWNER, id, r.version, 'archive')
      if (r) await engine.forScope(r.scope).forget(id)
      return { id, state: 'deleted' }
    }
  }
  async function backup() { return store.backup() }
  return { gateway, ownerClient, event, observeRead, enqueue, drain,
    backup,
    status: () => ({ active, enabled: enabled(), error: lastError, nextIndexAt: nextIndexAt ? new Date(nextIndexAt).toISOString() : null, pending: fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.json')).length : 0 }),
    start() { if (!timer) { timer = setInterval(() => { void drain() }, 5000); timer.unref() } },
    stop() { clearInterval(timer); timer = null }
  }
}
function runtime() { return singleton || (singleton = createRuntime()) }
module.exports = { createRuntime, runtime }
