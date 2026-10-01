'use strict'
const { createHash, randomUUID } = require('node:crypto')
const { stableId } = require('../memory/governed')
const { ID, validText } = require('../memory/hindsight')
const { exclusionReason } = require('../memory/capturePolicy')
const { sourceOnlyReason } = require('../memory/indexPolicy')
const { createMailState } = require('./mailState')
const hash = value => createHash('sha256').update(value).digest('hex')
const message = row => row?.source?.kind === 'admin_mail_message'
const thread = row => row?.source?.kind === 'admin_mail_thread'
const active = (row, now) => row.status === 'active' && !row.supersededBy && (!row.expiresAt || row.expiresAt > now)
const canonicalDecision = (row, now) => thread(row) && active(row, now) && row.approval?.kind === 'owner'
const visibleThread = (row, now) => thread(row) && ['candidate', 'active', 'rejected'].includes(row.status) &&
  !row.supersededBy && (!row.expiresAt || row.expiresAt > now)
function intact (row) {
  const d = row.details
  return row.details.hash === hash(JSON.stringify({ subject: d.subject || null, from: d.from || null, date: d.date || null,
    internalDate: d.internalDate || null, threadId: d.threadId || row.source.id, body: row.text,
    bodyState: d.bodyState, bodyTruncated: d.bodyTruncated === true }))
}
function recallable (rows, now) {
  const visibleThreads = new Set(rows.filter(r => visibleThread(r, now)).map(r => r.source.id))
  return rows.filter(r => message(r) && active(r, now) && intact(r) && visibleThreads.has(r.details.threadId))
}
const sourceText = row => 'SOURCE-BOUND HISTORICAL EMAIL\n' + JSON.stringify({ documentId: row.id,
  messageId: row.source.id, mailbox: row.details.mailbox, date: row.source.at, hash: row.details.hash,
  subject: row.subject, from: row.details.from, partial: row.details.bodyTruncated || row.text.length > 24000 }) + '\nORIGINAL BODY:\n' + row.text.slice(0, 24000)
