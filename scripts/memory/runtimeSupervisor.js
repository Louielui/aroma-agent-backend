'use strict'
const REASONS = new Set(['not_running', 'not_configured', 'memory_disabled', 'authorization_failed', 'identity_mismatch', 'probe_timeout', 'probe_unavailable', 'database_unavailable', 'vector_unavailable', 'index_missing'])
function createSupervisor({ component, probe, start, save, clock = Date.now, warmupMs = 300000 }) {
  if (!['bridge', 'hindsight'].includes(component)) throw Error('invalid_component')
  let busy = false, child = null, startedAt = null, misses = 0, retryAt = 0
  let current = { component, state: 'unavailable', reason: 'not_running', checkedAt: null, pid: null, starts: 0, consecutiveFailures: 0, nextRetryAt: null }
  const snapshot = () => ({ ...current })
  const backoff = () => {
    current.consecutiveFailures++
    retryAt = clock() + Math.min(60000, 10000 * 2 ** Math.min(current.consecutiveFailures - 1, 4))
    current.nextRetryAt = new Date(retryAt).toISOString()
  }
  async function tick() {
    if (busy) return snapshot()
    busy = true
    try {
      const measured = await probe()
      current.checkedAt = new Date(clock()).toISOString()
      current.state = ['ready', 'degraded', 'unavailable', 'foreign', 'disabled'].includes(measured?.state) ? measured.state : 'unavailable'
      current.reason = measured?.reason === null ? null : REASONS.has(measured?.reason) ? measured.reason : 'probe_unavailable'
      if (child && !child.running()) {
        child = null; current.pid = null; startedAt = null; misses = 0
      }
      if (current.state === 'ready') {
        current.consecutiveFailures = 0; current.nextRetryAt = null; retryAt = 0; misses = 0
      } else if (measured?.alive === true) {
        misses = 0; current.nextRetryAt = null
      } else if (child) {
        if (clock() - startedAt < warmupMs) { current.state = 'starting'; current.reason = 'startup_pending' }
        else if (++misses >= 3 && child.stop) {
          const stopped = await child.stop()
          if (stopped === false) current.reason = 'recovery_failed'
          else { child = null; current.pid = null; current.reason = 'liveness_failed'; backoff() }
        }
      } else if (current.reason === 'not_running' && clock() >= retryAt) {
        try {
          child = await start()
          startedAt = clock(); misses = 0; current.starts++; current.pid = child.pid
          current.state = 'starting'; current.reason = 'startup_pending'
        } catch (_) { current.state = 'unavailable'; current.reason = 'startup_failed' }
        backoff()
      }
      await save(snapshot())
      return snapshot()
    } catch (_) {
      current.state = 'unavailable'; current.reason = 'supervisor_unavailable'; current.checkedAt = new Date(clock()).toISOString()
      return snapshot()
    } finally { busy = false }
  }
  return { tick, status: snapshot }
}
module.exports = { createSupervisor }
