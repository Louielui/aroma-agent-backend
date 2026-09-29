'use strict'
const { randomUUID, createHash, randomBytes, timingSafeEqual } = require('node:crypto')
const { exclusionReason } = require('./capturePolicy')
const { ID } = require('./hindsight')
const OWNER = Object.freeze({ id: 'owner', role: 'owner' })
const TYPES = Object.freeze(['working', 'episodic', 'semantic', 'decision', 'procedural', 'preference'])
const SCOPES = Object.freeze(['global:aroma', 'company:st-marys', 'company:the-forks', 'company:central-kitchen',
  'domain:development', 'domain:accounting', 'domain:purchasing', 'domain:operations', 'domain:production', 'domain:hr', 'domain:email', 'domain:management',
  'agent:email', 'agent:qa', 'agent:coding', 'agent:purchasing', 'agent:accounting', 'agent:review', 'private:owner'])
const STATUSES = Object.freeze(['temporary', 'candidate', 'active', 'superseded', 'archived', 'rejected', 'ignored'])
const hash = s => createHash('sha256').update(s).digest('hex')
// Index bookkeeping changes the row version, not the evidence or its authority.
const evidenceHash = r => hash(JSON.stringify([r.id, r.type, r.scope, r.subject, r.text, r.expiresAt,
  r.source.kind, r.source.id, r.source.at, r.source.attribution, r.source.url, r.source.version,
  r.approval?.kind, r.approval?.id, r.approval?.actor, r.approval?.at]))
