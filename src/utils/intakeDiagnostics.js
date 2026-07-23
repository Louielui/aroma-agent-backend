'use strict'

/**
 * intakeDiagnostics.js — B2-2 Slice B: the single intake error-disclosure boundary.
 *
 * Responsibilities:
 *   - classify a propagated intake error by REAL type (instanceof), not err.name
 *   - emit a METADATA-ONLY server diagnostic (log-only; NO raw model text, NO
 *     err.message, NO stack unless an explicit non-prod debug flag is set, NO
 *     prompt, NO Context Card)
 *   - return a stable, safe client contract { status, body }
 *   - never let a diagnostic-sink failure become a response failure (fail-safe)
 *
 * Kept deliberately separate from metricsLogger.js: metrics and error diagnostics
 * have different sensitivity, redaction, and ownership, and this module must be
 * easy to inject a fake sink into for testing.
 */

const crypto = require('crypto')
const { DistillParseError } = require('../intake/distillPrompt')   // owner module (Slice A) — import, NOT re-export
const { IntakeUpstreamError } = require('../intake/intakeErrors')  // Slice B error

// Client-facing, fixed and safe. Never contain: parser reason, provider name/text,
// raw, prompt, Context Card, stack, path, or err.message.
const SAFE_MESSAGES = Object.freeze({
  invalid_llm_output: '香香未能產生有效回應，請稍後再試。',
  llm_unavailable: '香香目前暫時無法連接服務，請稍後再試。',
  internal_error: '系統暫時無法處理這個請求。'
})
const STATUS = Object.freeze({ invalid_llm_output: 500, llm_unavailable: 503, internal_error: 500 })
const RETRYABLE = Object.freeze({ invalid_llm_output: true, llm_unavailable: true, internal_error: false })

// Best-effort secret shapes — used ONLY to (a) set redactionHit metadata and
// (b) redact the optional non-prod debug stack. The raw text itself is never logged.
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{6,}/,
  /sk-[A-Za-z0-9_-]{8,}/,
  /Bearer\s+[A-Za-z0-9._-]{8,}/,
  /\b[A-Fa-f0-9]{32,}\b/,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/
]

function isDebugStack () {
  return process.env.INTAKE_DEBUG_STACK === '1' && process.env.NODE_ENV !== 'production'
}

function redact (s) {
  let out = String(s)
  for (const re of SECRET_PATTERNS) out = out.replace(new RegExp(re, 'g'), '[REDACTED]')
  return out
}

// Classify by REAL type. Unknown errors fall through to internal_error.
function classify (err) {
  if (err instanceof DistillParseError) {
    return { code: 'invalid_llm_output', stage: 'distill_parse', reason: err.reason || null, raw: err.diagnostic && err.diagnostic.rawSample }
  }
  if (err instanceof IntakeUpstreamError) {
    return { code: 'llm_unavailable', stage: 'llm_call', reason: null, raw: null }
  }
  return { code: 'internal_error', stage: 'unknown', reason: null, raw: null }
}

/**
 * Compute METADATA about a raw sample without ever emitting the sample text.
 * Safe when `raw` is undefined/null/empty.
 *
 * GOVERNANCE: `rawHash` is forensic / correlation metadata ONLY. It MUST NOT be
 * used as a cache key, dedup key, or any functional decision input.
 */
function rawMeta (raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { rawPresent: false, rawLength: 0, redactionHit: false, rawHash: null }
  }
  return {
    rawPresent: true,
    rawLength: raw.length,
    redactionHit: SECRET_PATTERNS.some(re => re.test(raw)),
    rawHash: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12) // irreversible; forensic-only
  }
}

function defaultSink (entry) {
  console.error('[AROMA-INTAKE-DIAG]', JSON.stringify(entry))
}

/**
 * Map a propagated intake error to (a) a server-only metadata diagnostic and
 * (b) a safe client response. Never throws.
 *
 * @param {Error} err   — the propagated error (carries .correlationId when tagged)
 * @param {{ correlationId?: string, endpoint?: string, model?: string, latencyMs?: number }} ctx
 * @param {{ sink?: (entry:object)=>void }} deps — injectable diagnostic sink (tests)
 * @returns {{ status: number, body: object }}
 */
function handleIntakeError (err, ctx = {}, deps = {}) {
  const sink = deps.sink || defaultSink
  const correlationId = (err && err.correlationId) || ctx.correlationId || null
  const c = classify(err)

  const entry = {
    event: 'INTAKE_ERROR',
    timestamp: new Date().toISOString(),
    correlationId,
    endpoint: ctx.endpoint || 'unknown',
    stage: c.stage,
    errorClass: (err && err.name) || 'Error',
    code: c.code,
    reason: c.reason,
    model: ctx.model || null,
    latencyMs: (ctx.latencyMs != null) ? ctx.latencyMs : null,
    ...rawMeta(c.raw) // rawPresent / rawLength / redactionHit / rawHash — NEVER the raw text
  }
  if (isDebugStack() && err && err.stack) entry.stackSample = redact(String(err.stack)).slice(0, 512)

  try {
    sink(entry)
  } catch (_) {
    // A diagnostic failure must NEVER become a response failure. Minimal, non-sensitive fallback.
    try { console.error('[AROMA-INTAKE] diagnostic_failed correlationId=' + correlationId) } catch (__) {}
  }

  return {
    status: STATUS[c.code],
    body: { error: { code: c.code, message: SAFE_MESSAGES[c.code], correlationId, retryable: RETRYABLE[c.code] } }
  }
}

module.exports = { handleIntakeError, classify, rawMeta, redact, isDebugStack, SAFE_MESSAGES, STATUS, RETRYABLE }
