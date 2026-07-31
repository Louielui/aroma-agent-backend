'use strict'

/**
 * ownerApproval.js — the machinery behind the Owner Approval Ceremony.
 *
 * ── WHY THIS IS NODE AND THE SCREENS ARE POWERSHELL ────────────────────────
 * The canonicalisation and the hash already exist, once, in sealedOrderGate.js. Re-implementing
 * either in PowerShell would create a second source of truth that can drift from the one the
 * gate actually enforces — and the failure would look like a rejected approval on the night it
 * matters. So PowerShell owns the human interaction and nothing else; every byte that ends up
 * hashed passes through here.
 *
 * ── WHAT THE OWNER NEVER HAS TO DO ─────────────────────────────────────────
 * Invent an id, copy JSON, compare a hash, track a nonce, or paste a command. He reads a plain
 * summary and chooses. Everything in this file exists so that remains true:
 *
 *   summary   render the human-readable scope from a work order
 *   issue     mint a random approvalId, bind it, hash it, write a durable receipt
 *   verify    re-derive the summary FROM THE RECEIPT and check the order still matches
 *
 * ── THE RULE THAT SHAPES `verify` ──────────────────────────────────────────
 * The EXECUTE screen must render from the RECEIPT, never by regenerating from the work order.
 * If it regenerated, a work order edited between the two screens would be displayed as though
 * the Owner had approved it — he would be looking at content he never saw. So the receipt
 * carries its own copy of what was approved, and the current order is checked AGAINST it.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { computeOrderHash, ALLOWED_PATH, LIMITS } = require('../../src/computer/sealedOrderGate')
const pkg = require('./executionPackage')

const REPO = path.resolve(__dirname, '..', '..')
const DRAFT = path.join(REPO, 'docs', 'governance', 'canary-work-order.draft.json')
const RECEIPT_DIR = path.join(REPO, '.aroma', 'owner-approvals')

/**
 * The marking for receipts issued before the execution package existed. Owner ruling
 * 2026-07-31: keep them, never honour them.
 */
const PRE_IMPLEMENTATION_STATUS = 'SCOPE APPROVED - PRE-IMPLEMENTATION - NOT EXECUTABLE'

/** Which packaged files differ from what the receipt pinned — so a refusal can name them. */
function changedPackageFiles (receipt) {
  const now = pkg.buildManifest().files
  const was = new Map((receipt.executionPackageManifest || []).map((f) => [f.path, f.sha256]))
  const changed = []
  for (const f of now) {
    if (!was.has(f.path)) changed.push({ path: f.path, change: 'added' })
    else if (was.get(f.path) !== f.sha256) changed.push({ path: f.path, change: 'modified' })
  }
  for (const p of was.keys()) if (!now.find((f) => f.path === p)) changed.push({ path: p, change: 'removed' })
  return changed
}

/** An id the builder cannot have chosen: 128 random bits, minted at the moment of consent. */
function mintApprovalId (rng = crypto.randomBytes) {
  return 'appr_' + rng(16).toString('hex')
}

function readOrder (file) {
  return JSON.parse(fs.readFileSync(file || DRAFT, 'utf8'))
}

/**
 * The scope, in the words a person can check. Derived from the order, and deliberately
 * exhaustive: anything the run can do must appear here, or the Owner is approving something
 * he was not shown.
 *
 * ── EVERY STRING HERE IS PURE ASCII, AND THAT IS A REQUIREMENT ────────────
 * The Owner saw mojibake on the real screen: an em dash written as UTF-8 and read back by a
 * fresh console under its OEM code page. PowerShell 5.1 decodes a native command's output
 * using [Console]::OutputEncoding, which in a double-clicked console is the OEM page, not
 * UTF-8 — so a character that renders correctly in a developer's terminal turns to noise in
 * front of the person who has to read it and decide.
 *
 * Setting the console encoding would have been the clever fix and the wrong one: it makes the
 * screen depend on a setting nobody can see. ASCII depends on nothing. A test asserts it.
 */
function summarise (order) {
  const lines = []
  const save = order.steps.find((s) => s.action === 'save')
  const type = order.steps.find((s) => s.action === 'type_text')
  const open = order.steps.find((s) => s.action === 'open_app')

  lines.push(['Application', open ? 'Notepad only - nothing else is opened' : '(none)'])
  lines.push(['Text typed', type ? JSON.stringify(type.text) : '(none)'])
  lines.push(['File written', save ? order.allowedPath + '\\' + save.fileName : '(none)'])
  lines.push(['Folder', order.allowedPath + '  (nowhere else)'])
  lines.push(['Overwrite', 'never - refuses if the file already exists'])
  lines.push(['Steps', order.steps.map((s) => s.n + '. ' + s.action).join('   ')])
  lines.push(['Time limit', order.timeoutSec + ' seconds, then it stops'])
  lines.push(['Afterwards', 'Notepad is closed; the file stays for you to check and delete'])
  lines.push(['Not allowed', 'internet, other windows, other folders, deleting anything'])
  return lines
}

