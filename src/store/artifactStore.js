'use strict'

/**
 * artifactStore.js — a small durable filesystem store for B2-1 worker artifacts,
 * following the aroma-selfexec JSON+timestamp precedent.
 *
 * It holds two kinds of record under a base directory (`.aroma/` in production):
 *
 *   tasks/    — Execution Artifacts: what was authorised and dispatched to a
 *               worker (carries proposalId + the approval that authorised it).
 *   results/  — Result Artifacts: what a worker produced (links back to its
 *               Execution Artifact via taskId).
 *
 * Each record is one JSON file named `<sanitized-createdAt>-<id>.json`, so files
 * sort chronologically and every write is traceable to a timestamp. The store is
 * deterministic given its inputs: the caller supplies `id` and `createdAt`
 * (no Date.now() here), so tests are fully reproducible.
 *
 * This module performs file I/O only. It knows nothing about workers, sandboxes,
 * or the approval flow — it is a dumb, honest persistence layer.
 */

const fs = require('node:fs')
const path = require('node:path')

const KINDS = ['tasks', 'results']

/**
 * B2-11a safe-load. A DEFINED error for a present-but-unreadable artifact file,
 * so a caller can distinguish "corrupt" from "absent" (null) and handle it in a
 * controlled way instead of an uncaught JSON.parse SyntaxError crash. Carries a
 * 500 statusCode and a name tests can assert on. A half-written artifact (a crash
 * mid-write) is invalid JSON → surfaced through this, never misread as valid.
 */
class ArtifactCorruptError extends Error {
  constructor (message, cause) {
    super(message)
    this.name = 'ArtifactCorruptError'
    this.statusCode = 500
    if (cause !== undefined) this.cause = cause
  }
}

/** Parse one artifact file defensively. @throws {ArtifactCorruptError} */
function parseArtifactFile (filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new ArtifactCorruptError(`artifact file is not valid JSON: ${filePath}`, err)
  }
}

/** Make an ISO timestamp safe as a filename segment (': ' and '.' are illegal on Windows). */
function safeStamp (createdAt) {
  return String(createdAt).replace(/[:.]/g, '-')
}

/**
 * Create an artifact store rooted at `baseDir`.
 *
 * @param {{ baseDir: string }} options
 *   baseDir — the root directory (e.g. an absolute path to `.aroma`). Required;
 *   the store never guesses a location.
 * @returns {{ write, read, list, dirFor }}
 */
function createArtifactStore (options = {}) {
  const baseDir = options && options.baseDir
  if (typeof baseDir !== 'string' || baseDir.trim() === '') {
    throw new TypeError('createArtifactStore requires a non-empty baseDir')
  }

  function dirFor (kind) {
    if (!KINDS.includes(kind)) {
      throw new Error(`unknown artifact kind: ${kind} (expected one of ${KINDS.join(', ')})`)
    }
    return path.join(baseDir, kind)
  }

  /**
   * Write one record as `<kind>/<sanitized-createdAt>-<id>.json`.
   * @param {'tasks'|'results'} kind
   * @param {{ id: string, createdAt: string }} record  must carry id + createdAt
   * @returns {{ id: string, path: string }}
   */
  function write (kind, record) {
    const dir = dirFor(kind)
    if (!record || typeof record !== 'object') {
      throw new TypeError('record must be an object')
    }
    if (typeof record.id !== 'string' || record.id.trim() === '') {
      throw new TypeError('record.id is required (non-empty string)')
    }
    if (typeof record.createdAt !== 'string' || record.createdAt.trim() === '') {
      throw new TypeError('record.createdAt is required (ISO timestamp string)')
    }
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${safeStamp(record.createdAt)}-${record.id}.json`)
    fs.writeFileSync(file, JSON.stringify(record, null, 2))
    return { id: record.id, path: file }
  }

  /**
   * Read one record by id, or null if none exists.
   * @param {'tasks'|'results'} kind
   * @param {string} id
   * @returns {object|null}
   */
  function read (kind, id) {
    const dir = dirFor(kind)
    if (!fs.existsSync(dir)) return null
    const suffix = `-${id}.json`
    const match = fs.readdirSync(dir).find(f => f.endsWith(suffix))
    if (!match) return null
    // B2-11a safe-load contract for read(id): missing → null (as today); FOUND but
    // malformed → throw ArtifactCorruptError (controlled, distinct from not-found),
    // never a raw crash, never a half-written file read as valid, never overwritten.
    return parseArtifactFile(path.join(dir, match))
  }

  /**
   * List every record of a kind, oldest-first (filenames sort chronologically).
   * @param {'tasks'|'results'} kind
   * @returns {object[]}
   */
  function list (kind) {
    const dir = dirFor(kind)
    if (!fs.existsSync(dir)) return [] // missing dir → controlled, as today
    // B2-11a safe-load contract for list(): SKIP-and-continue on a malformed entry
    // (a half-written artifact from a crash mid-write is invalid JSON) so one bad
    // file can never crash a whole listing or be misread as valid. Valid records
    // are returned in chronological order; corrupt files are never overwritten.
    const records = []
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
      try {
        records.push(parseArtifactFile(path.join(dir, f)))
      } catch (err) {
        if (!(err instanceof ArtifactCorruptError)) throw err // unexpected IO error surfaces
        // else: skip this corrupt/partial file and continue
      }
    }
    return records
  }

  return { write, read, list, dirFor }
}

module.exports = { createArtifactStore, KINDS, ArtifactCorruptError }
