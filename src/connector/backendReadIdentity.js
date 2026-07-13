'use strict'

/**
 * backendReadIdentity.js — Phase 2 Gate 1. The dedicated BACKEND_READ_IDENTITY
 * secret the connector projection endpoint requires (distinct from HUB_TOKEN and
 * from any connector-token). Read at call time. The VALUE is never logged, echoed,
 * or placed in a response/audit record — callers compare against it and record only
 * a match/mismatch boolean.
 */

function readBackendReadIdentity () {
  const v = process.env.BACKEND_READ_IDENTITY
  return (typeof v === 'string' && v.length > 0) ? v : null
}

module.exports = { readBackendReadIdentity }
