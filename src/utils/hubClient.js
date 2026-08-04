'use strict'

/**
 * hubClient.js — in-process persistence (M1 integrated build).
 *
 * Keeps the SAME function signatures the intake service expects
 * (persistIntake / recordLLMUsage) but calls the local truth store directly
 * instead of a second HTTP service, so M1 runs as one process on one port.
 * The contract matches Wall-E's DB-003 endpoints; swapping back to the HTTP
 * hub later requires no change to the intake service.
 */

const store = require('../store/store')

/**
 * THE ASYMMETRY, MADE EXPLICIT RATHER THAN LEFT INCIDENTAL.
 *
 * A lost llm_usage record is an accounting gap. A lost Decision is the thing this whole
 * system exists to preserve. Both used to swallow their error identically and return
 * `{ ok: false }`, and downstream nobody looked — a turn whose Decision was never written
 * still answered the Owner as though it had been.
 *
 * `durable` is the field that carries the difference. It is present ONLY on the Decision
 * path, it is never inferred, and `false` means the Decision is not on disk.
 */
async function persistIntake (payload) {
  try {
    const data = store.persistIntake(payload)
    return { ok: true, durable: true, data }
  } catch (err) {
    // NOT fail-open. The caller must surface this to the Owner; see intakeService.
    try {
      console.log('[AROMA-HUB]', JSON.stringify({
        event: 'DECISION_NOT_PERSISTED', timestamp: new Date().toISOString(), durable: false
      }))
    } catch (_) {}
    return { ok: false, durable: false, error: err.message }
  }
}

async function recordLLMUsage (metrics) {
  try {
    store.recordLLMUsage(metrics)
    return { ok: true }
  } catch (err) {
    // FAIL-OPEN, deliberately: metering must never cost the Owner a reply. Counted, not
    // silent — a metering gap you can see beats a turn that died over accounting.
    try {
      console.log('[AROMA-HUB]', JSON.stringify({
        event: 'USAGE_NOT_RECORDED', timestamp: new Date().toISOString()
      }))
    } catch (_) {}
    return { ok: false, error: err.message }
  }
}

module.exports = { persistIntake, recordLLMUsage }
