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
const { t } = require('../i18n/t')
const fs = require('node:fs')
const path = require('node:path')
const { validateWorkOrder, hashWorkOrder, normRel, MUST_FORBID, isForbiddenFile } = require('./workOrder')
const {
  IDENTITY_REFUSED, identityForProject, isExecutableIdentity, isValidIdentity, sameIdentity
} = require('../projects/repositoryIdentity')

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
 * ⛔ THE ONE PLACE THAT DECIDES WHETHER A REPO-RELATIVE PATH IS USABLE.
 *
 * Containment, existence, regular-file and readability were written once here, for Work Order
 * sealing. The pre-Proposal gate needs the SAME four answers, and writing them a second time is
 * how two validators drift until one accepts what the other refuses — so it is extracted rather
 * than copied, and both stages call this.
 *
 * ⛔ THE ABSOLUTE PATH DOES NOT LEAVE THIS MODULE. `abs` is returned for the reader below and
 * for nothing else; the availability API exposes only a closed reason, because a refusal shown
 * to the Owner or written to a log must not carry a machine root.
 *
 * @returns {{ok:true, abs}|{ok:false, reason:'outside_repo'|'not_found'|'not_a_file'|'unreadable'}}
 */
function resolveRepoFile (repoRoot, relPath) {
  const root = path.resolve(repoRoot)
  const abs = path.resolve(root, relPath)
  // Containment first: `..` cannot climb out, and an absolute path cannot point elsewhere.
  if (abs !== root && !abs.startsWith(root + path.sep)) return { ok: false, reason: 'outside_repo' }
  let st
  try { st = fs.statSync(abs) } catch { return { ok: false, reason: 'not_found' } }
  if (!st.isFile()) return { ok: false, reason: 'not_a_file' }
  try { fs.accessSync(abs, fs.constants.R_OK) } catch { return { ok: false, reason: 'unreadable' } }
  return { ok: true, abs }
}

/**
 * ⛔ IS THIS PATH USABLE IN THE REPOSITORY THIS SERVER CAN ACTUALLY WORK ON?
 *
 * The root is this module's own REPO_ROOT — server-owned, resolved from the source tree. It is
 * never taken from a request body, a browser field, Owner text, a model, or a registry: a
 * caller can ask ABOUT a path, never ask about a different repository.
 *
 * Returns a closed reason and nothing else. No absolute path, no errno, no machine directory.
 *
 * @returns {{ok:true}|{ok:false, reason:'outside_repo'|'not_found'|'not_a_file'|'unreadable'}}
 */
function currentRepoFileAvailable (relPath) {
  const r = resolveRepoFile(REPO_ROOT, relPath)
  return r.ok ? { ok: true } : { ok: false, reason: r.reason }
}

/**
 * ⛔ IDENTITY FIRST, EXISTENCE SECOND — AND THE ORDER IS THE WHOLE POINT.
 *
 * `currentRepoFileAvailable` above answers 「does this path exist HERE」. That was the only
 * question asked before a Proposal, and it is not the question the Owner is asking.
 * Measured 2026-08-20 in the real tree: README.md, package.json, CLAUDE.md,
 * docs/HOUSE-RULES.md and .gitignore all exist in BOTH repositories. So 「改 aroma-system
 * 個 README.md」 answered YES — about the wrong repository — and nothing downstream carried
 * enough identity to notice.
 *
 * So the identity is checked BEFORE the filesystem is touched at all. A non-backend
 * identity is refused while it is still an identity; it never gets the chance to become a
 * true statement about a same-named backend file.
 *
 * RB1 still reads only the backend root, because the backend is still the only repository
 * this build can execute against. The machine-local binding for any OTHER repository is
 * RB2 — deliberately absent here rather than stubbed.
 *
 * @param {{projectId:string, repoFullName:string}} identity server-derived; never from a body
 * @returns {{ok:true}|{ok:false, reason}}
 */
function repositoryFileAvailable (identity, relPath) {
  if (!isExecutableIdentity(identity)) return { ok: false, reason: IDENTITY_REFUSED.NOT_EXECUTABLE }
  return currentRepoFileAvailable(relPath)
}

