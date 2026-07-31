'use strict'

/**
 * run-notepad-canary.js — THE fixed entrypoint. One canary, no arguments that shape it.
 *
 * ── WHAT CANNOT BE PASSED IN ───────────────────────────────────────────────
 * No command, no module path, no text, no filename, no directory. The two verbs it accepts
 * (`preflight`, `run`) choose a phase and nothing else; they cannot alter a single byte of what
 * gets typed or where it gets written.
 *
 * ── WHERE THE WORK ORDER COMES FROM ────────────────────────────────────────
 * From the VERIFIED RECEIPT, and nowhere else. Not from argv, not from stdin, not from the
 * environment, and not by re-reading the draft file. `verify()` returns the receipt; the order
 * handed to the executor is `receipt.approvedOrder` — the exact object the Owner approved,
 * carried inside the thing he signed.
 *
 * Rebuilding the order from the draft would reintroduce the gap the receipt exists to close: the
 * draft is a file on disk that anything can edit, and the Owner did not approve a file, he
 * approved a specific document.
 *
 * ── THE CALL CHAIN, FIXED ──────────────────────────────────────────────────
 *   Owner-Execute.ps1  ->  verify receipt + execution package
 *                      ->  THIS FILE (preflight)          [flag still off]
 *                      ->  PS sets COMPUTER_OPERATOR=on in the Process scope only
 *                      ->  THIS FILE (run)                [child inherits the flag]
 *                      ->  buildComputerOperator(...)     exactly once
 *                      ->  executor.execute(approvedOrder) exactly once
 *
 * There is no other production path to the adapter: computerOperatorWiring is the only importer,
 * and it constructs the adapter behind the flag. This file never imports desktopAdapter itself.
 */

const fs = require('node:fs')
const path = require('node:path')

const approval = require('./ownerApproval')
const pkg = require('./executionPackage')

const REPO = path.resolve(__dirname, '..', '..')

/** The only verbs. Anything else is a refusal, and neither one touches the order. */
const VERBS = Object.freeze(['preflight', 'run'])

/**
 * How long an approval stays usable.
 *
 * Chosen, not derived — so it is stated rather than buried. An approval is a decision taken
 * with a particular machine state in mind; a week later that state is a guess. Twelve hours
 * covers "approve now, run after service" and expires overnight.
 */
const APPROVAL_TTL_MS = 12 * 60 * 60 * 1000

const ALLOWED_DIR = 'C:\\Aroma\\ComputerOperator-Test'
const EXPECTED_FILE = 'canary-1.txt'

const fail = (refusal, human, detail) => ({ ok: false, refusal, human, detail: detail || null })

/**
 * Everything that must be true before the flag is allowed anywhere near `on`.
 *
 * `checkFlagScopes` is false for the `run` phase and only then: by that point the Process scope
 * is deliberately on, and re-asserting it unset would fail the very state we arranged. Every
 * other check runs in both phases, so nothing is verified once and assumed later.
 */
function preflight (opts = {}) {
  const io = opts.io || realIo()
  const env = opts.env || process.env
  const now = opts.now ? opts.now() : Date.now()

  // ── the approval ────────────────────────────────────────────────────────
  const v = approval.verify({ receiptDir: opts.receiptDir, orderFile: opts.orderFile })
  if (!v.ok) {
    const human = v.refusal === 'pre_implementation_receipt'
      ? 'This approval is from before the program was finished.'
      : v.refusal === 'execution_package_changed'
        ? 'The program has changed since you approved it.'
        : v.refusal === 'work_order_changed'
          ? 'The task has changed since you approved it.'
          : 'There is no usable approval.'
    return Object.assign(fail(v.refusal, human, v.reason), { changedFiles: v.changedFiles || null })
  }
  const receipt = v.receipt

  // Single use ACROSS PROCESSES. The registry's spent ledger lives in memory, so it cannot
  // stop a second `node run-notepad-canary.js run`. A durable marker can.
  if (io.executionRecordExists(receipt.approvalId, opts.receiptDir)) {
    return fail('approval_already_executed', 'This approval has already been used. Approve again to run it again.')
  }

  const age = now - Date.parse(receipt.approvedAt)
  if (!(age >= 0) || age > APPROVAL_TTL_MS) {
    return fail('approval_expired', 'This approval is too old to use. Please approve again.',
      'approved ' + Math.round(age / 60000) + ' minutes ago')
  }

  // ── the flag, in all three scopes ───────────────────────────────────────
  if (opts.checkFlagScopes !== false) {
    for (const [scope, value] of Object.entries(io.flagScopes())) {
      if (value && value !== 'off') {
        return fail('flag_already_set', 'The computer operator switch is already on. It must start off.', scope + '=' + value)
      }
    }
  }

  // ── the folder ──────────────────────────────────────────────────────────
  if (receipt.approvedOrder.allowedPath !== ALLOWED_DIR) {
    return fail('allowed_path_unexpected', 'The approved folder is not the one this canary uses.', receipt.approvedOrder.allowedPath)
  }
  if (!io.dirExists(ALLOWED_DIR)) {
    return fail('folder_missing', 'The folder it would save into does not exist.', ALLOWED_DIR)
  }
  const entries = io.listDir(ALLOWED_DIR)
  if (entries === null) {
    return fail('folder_unreadable', 'The folder cannot be read from here.', ALLOWED_DIR)
  }
  if (entries.length > 0) {
    return fail('folder_not_empty', 'The folder is not empty. It must be clean before a canary run.', entries.join(', '))
  }
  if (io.fileExists(path.join(ALLOWED_DIR, EXPECTED_FILE))) {
    return fail('file_exists', 'The file it would create already exists. Nothing will be overwritten.', EXPECTED_FILE)
  }

  // ── the audit sink ──────────────────────────────────────────────────────
  // Checked BEFORE anything acts, because an unrecordable run must not begin — the same rule
  // the executor enforces per step, applied one level earlier so it fails before the flag.
  if (!io.auditWritable()) {
    return fail('audit_not_writable', 'The record of what happens cannot be written. Nothing will run.')
  }

  return { ok: true, receipt, packageHash: v.executionPackageManifestHash }
}

