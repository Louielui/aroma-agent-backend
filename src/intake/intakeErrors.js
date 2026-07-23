'use strict'

/**
 * intakeErrors.js — B2-2 Slice B. Owns ONLY the intake-boundary error types that
 * Slice B introduces. DistillParseError stays owned by distillPrompt.js (Slice A)
 * and is NOT re-exported here — consumers import it from its owner module.
 */

/**
 * Raised when the upstream LLM provider/adapter is unavailable or fails. Its
 * `.message` is fixed and safe (never surfaced to the client). The original error
 * is kept on `.cause` for SERVER-side classification only (we read its type, never
 * its message) and is never serialized to the client.
 */
class IntakeUpstreamError extends Error {
  constructor ({ correlationId, cause } = {}) {
    super('intake upstream (LLM provider/adapter) unavailable')
    this.name = 'IntakeUpstreamError'
    this.correlationId = correlationId
    this.cause = cause
  }
}

module.exports = { IntakeUpstreamError }
