'use strict'
const { createMailState } = require('./mailState')
const OWNER = Object.freeze({ owner: true })
const ID = /^[a-f0-9]{1,100}$/i
// A separate checkpoint owns the historical snapshot; live Watch cursors never move here.
function createMailHistory ({ store, mailbox, memory, clock = () => new Date().toISOString() }) {
  const state = createMailState({ store, mailbox, clock, kind: 'history_import' })
  let busy = false; let running = false; let timer
  const guard = actor => {
    if (actor?.owner !== true) throw Error('mail_access_denied')
    const verify = mailbox.lease(actor); verify(); return verify
  }
  async function status () {
    const s = await state.read()
    return { state: s.state || 'not_started', busy, enabled: memory.enabled(),
      sourceId: 'admin-mail', mailbox: mailbox.status().mailbox, scope: 'all_available_mail_at_start',
      startedAt: s.startedAt || null, completedAt: s.completedAt || null,
      processed: s.processed ?? null, retained: s.retained ?? null, excluded: s.excluded ?? null,
      partial: s.partial ?? null, pages: s.pages ?? null, exclusionReasons: s.exclusionReasons || {},
      oldestAt: s.oldestAt || null, newestAt: s.newestAt || null, checkedAt: s.checkedAt || null,
      reason: s.reason || null, retryAt: s.retryAt || null,
      hasMore: !!s.startedAt && s.state !== 'completed', intervalSeconds: 2 }
  }
  async function control (actor, action) {
    const verify = guard(actor)
    if (!['start', 'pause', 'resume', 'cancel'].includes(action)) throw Error('invalid_request')
    if (action === 'start' && busy) throw Error('mail_history_busy')
    await state.update(s => {
      verify()
      if (action === 'start') {
        if (s.state === 'running') throw Error('mail_history_busy')
        const at = clock()
        return { state: 'running', startedAt: at, completedAt: null,
          query: 'in:anywhere before:' + (Math.floor(Date.parse(at) / 1000) + 1),
          pageToken: null, pageIds: null, pageOffset: 0, nextPageToken: null,
          processed: 0, retained: 0, excluded: 0, partial: 0, pages: 0,
          exclusionReasons: {}, oldestAt: null, newestAt: null, checkedAt: at,
          reason: null, retryAt: null }
      }
      if (!s.startedAt) throw Error('mail_history_not_started')
      if (action === 'resume' && s.state === 'completed') return s
      return { ...s, state: action === 'resume' ? 'running' : action === 'cancel' ? 'cancelled' : 'paused',
        reason: null, retryAt: null, checkedAt: clock() }
    })
    verify(); return status()
  }
  async function tick () {
    if (busy || !memory.enabled()) return
    busy = true
    try {
      const verify = guard(OWNER)
      let s = await state.read()
      if (!['running', 'failed'].includes(s.state) || Date.parse(s.retryAt) > Date.parse(clock())) return
      const active = async () => {
        verify(); const current = await state.read()
        if (!memory.enabled() || !['running', 'failed'].includes(current.state)) throw Error('mail_history_paused')
      }
      const advance = fn => state.update(v => {
        verify()
        if (!memory.enabled() || !['running', 'failed'].includes(v.state)) throw Error('mail_history_paused')
        return fn(v)
      })
      if (!s.pageIds) {
        const page = await mailbox.scan(OWNER, { q: s.query, pageToken: s.pageToken || undefined })
        await active()
        if (!Array.isArray(page.messages) || page.messages.length > 10 || page.messages.some(m => !ID.test(m.id || '')) ||
            (page.nextPageToken && (typeof page.nextPageToken !== 'string' || page.nextPageToken.length > 4096 || page.nextPageToken === s.pageToken))) throw Error('invalid_history_page')
        s = await advance(v => ({ ...v, pageIds: [...new Set(page.messages.map(m => m.id))], pageOffset: 0,
          nextPageToken: page.nextPageToken || null, pages: v.pages + 1, state: 'running', reason: null, retryAt: null }))
      }
      // Each retained message advances a durable offset. A crash between capture and offset
      // replays the idempotent capture, then counts that message exactly once.
      for (let i = s.pageOffset; i < s.pageIds.length; i++) {
        await active()
        let message; let result
        try { message = await mailbox.read(OWNER, s.pageIds[i]); result = await memory.capture(OWNER, message) }
        catch (e) { if (e.message !== 'mail_message_gone') throw e; result = { state: 'mail_message_gone' } }
        if (result?.state === 'paused') throw Error('mail_memory_paused')
        await active()
        const retained = ['saved', 'unchanged'].includes(result?.state)
        const reason = ['body_unavailable', 'excluded', 'thread_limit', 'mail_message_gone'].includes(result?.state) ? result.state : 'unknown_result'
        if (!retained && reason === 'unknown_result') throw Error('invalid_capture_result')
        const ms = Number(message?.internalDate) || Date.parse(message?.date)
        const observedAt = Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null
        s = await advance(v => ({ ...v, state: 'running', pageOffset: i + 1,
          processed: v.processed + 1, retained: v.retained + Number(retained), excluded: v.excluded + Number(!retained),
          partial: v.partial + Number(retained && (message?.bodyTruncated === true || message?.bodyState === 'partial')),
          exclusionReasons: retained ? v.exclusionReasons : { ...v.exclusionReasons, [reason]: (v.exclusionReasons[reason] || 0) + 1 },
          oldestAt: observedAt && (!v.oldestAt || observedAt < v.oldestAt) ? observedAt : v.oldestAt,
          newestAt: observedAt && (!v.newestAt || observedAt > v.newestAt) ? observedAt : v.newestAt,
          checkedAt: clock(), reason: null, retryAt: null }))
      }
      await active()
      await advance(v => ({ ...v, state: v.nextPageToken ? 'running' : 'completed', pageToken: v.nextPageToken,
        pageIds: null, pageOffset: 0, nextPageToken: null, checkedAt: clock(),
        completedAt: v.nextPageToken ? null : clock(), reason: null, retryAt: null }))
    } catch (e) {
      // Pause/cancel controls retain their state, even if invoked during a read.
      try {
        if (['running', 'failed'].includes((await state.read()).state)) await state.update(v => !['running', 'failed'].includes(v.state) ? v : ({ ...v,
          state: 'failed', reason: e.message === 'mail_access_denied' ? 'source_access_unavailable' : 'history_import_unavailable',
          retryAt: new Date(Date.parse(clock()) + 60000).toISOString(), checkedAt: clock() }))
      } catch (_) {}
    } finally { busy = false }
  }
  const loop = async () => { await tick(); if (running) { timer = setTimeout(loop, 2000); timer.unref() } }
  return { status, control, tick, start () { if (!running) { running = true; void loop() } }, stop () { running = false; clearTimeout(timer) } }
}
module.exports = { createMailHistory }