/**
 * The run phase. Builds the operator ONCE and executes ONCE, with the order taken from the
 * receipt — never rebuilt, never merged with anything on disk.
 */
function run (opts = {}) {
  const pre = preflight(Object.assign({}, opts, { checkFlagScopes: false }))
  if (!pre.ok) return pre

  const receipt = pre.receipt
  const build = opts.buildComputerOperator || require('../../src/computer/computerOperatorWiring').buildComputerOperator

  const built = build({
    env: opts.env || process.env,
    artifactStore: opts.artifactStore || realArtifactStore(),
    runner: opts.runner || realRunner()
  })
  if (!built.enabled) {
    return fail('operator_not_enabled', 'The operator could not be started.', built.reason)
  }

  // THE ORDER, verbatim from the receipt. Frozen so nothing downstream can decorate it.
  const approvedOrder = Object.freeze(receipt.approvedOrder)

  const result = built.executor.execute(approvedOrder, { flagOn: true })

  // Durable single-use marker, written whatever the outcome. A failed run has still consumed
  // its authorisation — recovery is a new approval, not a retry.
  ;(opts.io || realIo()).writeExecutionRecord(receipt.approvalId, {
    approvalId: receipt.approvalId,
    workOrderHash: receipt.workOrderHash,
    executionPackageManifestHash: receipt.executionPackageManifestHash,
    ok: result.ok === true,
    refusal: result.refusal || null,
    at: new Date(opts.now ? opts.now() : Date.now()).toISOString()
  }, opts.receiptDir)

  return { ok: result.ok === true, refusal: result.refusal || null, result, approvalId: receipt.approvalId }
}

/* ── the real world, isolated so tests never touch it ─────────────────────── */

function realIo () {
  const recDir = (d) => d || path.join(REPO, '.aroma', 'owner-approvals')
  const recFile = (id, d) => path.join(recDir(d), 'executed-' + id + '.json')
  return {
    flagScopes () {
      return { Process: process.env.COMPUTER_OPERATOR || null }
    },
    dirExists: (p) => { try { return fs.statSync(p).isDirectory() } catch (_) { return false } },
    fileExists: (p) => { try { return fs.statSync(p).isFile() } catch (_) { return false } },
    listDir: (p) => { try { return fs.readdirSync(p) } catch (_) { return null } },
    auditWritable () {
      try {
        const d = path.join(REPO, '.aroma')
        fs.mkdirSync(d, { recursive: true })
        const probe = path.join(d, '.audit-probe')
        fs.writeFileSync(probe, 'probe')
        fs.unlinkSync(probe)
        return true
      } catch (_) { return false }
    },
    executionRecordExists: (id, d) => { try { return fs.statSync(recFile(id, d)).isFile() } catch (_) { return false } },
    writeExecutionRecord (id, record, d) {
      fs.mkdirSync(recDir(d), { recursive: true })
      fs.writeFileSync(recFile(id, d), JSON.stringify(record, null, 2) + '\n', 'utf8')
    }
  }
}

function realArtifactStore () {
  const { createArtifactStore } = require('../../src/store/artifactStore')
  const { resolveArtifactDir } = require('../../src/runtime/artifactDir')
  const root = resolveArtifactDir(process.env, path.join(REPO, '.aroma'))
  return createArtifactStore({ baseDir: root.dir })
}

/**
 * The process runner the adapter uses. It runs ONE fixed script with a JSON payload, and the
 * script path is not a parameter of this function — it is the adapter's constant.
 */
function realRunner () {
  const { spawnSync } = require('node:child_process')
  return {
    run (scriptPath, payload) {
      const abs = path.join(REPO, scriptPath.split('/').join(path.sep))
      const r = spawnSync('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', abs, '-PayloadJson', JSON.stringify(payload)],
        { encoding: 'utf8', timeout: (payload.timeoutSec || 300) * 1000 })
      if (r.status !== 0 && !r.stdout) return { ok: false, reason: 'helper_failed', detail: (r.stderr || '').slice(0, 400) }
      try { return JSON.parse(String(r.stdout).trim()) } catch (e) { return { ok: false, reason: 'helper_bad_output', detail: String(r.stdout).slice(0, 400) } }
    }
  }
}

/* ── CLI ──────────────────────────────────────────────────────────────────── */

if (require.main === module) {
  const verb = process.argv[2]
  if (!VERBS.includes(verb)) {
    process.stdout.write(JSON.stringify({ ok: false, refusal: 'unknown_verb', human: 'Nothing to do.' }) + '\n')
    process.exit(2)
  }
  // Deliberately: argv beyond the verb is IGNORED, not parsed. There is no shape in which a
  // caller can add a path, a filename or a line of text.
  const out = verb === 'preflight' ? preflight({}) : run({})
  process.stdout.write(JSON.stringify(out.ok ? { ok: true, verb } : out) + '\n')
  process.exit(out.ok ? 0 : 3)
}

module.exports = { preflight, run, VERBS, APPROVAL_TTL_MS, ALLOWED_DIR, EXPECTED_FILE, realIo }
