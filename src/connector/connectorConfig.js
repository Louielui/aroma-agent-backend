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

// IR-01 generic-endpoint auth hardening. INDEPENDENT flag (separate on/off/rollback
// from CONNECTOR_PROJECTION). When 'on', the generic /return-ready + /proposals/results
// read routes require the existing service token. NOTE: this WIDENS HUB_TOKEN's guard
// scope over those two read routes. It does NOT conflict with the projection endpoint's
// dedicated BACKEND_READ_IDENTITY: the MCP path reaches data via the broker + that
// separate identity and never touches the generic routes. Default OFF (byte-identical).
function resolveConnectorGenericAuth () {
  const raw = process.env.CONNECTOR_GENERIC_AUTH
  if (raw === undefined || raw === null || raw === '') return 'off'
  if (raw === 'on' || raw === 'off') return raw
  console.warn(`[AROMA-HUB] Invalid CONNECTOR_GENERIC_AUTH="${raw}" — falling back to 'off'.`)
  return 'off'
}

// Bumping this invalidates every outstanding connectorResultId (bound to the version).
const EGRESS_POLICY_VERSION = 'egr-1'

module.exports = { resolveConnectorProjection, resolveConnectorGenericAuth, EGRESS_POLICY_VERSION }
