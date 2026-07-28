'use strict'

/**
 * workOrderProducer.js — STEP 2 of the chain, built to the Allowed Files Governance
 * Contract v1: "Policy constrains; Xiangxiang proposes; Louie approves; executor
 * cannot expand."
 *
 * 心燈 supplies a PROPOSAL (a goal, one candidate file, optionally a test command).
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
 *                     mentioned in the conversation. 心燈 may not browse or invent paths.
 *
 * A rejected proposal returns { ok:false, errors[], reasonForOwner } and NO Work Order.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { validateWorkOrder, hashWorkOrder, normRel, MUST_FORBID, isForbiddenFile } = require('./workOrder')

// System-owned defaults. 心燈 cannot raise these; the Owner changes them here.
const DEFAULTS = Object.freeze({ timeoutSec: 120, costCapUsd: 0.5, approvalTtlSec: 600 })

// ── The bounded read behind 「現時內容」 (Owner Decision Card v2) ─────────────────
// The card shows the Owner what the file says RIGHT NOW. That is a fact, so it is read
// from the real file at seal time — never described by a model. The read is bounded so a
// large file cannot flood the card: the FIRST 20 LINES, and at most 800 CHARACTERS,
// whichever limit is reached first. `truncated` says plainly when there is more.
const MAX_EXCERPT_LINES = 20
const MAX_EXCERPT_CHARS = 800

const REPO_ROOT = path.resolve(__dirname, '..', '..')

/**
 * Read the head of a repo-relative file. Refuses anything that is not a readable regular
 * file inside the repo — so a Work Order can never be sealed for a path that does not
 * exist (previously the validator did no fs check at all and such a path sealed fine).
 * @returns {{ok:true, text, truncated}|{ok:false, reason}}
 */
function readCurrentExcerptFromDisk (repoRoot, relPath) {
  const root = path.resolve(repoRoot)
  const abs = path.resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + path.sep)) return { ok: false, reason: 'outside_repo' }
  let st
  try { st = fs.statSync(abs) } catch { return { ok: false, reason: 'not_found' } }
  if (!st.isFile()) return { ok: false, reason: 'not_a_file' }
  let raw
  try { raw = fs.readFileSync(abs, 'utf8') } catch { return { ok: false, reason: 'unreadable' } }
  const all = raw.replace(/\r\n/g, '\n').split('\n')
  let text = all.slice(0, MAX_EXCERPT_LINES).join('\n')
  let truncated = all.length > MAX_EXCERPT_LINES
  if (text.length > MAX_EXCERPT_CHARS) { text = text.slice(0, MAX_EXCERPT_CHARS); truncated = true }
  return { ok: true, text, truncated }
}

const EXCERPT_REFUSALS = Object.freeze({
  not_found: (f) => `「${f}」在程式庫中不存在。我不會為一個不存在的檔案建立工作單`,
  not_a_file: (f) => `「${f}」不是一個檔案(可能是資料夾)`,
  unreadable: (f) => `「${f}」無法讀取,所以我無法向你顯示它現時的內容`,
  outside_repo: (f) => `「${f}」不在程式庫範圍內`
})

/**
 * Turn whatever arrived in `goal` into ONE plain sentence.
 *
 * A promoted Proposal carries a v1 worker brief ("Title: x\n\nDetails: y") — that is
 * machine structure, and it leaked onto the Owner's card verbatim. Normalizing here (at
 * seal time, deterministically) means the sentence the Owner reads is the sentence inside
 * the hash; there is no separate display-time rewrite.
 */
function plainGoal (raw) {
  let s = String(raw == null ? '' : raw).replace(/\r\n/g, '\n').trim()
  const m = s.match(/^Title:\s*([\s\S]*?)(?:\n\s*\n\s*Details:\s*([\s\S]*))?$/)
  if (m) {
    const title = (m[1] || '').replace(/\s+/g, ' ').trim().replace(/[。.]+$/, '')
    const details = (m[2] || '').replace(/\s+/g, ' ').trim()
    s = (title && details && details !== title) ? `${title}（${details}）` : (title || details)
  }
  return s.replace(/\s+/g, ' ').trim()
}
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
    // Plain-language explanation the Owner sees instead of a Work Order. It carries its own
    // "未能建立工作單" opener, so no caller should prefix that again (the demo page used to,
    // producing "未能建立工作單：未能建立工作單:").
    reasonForOwner: '未能建立工作單:' + errors.join(';') + '。需要你確認一個已經在對話中提過、確實存在、且不屬於受保護範圍的單一檔案。'
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
  const goal = plainGoal(p.goal)
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

  // ── L3: the file must actually EXIST and be readable, because the card promises the
  //    Owner a true "現時內容". No file ⇒ no card and no Work Order. ──────────────
  const reader = typeof input.readCurrentExcerpt === 'function'
    ? input.readCurrentExcerpt
    : (rel) => readCurrentExcerptFromDisk(input.repoRoot || REPO_ROOT, rel)
  const cur = reader(file)
  if (!cur || cur.ok !== true) {
    const why = (cur && EXCERPT_REFUSALS[cur.reason]) || EXCERPT_REFUSALS.not_found
    return reject([why(file)])
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
    approvalId,
    // Card v2 facts, sealed together with everything else so they are inside the hash.
    // `intendedChange` is 心燈's STATED INTENT, echoed verbatim and labelled as intent —
    // the agent has not run, so it is never presented as an achieved result.
    currentExcerpt: cur.text,
    currentExcerptTruncated: !!cur.truncated,
    intendedChange: (typeof p.intendedChange === 'string' && p.intendedChange.trim() !== '') ? p.intendedChange.trim() : null,
    approvalTtlSec: defaults.approvalTtlSec
  }

  // Final gate: the sealed order must satisfy the SAME validator the runner uses.
  const v = validateWorkOrder(workOrder)
  if (!v.ok) return reject(v.errors)

  return { ok: true, workOrder, hash: hashWorkOrder(workOrder), errors: [] }
}

module.exports = {
  proposeWorkOrder,
  mentionedFilesFrom,
  plainGoal,
  readCurrentExcerptFromDisk,
  DEFAULTS,
  MAX_ALLOWED_FILES,
  MAX_EXCERPT_LINES,
  MAX_EXCERPT_CHARS
}
