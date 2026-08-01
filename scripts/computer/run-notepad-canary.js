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

/**
 * The only verbs.
 *
 * `run` is GONE, as of the architecture ruling of 2026-07-31. It used to execute the canary here,
 * in the Owner's session, with the Owner's token — and a preflight that finally asked WHO showed
 * that the whole chain would have acted as `louis`. Deleting the verb is the fix; leaving it
 * behind a flag would have left a second door into the executor, and this project has already
 * paid for the lesson that a second door is the one that gets used.
 *
 * What the Owner's side may do is `request`: write a pointer to an approval into a directory the
 * Companion watches, and stop. It cannot start a process, cannot reach an adapter, and cannot
 * name a file to run.
 */
const VERBS = Object.freeze(['preflight', 'request'])

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

/** Where a request is left for the Companion. A directory, not a channel: nothing is started. */
const REQUEST_DIR = 'C:\\Aroma\\ComputerOperator-Requests'

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
 * The request phase — everything the Owner's side is permitted to do.
 *
 * It runs the same preflight, then writes ONE pointer: which approval, which order hash, which
 * package hash, when it dies. No text, no filename, no command, no path. If this file could
 * describe the work, the Owner's side would be choosing the work, and a compromised Owner path
 * could choose different work. The work lives in the receipt, and the Companion reads it for
 * itself, in its own session, with its own token.
 *
 * Writing a request starts nothing. Whether anything happens next is a decision made by another
 * process, as another user, after checks this side cannot perform and cannot fake.
 */
function request (opts = {}) {
  const pre = preflight(opts)
  if (!pre.ok) return pre

  const store = opts.store || require('../../src/computer/executeRequestStore')
  const receipt = pre.receipt

  let req
  try {
    req = store.buildRequest(receipt, { now: opts.now, ttlMs: opts.ttlMs, receiptHash: receipt.receiptHash })
  } catch (e) {
    return fail('request_not_built', 'The task could not be prepared.', e.message)
  }

  const ledger = opts.ledger || store.createRequestStore({ dir: opts.requestDir || REQUEST_DIR })
  const sub = ledger.submit(req)
  if (!sub.ok) {
    const human = sub.refusal === 'approval_already_live'
      ? 'A task from this approval is already waiting. Let that one finish or expire.'
      : sub.refusal === 'approval_already_used'
        ? 'This approval has already been sent. Approve again to send another.'
        : 'The task could not be handed over.'
    return fail(sub.refusal, human, sub.reason)
  }

  return {
    ok: true,
    requestId: req.requestId,
    approvalId: req.approvalId,
    expiresAt: req.expiresAt,
    requestDir: opts.requestDir || REQUEST_DIR
  }
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

/**
 * There is no `realRunner` and no `realArtifactStore` here any more.
 *
 * Both existed to serve the `run` verb. With that verb gone, a transport constructor sitting in
 * this file would be a loaded gun in a room nobody is supposed to be able to shoot from — and
 * the previous version's stub, which threw when called, still put the NAME of the capability on
 * the Owner's side. The transport, the adapter and the executor are assembled by
 * companionProductionFactory, in the Companion, and its tests assert each has exactly one
 * production importer.
 */

/* ── CLI ──────────────────────────────────────────────────────────────────── */

if (require.main === module) {
  const verb = process.argv[2]
  if (!VERBS.includes(verb)) {
    process.stdout.write(JSON.stringify({ ok: false, refusal: 'unknown_verb', human: 'Nothing to do.' }) + '\n')
    process.exit(2)
  }
  // Deliberately: argv beyond the verb is IGNORED, not parsed. There is no shape in which a
  // caller can add a path, a filename or a line of text.
  const out = verb === 'preflight' ? preflight({}) : request({})
  process.stdout.write(JSON.stringify(
    out.ok ? Object.assign({ ok: true, verb }, verb === 'request' ? { requestId: out.requestId, expiresAt: out.expiresAt } : {}) : out
  ) + '\n')
  process.exit(out.ok ? 0 : 3)
}

module.exports = { preflight, request, VERBS, APPROVAL_TTL_MS, ALLOWED_DIR, EXPECTED_FILE, REQUEST_DIR, realIo }
