'use strict'

/**
 * artifactDir — PURE resolver for the artifact-store root (`AROMA_ARTIFACT_DIR`).
 *
 * Runtime Foundation A4: lets the artifact store live OUTSIDE the immutable release
 * tree so a production service can run from a read-only release.
 *
 *   - `AROMA_ARTIFACT_DIR` truly ABSENT (property not present) -> the caller's existing
 *     default (the release-relative `.aroma`), preserving ALL current dev/test behavior
 *     exactly (no migration, no redirect).
 *   - PRESENT but empty / whitespace-only / non-string -> FAIL CLOSED. Present-but-empty
 *     is NOT the same as absent and must never fall back to the default.
 *   - PRESENT with a valid ABSOLUTE Windows path (drive-letter or UNC) -> use it.
 *   - Any invalid explicit value FAILS CLOSED — no silent fallback to the default, no
 *     directory created, no store constructed, and the raw value is never echoed.
 *
 * Pure: reads only the passed env, does NO filesystem work (no mkdir), never
 * process.exit()s, never mutates env. The caller decides how to fail (app.js throws
 * before constructing the store, so an invalid config fails closed before any write).
 */

const path = require('path')

const CODE = Object.freeze({ OK: 'ARTIFACT_DIR_OK', INVALID: 'ARTIFACT_DIR_INVALID' })
const WIN_ABS = /^[A-Za-z]:[\\/]/ // drive-letter root, e.g. C:\ or C:/
const UNC = /^\\\\[^\\]/ // UNC root, e.g. \\server\share

/**
 * @param {object} env  e.g. process.env
 * @param {string} defaultDir  the existing release-relative default (caller-supplied)
 * @returns {{ok:boolean, dir?:string, code:string, source?:string, reason?:string}}
 */
function resolveArtifactDir (env, defaultDir) {
  // Truly ABSENT (property not present) -> existing default. `hasOwnProperty`
  // distinguishes absent from present-but-empty; present-empty is NOT absent.
  if (!env || !Object.prototype.hasOwnProperty.call(env, 'AROMA_ARTIFACT_DIR')) {
    return { ok: true, dir: defaultDir, code: CODE.OK, source: 'default' }
  }
  const raw = env.AROMA_ARTIFACT_DIR
  // PRESENT: must be a non-empty, non-whitespace, absolute Windows path. Fail closed
  // on everything else; the raw value is never included in the reason.
  if (typeof raw !== 'string') return { ok: false, code: CODE.INVALID, reason: 'non-string' }
  if (raw.trim() === '') return { ok: false, code: CODE.INVALID, reason: 'empty-or-whitespace' }
  if (raw.indexOf('\0') !== -1) return { ok: false, code: CODE.INVALID, reason: 'malformed' }
  if (!(WIN_ABS.test(raw) || UNC.test(raw))) return { ok: false, code: CODE.INVALID, reason: 'not-absolute-windows-path' }
  return { ok: true, dir: path.win32.normalize(raw), code: CODE.OK, source: 'explicit' }
}

module.exports = { resolveArtifactDir, CODE }
