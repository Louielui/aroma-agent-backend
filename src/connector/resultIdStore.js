'use strict'

/**
 * resultIdStore.js — Phase 2 Gate 1. In-memory store for connectorResultId binding
 * records. The projection endpoint calls set() when it mints a handle. get() is
 * exported for the future Tool 2 (get_execution_result) and is NOT wired into any
 * flow in this GO. No persistence, no eviction here — TTL enforcement lives in
 * connectorResultId.validate().
 */

function createResultIdStore () {
  const map = new Map()
  return {
    set (id, record) {
      if (typeof id !== 'string' || id === '') throw new TypeError('resultIdStore.set requires a non-empty id')
      map.set(id, record)
    },
    get (id) { // reserved for Tool 2 (not enabled in this GO)
      return map.has(id) ? map.get(id) : null
    },
    size () { return map.size }
  }
}

module.exports = { createResultIdStore }
