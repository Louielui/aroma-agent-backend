'use strict'

/**
 * metricsLogger.js — structured metrics logging (condition 6).
 *
 * Logs: request_count, latency, estimated token usage, model.
 * NEVER logs: API key, message content, or any red-line data.
 *
 * In-process metrics store (suitable for single-instance deployment).
 * For multi-instance, replace with Redis or a time-series DB.
 */

let requestCount = 0

/**
 * Logs a completed LLM call. Safe fields only.
 *
 * @param {{ model: string, latencyMs: number, inputTokens: number, outputTokens: number, totalTokens: number, endpoint: string, blocked?: boolean }} metrics
 */
function logLLMCall (metrics) {
  requestCount++

  // Structured log — safe fields only
  const entry = {
    timestamp: new Date().toISOString(),
    request_count: requestCount,
    endpoint: metrics.endpoint || 'unknown',
    model: metrics.model || 'unknown',
    latency_ms: metrics.latencyMs || 0,
    input_tokens: metrics.inputTokens || 0,
    output_tokens: metrics.outputTokens || 0,
    total_tokens: metrics.totalTokens || 0,
    blocked: metrics.blocked || false
    // NOTE: message content is intentionally OMITTED
    // NOTE: API key is intentionally OMITTED
  }

  // Use structured JSON logging — never interpolate sensitive values
  console.log('[AROMA-METRICS]', JSON.stringify(entry))
}

/**
 * Logs a red-line block event. Records the matched class but NOT the message content.
 *
 * @param {{ matchedClass: string, endpoint: string }} info
 */
function logRedLineBlock (info) {
  requestCount++

  const entry = {
    timestamp: new Date().toISOString(),
    request_count: requestCount,
    endpoint: info.endpoint || 'unknown',
    event: 'RED_LINE_BLOCKED',
    matched_class: info.matchedClass || 'unknown',
    model: 'none — not sent externally'
    // NOTE: message content is intentionally OMITTED
  }

  console.warn('[AROMA-REDLINE]', JSON.stringify(entry))
}

/**
 * Returns current in-process request count (for health/status endpoints).
 * @returns {number}
 */
function getRequestCount () {
  return requestCount
}

/**
 * Resets the counter — used in tests only.
 */
function _resetForTests () {
  requestCount = 0
}

module.exports = { logLLMCall, logRedLineBlock, getRequestCount, _resetForTests }
