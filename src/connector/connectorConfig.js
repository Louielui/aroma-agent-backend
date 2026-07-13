'use strict'

/**
 * connectorConfig.js — Phase 2 Gate 1. Feature flag + egress policy version for the
 * connector projection endpoint. Mirrors resolveWorkerInvocation: strict 'on' only;
 * unset/empty/misspelled/wrong-case/any-other → 'off' (fail-closed). Default OFF, so
 * production behaviour is byte-for-byte unchanged unless explicitly enabled.
 */

function resolveConnectorProjection () {
  const raw = process.env.CONNECTOR_PROJECTION
  if (raw === undefined || raw === null || raw === '') return 'off'
  if (raw === 'on' || raw === 'off') return raw
  console.warn(`[AROMA-HUB] Invalid CONNECTOR_PROJECTION="${raw}" — falling back to 'off'.`)
  return 'off'
}

// Bumping this invalidates every outstanding connectorResultId (bound to the version).
const EGRESS_POLICY_VERSION = 'egr-1'

module.exports = { resolveConnectorProjection, EGRESS_POLICY_VERSION }