/** Fixed-width rendering so both screens print the identical block. */
function renderSummary (order) {
  return summarise(order).map(([k, v]) => '  ' + (k + ' ').padEnd(14, '.') + ' ' + v).join('\n')
}

/**
 * Mint, bind, hash, and write the receipt. Called ONLY from the approval screen, only after a
 * real human keypress — this function does not and cannot check that, which is exactly why the
 * interactivity gate lives in the screen and is tested there.
 */
function issue (opts = {}) {
  const order = readOrder(opts.orderFile)
  if (order.approvalId) throw new Error('draft already carries an approvalId - refusing to re-approve')

  const approvalId = opts.approvalId || mintApprovalId(opts.rng)
  const bound = Object.assign({}, order, { approvalId })
  bound.orderHash = computeOrderHash(bound)

  // The code that will run, pinned at the moment of consent. Without this the receipt binds
  // WHAT will be done and nothing about WHAT DOES IT — see executionPackage.js.
  const packageManifest = pkg.buildManifest()
  const executionPackageManifestHash = pkg.computePackageHash()

  const receipt = {
    kind: 'owner-approval-receipt',
    receiptVersion: 2,
    approvalId,
    workOrderHash: bound.orderHash,
    executionPackageManifestHash,
    executionPackageManifest: packageManifest.files,
    orderId: bound.orderId,
    // The receipt carries what was approved, so EXECUTE can render from it rather than from a
    // file that may have moved on.
    approvedOrder: bound,
    approvedSummary: summarise(bound),
    scope: {
      allowedPath: bound.allowedPath,
      fileName: (bound.steps.find((s) => s.action === 'save') || {}).fileName || null,
      sealedText: bound.sealedText,
      maxSteps: bound.maxSteps,
      timeoutSec: bound.timeoutSec,
      actions: bound.steps.map((s) => s.action)
    },
    approvedAt: opts.at || new Date().toISOString(),
    approvedBy: opts.by || null,
    machine: opts.machine || null,
    limits: LIMITS
  }
  receipt.receiptHash = crypto.createHash('sha256')
    .update(JSON.stringify({ approvalId, workOrderHash: receipt.workOrderHash, approvedAt: receipt.approvedAt }), 'utf8')
    .digest('hex')

  const dir = opts.receiptDir || RECEIPT_DIR
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'receipt-' + approvalId + '.json')
  if (fs.existsSync(file)) throw new Error('receipt already exists: ' + file)
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n', 'utf8')

  return { receipt, file }
}

/** The most recent receipt, or null. */
function latestReceipt (dir) {
  const d = dir || RECEIPT_DIR
  if (!fs.existsSync(d)) return null
  const files = fs.readdirSync(d).filter((n) => n.startsWith('receipt-') && n.endsWith('.json'))
  if (files.length === 0) return null
  const withTime = files.map((n) => ({ n, t: fs.statSync(path.join(d, n)).mtimeMs }))
  withTime.sort((a, b) => b.t - a.t)
  return { file: path.join(d, withTime[0].n), receipt: JSON.parse(fs.readFileSync(path.join(d, withTime[0].n), 'utf8')) }
}

/**
 * EXECUTE-side check. The summary it returns comes from the RECEIPT — never regenerated from
 * the work order — so the Owner sees what he approved even when the order has changed.
 */
