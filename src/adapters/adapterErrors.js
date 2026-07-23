'use strict'

/**
 * adapterErrors — typed, fail-closed errors for the LLM adapter boundary.
 *
 * Messages are SAFE by construction: they carry only capability/option names,
 * a short reason, and (optionally) the model id — NEVER provider response
 * bodies, prompts, or credentials.
 */

function isPlainObject (v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Malformed adapter option (e.g. a bad responseFormat contract). */
class AdapterOptionError extends Error {
  constructor (code, detail) {
    super(`adapter option rejected: ${code}${detail ? ' (' + detail + ')' : ''}`)
    this.name = 'AdapterOptionError'
    this.code = code
    this.detail = detail || null
  }
}

/** Requested capability not supported by this adapter/model — fail closed. */
class UnsupportedCapabilityError extends Error {
  constructor (capability, model) {
    super(`unsupported capability: ${capability}${model ? ' for model ' + model : ''}`)
    this.name = 'UnsupportedCapabilityError'
    this.code = 'STRUCTURED_OUTPUT_UNSUPPORTED'
    this.capability = capability
    this.model = model || null
  }
}

/**
 * assertResponseFormat — validate the generic, vendor-neutral responseFormat
 * contract BEFORE any network access. Throws AdapterOptionError with code
 * 'MALFORMED_RESPONSE_FORMAT' on any violation; returns rf on success.
 *
 * Generic contract: { type: 'json_schema', name: string, schema: object }
 */
function assertResponseFormat (rf) {
  if (!isPlainObject(rf)) {
    throw new AdapterOptionError('MALFORMED_RESPONSE_FORMAT', 'must be an object')
  }
  if (rf.type !== 'json_schema') {
    throw new AdapterOptionError('MALFORMED_RESPONSE_FORMAT', 'type must be "json_schema"')
  }
  if (typeof rf.name !== 'string' || rf.name.trim() === '') {
    throw new AdapterOptionError('MALFORMED_RESPONSE_FORMAT', 'name must be a non-empty string')
  }
  if (!isPlainObject(rf.schema)) {
    throw new AdapterOptionError('MALFORMED_RESPONSE_FORMAT', 'schema must be an object')
  }
  return rf
}

module.exports = { AdapterOptionError, UnsupportedCapabilityError, assertResponseFormat }
