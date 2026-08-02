'use strict'

/**
 * proposalPersistence.js — durable, safe-write persistence for the Proposal
 * store. A pure, side-effect-free-except-for-the-named-file module so it can be
 * unit-tested in isolation.
 *
 * Contract (deliberately the OPPOSITE of store.js's silent-empty load):
 *
 *   load(path)
 *     - missing file (ENOENT)            → return an empty shape { order: [],
 *                                          proposals: {} }. Safe init, NEVER a throw.
 *     - present but not valid JSON        → THROW ProposalStoreCorruptError.
 *     - present but wrong top-level shape → THROW ProposalStoreCorruptError.
 *     - any other read error (EACCES …)   → propagate (never silently swallowed).
 *   In NO case does load overwrite, recreate, or fabricate the file's contents.
 *
 *   save(path, data)
 *     - write to `<path>.tmp`, then fs.renameSync onto `<path>`. rename is atomic
 *       on the same filesystem, so a crash mid-write leaves the previous good file
 *       intact (the half-written bytes are only ever in the .tmp). No fsync is
 *       issued — the temp+rename is the durability guarantee the slice requires;
 *       fsync is intentionally omitted to keep the write minimal.
 *
 * This module does NOT normalize per-record fields — that is the store's concern
 * (record semantics live in proposal.js). Here we only guarantee file-level
 * integrity: valid JSON with the { order:[], proposals:{} } envelope, where every
 * id in `order` has a matching object record in `proposals`.
 */

const fs = require('node:fs')
const path = require('node:path')

/** The on-disk envelope for an empty store. */
function emptyShape () {
  return { order: [], proposals: {} }
}

/** A DEFINED error for a present-but-unreadable proposal store file. Carrying a
 *  500 statusCode keeps it distinguishable from the 404/409/422 the store itself
 *  raises, and its name lets tests assert the controlled-failure path precisely. */
class ProposalStoreCorruptError extends Error {
  constructor (message, cause) {
    super(message)
    this.name = 'ProposalStoreCorruptError'
    this.statusCode = 500
    if (cause !== undefined) this.cause = cause
  }
}

function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validate the top-level envelope WITHOUT judging individual record fields.
 * Field-completeness (missing status/confirmedBy/…) is normalized by the store,
 * not rejected here — only genuine structural corruption throws.
 */
function assertShape (data, filePath) {
  if (!isPlainObject(data)) {
    throw new ProposalStoreCorruptError(
      `proposal store file is not an object envelope: ${filePath}`)
  }
  if (!Array.isArray(data.order)) {
    throw new ProposalStoreCorruptError(
      `proposal store file has a non-array "order": ${filePath}`)
  }
  if (!isPlainObject(data.proposals)) {
    throw new ProposalStoreCorruptError(
      `proposal store file has a non-object "proposals": ${filePath}`)
  }
  for (const id of data.order) {
    if (typeof id !== 'string') {
      throw new ProposalStoreCorruptError(
        `proposal store "order" contains a non-string id: ${filePath}`)
    }
    if (!isPlainObject(data.proposals[id])) {
      throw new ProposalStoreCorruptError(
        `proposal store "order" id ${id} has no matching record object: ${filePath}`)
    }
  }
  return data
}

/**
 * Read and validate the store file.
 * @param {string} filePath
 * @returns {{ order: string[], proposals: Object }} the on-disk envelope, or an
 *   empty shape if the file does not exist.
 * @throws {ProposalStoreCorruptError} if the file exists but is unparseable or
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
    throw new ProposalStoreCorruptError(
      `proposal store file is not valid JSON: ${filePath}`, err)
  }

  return assertShape(data, filePath)
}

/**
 * Atomically persist the store envelope: temp file + rename.
 * @param {string} filePath
 * @param {{ order: string[], proposals: Object }} data
 */
function save (filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = filePath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, filePath) // atomic on the same filesystem
}

/**
 * WHERE THE PROPOSAL STORE LIVES — ONE ANSWER, FOR EVERY READER.
 *
 * The Proposal Store computed this itself, and when the Morning Briefing needed the same
 * file the obvious move was to copy the two lines across. That is how two path rules
 * start, and how they later disagree: one honours a new env var, the other does not, and
 * the symptom is a reader that finds nothing while the writer is perfectly happy.
 *
 * The rule mirrors store.js so both truth files live together: AROMA_DATA_DIR when it is
 * set, otherwise the repo's `data/`, and the filename is fixed here rather than passed in
 * — a caller that could name the file could name a different one.
 *
 * `env` is a parameter so a caller may resolve at call time; proposal.js resolves once at
 * module load, which is the behaviour it has always had.
 */
const PROPOSALS_FILENAME = 'aroma-proposals.json'

function resolveProposalFilePath (env = process.env) {
  const dir = (env && env.AROMA_DATA_DIR) || path.resolve(__dirname, '../../data')
  return path.join(dir, PROPOSALS_FILENAME)
}

module.exports = { load, save, emptyShape, ProposalStoreCorruptError, resolveProposalFilePath, PROPOSALS_FILENAME }
