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
    return JSON.parse(fs.readFileSync(path.join(dir, match), 'utf8'))
  }

  /**
   * List every record of a kind, oldest-first (filenames sort chronologically).
   * @param {'tasks'|'results'} kind
   * @returns {object[]}
   */
  function list (kind) {
    const dir = dirFor(kind)
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  }

  return { write, read, list, dirFor }
}

module.exports = { createArtifactStore, KINDS }