/**
 * Read the head of a repo-relative file. Refuses anything that is not a readable regular
 * file inside the repo — so a Work Order can never be sealed for a path that does not
 * exist (previously the validator did no fs check at all and such a path sealed fine).
 *
 * ⛔ SEAL-TIME VALIDATION STAYS, even though the pre-Proposal gate now asks the same question
 * earlier. A file can be deleted, replaced by a directory, or made unreadable between the
 * Proposal and the seal; the earlier check is an integrity gate, not a substitute for the one
 * that guards the Owner's card and the hash.
 *
 * @returns {{ok:true, text, truncated}|{ok:false, reason}}
 */
function readCurrentExcerptFromDisk (repoRoot, relPath) {
  const resolved = resolveRepoFile(repoRoot, relPath)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  let raw
  try { raw = fs.readFileSync(resolved.abs, 'utf8') } catch { return { ok: false, reason: 'unreadable' } }
  const all = raw.replace(/\r\n/g, '\n').split('\n')
  let text = all.slice(0, MAX_EXCERPT_LINES).join('\n')
  let truncated = all.length > MAX_EXCERPT_LINES
  if (text.length > MAX_EXCERPT_CHARS) { text = text.slice(0, MAX_EXCERPT_CHARS); truncated = true }
  return { ok: true, text, truncated }
}

const EXCERPT_REFUSALS = Object.freeze({
  not_found: (f) => t('wop.notFound', { file: f }),
  not_a_file: (f) => t('wop.notAFile', { file: f }),
  unreadable: (f) => t('wop.unreadable', { file: f }),
  outside_repo: (f) => t('wop.outsideRepo', { file: f })
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
    s = (title && details && details !== title) ? t('wop.detailsSuffix', { title, details }) : (title || details)
  }
  return s.replace(/\s+/g, ' ').trim()
}
// One explicit path. Not "at most a few" — exactly one.
const MAX_ALLOWED_FILES = 1
const WILDCARD_RE = /[*?[\]{}]/
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Extract the file paths a conversation actually mentioned (deterministic, no model call). */
/**
 * ⛔ IDENTITY KEEPS ITS CASE; ONLY THE COMPARISON KEY IS FOLDED.
 *
 * This used to return normRel(match), and normRel lowercases — so 「docs/Canary/Agent-Canary.md」
 * came back as 「docs/canary/agent-canary.md」 and that lowercased string travelled all the way
 * into offer.file, the Owner's card, and allowedFiles inside the sealed Work Order and its hash.
 * On Windows it still resolved, so nothing failed and the wrong spelling looked correct; on a
 * case-sensitive repository it would simply not be the file he named.
 *
 * A path the Owner wrote is an IDENTITY. Whether two mentions are the same file is a
 * COMPARISON. normRel is the right answer to the second question and the wrong answer to the
 * first, so it is now used only as a dedupe key and never as the stored value.
 *
 * First-seen spelling wins: 「docs/Canary/File.js」 then 「docs/canary/file.js」 yields one entry,
 * spelled the way he first wrote it.
 */
