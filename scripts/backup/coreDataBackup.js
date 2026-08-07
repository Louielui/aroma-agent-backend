'use strict'
/**
 * coreDataBackup.js — the core-data leg, rebuilt. Stage 2 of the D: retirement, 3 days late.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS FILE EXISTS: THE OLD PRODUCER IS GONE.
 *
 * `AromaCoreBackup-B2Sync` copies `D:\AromaCoreBackups → b2:aroma-core-backups`. It has failed
 * every logged day since **2026-07-26** (`rc=3`, 「directory not found」) because D: no longer
 * exists. But the deeper problem is not the path:
 *
 *   **the tool that WROTE the bundles into D:\AromaCoreBackups is not on this machine** —
 *   not on disk, not in any branch, not in this repo's git history. It produced 6 bundles
 *   between 2026-07-15 and 2026-07-21 and then vanished with the drive.
 *
 * So the fix cannot be a repointed path. This is a replacement producer, modelled on
 * `aroma-truthdata-backup.ps1`, which does the same job for another store and is green daily.
 *
 * ── WHAT WENT WRONG, IN ORDER ───────────────────────────────────────────────
 *  2026-07-21  last bundle created and uploaded (aroma-core-45c45738)
 *  2026-07-26  D: gone. Task starts failing nightly. Nobody reads rc=3.
 *  2026-08-04  Owner retires D: deliberately. Stage1-RetireDStaging.ps1 moves TruthData and
 *              ReleaseRecords staging to C: and says, in writing:
 *                「The core-data leg (Stage 2) ... NOT touched here.」
 *              Stage 2 was never written. Monthly-OfflineBackup.ps1 lists three sources;
 *              Core is not among them. Core fell between two migrations, twice.
 *
 * And the irony worth keeping: the Owner's own 08-04 reasoning was
 *   「a task that fails 29 nights out of 30 trains you to ignore failures」
 * — which is precisely what this task then did, for 12 nights, unread.
 *
 * ── GUARANTEES ──────────────────────────────────────────────────────────────
 *  · READ-ONLY on the source. Copy-only to staging and B2 — no sync, no delete, ever.
 *  · CONTENT-ADDRESSED id, so re-running with unchanged data is NO_CHANGE, not a duplicate.
 *  · SOURCE-STABILITY: the tree is hashed before AND after the copy. If it moved underneath
 *    us the backup is REFUSED rather than silently half-captured.
 *  · RESTORE-VERIFY TWICE — from staging, and from B2 after download. A green task result is
 *    not evidence: that is exactly what the other two legs returned while this one was dead.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const SOURCE = process.env.AROMA_CORE_DIR || 'C:\\Users\\louis\\AromaCore\\core-data'
const STAGING = process.env.AROMA_CORE_STAGING || 'C:\\AromaBackupStaging\\Core'
const RCLONE = 'C:\\ProgramData\\AromaBackup\\bin\\rclone.exe'
const RCONF = 'C:\\ProgramData\\AromaBackup\\config\\rclone.conf'
const B2_ROOT = 'b2:aroma-core-backups/core-data-v2'
const LOG = 'C:\\ProgramData\\AromaBackup\\logs\\coredata-backup.log'
const DRY = process.argv.includes('--dry-run')

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/** Every file under dir, relative-pathed, sorted — the unit of both hashing and copying. */
function walk (dir, base) {
  const root = base || dir
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) out.push(...walk(p, root))
    else out.push({ rel: path.relative(root, p).split(path.sep).join('/'), abs: p, size: st.size })
  }
  return out
}

/** Content address of the whole tree: path + hash of every file, hashed. Order is fixed. */
function treeHash (files) {
  const h = crypto.createHash('sha256')
  for (const f of files) h.update(f.rel + '\0' + sha256(fs.readFileSync(f.abs)) + '\0')
  return h.digest('hex')
}

function log (obj) {
  const line = JSON.stringify(obj)
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    fs.appendFileSync(LOG, line + '\n')
  } catch (_) { /* the console line below is still the record */ }
  console.log(line)
}

function rclone (args) {
  return execFileSync(RCLONE, args.concat(['--config', RCONF]), { encoding: 'utf8', timeout: 300000 })
}

function finish (outcome, exitCode, extra) {
  log(Object.assign({ script: 'coredata-backup', startedAt, completedAt: new Date().toISOString(), outcome, exitCode }, extra || {}))
  process.exit(exitCode)
}

const startedAt = new Date().toISOString()

// ── 1. THE SOURCE MUST EXIST. An absent source is a REFUSAL, never an empty backup. ────────
if (!fs.existsSync(SOURCE)) {
  finish('FAILED', 3, { failureStage: 'NO_SOURCE', detail: 'core-data not found at ' + SOURCE + ' — refusing to write an empty backup' })
}

const before = walk(SOURCE)
if (!before.length) {
  // ⛔ Zero files is indistinguishable from a mount that has not come up. Never back that up.
  finish('FAILED', 3, { failureStage: 'EMPTY_SOURCE', detail: 'the source has no files; refusing (an empty backup would overwrite nothing but would REPORT success)' })
}
const hashBefore = treeHash(before)
const backupId = 'core-v2-' + hashBefore.slice(0, 16)
const finalDir = path.join(STAGING, backupId)
const b2Prefix = B2_ROOT + '/' + backupId
const totalBytes = before.reduce((a, f) => a + f.size, 0)
const base = { backupId, fileCount: before.length, totalBytes, sourceCoreDir: SOURCE, finalDir, b2Prefix, sourceTreeHash: hashBefore }

