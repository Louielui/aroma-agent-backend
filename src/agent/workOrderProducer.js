'use strict'

/**
 * workOrderProducer.js — STEP 2 of the chain, built to the Allowed Files Governance
 * Contract v1: "Policy constrains; Xiangxiang proposes; Louie approves; executor
 * cannot expand."
 *
 * 香香 supplies a PROPOSAL (a goal, one candidate file, optionally a test command).
 * That proposal is never an authorization and never a Work Order. This module is the
 * SYSTEM side: it constrains, validates, and — only if everything passes — SEALS a
 * Work Order with system-owned fields (forbiddenActions, timeoutSec, costCapUsd,
 * approvalId, branch) and a system-computed hash. The model cannot set any of those,
 * cannot widen scope, and cannot supply its own hash.
 *
 * LAYER ORDER (fail-closed, in this order, nothing skipped):
 *   L0 shape        — a goal, exactly one candidate path, no wildcard/dir/glob
 *   L1 hard bound   — the EXISTING validateWorkOrder / FORBIDDEN_FILE_PATTERNS. There is
 *                     deliberately NO second validator: this module calls the one in
 *                     workOrder.js and never re-implements or relaxes it.
 *   L2 provenance   — Owner decision (option B): the file must ALREADY have been
 *                     mentioned in the conversation. 香香 may not browse or invent paths.
 *
 * A rejected proposal returns { ok:false, errors[], reasonForOwner } and NO Work Order.
 */

const crypto = require('node:crypto')
const { validateWorkOrder, hashWorkOrder, normRel, MUST_FORBID, isForbiddenFile } = require('./workOrder')

// System-owned defaults. 香香 cannot raise these; the Owner changes them here.
const DEFAULTS = Object.freeze({ timeoutSec: 120, costCapUsd: 0.5 })
// One explicit path. Not "at most a few" — exactly one.
const MAX_ALLOWED_FILES = 1
const WILDCARD_RE = /[*?[\]{}]/
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Extract the file paths a conversation actually mentioned (deterministic, no model call). */
function mentionedFilesFrom (texts) {
  const out = []
  const src = Array.isArray(texts) ? texts : [texts]
  // a path-looking token: at least one '/' and a file extension, or a bare filename with
  // a known code/text extension. Deliberately conservative — this only ever NARROWS.
  const re = /(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,6}/g
  for (const t of src) {
    for (const m of String(t == null ? '' : t).match(re) || []) {
      const n = normRel(m)
      if (n && !out.includes(n)) out.push(n)
    }
  }
  return out
}

function reject (errors) {
  return {
    ok: false,
    workOrder: null,
    errors,
    // plain-language explanation the Owner sees instead of a Work Order
    reasonForOwner: '未能建立工作單:' + errors.join(';') + '。需要你確認一個已經在對話中提過、且不屬於受保護範圍的單一檔案。'
  }
}

/**
 * @param {{ proposal: {goal, candidateFile, allowedTestCommand?}, conversation?: string[]|string,
 *           mentionedFiles?: string[], defaults?: object, newId?: function }} input
 * @returns {{ ok, workOrder, errors, reasonForOwner? }}  workOrder is SEALED when ok
 */
function proposeWorkOrder (input = {}) {
  const p = (input && input.proposal) || {}
  const errors = []

  // ── L0: shape ─────────────────────────────────────────────────────────────
  const goal = typeof p.goal === 'string' ? p.goal.trim() : ''
  if (!goal) errors.push('goal 不可為空')

  // The producer accepts ONE candidate. An array is tolerated only to reject it loudly.
  let candidates = []
  if (typeof p.candidateFile === 'string') candidates = [p.candidateFile]
  else if (Array.isArray(p.candidateFile)) candidates = p.candidateFile
  else if (Array.isArray(p.allowedFiles)) candidates = p.allowedFiles // defensive: model shape drift
  candidates = candidates.filter((x) => typeof x === 'string' && x.trim() !== '')

  if (candidates.length === 0) errors.push('必須指定一個檔案')
  if (candidates.length > MAX_ALLOWED_FILES) errors.push(`一次只可以改一個檔案(收到 ${candidates.length} 個)`)

  const raw = candidates[0]
  if (raw) {
    const posix = raw.replace(/\\/g, '/')
    if (WILDCARD_RE.test(posix)) errors.push('不接受通用字元(wildcard/glob)')
    if (posix.endsWith('/')) errors.push('不接受資料夾,必須是單一檔案')
    if (!/\.[A-Za-z0-9]{1,6}$/.test(posix)) errors.push('必須是明確的檔案路徑(要有副檔名)')
    if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix)) errors.push('必須是相對路徑')
    if (posix.includes('..')) errors.push('路徑不可包含 ..')
  }
  if (errors.length) return reject(errors)

  const file = raw.replace(/\\/g, '/')

  // ── L1: the HARD boundary — reuse the existing validator, never a parallel one ──
  if (isForbiddenFile(file)) errors.push(`「${file}」屬於受保護範圍(憑證/環境/授權閘/稽核/治理),不可修改`)
  if (errors.length) return reject(errors)

  // ── L2: provenance — option B, the file must already be in the conversation ──
  const mentioned = Array.isArray(input.mentionedFiles) && input.mentionedFiles.length
    ? input.mentionedFiles.map(normRel)
    : mentionedFilesFrom(input.conversation)
  if (!mentioned.includes(normRel(file))) {
    return reject([`「${file}」未在對話中提及過。我不會自行搜尋或推測檔案路徑`])
  }

  // ── SEAL: system-owned fields only. The model supplies none of these. ──────
  const defaults = Object.assign({}, DEFAULTS, input.defaults || {})
  const newId = typeof input.newId === 'function' ? input.newId : () => `appr_${crypto.randomUUID().slice(0, 8)}`
  const approvalId = newId()
  if (!SAFE_ID.test(approvalId)) return reject(['內部錯誤:approvalId 格式不正確'])

  const workOrder = {
    goal,
    allowedFiles: [file],
    allowedTestCommand: (typeof p.allowedTestCommand === 'string' && p.allowedTestCommand.trim() !== '') ? p.allowedTestCommand.trim() : null,
    forbiddenActions: [...MUST_FORBID, 'cred-edit', 'env-edit', 'gate-edit', 'audit-edit'],
    timeoutSec: defaults.timeoutSec,
    costCapUsd: defaults.costCapUsd,
    branch: `agent/${approvalId}`,
    approvalId
  }

  // Final gate: the sealed order must satisfy the SAME validator the runner uses.
  const v = validateWorkOrder(workOrder)
  if (!v.ok) return reject(v.errors)

  return { ok: true, workOrder, hash: hashWorkOrder(workOrder), errors: [] }
}

module.exports = { proposeWorkOrder, mentionedFilesFrom, DEFAULTS, MAX_ALLOWED_FILES }