function mentionedFilesFrom (texts) {
  const out = []
  const seen = new Set()
  const src = Array.isArray(texts) ? texts : [texts]
  // a path-looking token: at least one '/' and a file extension, or a bare filename with
  // a known code/text extension. Deliberately conservative — this only ever NARROWS.
  const re = /(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,6}/g
  for (const t of src) {
    for (const m of String(t == null ? '' : t).match(re) || []) {
      // Separator/prefix normalisation only — the same shaping normRel does, minus the fold.
      const value = String(m).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
      const key = normRel(m)
      if (key && !seen.has(key)) { seen.add(key); out.push(value) }
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
    // producing "未能建立工作單：未能建立工作單：").
    reasonForOwner: t('wop.reasonForOwner', { errors: errors.join(t('punct.clauseSep')) })
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

  /**
   * ── RB1 L-IDENTITY: WHICH REPOSITORY, BEFORE ANYTHING ELSE ────────────────
   * The identity arrives from the SERVER-OWNED Proposal, decided when the Proposal was
   * created. It is re-verified here rather than trusted, because seal time is the moment
   * the hash is minted and a stale or tampered pair must not reach it:
   *
   *   1. it must be a well-formed pair at all
   *   2. the registry must still agree that this projectId has that repoFullName
   *   3. RB1 may only seal for the ONE repository this build can execute against
   *
   * Rule 3 is why an Aroma System order cannot be sealed yet: identity is known and
   * displayable, execution is not. That refusal is honest, not a missing feature.
   */
  const claimedIdentity = input.repositoryIdentity
  if (!isValidIdentity(claimedIdentity)) return reject([t('wop.repoIdentityMissing')])
  const registered = identityForProject(claimedIdentity.projectId)
  if (!registered || !sameIdentity(registered, claimedIdentity)) {
    return reject([t('wop.repoIdentityUnknown')])
  }
  if (!isExecutableIdentity(claimedIdentity)) {
    return reject([t('wop.repoNotExecutable', { repo: claimedIdentity.repoFullName })])
  }

  // ── L0: shape ─────────────────────────────────────────────────────────────
  const goal = plainGoal(p.goal)
  if (!goal) errors.push(t('wop.goalEmpty'))

  // The producer accepts ONE candidate. An array is tolerated only to reject it loudly.
  let candidates = []
  if (typeof p.candidateFile === 'string') candidates = [p.candidateFile]
  else if (Array.isArray(p.candidateFile)) candidates = p.candidateFile
  else if (Array.isArray(p.allowedFiles)) candidates = p.allowedFiles // defensive: model shape drift
  candidates = candidates.filter((x) => typeof x === 'string' && x.trim() !== '')

  if (candidates.length === 0) errors.push(t('wop.needOneFile'))
  if (candidates.length > MAX_ALLOWED_FILES) errors.push(t('wop.onlyOneFile', { n: candidates.length }))

  const raw = candidates[0]
  if (raw) {
    const posix = raw.replace(/\\/g, '/')
    if (WILDCARD_RE.test(posix)) errors.push(t('wop.noWildcard'))
    if (posix.endsWith('/')) errors.push(t('wop.noFolder'))
    if (!/\.[A-Za-z0-9]{1,6}$/.test(posix)) errors.push(t('wop.needExtension'))
    if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix)) errors.push(t('wop.needRelative'))
    if (posix.includes('..')) errors.push(t('wop.noDotDot'))
  }
  if (errors.length) return reject(errors)

  const file = raw.replace(/\\/g, '/')

  // ── L1: the HARD boundary — reuse the existing validator, never a parallel one ──
  if (isForbiddenFile(file)) errors.push(t('wop.protected', { file }))
  if (errors.length) return reject(errors)

  // ── L2: provenance — option B, the file must already be in the conversation ──
  // ⛔ BOTH SIDES THROUGH normRel, EXPLICITLY. mentionedFilesFrom used to hand back values that
  //    were already folded, so this comparison worked by accident of its input. It now returns
  //    the Owner's own spelling, and the folding has to happen HERE — otherwise a request that
  //    named 「docs/Canary/x.md」 would fail its own provenance check on a case difference.
  const mentioned = (Array.isArray(input.mentionedFiles) && input.mentionedFiles.length
    ? input.mentionedFiles
    : mentionedFilesFrom(input.conversation)).map(normRel)
  if (!mentioned.includes(normRel(file))) {
    return reject([t('wop.notMentioned', { file })])
  }

  // ── L3: the file must actually EXIST and be readable, because the card promises the
  //    Owner a true "現時內容". No file ⇒ no card and no Work Order. ──────────────
  // ⛔ THE EXCERPT COMES FROM THE REPOSITORY THE ORDER NAMES. Reaching this line already
  //    proves the identity IS the executable backend (L-IDENTITY refuses everything else
  //    above), so the backend root is the correct — and only — root to read.
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
  if (!SAFE_ID.test(approvalId)) return reject([t('wop.badApprovalId')])

  const workOrder = {
    goal,
    // RB1: the verified pair, straight from the registry record — not the caller's copy.
    projectId: registered.projectId,
    repoFullName: registered.repoFullName,
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
  currentRepoFileAvailable,
  repositoryFileAvailable,
  DEFAULTS,
  MAX_ALLOWED_FILES,
  MAX_EXCERPT_LINES,
  MAX_EXCERPT_CHARS
}
