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

async function persistIntake (payload) {
  try {
    const data = store.persistIntake(payload)
    return { ok: true, data }
  } catch (err) {
    console.warn('[AROMA-HUB] persist failed:', err.message)
    return { ok: false, error: err.message }
  }
}

async function recordLLMUsage (metrics) {
  try {
    store.recordLLMUsage(metrics)
    return { ok: true }
  } catch (err) {
    console.warn('[AROMA-HUB] llm-usage record failed:', err.message)
    return { ok: false, error: err.message }
  }
}

module.exports = { persistIntake, recordLLMUsage }