function verify (opts = {}) {
  const found = opts.receipt ? { receipt: opts.receipt, file: opts.receiptFile || null } : latestReceipt(opts.receiptDir)
  if (!found) return { ok: false, refusal: 'no_receipt', reason: 'nothing has been approved' }
  const r = found.receipt

  if (r.kind !== 'owner-approval-receipt') return { ok: false, refusal: 'bad_receipt', reason: 'not an approval receipt' }
  if (!r.approvalId || !r.workOrderHash) return { ok: false, refusal: 'bad_receipt', reason: 'receipt is missing its binding' }

  // ── MIGRATION: receipts issued before the execution package existed ──────
  // A v1 receipt approved a SCOPE — what would be done — and pinned nothing about the code
  // that does it. It is kept for audit and it is not an execution authorisation, because the
  // Owner who signed it could not have been shown an implementation that did not yet exist.
  // Refused HERE, before the spent ledger is ever consulted, so it can never be admitted.
  if (!r.executionPackageManifestHash) {
    return {
      ok: false,
      refusal: 'pre_implementation_receipt',
      status: PRE_IMPLEMENTATION_STATUS,
      reason: 'approved before the execution package was pinned - retained for audit, never executable',
      receipt: r,
      file: found.file
    }
  }

  // ── THE CODE, not just the intent ────────────────────────────────────────
  // The receipt pinned the package that would run. If the package has moved, the Owner
  // approved an implementation that is no longer the one on disk.
  let currentPackageHash = null
  try { currentPackageHash = pkg.computePackageHash() } catch (e) {
    return { ok: false, refusal: 'execution_package_incomplete', reason: e.message, receipt: r, file: found.file }
  }
  if (currentPackageHash !== r.executionPackageManifestHash) {
    return {
      ok: false,
      refusal: 'execution_package_changed',
      reason: 'the code that would run is not the code that was approved',
      approvedPackageHash: r.executionPackageManifestHash,
      currentPackageHash,
      changedFiles: changedPackageFiles(r),
      receipt: r,
      file: found.file
    }
  }

  // The receipt against itself: the order it carries must still hash to the hash it claims.
  const selfHash = computeOrderHash(r.approvedOrder)
  if (selfHash !== r.workOrderHash) {
    return { ok: false, refusal: 'receipt_self_mismatch', reason: 'the receipt has been altered since it was written', receipt: r, file: found.file }
  }

  // The CURRENT order against the receipt. A mismatch means the work order moved between the
  // two screens, and the Owner must not be shown, or asked to run, something he never approved.
  let current = null
  try { current = readOrder(opts.orderFile) } catch (e) { return { ok: false, refusal: 'order_unreadable', reason: e.message, receipt: r, file: found.file } }
  const currentBound = Object.assign({}, current, { approvalId: r.approvalId })
  const currentHash = computeOrderHash(currentBound)
  if (currentHash !== r.workOrderHash) {
    return {
      ok: false,
      refusal: 'work_order_changed',
      reason: 'the work order no longer matches the approved one',
      approvedHash: r.workOrderHash,
      currentHash,
      receipt: r,
      file: found.file
    }
  }

  return { ok: true, receipt: r, file: found.file, executionPackageManifestHash: r.executionPackageManifestHash, order: Object.assign({}, currentBound, { orderHash: r.workOrderHash }) }
}

/** Render the block the EXECUTE screen shows — FROM THE RECEIPT. */
function renderReceiptSummary (receipt) {
  const rows = Array.isArray(receipt.approvedSummary) ? receipt.approvedSummary : summarise(receipt.approvedOrder)
  return rows.map(([k, v]) => '  ' + (k + ' ').padEnd(14, '.') + ' ' + v).join('\n')
}

/* ── CLI, used by the two PowerShell screens ──────────────────────────────── */

if (require.main === module) {
  const arg = (name) => {
    const i = process.argv.indexOf(name)
    return i > -1 ? process.argv[i + 1] : undefined
  }
  const cmd = process.argv[2]
  try {
    if (cmd === 'summary') {
      process.stdout.write(renderSummary(readOrder(arg('--order'))) + '\n')
    } else if (cmd === 'issue') {
      const out = issue({ by: arg('--by'), machine: arg('--machine'), orderFile: arg('--order'), receiptDir: arg('--receipts') })
      process.stdout.write(JSON.stringify({ ok: true, approvalId: out.receipt.approvalId, workOrderHash: out.receipt.workOrderHash, file: out.file }) + '\n')
    } else if (cmd === 'verify') {
      const v = verify({ orderFile: arg('--order'), receiptDir: arg('--receipts') })
      if (!v.ok) {
        process.stdout.write(JSON.stringify({
          ok: false,
          refusal: v.refusal,
          status: v.status || null,
          reason: v.reason,
          approvedHash: v.approvedHash || null,
          currentHash: v.currentHash || null,
          approvedPackageHash: v.approvedPackageHash || null,
          currentPackageHash: v.currentPackageHash || null,
          changedFiles: v.changedFiles || null
        }) + '\n')
        process.exit(3)
      }
      process.stdout.write(JSON.stringify({ ok: true, approvalId: v.receipt.approvalId, workOrderHash: v.receipt.workOrderHash, approvedAt: v.receipt.approvedAt, file: v.file, summary: renderReceiptSummary(v.receipt) }) + '\n')
    } else {
      process.stderr.write('usage: ownerApproval.js summary|issue|verify\n'); process.exit(2)
    }
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, refusal: 'error', reason: e.message }) + '\n')
    process.exit(4)
  }
}

module.exports = {
  mintApprovalId, readOrder, summarise, renderSummary, issue, verify, latestReceipt, renderReceiptSummary,
  changedPackageFiles, PRE_IMPLEMENTATION_STATUS,
  DRAFT, RECEIPT_DIR, ALLOWED_PATH
}
