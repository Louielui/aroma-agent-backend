'use strict'
const { createHash } = require('node:crypto')
const { stableId } = require('../memory/governed')
const { exclusionReason } = require('../memory/capturePolicy')
const OWNER = Object.freeze({ owner: true })
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const isMail = row => row?.source?.kind?.startsWith('admin_mail_') === true
// Source-bound records share the canonical PostgreSQL store, but never enter a
// shared Hindsight bank or the general conversation/consolidation pipeline.
function createMailMemory ({ store, mailbox, analyzer = null, engine = null, clock = () => new Date().toISOString(), allowed = () => true, foreground = () => false }) {
  let tail = Promise.resolve(); let timer; let indexTimer; let indexRunning = false; let indexGeneration = 0
  let busy = false; let error = null; let analyzing = false
  let indexAttemptActive = false; let backgroundReservation = false; let analysisWaiting = false
  let preferIndexUntil = 0; let preferAnalysis = false
  const serial = fn => { const next = tail.then(fn); tail = next.catch(() => {}); return next }
  const semantic = require('./mailSemantic').createMailSemantic({ store, mailbox, engine, clock, allowed, serial,
    subscriptionCheck: typeof analyzer?.preflight === 'function' ? () => analyzer.preflight() : null })
  function scheduleIndex (delay, run) {
    if (!indexRunning || run !== indexGeneration) return
    indexTimer = setTimeout(async () => {
      indexTimer = null
      let next = 30000
      try {
        if (foreground() || analyzing) next = 5000
        else if (allowed()) {
          const result = await indexNext(OWNER, { background: true })
          if (['saved', 'raw_only', 'source_only', 'rebuilding', 'queued', 'changed', 'scanning'].includes(result.state)) next = 2000
          else if (['busy', 'yielded', 'deferred'].includes(result.state)) next = 5000
          else if (result.state === 'backoff') next = Math.max(30000, Math.min(900000, Date.parse(result.retryAt) - Date.parse(clock())))
        }
      } catch (_) { /* Failed checks defer the serial worker; source state stays authoritative. */ }
      scheduleIndex(next, run)
    }, delay)
    indexTimer.unref()
  }
  const account = () => mailbox.status().mailbox
  const sourceRows = async (kinds = ['admin_mail_message', 'admin_mail_thread']) =>
    (await (store.mailRows ? store.mailRows(account(), kinds) : store.all()))
      .filter(r => kinds.includes(r.source?.kind) && r.details?.mailbox === account())
  const key = (kind, id) => stableId('admin-mail:' + account() + ':' + kind + ':' + id)
  function guard (actor) {
    if (actor?.owner !== true) throw Error('mail_access_denied')
    const verify = mailbox.lease(actor); verify(); return verify
  }
  async function checked (actor) {
    guard(actor)
    if (mailbox.check) await mailbox.check(actor)
    return guard(actor)
  }
  function base (kind, id, subject, value) {
    const at = clock()
    return { id: key(kind, id), type: 'episodic', scope: 'domain:email', subject: String(subject || id).slice(0, 240), text: value,
      status: 'active', source: { kind: 'admin_mail_' + kind, id, at, attribution: 'external_claim' },
      confidence: null, owner: 'owner', createdAt: at, updatedAt: at, version: 1, supersedes: null, supersededBy: null,
      approval: null, decidedBy: null, decidedAt: null, expiresAt: null,
      details: { sourceId: 'admin-mail', mailbox: account() }, index: { state: 'source_only', attempts: 0, facts: null, reason: 'source_permission_required' } }
  }
  const commit = (changes, op) => store.commit(changes, { op, actor: 'owner', at: clock() })
  async function captureNow (actor, message, suggestion) {
    const verify = guard(actor)
    if (!allowed()) return { state: 'paused' }
    if (!message || message.mailbox !== account() || !/^[a-f0-9]{1,100}$/i.test(message.id || '') ||
        (message.threadId && !/^[a-f0-9]{1,100}$/i.test(message.threadId))) throw Error('invalid_mail_evidence')
    if (!message.body || message.bodyState === 'unavailable') return { state: 'body_unavailable', reason: 'body_unavailable' }
    const excluded = exclusionReason(message.body) || exclusionReason(JSON.stringify([message.subject, message.from]), false)
    if (excluded) return { state: 'excluded', reason: excluded }
    const payload = { subject: message.subject || null, from: message.from || null, date: message.date || null,
      internalDate: message.internalDate || null, threadId: message.threadId || message.id,
      body: message.body, bodyState: message.bodyState, bodyTruncated: message.bodyTruncated === true }
    const hash = digest(payload); const old = await store.get(key('message', message.id))
    let evidence = old; const changes = []
    if (!old || old.details.hash !== hash) {
      evidence = base('message', message.id, message.subject, message.body)
      evidence.details = { ...evidence.details, ...payload, hash, observedAt: message.readAt || clock() }
      evidence.source.at = message.date && Number.isFinite(Date.parse(message.date)) ? new Date(message.date).toISOString() : null
      evidence.source.url = 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(account()) + '#all/' + message.id
      if (old) { evidence.version = old.version + 1; evidence.createdAt = old.createdAt }
      changes.push({ expected: old?.version || 0, row: evidence })
    }
    const previous = await store.get(key('thread', payload.threadId))
    const thread = previous ? structuredClone(previous) : base('thread', payload.threadId, message.subject, message.subject || message.id)
    const ids = thread.details.messageIds || []
    const evidenceChanged = changes.length > 0
    if (!previous) { thread.status = 'candidate'; thread.details = { ...thread.details, assignee: null, deadline: null, taskState: null, needsReview: true, messageIds: [] } }
    if (!ids.includes(message.id)) thread.details.messageIds.push(message.id)
    const timestamp = Number(message.internalDate) || (Number.isFinite(Date.parse(message.date)) ? Date.parse(message.date) : null)
    if (!thread.details.latestId || (timestamp !== null && (thread.details.latestTimestamp == null || timestamp >= thread.details.latestTimestamp))) {
      thread.details.latestId = message.id; thread.details.latestTimestamp = timestamp
      thread.source.url = evidence.source.url
    }
    let suggestionChanged = false
    if (suggestion && typeof suggestion.followUp === 'string' && suggestion.followUp.length <= 1200 &&
        typeof suggestion.quote === 'string' && suggestion.quote.trim() && message.body.includes(suggestion.quote) &&
        !exclusionReason(suggestion.followUp, false)) {
      const next = { text: suggestion.followUp, quote: suggestion.quote, messageId: message.id, evidenceHash: hash }
      suggestionChanged = digest(next) !== digest(thread.details.suggestion || null)
      if (suggestionChanged) thread.details.suggestion = next
    }
    if (evidenceChanged || suggestionChanged || !previous) {
      if (evidenceChanged && thread.details.analysis) thread.details.analysis.state = 'stale'
      thread.details.needsReview = true
      thread.updatedAt = clock(); thread.version = (previous?.version || 0) + 1
      changes.push({ expected: previous?.version || 0, row: thread })
    }
    verify()
    if (changes.length) await commit(changes, 'mail_observed')
    verify()
    return { state: changes.length ? 'saved' : 'unchanged', id: thread.id, bodyTruncated: message.bodyTruncated === true }
  }
  const capture = (actor, message, suggestion) => serial(() => captureNow(actor, message, suggestion))
  const category = row => row.details.analysis?.state === 'ready' ? row.details.analysis.category : 'unknown'
  const attention = row => (row.status === 'active' && row.details.taskState === 'open') ||
    (row.details.needsReview && (row.approval || !['notification', 'promotion'].includes(category(row))))
  async function threads (actor) {
    const verify = await checked(actor)
    const rows = await sourceRows(['admin_mail_thread'])
    verify(); return rows
  }
  function validateQuery (query, filter) {
    if (typeof query !== 'string' || query.length > 400) throw Error('invalid_query')
    if (!['all', 'attention', 'decision', 'follow_up', 'notification', 'promotion', 'unknown'].includes(filter)) throw Error('invalid_query')
  }
  async function list (actor, query = '', filter = 'all', snapshot = null) {
    validateQuery(query, filter)
    const verify = await checked(actor)
    const all = (snapshot || await sourceRows()).filter(r => isMail(r) && r.details.mailbox === account())
    const rows = all.filter(r => r.source.kind === 'admin_mail_thread')
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    const messages = new Map(all.filter(r => r.source.kind === 'admin_mail_message').map(r => [r.source.id, r]))
    const selected = rows.filter(r => (filter === 'all' || (filter === 'attention' ? attention(r) : category(r) === filter)) && terms.every(q => JSON.stringify([r.subject, r.text, r.details.suggestion, r.details.analysis, r.details.assignee,
      ...r.details.messageIds.map(id => messages.get(id)?.text || '')]).toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    verify()
    return { items: selected.slice(0, 20).map(r => {
      const m = (terms.length && r.details.messageIds.map(id => messages.get(id)).find(m => m && terms.some(q => m.text.toLowerCase().includes(q)))) || messages.get(r.details.latestId)
      return { ...r, evidenceExcerpt: m?.text.slice(0, 1000) || null, evidenceUrl: m?.source.url || null }
    }), total: selected.length, truncated: selected.length > 20, checkedAt: clock(), sourceId: 'admin-mail' }
  }
  async function detail (actor, id) {
    const verify = guard(actor); const row = await store.get(id)
    if (row?.source?.kind !== 'admin_mail_thread' || row.details.mailbox !== account()) throw Error('mail_access_denied')
    verify()
    await mailbox.read(actor, row.details.latestId)
    const after = guard(actor)
    const messages = []
    for (const messageId of row.details.messageIds) {
      const r = await store.get(key('message', messageId)); if (r) messages.push(r)
    }
    const audit = await store.audit(id); after()
    return { record: row, messages, audit, checkedAt: clock() }
  }
  async function indexNext (actor, { background = false } = {}) {
    guard(actor)()
    if (analyzing || backgroundReservation || indexAttemptActive) return { state: 'busy' }
    if (background && preferAnalysis) return { state: 'deferred', reason: 'background_analysis_turn' }
    // Reserve synchronously, before the semantic worker awaits its source checks.
    indexAttemptActive = true
    try { return await semantic.indexNext(actor) }
    finally {
      indexAttemptActive = false; preferIndexUntil = 0
      // Hand off to an explicitly waiting scheduler even when its source reads
      // are slow. The scheduler withdraws demand on pause, stop or future due dates.
      if (analysisWaiting) preferAnalysis = true
    }
  }
  async function analyze (actor, id, { background = false } = {}) {
    guard(actor)
    if (!analyzer) throw Error('mail_analysis_not_connected')
    if (!allowed()) throw Error('mail_memory_paused')
    if (analyzing) throw Error('mail_analysis_busy')
    if (background && (indexAttemptActive || semantic.busy())) return { state: 'deferred', reason: 'semantic_index_active' }
    analyzing = true
    let record; let verify
    try {
      if (!background) await semantic.cancel()
      const detailView = await detail(actor, id); record = detailView.record; verify = guard(actor)
      verify(); if (!allowed()) throw Error('mail_memory_paused')
      if (background && foreground()) return { state: 'deferred', reason: 'foreground_busy' }
      if (record.details.analysis?.state === 'ready') return { state: 'unchanged', id }
      const ordered = detailView.messages.sort((a, b) => (Number(a.details.internalDate) || Date.parse(a.details.date) || 0) - (Number(b.details.internalDate) || Date.parse(b.details.date) || 0))
      const evidence = ordered.slice(-3).map(m => ({ id: m.source.id, subject: m.subject, from: m.details.from, date: m.details.date,
        body: m.text.slice(0, 6000), partial: m.details.bodyTruncated || m.details.bodyState !== 'available' || m.text.length > 6000 }))
      const input = { evidence, partialThread: ordered.length > evidence.length,
        decision: record.approval ? { text: record.text, status: record.status, taskState: record.details.taskState, decidedAt: record.decidedAt } : null }
      const result = await analyzer.analyze(input)
      // Validate even injected adapters: the source-bound service owns persistence.
      const clean = require('./mailAnalysis').validate(result, evidence)
      if (mailbox.check) await mailbox.check(actor)
      return await serial(async () => {
        verify(); if (!allowed()) throw Error('mail_memory_paused')
        const current = await store.get(id)
        if (current.version !== record.version) throw Error('revision_conflict')
        current.details.analysis = { ...clean, state: 'ready', at: clock(), model: result.model || null,
          partial: input.partialThread || evidence.some(m => m.partial),
          evidence: ordered.slice(-3).map(m => ({ id: m.source.id, hash: m.details.hash })) }
        current.updatedAt = clock(); current.version++
        await commit([{ expected: record.version, row: current }], 'mail_analysis_suggested'); verify()
        return { state: 'ready', id }
      })
    } catch (e) {
      if (record && verify && e.message !== 'mail_analysis_yielded') await serial(async () => {
        verify(); if (!allowed()) return
        const current = await store.get(id)
        if (current.version !== record.version) return
        const reason = ['subscription_limit_reached', 'subscription_login_required'].includes(e.code || e.message) ? (e.code || e.message) : 'analysis_unavailable'
        current.details.analysis = { state: 'failed', at: clock(), reason,
          retryAt: new Date(Date.parse(clock()) + (reason.startsWith('subscription_') ? 3600000 : 1800000)).toISOString() }
        current.updatedAt = clock(); current.version++
        await commit([{ expected: record.version, row: current }], 'mail_analysis_failed')
      }).catch(() => {})
      throw e
    } finally {
      analyzing = false
      // Give the five-second index poll one opportunity, but never wait for a
      // quota-sleeping worker. An actual in-flight retain owns its separate slot.
      if (background && indexRunning) preferIndexUntil = Date.parse(clock()) + 6000
    }
  }
  async function analyzeBatch (actor) {
    guard(actor)
    if (!analyzer) throw Error('mail_analysis_not_connected')
    if (!allowed()) throw Error('mail_memory_paused')
    const rows = await threads(actor)
    const pending = rows.filter(r => r.details.analysis?.state !== 'ready' &&
      (!r.details.analysis?.retryAt || Date.parse(r.details.analysis.retryAt) <= Date.parse(clock()) || r.details.analysis.state === 'stale'))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(0, 2)
    let completed = 0; let failed = 0
    for (const row of pending) { guard(actor)(); try { await analyze(actor, row.id); completed++ } catch (_) { guard(actor)(); failed++ } }
    return { completed, failed }
  }
  async function analyzeNext (actor, { oldest = false, background = false } = {}) {
    guard(actor)
    if (background) {
      if (foreground()) return { state: 'deferred', reason: 'foreground_busy' }
      if (indexAttemptActive || semantic.busy()) { analysisWaiting = true; return { state: 'deferred', reason: 'semantic_index_active' } }
      if (indexRunning && Date.parse(clock()) < preferIndexUntil) return { state: 'deferred', reason: 'semantic_index_turn' }
      if (analyzing || backgroundReservation) return { state: 'deferred', reason: 'mail_analysis_busy' }
      backgroundReservation = true; preferAnalysis = false; analysisWaiting = false
    }
    try {
      const rows = (await threads(actor)).filter(r => r.details.analysis?.state !== 'ready' &&
        (!r.details.analysis?.retryAt || Date.parse(r.details.analysis.retryAt) <= Date.parse(clock()) || r.details.analysis.state === 'stale'))
      guard(actor)()
      if (background && foreground()) return { state: 'deferred', reason: 'foreground_busy' }
      // Approved replies first; reserve every fifth scheduler attempt for the oldest remaining thread.
      const score = r => Number(!!r.approval && r.details.needsReview)
      rows.sort((a, b) => score(b) - score(a) || (oldest ? a.createdAt.localeCompare(b.createdAt) : (b.details.latestTimestamp || 0) - (a.details.latestTimestamp || 0)))
      return rows.length ? await analyze(actor, rows[0].id, { background }) : { state: 'idle' }
    } finally { if (background) backgroundReservation = false }
  }
  async function briefing (actor) {
    const rows = await threads(actor)
    const selected = rows.filter(attention).sort((a, b) => Number(!!b.approval && b.details.needsReview) - Number(!!a.approval && a.details.needsReview) || b.updatedAt.localeCompare(a.updatedAt))
    return { items: selected.slice(0, 10), total: selected.length, truncated: selected.length > 10,
      pending: rows.filter(r => r.details.analysis?.state !== 'ready').length, checkedAt: clock() }
  }
  const update = (actor, id, version, input) => serial(async () => {
    const { record: row } = await detail(actor, id); const verify = guard(actor)
    if (row.version !== version) throw Error('revision_conflict')
    if (!input || Object.keys(input).some(k => !['action', 'text', 'assignee', 'deadline', 'taskState'].includes(k)) ||
        !['approve', 'reject'].includes(input.action)) throw Error('invalid_request')
    if (input.action === 'approve') {
      if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000 || exclusionReason(input.text) ||
          !(input.assignee === null || (typeof input.assignee === 'string' && input.assignee.length <= 120)) ||
          !(input.deadline === null || (typeof input.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.deadline) && new Date(input.deadline).toISOString().slice(0, 10) === input.deadline)) ||
          !['open', 'done', 'cancelled'].includes(input.taskState)) throw Error('invalid_request')
      row.text = input.text.trim(); row.status = 'active'
      row.details.assignee = input.assignee?.trim() || null; row.details.deadline = input.deadline; row.details.taskState = input.taskState
      row.approval = { kind: 'owner', actor: 'owner', at: clock(), approvedVersion: version, contentHash: digest(input) }
      row.decidedBy = 'owner'; row.decidedAt = clock()
    } else { row.status = 'rejected' }
    row.details.needsReview = false; row.updatedAt = clock(); row.version++
    verify(); await commit([{ expected: version, row }], input.action === 'approve' ? 'mail_owner_approved' : 'mail_owner_rejected'); verify()
    return row
  })
  async function sync () {
    if (busy) throw Error('mail_memory_busy')
    busy = true
    try {
      if (!allowed()) return { state: 'paused' }
      guard(OWNER)
      const id = key('sync', 'checkpoint'); const old = await store.get(id)
      const state = old?.details || {}; const startedAt = state.pageToken ? state.startedAt : clock()
      const lower = state.completedAt ? Date.parse(state.completedAt) - 86400000 : Date.parse(startedAt) - 30 * 86400000
      const q = state.pageToken ? state.query : 'after:' + Math.floor(lower / 1000) + ' before:' + (Math.floor(Date.parse(startedAt) / 1000) + 1)
      const page = await mailbox.scan(OWNER, { q, pageToken: state.pageToken || undefined })
      let captured = 0; let excluded = 0
      for (const item of page.messages) {
        const result = await capture(OWNER, await mailbox.read(OWNER, item.id))
        if (result.state === 'paused') throw Error('mail_memory_paused')
        if (result.state === 'saved') captured++
        else if (result.state !== 'unchanged') excluded++
      }
      const row = base('sync', 'checkpoint', 'Administrative mail synchronization', 'Source-bound checkpoint')
      row.status = 'ignored'; row.version = (old?.version || 0) + 1
      row.details = { ...row.details, query: q, pageToken: page.nextPageToken || null, startedAt,
        completedAt: page.nextPageToken ? state.completedAt || null : startedAt,
        captured, excluded, checkedAt: clock(), initialWindow: '30_days' }
      guard(OWNER)(); await commit([{ expected: old?.version || 0, row }], 'mail_sync_checkpoint')
      error = null
      return { state: 'ok', captured, excluded, hasMore: !!page.nextPageToken, initialWindow: '30_days' }
    } catch (e) { error = 'mail_memory_sync_unavailable'; throw e }
    finally { busy = false }
  }
  async function status (snapshot = null) {
    const row = await store.get(key('sync', 'checkpoint'))
    const rows = (snapshot || await sourceRows(['admin_mail_thread'])).filter(r => r.source?.kind === 'admin_mail_thread' && r.details.mailbox === account())
    return { state: 'source_bound', busy, error, enabled: allowed(), initialWindow: '30_days', intervalSeconds: 300,
      analysis: { connected: !!analyzer, busy: analyzing, pending: rows.filter(r => r.details.analysis?.state !== 'ready').length,
        failed: rows.filter(r => r.details.analysis?.state === 'failed').length, ready: rows.filter(r => r.details.analysis?.state === 'ready').length },
      checkedAt: row?.details.checkedAt || null, completedAt: row?.details.completedAt || null,
      hasMore: !!row?.details.pageToken, excluded: row?.details.excluded ?? null,
      hindsight: { ...await semantic.status(snapshot), indexer: { concurrency: 1, activeDelayMs: 2000, idleDelayMs: 30000, foregroundPollMs: 5000 } } }
  }
  async function view (actor, query = '', filter = 'all') {
    validateQuery(query, filter)
    const verify = await checked(actor)
    const snapshot = await sourceRows(); verify()
    const result = { ...await list(actor, query, filter, snapshot), sync: await status(snapshot) }
    verify(); return result
  }
  return { capture, list, view, detail, update, sync, status, analyze, analyzeBatch, analyzeNext, briefing,
    runtimeStatus: () => ({ enabled:allowed(), syncActive:busy, analysisConnected:!!analyzer, analysisActive:analyzing,
      indexEnabled:allowed() && indexRunning, indexActive:indexAttemptActive || semantic.busy() }),
    recall: semantic.recall, indexNext, retryIndex: semantic.retry, rebuildIndex: semantic.rebuild,
    enabled: allowed,
    backgroundAnalysisDemand: requested => { analysisWaiting = requested === true; if (!analysisWaiting) preferAnalysis = false },
    cancelAnalysis: () => Promise.all([semantic.cancel(), Promise.resolve(analyzer?.cancel?.())]),
    start () {
      if (!timer) { timer = setInterval(() => { void sync().catch(() => {}) }, 300000); timer.unref() }
      if (!indexRunning && engine) { indexRunning = true; scheduleIndex(2000, ++indexGeneration) }
    },
    stop () { clearInterval(timer); clearTimeout(indexTimer); timer = null; indexTimer = null; indexRunning = false; indexGeneration++; semantic.cancel() } }
}
module.exports = { createMailMemory, isMail }