if (DRY) finish('NO_CHANGE', 0, Object.assign({ failureStage: 'DRYRUN_PLAN_ONLY', detail: 'dry run: nothing staged, nothing uploaded' }, base))

// ── 2. ALREADY DONE? Content-addressed, so an unchanged tree is NO_CHANGE — but only if the
//       B2 side is actually there. 「staged locally」 is not 「backed up」. ──────────────────
let b2Has = false
try { b2Has = rclone(['lsf', b2Prefix]).trim().length > 0 } catch (_) { b2Has = false }
if (fs.existsSync(finalDir) && b2Has) {
  finish('NO_CHANGE', 0, Object.assign({ verification: 'already present on BOTH staging and B2 for this exact content hash' }, base))
}

// ── 3. STAGE. Copy-only, into a fresh temp dir, then move into place. ──────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corebk-'))
try {
  for (const f of before) {
    const dst = path.join(tmp, 'data', f.rel.split('/').join(path.sep))
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(f.abs, dst)
  }

  // ⛔ SOURCE STABILITY. If the tree moved while we copied, the bundle is a mixture of two
  // states and its own hash is a lie. Refuse; do not 「fix it up」.
  const hashAfter = treeHash(walk(SOURCE))
  if (hashAfter !== hashBefore) {
    finish('FAILED', 4, Object.assign({ failureStage: 'SOURCE_ADVANCED', detail: 'the source changed during the copy; refusing a half-captured bundle', hashAfter }, base))
  }

  const manifest = {
    schemaVersion: 2,
    kind: 'aroma-core-data',
    backupId,
    createdAt: startedAt,
    sourceCoreDir: SOURCE,
    algo: 'sha256-tree/v2',
    sourceTreeHash: hashBefore,
    fileCount: before.length,
    totalBytes,
    // ⛔ Recorded, not claimed: staging now lives on the SAME physical disk as the source, so
    // a disk failure takes both. That was true of the other two legs from 2026-08-04 too. The
    // real second copy is B2; the third is the monthly Seagate, by hand.
    diskFailureCoverage: false,
    diskCoverageNote: 'staging is on C: alongside the source — B2 is the off-disk copy',
    files: before.map((f) => ({ relativePath: f.rel, sizeBytes: f.size, fileSha256: sha256(fs.readFileSync(f.abs)) }))
  }
  fs.writeFileSync(path.join(tmp, 'backup-manifest.json'), JSON.stringify(manifest, null, 1))
  fs.writeFileSync(path.join(tmp, 'bundle.sha256'), hashBefore + '\n')

  // ── 4. RESTORE-VERIFY #1 — from the STAGED copy, re-hashed independently. ───────────────
  const staged = walk(path.join(tmp, 'data'))
  if (treeHash(staged) !== hashBefore) {
    finish('FAILED', 4, Object.assign({ failureStage: 'STAGING_MISMATCH', detail: 'the staged copy does not re-hash to the source' }, base))
  }

  fs.mkdirSync(STAGING, { recursive: true })
  if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true })
  fs.renameSync(tmp, finalDir)
} catch (e) {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (_) {}
  finish('FAILED', 4, Object.assign({ failureStage: 'STAGE_ERROR', detail: String(e.message).split('\n')[0].slice(0, 160) }, base))
}

// ── 5. UPLOAD. copy, never sync — the cloud is never deleted by a local problem. ───────────
try {
  rclone(['copy', finalDir, b2Prefix, '--transfers', '4', '--checkers', '8', '--retries', '3'])
} catch (e) {
  finish('FAILED', 5, Object.assign({ failureStage: 'B2_UPLOAD', detail: String(e.message).split('\n')[0].slice(0, 160) }, base))
}

// ── 6. RESTORE-VERIFY #2 — rclone check, THEN download and re-hash independently. ─────────
//
// ⛔ A GREEN TASK RESULT IS NOT EVIDENCE. That is precisely what the other two legs returned
// every night while this one was dead. The proof is bytes pulled back down and re-hashed.
try {
  rclone(['check', finalDir, b2Prefix, '--one-way'])
} catch (e) {
  finish('FAILED', 4, Object.assign({ failureStage: 'B2_CHECK', detail: 'rclone check found differences: ' + String(e.message).split('\n')[0].slice(0, 120) }, base))
}

const back = fs.mkdtempSync(path.join(os.tmpdir(), 'coreback-'))
try {
  rclone(['copy', b2Prefix + '/data', path.join(back, 'data')])
  const pulled = walk(path.join(back, 'data'))
  const pulledHash = treeHash(pulled)
  if (pulledHash !== hashBefore) {
    finish('FAILED', 4, Object.assign({ failureStage: 'B2_RESTORE_VERIFY', detail: 'bytes downloaded from B2 do not re-hash to the source', pulledHash }, base))
  }
  finish('CREATED', 0, Object.assign({
    verification: 'staging restore-verify PASS; B2 copy+check PASS; B2 restore-verify PASS (' + pulled.length + ' files re-hashed from downloaded bytes)'
  }, base))
} catch (e) {
  finish('FAILED', 4, Object.assign({ failureStage: 'B2_RESTORE_VERIFY', detail: String(e.message).split('\n')[0].slice(0, 160) }, base))
} finally {
  try { fs.rmSync(back, { recursive: true, force: true }) } catch (_) {}
}
