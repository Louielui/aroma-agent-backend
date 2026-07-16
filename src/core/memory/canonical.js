'use strict'

/**
 * canonical — deterministic serialization + SHA-256 content hashing.
 *
 * Rules (Owner-fixed):
 *   - object keys sorted recursively
 *   - arrays keep their order
 *   - UTF-8
 *   - contentHash/eventHash field excluded when hashing a record
 *   - reject undefined, function, symbol, bigint, NaN, +/-Infinity
 *   - same semantic content -> same hash regardless of key insertion order
 *
 * NOTE: JSON.stringify is intentionally NOT used for canonical form — it silently
 * drops undefined/functions and turns NaN into null. We serialize strictly and
 * throw on unsupported values.
 */

const crypto = require('crypto')
const { MemoryError } = require('./errors')

function canonicalize (value) {
  const t = typeof value
  if (value === null) return 'null'
  if (t === 'string') return JSON.stringify(value)
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new MemoryError('CANONICAL_INVALID', 'non-finite number')
    return JSON.stringify(value)
  }
  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
    throw new MemoryError('CANONICAL_INVALID', `unsupported type: ${t}`)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']'
  }
  if (t === 'object') {
    const keys = Object.keys(value).sort()
    const parts = []
    for (const k of keys) {
      const v = value[k]
      if (v === undefined) throw new MemoryError('CANONICAL_INVALID', `undefined value at key "${k}"`)
      parts.push(JSON.stringify(k) + ':' + canonicalize(v))
    }
    return '{' + parts.join(',') + '}'
  }
  throw new MemoryError('CANONICAL_INVALID', 'unsupported value')
}

function sha256Hex (str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex')
}

// Hash an object, excluding the named hash field (so the hash can live inside it).
function hashOf (obj, excludeKey) {
  const clone = {}
  for (const k of Object.keys(obj)) if (k !== excludeKey) clone[k] = obj[k]
  return sha256Hex(canonicalize(clone))
}

module.exports = { canonicalize, sha256Hex, hashOf }
