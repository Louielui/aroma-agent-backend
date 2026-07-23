'use strict'

/**
 * MemoryError — typed errors for the M1 memory-foundations store.
 * `.code` is a stable machine string; `.detail` is safe (no secrets, no raw).
 */
class MemoryError extends Error {
  constructor (code, detail) {
    super(`${code}${detail ? ': ' + detail : ''}`)
    this.name = 'MemoryError'
    this.code = code
    this.detail = detail || null
  }
}

// Resolver status values (returned, not thrown).
const ACTIVE_STATE = Object.freeze({
  ACTIVE: 'ACTIVE',
  NONE: 'NONE',
  AMBIGUOUS_ACTIVE_STATE: 'AMBIGUOUS_ACTIVE_STATE'
})

module.exports = { MemoryError, ACTIVE_STATE }
