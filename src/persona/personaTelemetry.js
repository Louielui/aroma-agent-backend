'use strict'

/**
 * personaTelemetry — R3 safe Persona-source readiness telemetry.
 *
 * Reuses the existing structured application logging pattern (a tagged, whitelisted
 * JSON line via console, like metricsLogger.js). It records ONLY safe metadata about
 * the runtime persona source — NEVER persona / tail / fragment / prompt / user /
 * request / response / Error-stack content. It is NON-AUTHORITATIVE: a logger
 * failure never changes persona routing, never triggers fallback, never writes
 * Memory, and never recurses.
 *
 * Memory-free: this module imports nothing from core/memory or the composer, so
 * legacy telemetry loads no Memory dependency.
 *
 * Deduplication is process-local (no filesystem / database): `readiness-change` and
 * `pin-drift` events fire once per distinct safe fingerprint. Timestamps are NOT in
 * the fingerprint (they would defeat dedup).
 */

const TAG = '[AROMA-PERSONA-SOURCE]'
const EVENT_TYPE = 'PERSONA_SOURCE_STATUS'

const _seen = new Set() // fingerprints already emitted (startup / readiness-change)
const _drift = new Set() // drift fingerprints already emitted

// Fingerprint over SAFE identity-only fields (no timestamp, no text).
function fingerprint (m) {
  return [m.personaSourceMode, m.status, m.reason || '', m.pinState || '', m.identityRevisionId || '', m.operatingPrinciplesRevisionId || '', m.personalityRevisionId || '', m.mappingSourceCommit || ''].join('|')
}

// Build the whitelisted safe entry. Any field not listed here is dropped.
function safeEntry (phase, m) {
  return {
    eventType: EVENT_TYPE,
    phase,
    personaSourceMode: m.personaSourceMode || null,
    status: m.status || null,
    reason: m.reason || null,
    ready: !!m.ready,
    modelPersonaSource: m.modelPersonaSource || null,
    memoryReadAttempted: !!m.memoryReadAttempted,
    pinState: m.pinState || null,
    identityRevisionId: m.identityRevisionId || null,
    operatingPrinciplesRevisionId: m.operatingPrinciplesRevisionId || null,
    personalityRevisionId: m.personalityRevisionId || null,
    mappingSourceCommit: m.mappingSourceCommit || null,
    legacyPersonaSha256: m.legacyPersonaSha256 || null,
    hybridPersonaSha256: m.hybridPersonaSha256 || null,
    byteIdentical: (m.byteIdentical === undefined) ? null : (m.byteIdentical === null ? null : !!m.byteIdentical),
    tailSource: m.tailSource || null,
    fallbackUsed: false // always false — no fallback mode exists
  }
}

// Default emit target: stderr (like metricsLogger's redline warning), so structured
// telemetry never pollutes a tool's stdout JSON stream.
function defaultSink (tag, json) { console.error(tag, json) }

// Emit one line. NEVER throws; on failure returns TELEMETRY_EMIT_FAILED. Never
// serializes an Error / request / persona text.
function emit (phase, m, sink) {
  try {
    const out = sink || defaultSink
    out(TAG, JSON.stringify(safeEntry(phase, m)))
    return { ok: true }
  } catch (e) {
    return { ok: false, status: 'TELEMETRY_EMIT_FAILED' }
  }
}

function recordStartup (m, sink) {
  _seen.add(fingerprint(m))
  return emit('startup', m, sink)
}

function recordReadinessChange (m, sink) {
  const fp = fingerprint(m)
  if (_seen.has(fp)) return { ok: true, deduped: true }
  _seen.add(fp)
  return emit('readiness-change', m, sink)
}

function recordPinDrift (m, sink) {
  const fp = fingerprint(m)
  if (_drift.has(fp)) return { ok: true, deduped: true }
  _drift.add(fp)
  return emit('pin-drift', m, sink)
}

function _resetForTests () { _seen.clear(); _drift.clear() }

module.exports = { TAG, EVENT_TYPE, fingerprint, safeEntry, emit, recordStartup, recordReadinessChange, recordPinDrift, _resetForTests }