// Canonical evidence remains available locally even when the authoritative
// Hindsight text policy forbids sending its body or metadata for extraction.
const eligibilityReason = row => sourceOnlyReason(row.text) || (validText(sourceText(row)) ? null : 'text_policy_excluded')
function tokens (query) {
  const parts = query.toLowerCase().match(/[a-z0-9_@.-]{2,}|[\u3400-\u9fff]+/g) || []
  const stop = new Set(['the', 'and', 'what', 'was', 'were', 'last', 'previous', 'email', 'mail', 'said', 'that', 'this'])
  return [...new Set(parts.filter(p => !stop.has(p)).flatMap(p => /^[\u3400-\u9fff]{3,}$/.test(p)
    ? [p, ...Array.from({ length: p.length - 1 }, (_, i) => p.slice(i, i + 2))] : [p]))]
}
// The engine returns pointers only. Every emitted body and decision is re-read
// from the current source-bound canonical store after retrieval has completed.
function createMailSemantic ({ store, mailbox, engine, clock, allowed, serial }) {
  const rebuildState = createMailState({ store, mailbox, clock, kind: 'index_rebuild' })
  const runtimeState = createMailState({ store, mailbox, clock, kind: 'index_runtime' })
  const schedulerState = createMailState({ store, mailbox, clock, kind: 'scheduler' })
  let indexing = false; let lastError = null; let abort = null; let job = null; let generation = 0
  let connectionState = engine?.forMailSource ? 'unverified' : 'not_connected'; let connectionCheckedAt = null
  const account = () => mailbox.status().mailbox
  function guard (actor) {
    if (actor?.owner !== true) throw Error('mail_access_denied')
    const verify = mailbox.lease(actor); verify(); return verify
  }
  async function checked (actor) { guard(actor); if (mailbox.check) await mailbox.check(actor); return guard(actor) }
  const client = () => engine?.forMailSource ? engine.forMailSource(account()) : null
  const sources = async () => (await (store.mailRows ? store.mailRows(account()) : store.all()))
    .filter(r => (message(r) || thread(r)) && r.details.mailbox === account())
  async function subscriptionWait () {
    const state = await schedulerState.read()
    return state.reason === 'subscription_limit_reached' && Date.parse(state.nextAt) > Date.parse(clock())
      ? { state: 'backoff', reason: 'subscription_limit_reached', retryAt: state.nextAt } : null
  }
  function retryReason (error) {
    return ['memory_timeout', 'memory_rate_limited', 'memory_unauthorized', 'memory_invalid_request', 'memory_invalid_text', 'memory_invalid_result', 'memory_unconfirmed'].includes(error.message)
      ? error.message : 'memory_unavailable'
  }
  const rebuilding = state => ['queued', 'running', 'failed'].includes(state)
  const snapshotRows = (rows, state) => recallable(rows, clock()).filter(row => row.createdAt <= state.cutoff && !eligibilityReason(row))
  async function rebuildStatus (rows) {
    const state = await rebuildState.read()
    if (!state.id) return { state: 'not_started', id: null, total: null, queued: null, remaining: null }
    const eligible = snapshotRows(rows, state)
    const marked = rows.filter(row => message(row) && row.index?.rebuildId === state.id).length
    return { ...state, queued: Math.max(state.queued || 0, marked),
      remaining: state.state === 'completed' ? 0 : eligible.filter(row => (!state.lastId || row.id > state.lastId) && row.index?.rebuildId !== state.id).length,
      enabled: allowed(), intervalSeconds: 2, batchSize: 20 }
  }
  async function startRebuild (actor) {
    const verify = await checked(actor); await cancel()
    return serial(async () => {
      let state = await rebuildState.read(); verify()
      if (rebuilding(state.state)) {
        state = await rebuildState.update(current => { verify(); return { ...current, state: 'queued', retryAt: null, reason: null, checkedAt: clock() } })
        verify(); return { state: 'queued', id: state.id, count: state.total, queued: state.queued, resumed: true }
      }
      const at = clock(); const rows = await sources(); verify()
      const visible = recallable(rows, at)
      const total = visible.filter(row => row.createdAt <= at && !eligibilityReason(row)).length
      const id = randomUUID()
      state = await rebuildState.update(() => {
        verify()
        return { id, state: 'queued', scope: 'current_indexable_saved_mail_at_start', cutoff: at, startedAt: at,
          total, queued: 0, processed: 0, skipped: 0, scopeChanged: 0, lastId: null, completedAt: null,
          sourceOnlyAtStart: visible.filter(row => eligibilityReason(row)).length,
          checkedAt: at, reason: null, retryAt: null }
      })
      verify(); return { state: 'queued', id: state.id, count: state.total, queued: 0 }
    })
  }
  async function advanceRebuild (actor, verify, started) {
    let state = await rebuildState.read()
    if (!rebuilding(state.state)) return null
    if (state.retryAt && state.retryAt > clock()) return { state: 'rebuild_failed', id: state.id, queued: state.queued }
    const assertActive = () => {
      verify()
      if (!allowed()) throw Error('mail_memory_paused')
      if (started !== generation) throw Error('mail_index_yielded')
    }
    const advance = fn => rebuildState.update(current => {
      assertActive()
      if (current.id !== state.id || !rebuilding(current.state)) throw Error('mail_index_yielded')
      return fn(current)
    })
    try {
      return await serial(async () => {
        assertActive()
        const candidates = snapshotRows(await sources(), state).filter(row => !state.lastId || row.id > state.lastId)
          .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 20)
        assertActive()
        for (const candidate of candidates) {
          assertActive(); const current = await store.get(candidate.id); assertActive()
          const owningThread = current ? await store.get(stableId('admin-mail:' + account() + ':thread:' + current.details.threadId)) : null
          assertActive()
          let queued = false
          if (current && active(current, clock()) && intact(current) && visibleThread(owningThread, clock()) &&
            owningThread.details.mailbox === account() && !eligibilityReason(current)) {
            if (current.index?.rebuildId !== state.id) {
              const expected = current.version
              current.version++; current.updatedAt = clock()
              current.index = { ...current.index, state: 'pending', attempts: 0, facts: null, reason: null,
                nextRetryAt: null, rebuildId: state.id, queuedAt: clock(), rebuildCutoff: state.cutoff }
              await store.commit([{ expected, row: current }], { op: 'mail_index_rebuild', actor: 'owner', at: clock(), rebuildId: state.id })
              assertActive()
            }
            queued = true
          }
          // A reset committed immediately before a crash carries its manifest ID.
          // Replay advances this cursor once without resetting that source again.
          state = await advance(previous => ({ ...previous, state: 'running', lastId: candidate.id,
            queued: previous.queued + Number(queued), processed: previous.processed + 1,
            skipped: previous.skipped + Number(!queued), checkedAt: clock(), reason: null, retryAt: null }))
          assertActive()
        }
        if (mailbox.check) await mailbox.check(actor); assertActive()
        const remaining = snapshotRows(await sources(), state).filter(row => !state.lastId || row.id > state.lastId).length
        assertActive()
        if (!remaining) state = await advance(previous => ({ ...previous, state: 'completed', completedAt: clock(), checkedAt: clock(),
          scopeChanged: Math.max(0, previous.total - previous.queued - previous.skipped), reason: null, retryAt: null }))
        return { state: remaining ? 'rebuilding' : 'queued', id: state.id, queued: state.queued, remaining }
      })
    } catch (error) {
      if (['mail_memory_paused', 'mail_index_yielded'].includes(error.message)) return { state: error.message === 'mail_memory_paused' ? 'paused' : 'yielded', id: state.id }
      try {
        await rebuildState.update(current => current.id !== state.id || !rebuilding(current.state) ? current : ({ ...current, state: 'failed',
          reason: error.message === 'mail_access_denied' ? 'source_access_unavailable' : 'mail_index_rebuild_unavailable',
          retryAt: new Date(Date.parse(clock()) + 30000).toISOString(), checkedAt: clock() }))
      } catch (_) {}
      return { state: 'rebuild_failed', id: state.id, queued: state.queued }
    }
  }
  const interruption = (verify, started) => {
    verify()
    if (!allowed()) return { state: 'paused' }
    if (started !== generation || abort?.signal.aborted) return { state: 'yielded' }
    return null
  }
  async function saveIndex (row, index, owningThread, verify, started) {
    return serial(async () => {
      let stopped = interruption(verify, started); if (stopped) return stopped
      const current = await store.get(row.id)
      stopped = interruption(verify, started); if (stopped) return stopped
      if (!current || current.version !== row.version || !message(current) || current.details.mailbox !== account() ||
          current.details.hash !== row.details.hash || !active(current, clock()) || !intact(current)) return { state: 'changed' }
      const currentThread = owningThread && await store.get(owningThread.id)
      stopped = interruption(verify, started); if (stopped) return stopped
      if (!currentThread || !visibleThread(currentThread, clock()) || currentThread.source.id !== current.details.threadId ||
          currentThread.details.mailbox !== account()) return { state: 'changed' }
      if (index.state === 'source_only' && eligibilityReason(current) !== index.reason) return { state: 'changed' }
      const rebuild = current.index?.rebuildId ? { rebuildId: current.index.rebuildId, queuedAt: current.index.queuedAt, rebuildCutoff: current.index.rebuildCutoff } : {}
      current.index = { ...index, ...rebuild }; current.version++; current.updatedAt = clock()
      await store.commit([{ expected: row.version, row: current }], { op: 'mail_source_index', actor: 'owner', at: clock() }); verify()
      return { state: index.state, id: current.id }
    })
  }
  async function classifyLocal (actor, selected, threads, verify, started) {
    // The source snapshot is read once. Each original then has its own current
    // revision, thread, lease and durable checkpoint; interruption cannot lose
    // completed classifications or overwrite a later canonical revision.
    if (mailbox.check) await mailbox.check(actor)
    let count = 0; let id = null
    for (const { row, reason } of selected.slice(0, 20)) {
      const stopped = interruption(verify, started); if (stopped) return { ...stopped, count }
      const result = await saveIndex(row, { state: 'source_only', reason, facts: null, attempts: row.index?.attempts || 0,
        checkedAt: clock(), contentHash: row.details.hash, documentId: null, nextRetryAt: null }, threads.get(row.details.threadId), verify, started)
      if (['yielded', 'paused'].includes(result.state)) return { ...result, count }
      if (result.state === 'source_only') { count++; id = result.id }
    }
    const stopped = interruption(verify, started); if (stopped) return { ...stopped, count }
    return { state: count ? 'source_only' : 'changed', id, count }
  }
  async function runIndex (actor) {
    const started = generation
    const verify = await checked(actor)
    if (started !== generation) return { state: 'yielded' }
    if (!allowed()) return { state: 'paused' }
    if (indexing) return { state: 'busy' }
    abort = new AbortController()
    indexing = true
    try {
      const rebuilt = await advanceRebuild(actor, verify, started)
      if (rebuilt) return rebuilt
      const now = clock()
      const all = await sources(); const rows = recallable(all, now)
      const threads = new Map(all.filter(row => visibleThread(row, now)).map(row => [row.source.id, row]))
      const selected = rows.map(row => ({ row, reason: eligibilityReason(row) })).filter(({ row, reason }) =>
        !['saved', 'raw_only', 'source_only'].includes(row.index?.state) || row.index?.contentHash !== row.details.hash ||
        (reason && (row.index.state !== 'source_only' || row.index.reason !== reason)))
        // Permanent local eligibility is reconciled even after an older retry
        // policy exhausted its attempts or persisted a future retry deadline.
        .filter(({ row, reason }) => reason || (row.index?.attempts || 0) < 3)
        .filter(({ row, reason }) => reason || !row.index?.nextRetryAt || row.index.nextRetryAt <= now)
        .sort((a, b) => Number(!!b.reason) - Number(!!a.reason) || a.row.createdAt.localeCompare(b.row.createdAt))
      verify()
      if (started !== generation) return { state: 'yielded' }
      const local = selected.filter(value => value.reason)
      if (local.length) return await classifyLocal(actor, local, threads, verify, started)
      const next = selected[0]
      const runtime = await runtimeState.read(); verify()
      if (started !== generation) return { state: 'yielded' }
      // Classification and extraction share the same subscription. Preserve its
      // durable analysis deadline before any provider read or retain can consume
      // a source retry; local eligibility reconciliation above can still finish.
      const waiting = await subscriptionWait()
      const stopped = interruption(verify, started); if (stopped) return stopped
      if (waiting) return waiting
      if (runtime.quotaUntil && runtime.quotaUntil > clock()) return { state: 'backoff', retryAt: runtime.quotaUntil, reason: 'memory_rate_limited' }
      if (!next) return { state: engine?.forMailSource ? 'idle' : 'not_connected' }
      const { row } = next
      const contentHash = row.details.hash
      const documentId = stableId('admin-mail-index:' + account() + ':' + row.id + ':' + contentHash)
      const text = sourceText(row); let index
      {
        const configured = client(); if (!configured) return { state: 'not_connected' }
        const adapter = configured.withSignal ? configured.withSignal(abort.signal) : configured
        try {
          verify(); const old = adapter.get ? await adapter.get(documentId) : null; verify()
          const result = old?.text === text ? old : await adapter.retainAutomatic(documentId, text,
            { ...row.source, canonicalId: row.id, mailbox: account(), contentHash, attribution: 'external_claim' })
          verify()
          if (result?.id !== documentId || result.text !== text || !Number.isInteger(result.facts) || result.facts < 0) throw Error('memory_unconfirmed')
          index = { state: result.facts ? 'saved' : 'raw_only', reason: result.facts ? null : 'no_extracted_facts', facts: result.facts,
            attempts: (row.index?.attempts || 0) + 1, checkedAt: clock(), contentHash, documentId, nextRetryAt: null,
            partial: row.details.bodyTruncated || row.text.length > 24000 }
          lastError = null
          connectionState = 'verified'; connectionCheckedAt = clock()
        } catch (e) {
          if (abort.signal.aborted) return { state: 'yielded' }
          verify(); const attempts = (row.index?.attempts || 0) + 1; const reason = retryReason(e)
          const delay = reason === 'memory_rate_limited' ? 900000 : reason === 'memory_timeout' ? 300000 : Math.min(1800000, 30000 * 2 ** Math.min(attempts - 1, 6))
          index = { state: 'unconfirmed', reason, facts: null, attempts, checkedAt: clock(), contentHash, documentId,
            nextRetryAt: attempts < 3 ? new Date(Date.parse(clock()) + delay).toISOString() : null }; lastError = reason
          connectionState = 'unavailable'; connectionCheckedAt = clock()
          // Provider quota is a mailbox-wide durable circuit. A source revision or
          // manual retry cannot make the next original bypass that same cooldown.
          if (reason === 'memory_rate_limited') await runtimeState.update(state => {
            verify(); if (started !== generation) throw Error('mail_index_yielded')
            return { ...state, quotaUntil: new Date(Date.parse(clock()) + 900000).toISOString(), reason, checkedAt: clock() }
          })
        }
      }
      if (started !== generation || abort.signal.aborted) return { state: 'yielded' }
      if (mailbox.check) await mailbox.check(actor)
      return await saveIndex(row, index, threads.get(row.details.threadId), verify, started)
    } finally { indexing = false; abort = null }
  }
  function indexNext (actor) {
    if (job) return Promise.resolve({ state: 'busy' })
    job = runIndex(actor).finally(() => { job = null })
    return job
  }
  async function retry (actor) {
    const verify = await checked(actor)
    return serial(async () => {
      const rows = recallable(await sources(), clock()).filter(r => r.index?.state === 'unconfirmed')
      let count = 0
      for (const row of rows) {
        verify(); const current = await store.get(row.id); verify()
        if (!current || !active(current, clock()) || !intact(current) || current.index?.state !== 'unconfirmed') continue
        const expected = current.version
        current.version++; current.updatedAt = clock()
        current.index = { ...current.index, state: 'pending', attempts: 0, facts: null, reason: null, nextRetryAt: null }
        // Each source is its own bounded, durable queue checkpoint. A process
        // interruption leaves already queued sources visible and resumable.
        try { await store.commit([{ expected, row: current }], { op: 'mail_index_retry', actor: 'owner', at: clock() }) }
        catch (e) { e.progress = { state: 'partial', count, total: rows.length }; throw e }
        count++; verify()
      }
      if (mailbox.check) await mailbox.check(actor); verify()
      lastError = null; return { state: 'queued', count }
    })
  }
  async function recall (actor, query, options = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 2000 || exclusionReason(query, false)) throw Error('invalid_query')
    const verify = await checked(actor); const adapter = client(); let hits = []; let semantic = adapter ? 'ok' : 'not_connected'
    // Check the lease again even when the engine throws: a revoked source is an
    // unavailable source, never a lexical fallback through a stale permission.
    if (adapter) try {
      hits = await adapter.recall(query); if (!Array.isArray(hits)) throw Error('memory_invalid_result')
      connectionState = 'verified'; connectionCheckedAt = clock()
    } catch (_) { semantic = 'unavailable'; hits = []; connectionState = 'unavailable'; connectionCheckedAt = clock() }
    verify(); if (mailbox.check) await mailbox.check(actor); verify()
    const rows = await sources(); verify(); const now = clock()
    const decisions = new Map(rows.filter(r => canonicalDecision(r, now)).map(r => [r.source.id, r]))
    const refs = new Set((Array.isArray(options.references) ? options.references : []).filter(id => ID.test(id)).slice(0, 4))
    const semanticIds = new Set(hits.map(hit => hit?.documentId).filter(id => ID.test(id)))
    const terms = tokens(query)
    const candidates = recallable(rows, now).map(row => {
      const decision = decisions.get(row.details.threadId)
      const corpus = (row.subject + ' ' + row.details.from + ' ' + row.text + ' ' + (decision?.text || '')).toLowerCase()
      const lexical = terms.reduce((score, word) => score + Number(corpus.includes(word)), 0)
      const semanticHit = row.index?.contentHash === row.details.hash && ['saved', 'raw_only'].includes(row.index.state) && semanticIds.has(row.index.documentId)
      const reference = refs.has(row.id) || (decision && refs.has(decision.id))
      return { row, decision, rank: lexical + Number(semanticHit), semanticHit, reference }
    }).filter(r => r.rank > 0 || r.reference)
      .sort((a, b) => Number(b.reference) - Number(a.reference) || Number(!!b.decision) - Number(!!a.decision) || b.rank - a.rank || (b.row.source.at || '').localeCompare(a.row.source.at || ''))
    const selected = candidates.slice(0, 8)
    const result = selected.map(({ row, decision, semanticHit, reference }) => {
      const body = row.text.toLowerCase()
      const matchedAt = Math.min(...terms.map(term => body.indexOf(term)).filter(at => at >= 0))
      const offset = Number.isFinite(matchedAt) ? Math.max(0, matchedAt - 500) : 0
      return {
      id: row.id, documentId: row.id, sourceId: row.source.id, source: 'admin_mail_memory', scope: 'domain:email',
      mailbox: row.details.mailbox, subject: row.subject, from: row.details.from, text: row.text.slice(offset, offset + 4000), excerptOffset: offset, date: row.source.at,
      contentHash: row.details.hash, url: row.source.url || null, provenance: row.source, attribution: 'external_claim',
      partial: row.details.bodyTruncated || row.details.bodyState !== 'available' || row.text.length > 4000,
      via: reference ? 'reference' : semanticHit ? 'semantic' : 'source',
      canonicalDecision: decision ? { documentId: decision.id, text: decision.text, version: decision.version,
        approval: decision.approval, decidedAt: decision.decidedAt, taskState: decision.details.taskState,
        assignee: decision.details.assignee, deadline: decision.details.deadline, needsReview: decision.details.needsReview,
        dispatchPermission: false } : null
      }
    })
    verify()
    result.retrieval = { source: 'ok', semantic, coverage: 'saved_sources_only', total: candidates.length,
      truncated: candidates.length > result.length, partialBodies: result.filter(r => r.partial).length,
      unavailableOriginals: rows.filter(r => message(r) && active(r, clock()) && !intact(r)).length, checkedAt: clock() }
    return result
  }
  async function status (snapshot = null) {
    const all = (snapshot || await sources()).filter(r => (message(r) || thread(r)) && r.details.mailbox === account())
    const rows = recallable(all, clock())
    const runtime = await runtimeState.read()
    const waiting = await subscriptionWait()
    const engineBackoff = runtime.quotaUntil && runtime.quotaUntil > clock() ? runtime.quotaUntil : null
    const subscriptionBackoff = waiting?.retryAt || null
    const subscriptionLater = subscriptionBackoff && (!engineBackoff || Date.parse(subscriptionBackoff) >= Date.parse(engineBackoff))
    const matching = state => rows.filter(r => r.index?.state === state && r.index.contentHash === r.details.hash).length
    const saved = matching('saved'); const rawOnly = matching('raw_only'); const sourceOnly = matching('source_only')
    const sourceOnlyReasons = {}
    for (const row of rows.filter(row => row.index?.state === 'source_only' && row.index.contentHash === row.details.hash)) {
      sourceOnlyReasons[row.index.reason] = (sourceOnlyReasons[row.index.reason] || 0) + 1
    }
    return { configured: !!engine?.forMailSource, connected: connectionState === 'unverified' ? null : connectionState === 'verified',
      connectionState, connectionCheckedAt, busy: indexing, total: rows.length, saved, rawOnly, sourceOnly, sourceOnlyReasons,
      pending: rows.length - saved - rawOnly - sourceOnly, failed: matching('unconfirmed'), error: lastError,
      partialIndex: rows.filter(r => ['saved', 'raw_only'].includes(r.index?.state) && r.index.contentHash === r.details.hash && r.index.partial).length,
      retrying: rows.filter(r => r.index?.state === 'unconfirmed' && r.index.nextRetryAt && (r.index.attempts || 0) < 3).length,
      exhausted: rows.filter(r => r.index?.state === 'unconfirmed' && (r.index.attempts || 0) >= 3).length,
      unavailableOriginals: all.filter(r => message(r) && active(r, clock()) && !intact(r)).length,
      rebuild: await rebuildStatus(all),
      backoffUntil: subscriptionLater ? subscriptionBackoff : engineBackoff,
      backoffReason: subscriptionLater ? waiting.reason : engineBackoff ? 'memory_rate_limited' : null,
      coverage: 'saved_sources_only', bank: 'source_bound_admin_mail' }
  }
  function cancel () { generation++; abort?.abort(); return job ? job.catch(() => {}) : Promise.resolve() }
  return { indexNext, recall, status, retry, rebuild: startRebuild, busy: () => indexing, cancel }
}
module.exports = { createMailSemantic }
