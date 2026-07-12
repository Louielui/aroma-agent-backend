'use strict'

/**
 * runPersistence.js — durable, safe-write persistence for the Run store (B2-10).
 *
 * A pure, side-effect-free-except-for-the-named-file module, unit-testable in
 * isolation. It MIRRORS src/coo/proposalPersistence.js (B2-6) deliberately — same
 * safe-write + controlled-failure contract — but is an INDEPENDENT copy: it does
 * NOT import or modify the proposal store's helper (that stays byte-for-byte).
 *
 * Contract (the OPPOSITE of store.js's silent-empty load):
 *
 *   load(path)
 *     - missing file (ENOENT)            → { order: [], runs: {} }. Safe init,
 *                                          NEVER a throw.
 *     - present but not valid JSON        → THROW RunStoreCorruptError.
 *     - present but wrong envelope shape  → THROW RunStoreCorruptError.
 *     - any other read error (EACCES …)   → propagate (never silently swallowed).
 *   load NEVER overwrites, recreates, or fabricates the file's contents.
 *
 *   save(path, data)
 *     - write to `<path>.tmp`, then fs.renameSync onto `<path>`. rename is atomic
 *       on the same filesystem, so a crash mid-write leaves the previous good file
 *       intact (partial bytes only ever live in the .tmp). No fsync — temp+rename
 *       is the durability guarantee; fsync is intentionally omitted (as in B2-6).
 *
 * This module guarantees only file-level integrity (valid JSON, the
 * { order:[], runs:{} } envelope, every id in `order` mapping to a run record
 * object carrying a timeline array). Per-record field normalization is the Run
 * store's concern (run semantics live in run/store.js + run.js).
 */

const fs = require('node:fs')
const path = require('node:path')

/** The on-disk envelope for an empty store. */
function emptyShape () {
  return { order: [], runs: {} }
}

/** A DEFINED error for a present-but-unreadable run store file. Carries a 500
 *  statusCode (distinct from the 404/409/422 the store raises) and a name tests
 *  can assert on, to lock the controlled-failure path. */
class RunStoreCorruptError extends Error {
  constructor (message, cause) {
    super(message)
    this.name = 'RunStoreCorruptError'
    this.statusCode = 500
    if (cause !== undefined) this.cause = cause
  }
}

function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validate the top-level envelope WITHOUT judging individual record fields beyond
 * the structural minimum (a run needs a timeline array). Field-completeness
 * (missing owner/targetProject/…) is normalized by the store, not rejected here.
 */
function assertShape (data, filePath) {
  if (!isPlainObject(data)) {
    throw new RunStoreCorruptError(`run store file is not an object envelope: ${filePath}`)
  }
  if (!Array.isArray(data.order)) {
    throw new RunStoreCorruptError(`run store file has a non-array "order": ${filePath}`)
  }
  if (!isPlainObject(data.runs)) {
    throw new RunStoreCorruptError(`run store file has a non-object "runs": ${filePath}`)
  }
  for (const id of data.order) {
    if (typeof id !== 'string') {
      throw new RunStoreCorruptError(`run store "order" contains a non-string id: ${filePath}`)
    }
    const record = data.runs[id]
    if (!isPlainObject(record)) {
      throw new RunStoreCorruptError(`run store "order" id ${id} has no matching record object: ${filePath}`)
    }
    // A Run without an append-only timeline is structurally broken — reject it as
    // corruption rather than loading a record the store would crash on later.
    if (!Array.isArray(record.timeline)) {
      throw new RunStoreCorruptError(`run store record ${id} has no timeline array: ${filePath}`)
    }
  }
  return data
}

/**
 * Read and validate the store file.
 * @param {string} filePath
 * @returns {{ order: string[], runs: Object }} the on-disk envelope, or an empty
 *   shape if the file does not exist.
 * @throws {RunStoreCorruptError} if the file exists but is unparseable or
 *   structurally invalid. NEVER returns empty for a corrupt file.
 */
function load (filePath) {
  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return emptyShape() // safe init, not a throw
    throw err // EACCES and friends surface — never silently swallowed
  }

  let data
  try {
    data = JSON.parse(raw)
  } catch (err) {
    throw new RunStoreCorruptError(`run store file is not valid JSON: ${filePath}`, err)
  }

  return assertShape(data, filePath)
}

/**
 * Atomically persist the store envelope: temp file + rename.
 * @param {string} filePath
 * @param {{ order: string[], runs: Object }} data
 */
function save (filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = filePath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, filePath) // atomic on the same filesystem
}

module.exports = { load, save, emptyShape, RunStoreCorruptError }
