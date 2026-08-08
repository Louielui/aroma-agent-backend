'use strict'

/**
 * patchStore.js — where the agent's work goes so the Owner can actually use it.
 *
 * The agent edits an isolated clone under os.tmpdir() with every remote removed, and that
 * clone is reaped. Without this file, a run ends with "3 files changed, tests pass" and
 * nothing to apply — the Owner would still have to make the change himself, so three
 * copy-pastes would become four. The patch is the deliverable.
 *
 * ── WHY C:\Aroma\AgentPatches\ ────────────────────────────────────────────
 *   - OUTSIDE the repo. A patch file inside the working tree would show up in `git status`
 *     and could be committed by accident — the agent's proposal must never be able to
 *     become a repo change by sitting in the wrong folder.
 *   - OUTSIDE the tmpdir clone, which is thrown away and swept at startup.
 *   - Alongside the Owner's other artefacts (C:\Aroma\BriefAudit, C:\Aroma\XiangxiangLab),
 *     so there is one place he already looks rather than a new convention per feature.
 *   - A plain directory, not a store with its own format: the file is applied with
 *     `git apply`, and anything that needs a reader is a worse deliverable than a file
 *     that the tool already understands.
 *
 * v1 WRITES AND STOPS. Nothing here applies a patch, and there is no code path that could:
 * the module has no git call and no knowledge of the repo. Applying is the Owner's, by
 * hand, after reading it.
 */

const fs = require('node:fs')
const { t } = require('../i18n/t')
const path = require('node:path')

const DEFAULT_DIR = 'C:\\Aroma\\AgentPatches'
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
/** A patch is text; a huge one is a runaway, not a deliverable. */
const MAX_PATCH_BYTES = 2 * 1024 * 1024

function patchDir (opts = {}) {
  return opts.dir || (opts.env || process.env).AGENT_PATCH_DIR || DEFAULT_DIR
}

/**
 * Write one patch. Returns { ok, path, bytes } or { ok:false, reason }.
 * NEVER throws: failing to save the patch must not fail the run — the run already
 * happened, and losing the file is a smaller loss than losing the report of it.
 */
function writePatch (approvalId, patchText, opts = {}) {
  if (typeof approvalId !== 'string' || !SAFE_ID.test(approvalId)) {
    return { ok: false, reason: 'unsafe_approval_id' }
  }
  if (typeof patchText !== 'string' || patchText.trim() === '') {
    // A run that changed nothing is a legitimate outcome, not a failure. Say so plainly
    // rather than writing an empty file the Owner would open and find blank.
    return { ok: false, reason: 'no_changes' }
  }
  if (Buffer.byteLength(patchText, 'utf8') > MAX_PATCH_BYTES) {
    return { ok: false, reason: 'patch_too_large' }
  }

  const dir = patchDir(opts)
  const stamp = (typeof opts.now === 'function' ? opts.now() : new Date().toISOString())
    .replace(/[:.]/g, '-').slice(0, 19)
  const file = path.join(dir, stamp + '_' + approvalId + '.patch')

  try {
    fs.mkdirSync(dir, { recursive: true })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, patchText, 'utf8')
    fs.renameSync(tmp, file) // atomic on the same filesystem
  } catch (err) {
    return { ok: false, reason: 'write_failed' }
  }
  return { ok: true, path: file, bytes: Buffer.byteLength(patchText, 'utf8') }
}

/** The line the Owner is shown, with the command that applies it. */
function applyHint (patchPath, repoRoot) {
  if (!patchPath) return null
  return t('patch.written', { path: patchPath, repo: repoRoot || 'C:\\Aroma\\aroma-agent-backend' })
}

module.exports = { writePatch, applyHint, patchDir, DEFAULT_DIR, MAX_PATCH_BYTES }