const matchesEvidence = (r, e) => e.contentHash ? evidenceHash(r) === e.contentHash : r.version === e.version
const stableId = value => { const h = hash(value); return 'xx-' + h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-8' + h.slice(17, 20) + '-' + h.slice(20, 32) }
const owner = actor => { if (actor?.id !== 'owner' || actor?.role !== 'owner') throw Error('permission_denied') }
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
function createGateway({ store, engine, clock = () => new Date().toISOString() }) {
  const indexing = new Map()
  async function scopes(actor, write = false) {
    if (actor?.id === 'owner' && actor?.role === 'owner') return SCOPES
    if (actor?.role !== 'agent') throw Error('permission_denied')
    const grant = (await store.grants()).find(g => g.id === actor.id && !g.revoked)
    if (!grant) throw Error('permission_denied')
    return write ? grant.writeScopes : grant.scopes
  }
  async function authorize(actor, scope, write = false) {
    if (!SCOPES.includes(scope) || !(await scopes(actor, write)).includes(scope)) throw Error('permission_denied')
  }
  async function get(actor, id) {
    if (!ID.test(id || '')) throw Error('invalid_memory_id')
    const row = await store.get(id)
    if (row) await authorize(actor, row.scope)
    return row
  }
  const current = row => row.status === 'active' && (!row.expiresAt || row.expiresAt > clock())
  async function list(actor, filter = {}) {
    const allowed = await scopes(actor)
    if (filter.scope) await authorize(actor, filter.scope)
    return (await store.all()).filter(r => allowed.includes(r.scope) && (!filter.scope || r.scope === filter.scope) &&
      (!filter.type || r.type === filter.type) && (!filter.status || r.status === filter.status))
  }
  function validate(input) {
    if (!input || Object.keys(input).some(k => !['id', 'type', 'subject', 'text', 'scope', 'source', 'confidence', 'supersedes', 'details', 'policy', 'expiresAt'].includes(k)) ||
        !TYPES.includes(input.type) || !text(input.subject, 240) || !text(input.text, 100000) || !SCOPES.includes(input.scope)) throw Error('invalid_memory_request')
    const s = input.source
    if (!s || !text(s.kind, 80) || !text(s.id, 300) || !['owner_statement', 'assistant_claim', 'measured_result', 'external_claim', 'derived', 'historical_import'].includes(s.attribution) ||
        (s.at !== null && (typeof s.at !== 'string' || !Number.isFinite(Date.parse(s.at)))) || Object.keys(s).some(k => !['kind', 'id', 'at', 'attribution', 'url', 'version', 'evidence'].includes(k))) throw Error('invalid_provenance')
    if (s.url) { let u; try { u = new URL(s.url) } catch (_) { throw Error('invalid_provenance') } if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw Error('invalid_provenance') }
    if (s.version !== undefined && !text(s.version, 300)) throw Error('invalid_provenance')
    if (input.confidence != null && (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) throw Error('invalid_confidence')
    if (input.supersedes && !ID.test(input.supersedes)) throw Error('invalid_memory_id')
    if (input.id && !ID.test(input.id)) throw Error('invalid_memory_id')
    if (input.expiresAt && (!Number.isFinite(Date.parse(input.expiresAt)) || input.expiresAt <= clock())) throw Error('invalid_expiry')
    if (input.type === 'working' && (!input.expiresAt || Date.parse(input.expiresAt) - Date.parse(clock()) > 86400000)) throw Error('invalid_expiry')
    if (JSON.stringify(input.details || {}).length > 30000 || JSON.stringify(s).length > 30000) throw Error('invalid_memory_request')
    if (input.type === 'procedural' && (!s.url || !s.version)) throw Error('sop_link_and_version_required')
  }
  async function create(actor, input, observation) {
    validate(input); await authorize(actor, input.scope, true)
    if (input.policy && (input.policy !== 'owner_history' || input.scope !== 'private:owner' || input.type !== 'episodic' ||
        !['conversation', 'briefing', 'worker', 'historical_import'].includes(input.source.kind))) throw Error('invalid_capture_policy')
    if (input.policy) owner(actor)
    const excluded = exclusionReason(input.text) || exclusionReason(input.subject + JSON.stringify(input.source) + JSON.stringify(input.details || {}), false)
    const id = input.id || (observation ? stableId(JSON.stringify([input.scope, input.type, input.source, input.text])) : 'xx-' + randomUUID())
    const previous = await store.get(id)
    if (previous) { await authorize(actor, previous.scope); if (previous.scope !== input.scope || previous.type !== input.type || (previous.text && previous.text !== input.text.trim())) throw Error('revision_conflict'); return previous }
    const now = clock()
    const row = { id, type: input.type, subject: excluded ? 'Excluded memory' : input.subject.trim(), text: excluded ? '' : input.text.trim(), scope: input.scope,
      status: excluded ? 'ignored' : input.type === 'working' ? 'temporary' : input.policy === 'owner_history' ? 'active' : 'candidate',
      source: excluded ? { kind: 'excluded', id: hash(input.source.id), at: input.source.at, attribution: input.source.attribution } : input.source,
      confidence: input.confidence ?? null, owner: actor.id, createdAt: now, updatedAt: now, version: 1,
      supersedes: input.supersedes || null, supersededBy: null, approval: input.policy ? { kind: 'policy', id: input.policy, actor: actor.id, at: now } : null,
      decidedBy: null, decidedAt: null, expiresAt: input.expiresAt || null, details: excluded ? {} : input.details || {},
      index: { state: 'pending', attempts: 0, facts: null }, reason: excluded || null }
    await store.commit([{ expected: 0, row }], { op: 'observe', actor: actor.id, at: now, reason: row.reason })
    return row
  }
  async function transition(actor, id, expected, action) {
    owner(actor); const r = await get(actor, id)
    if (!r || r.version !== expected) throw Error('revision_conflict')
    if (!['approve', 'reject', 'archive'].includes(action)) throw Error('invalid_transition')
    if (action === 'approve' && r.status !== 'candidate') throw Error('invalid_transition')
    if (action === 'reject' && r.status !== 'candidate') throw Error('invalid_transition')
    if (action === 'archive' && !['active', 'temporary', 'candidate'].includes(r.status)) throw Error('invalid_transition')
    const now = clock(); const changes = []
    if (action === 'approve') {
      if (r.details.evidenceVersions) for (const e of r.details.evidenceVersions) {
        const evidence = await get(actor, e.id)
        if (!evidence || !current(evidence) || !matchesEvidence(evidence, e)) throw Error('stale_evidence')
      }
      if (r.supersedes) {
        const old = await get(actor, r.supersedes)
        if (!old || !current(old) || old.type !== r.type || old.scope !== r.scope || old.subject !== r.subject) throw Error('invalid_supersession')
        changes.push({ expected: old.version, row: { ...old, status: 'superseded', supersededBy: r.id, version: old.version + 1, updatedAt: now } })
      }
      r.approval = { kind: 'owner', actor: actor.id, at: now, approvedVersion: expected, contentHash: hash(r.text) }
      if (r.type === 'decision') { r.decidedBy = actor.id; r.decidedAt = now }
    }
    r.status = action === 'approve' ? 'active' : action === 'reject' ? 'rejected' : 'archived'
    r.version++; r.updatedAt = now
    changes.push({ expected, row: r })
    await store.commit(changes, { op: action, actor: actor.id, at: now })
    return r
  }
  async function getDecision(actor, subject, scope) {
    const rows = (await list(actor, { type: 'decision', scope })).filter(r => current(r) && r.subject === subject)
    if (rows.length > 1) throw Error('decision_conflict')
    return rows[0] || null
  }
  async function recall(actor, query, options = {}) {
    if (!text(query, 2000) || exclusionReason(query, false)) throw Error('invalid_query')
    const records = (await list(actor, options)).filter(current)
    const terms = query.toLowerCase().match(/[a-z0-9_-]{2,}|[\u3400-\u9fff]{1,}/g) || []
    const words = [...new Set(terms.flatMap(term => /^[\u3400-\u9fff]{3,}$/.test(term) ? [term, ...Array.from({ length: term.length - 1 }, (_, i) => term.slice(i, i + 2))] : [term]))]
    const score = r => words.reduce((n, w) => n + ((r.subject + ' ' + r.text).toLowerCase().includes(w) ? 1 : 0), 0)
    const ranked = new Map(records.filter(r => score(r) > 0).map(r => [r.id, { row: r, rank: score(r), via: 'source' }]))
    const selectedScopes = [...new Set(records.map(r => r.scope))]
    // Engine sees only authorized scopes. Results are checked against canonical state again.
    let semanticFailures = 0
    if (engine) await Promise.all(selectedScopes.map(async scope => {
      try {
        const rows = await engine.forScope(scope).recall(query)
        for (const hit of rows) { const row = records.find(r => r.id === hit.documentId && r.scope === scope); if (row) ranked.set(row.id, { row, rank: score(row) + 1, via: 'semantic' }) }
      } catch (_) { semanticFailures++ }
    }))
    const refreshed = new Map((await list(actor, options)).filter(current).map(r => [r.id, r]))
    const safe = [...ranked.values()].filter(hit => refreshed.has(hit.row.id)).map(hit => ({ ...hit, row: refreshed.get(hit.row.id) }))
    const result = safe.sort((a, b) => Number(b.row.type === 'decision') - Number(a.row.type === 'decision') || b.rank - a.rank)
      .slice(0, 12).map(({ row, via }) => ({ id: row.id, documentId: row.id, text: row.text.slice(0, 4000), date: row.source.at,
        source: 'memory_gateway', type: row.type, scope: row.scope, status: row.status, provenance: row.source, approval: row.approval, via }))
    result.retrieval = { source: 'ok', semantic: !engine ? 'not_connected' : semanticFailures ? 'partial' : 'ok' }
    return result
  }
  async function runIndex(actor, id) {
    owner(actor); const row = await get(actor, id)
    if (!row || !current(row) || !engine) throw Error('not_indexable')
    const expected = row.version; let result
    const attempts = row.index.attempts + 1
    try {
      const client = engine.forScope(row.scope)
      // A previous timeout may have completed upstream. Reconcile before any write.
      let d = client.get ? await client.get(row.id) : null
      if (!d || d.text !== row.text) d = await (client.retainAutomatic ? client.retainAutomatic(row.id, row.text, row.source) : client.retain(row.id, row.text))
      if (!Number.isInteger(d?.facts) || d.facts < 0) throw Error('memory_unconfirmed')
      result = { state: d.facts > 0 ? 'saved' : 'raw_only', facts: d.facts, attempts,
        reason: d.facts > 0 ? null : 'no_extracted_facts', checkedAt: clock(), nextRetryAt: null }
    } catch (e) {
      const reason = ['memory_timeout', 'memory_rate_limited', 'memory_unauthorized', 'memory_invalid_request', 'memory_invalid_text', 'memory_invalid_result', 'memory_unconfirmed'].includes(e.message) ? e.message : 'memory_unavailable'
      const retryable = ['memory_timeout', 'memory_rate_limited', 'memory_unavailable', 'memory_unconfirmed'].includes(reason)
      const delay = reason === 'memory_rate_limited' ? 15 * 60000 : reason === 'memory_timeout' ? 5 * 60000 : 30000 * 2 ** Math.min(attempts - 1, 4)
      result = { state: 'unconfirmed', facts: null, attempts, reason, checkedAt: clock(),
        nextRetryAt: retryable && attempts < 3 ? new Date(Date.parse(clock()) + delay).toISOString() : null }
    }
    // Never replace a newer approval, archive or supersession when an index call finishes late.
    const latest = await get(actor, id)
    if (latest.version !== expected) return latest
    latest.index = result; latest.version++; latest.updatedAt = clock()
    await store.commit([{ expected, row: latest }], { op: 'index', actor: actor.id, at: clock() })
    return latest
  }
  async function index(actor, id) {
    owner(actor)
    if (indexing.has(id)) return indexing.get(id)
    const job = runIndex(actor, id).finally(() => indexing.delete(id))
    indexing.set(id, job)
    return job
  }
  async function working(actor, input) {
    const { subject, goal, project, worker, runId, context, ttlSeconds, scope } = input
    if (!text(goal, 2000) || !text(runId, 300) || !Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86400) throw Error('invalid_working_context')
    return create(actor, { type: 'working', subject, text: goal, scope, expiresAt: new Date(Date.parse(clock()) + ttlSeconds * 1000).toISOString(),
      source: { kind: 'run', id: runId, at: clock(), attribution: 'measured_result' }, details: { goal, project: project || null, worker: worker || null, runId, context: context || [] } }, true)
  }
  async function finishWork(actor, id, expected, outcome) {
    const r = await get(actor, id)
    if (!r || r.type !== 'working' || !['completed', 'failed', 'cancelled', 'interrupted'].includes(outcome)) throw Error('invalid_working_context')
    await authorize(actor, r.scope, true)
    if (r.version !== expected) throw Error('revision_conflict')
    r.status = 'archived'; r.details.outcome = outcome; r.version++; r.updatedAt = clock()
    await store.commit([{ expected, row: r }], { op: 'finish_work', actor: actor.id, at: clock() })
    return r
  }
  async function grant(actor, input) {
    owner(actor)
    if (!/^[a-z][a-z0-9-]{1,60}$/.test(input.id) || input.id === 'owner' || !Array.isArray(input.scopes) || !Array.isArray(input.writeScopes) ||
        [...input.scopes, ...input.writeScopes].some(s => !SCOPES.includes(s) || s === 'private:owner') ||
        input.writeScopes.some(s => !input.scopes.includes(s))) throw Error('invalid_grant')
    const token = randomBytes(32).toString('hex')
    const g = { id: input.id, scopes: [...new Set(input.scopes)], writeScopes: [...new Set(input.writeScopes)], revoked: input.revoked === true, tokenHash: hash(token), updatedAt: clock() }
    await store.grant(g)
    return { ...g, tokenHash: undefined, token }
  }
  async function authenticate(token) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) throw Error('permission_denied')
    const digest = Buffer.from(hash(token))
    const g = (await store.grants()).find(g => !g.revoked && typeof g.tokenHash === 'string' && g.tokenHash.length === 64 && timingSafeEqual(digest, Buffer.from(g.tokenHash)))
    if (!g) throw Error('permission_denied')
    return { id: g.id, role: 'agent' }
  }
  async function reflect(actor, { query, scope, subject, evidenceIds, modelId }) {
    owner(actor); await authorize(actor, scope)
    if (!engine || !text(query, 2000) || !text(subject, 240) || !Array.isArray(evidenceIds) || !evidenceIds.length || evidenceIds.length > 30) throw Error('invalid_reflection')
    const evidence = []
    for (const id of evidenceIds) { const r = await get(actor, id); if (!r || !current(r) || r.scope !== scope) throw Error('invalid_evidence'); evidence.push(r) }
    // Explicit documents constrain reflection; derived content remains a candidate.
    const result = await engine.forScope(scope).reflect(query, evidence.map(r => ({ id: r.id, text: r.text, source: r.source })))
    if (!result || !text(result.text, 30000)) throw Error('reflection_unavailable')
    return create(actor, { type: 'semantic', subject, text: result.text, scope,
      source: { kind: 'reflection', id: randomUUID(), at: clock(), attribution: 'derived', evidence: evidence.map(r => r.id) },
      details: { query, mentalModel: true, evidenceVersions: evidence.map(r => ({ id: r.id, version: r.version, contentHash: evidenceHash(r) })), engine: 'hindsight', modelId: modelId || null },
      ...(modelId ? { supersedes: modelId } : {}) }, false)
  }
  async function status(actor) {
    owner(actor); const rows = await store.all()
    const active = rows.filter(current)
    return { database: await store.health(), layers: TYPES.map(type => ({ type, total: rows.filter(r => r.type === type).length, active: active.filter(r => r.type === type).length })),
      scopes: SCOPES, counts: Object.fromEntries(STATUSES.map(s => [s, rows.filter(r => r.status === s).length])),
      index: { pending: active.filter(r => r.index.state === 'pending').length, unconfirmed: active.filter(r => r.index.state === 'unconfirmed').length, saved: active.filter(r => r.index.state === 'saved').length,
        raw_only: active.filter(r => r.index.state === 'raw_only').length,
        retrying: active.filter(r => r.index.state === 'unconfirmed' && r.index.nextRetryAt).length },
      staleModels: active.filter(r => r.details.mentalModel && r.details.evidenceVersions?.some(e => !active.some(a => a.id === e.id && matchesEvidence(a, e)))).map(r => r.id),
      agents: (await store.grants()).map(({ tokenHash, ...g }) => g) }
  }
  return { engine: 'memory_gateway', authorize, get, list, propose: (actor, input) => create(actor, input, false),
    observe: (actor, input) => create(actor, input, true), transition, getDecision, recall, index, working, finishWork,
    grant, authenticate, reflect, status, audit: async (actor, id) => { const r = await get(actor, id); return r ? store.audit(id) : [] } }
}
module.exports = { createGateway, OWNER, TYPES, SCOPES, STATUSES, stableId }
