'use strict'
const { createMailState } = require('./mailState')
const OWNER = Object.freeze({ owner: true })
const validHistory = value => typeof value === 'string' && /^\d{1,30}$/.test(value)
function createMailEvents ({ store, mailbox, pubsub, memory, clock = () => new Date().toISOString() }) {
  const state = createMailState({ store, mailbox, clock, kind: 'events' })
  let busy = false; let timer; let running = false
  const status = async () => ({ state: 'not_connected', discarded: 0, ...await state.read(), configured: pubsub.status().configured, busy })
  async function capture (ids) {
    let excluded = 0
    for (const id of ids) {
      mailbox.lease(OWNER)()
      if (!memory.enabled() || (await state.read()).paused) throw Error('mail_memory_paused')
      try {
        const result = await memory.capture(OWNER, await mailbox.read(OWNER, id))
        if (result.state === 'paused') throw Error('mail_memory_paused')
        if (!['saved', 'unchanged'].includes(result.state)) excluded++
      } catch (e) { if (e.message !== 'mail_message_gone') throw e; excluded++ }
    }
    return excluded
  }
  async function tick () {
    if (busy || !memory.enabled()) return
    busy = true
    try {
      const verify = mailbox.lease(OWNER); verify()
      let s = await state.read()
      if (s.paused || Date.parse(s.retryAt) > Date.parse(clock())) return
      if (!pubsub.status().configured) return
      await pubsub.prepare()
      if (!s.historyId) {
        const historyId = await mailbox.cursor(OWNER)
        if (!validHistory(historyId)) throw Error('invalid_history')
        s = await state.update(v => ({ ...v, historyId }))
      }
      if (!s.renewedAt || Date.parse(clock()) - Date.parse(s.renewedAt) >= 86400000 || Number(s.expiration) <= Date.parse(clock()) + 3600000) {
        const watch = await mailbox.watch(OWNER, pubsub.status().topic)
        s = await state.update(v => ({ ...v, expiration: watch.expiration, renewedAt: clock() }))
      }
      const messages = await pubsub.pull(); verify()
      if ((await state.read()).paused || !memory.enabled()) return
      const acknowledgements = []; let target = s.historyId; let valid = 0; let discarded = 0; const reasons = {}
      for (const item of messages) {
        let data
        try { data = JSON.parse(Buffer.from(item.message?.data || '', 'base64').toString('utf8')) } catch (_) {}
        acknowledgements.push(item.ackId)
        // Some senders encode the cursor as a JSON number. Never accept a rounded integer.
        if (data && Number.isSafeInteger(data.historyId) && data.historyId >= 0) data.historyId = String(data.historyId)
        const reason = !data || typeof data !== 'object' ? 'invalid_payload' :
          typeof data.emailAddress !== 'string' || data.emailAddress.toLowerCase() !== mailbox.status().mailbox ? 'wrong_mailbox' :
            !validHistory(data.historyId) ? 'invalid_history' : null
        if (reason) { discarded++; reasons[reason] = (reasons[reason] || 0) + 1; continue }
        valid++
        if (BigInt(data.historyId) > BigInt(target)) target = data.historyId
      }
      if (discarded || valid) s = await state.update(v => {
        const discardReasons = { ...v.discardReasons }
        for (const [reason, count] of Object.entries(reasons)) discardReasons[reason] = (discardReasons[reason] || 0) + count
        return { ...v, discarded: (v.discarded || 0) + discarded, discardReasons,
          accepted: (v.accepted || 0) + valid, ...(valid ? { lastNotificationAt: clock() } : {}) }
      })
      // Periodic history reconciliation catches missing notifications; it is independent of old-mail backfill.
      const reconcile = !s.lastSyncAt || Date.parse(clock()) - Date.parse(s.lastSyncAt) >= 300000
      if (s.recovery) {
        const page = await mailbox.scan(OWNER, { q: 'in:anywhere', pageToken: s.recovery.pageToken || undefined })
        const excluded = await capture(page.messages.map(m => m.id)); verify()
        s = await state.update(v => ({ ...v, excluded: (v.excluded || 0) + excluded,
          recovery: page.nextPageToken ? { ...v.recovery, pageToken: page.nextPageToken } : null,
          ...(page.nextPageToken ? {} : { historyId: v.recovery.baseline, pageToken: null }), state: 'recovering' }))
        return // Replay from the pre-scan baseline before acknowledging any event.
      }
      if (s.pageToken || BigInt(target) > BigInt(s.historyId) || reconcile) {
        const page = await mailbox.history(OWNER, { historyId: s.historyId, pageToken: s.pageToken || undefined })
        if (page.expired) {
          const baseline = await mailbox.cursor(OWNER)
          if (!validHistory(baseline)) throw Error('invalid_history')
          await state.update(v => ({ ...v, recovery: { baseline, pageToken: null }, pageToken: null, state: 'recovering' })); return
        }
        if (!validHistory(page.historyId)) throw Error('invalid_history')
        const excluded = await capture(page.ids); verify()
        if (!memory.enabled()) throw Error('mail_memory_paused')
        s = await state.update(v => ({ ...v, excluded: (v.excluded || 0) + excluded, pageToken: page.nextPageToken || null,
          historyId: page.nextPageToken ? v.historyId : page.historyId,
          lastSyncAt: page.nextPageToken ? v.lastSyncAt : clock(), state: 'watching', reason: null, retryAt: null }))
        if (page.nextPageToken || BigInt(s.historyId) < BigInt(target)) return
      }
      verify(); if (!memory.enabled() || (await state.read()).paused) return
      if (acknowledgements.length) await pubsub.ack(acknowledgements)
    } catch (_) {
      await state.update(v => ({ ...v, state: 'failed', reason: 'notification_unavailable', retryAt: new Date(Date.parse(clock()) + 60000).toISOString() })).catch(() => {})
    } finally { busy = false }
  }
  async function control (actor, paused) {
    if (actor?.owner !== true) throw Error('mail_access_denied')
    mailbox.lease(actor)(); if (typeof paused !== 'boolean') throw Error('invalid_request')
    await state.update(v => ({ ...v, paused, retryAt: null, ...(!paused ? { renewedAt: null } : {}) })); return status()
  }
  const loop = async () => { await tick(); if (running) { timer = setTimeout(loop, pubsub.status().configured ? 2000 : 30000); timer.unref() } }
  return { tick, status, control, start () { if (!running) { running = true; void loop() } }, stop () { running = false; clearTimeout(timer) } }
}
module.exports = { createMailEvents }
