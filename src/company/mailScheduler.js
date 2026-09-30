'use strict'
const { createMailState } = require('./mailState')
const OWNER = Object.freeze({ owner: true })
function createMailScheduler ({ store, mailbox, memory, clock = () => new Date().toISOString(), foreground = () => false }) {
  const state = createMailState({ store, mailbox, clock, kind: 'scheduler' })
  let busy = false; let timer
  const status = async () => ({ mode: 'catchup', paused: false, ...await state.read(), busy, foreground: foreground() })
  async function tick () {
    if (busy || foreground() || !memory.enabled()) return
    busy = true
    try {
      const s = await status(); const now = Date.parse(clock())
      if (s.paused || Date.parse(s.nextAt) > now) return
      mailbox.lease(OWNER)()
      const window = Math.floor(now / 3600000); const attempts = s.window === window ? s.attempts || 0 : 0
      const cap = s.mode === 'catchup' ? 120 : 30
      if (attempts >= cap) {
        await state.update(v => ({ ...v, nextAt: new Date((window + 1) * 3600000).toISOString(), reason: 'hourly_budget' })); return
      }
      await state.update(v => ({ ...v, window, attempts: attempts + 1, lastAt: clock() }))
      try {
        const result = await memory.analyzeNext(OWNER, { oldest: attempts % 5 === 4 })
        await state.update(v => ({ ...v, completed: (v.completed || 0) + (result.state === 'ready' ? 1 : 0), failures: 0, reason: result.state,
          nextAt: new Date(now + (result.state === 'idle' ? 60000 : s.mode === 'catchup' ? 5000 : 60000)).toISOString() }))
      } catch (e) {
        const reason = ['subscription_limit_reached', 'subscription_login_required', 'mail_analysis_yielded'].includes(e.code || e.message) ? (e.code || e.message) : 'analysis_unavailable'
        await state.update(v => ({ ...v, failures: (v.failures || 0) + 1, reason,
          nextAt: new Date(now + (reason === 'mail_analysis_yielded' ? 60000 : reason.startsWith('subscription_') ? 3600000 : Math.min(1800000, 60000 * 2 ** Math.min(v.failures || 0, 5)))).toISOString() }))
      }
    } catch (_) { /* Source denial must never start a model call. */ }
    finally { busy = false }
  }
  async function control (actor, input) {
    if (actor?.owner !== true) throw Error('mail_access_denied')
    mailbox.lease(actor)()
    if (!input || Object.keys(input).sort().join(',') !== 'mode,paused' || typeof input.paused !== 'boolean' || !['catchup', 'balanced'].includes(input.mode)) throw Error('invalid_request')
    if (input.paused) memory.cancelAnalysis()
    await state.update(v => ({ ...v, ...input, nextAt: null, reason: input.paused ? 'paused' : 'resumed' }))
    return status()
  }
  return { tick, status, control,
    start () { if (!timer) { timer = setInterval(() => { void tick() }, 5000); timer.unref() } },
    stop () { clearInterval(timer); timer = null; memory.cancelAnalysis() } }
}
module.exports = { createMailScheduler }
