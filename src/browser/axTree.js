'use strict'

/**
 * axTree.js — turning a raw accessibility tree into something a model can act on.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THIS IS `read_page`, AND IT IS THE REAL WORK. `click` is not.
 *
 * Getting the tree is ONE CDP call — `Accessibility.getFullAXTree`. The real Costco search
 * page returns **890 nodes: 419 ignored, 91 InlineTextBox duplicating StaticText, 85
 * generic**. Handing that to a model is handing it the DOM with extra steps.
 *
 * What makes a tree ACTIONABLE is four things, and each is a rule below:
 *   PRUNED       what survives is what a person could point at
 *   REFERENCED   every node carries a stable ref, so `click` targets THAT node —
 *                which is why no coordinate ever appears in this file's output
 *   BOUNDED      it fits a budget, and when it is cut it SAYS SO
 *   DETERMINISTIC the same tree read twice gives the same refs
 *   OPAQUE       and a ref cannot be GUESSED — measured 2026-08-06, a model reached an
 *                element it could not see by extrapolating numeric refs, and answered an
 *                item number as a ref. See `REF_SALT`.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────
 * It does not decide that a modal blocks a button, or that a control is 「the real one」.
 * That is actionability, it belongs to `click`, and it is a JUDGEMENT. `read_page` reports
 * what is there. The Costco measurement stands: four actions against six classes of
 * judgement a selector cannot make — and this file is not where that gets solved.
 */

const path = require('node:path')

const CORPUS_DIR = path.join(__dirname, '..', '..', 'test', 'fixtures', 'axcorpus')

/**
 * ⚠ THE TRUNCATION NOTICE IS ONE LINE ON PURPOSE, AND IT WAS ONCE LONGER.
 *
 * On 2026-08-06 the benchmark caught a model answering `REF 634` on the truncated list — a
 * ref that was **not in its input**, reached by extrapolating the visible ref numbering. So
 * the notice was rewritten: a header before the data, 「refs are not sequential」, 「answer
 * only a printed ref」.
 *
 * ── THEN IT WAS A/B TESTED, AND IT LOST ──────────────────────────────────────
 * Same question, same nodes, same session, interleaved, ten runs per arm:
 *
 *      OLD (this one-liner)   0/10 invented   10/10 correct
 *      NEW (the rewrite)      0/10 invented    9/10 correct
 *
 * The rewrite also produced a NEW failure — `REF 250`, the item number answered as a ref,
 * which is present, printed, and the wrong element, so nothing structural refuses it.
 *
 * > **Owner's ruling: 「Keeping a change whose sole measured signal is negative because it
 * > 『should』 help is the thing we keep removing.」 REVERTED.**
 *
 * ── AND THE RATE I FIRST REPORTED WAS WRONG ──────────────────────────────────
 * I called it 1 in 4. That was one event in four attempts. With 14 attempts on record it is
 * **1 in 14 ≈ 7%** — which also means a wording change was never measurable by a
 * wording-change-sized trial. See HR-14's worked example.
 *
 * ── SO THE FENCE MOVED FROM THE TEXT TO THE FORMAT ───────────────────────────
 * **Do not re-expand this notice.** The defect it was aimed at is now handled structurally by
 * the opaque ref (see `REF_SALT` below): there is no sequence to extrapolate, and `250` is
 * not a well-formed ref at all. A notice asks; a format refuses.
 */

/**
 * Roles that are ACTIONABLE and therefore survive even with no accessible name. An unnamed
 * button is still a button a person can see; dropping it would hide the page's own defect
 * rather than report it.
 */
const INTERACTIVE = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'slider', 'spinbutton', 'switch',
  'searchbox', 'tab', 'treeitem'
])

/**
 * Roles that carry MEANING when named — a heading tells a model where it is — but are noise
 * when unnamed.
 */
const STRUCTURAL = new Set([
  'heading', 'dialog', 'alertdialog', 'navigation', 'main', 'form', 'search',
  'article', 'region', 'banner', 'contentinfo', 'table', 'row', 'cell', 'columnheader',
  'img', 'image', 'alert', 'status', 'progressbar', 'tabpanel'
])

/**
 * Never survives. `InlineTextBox` is a layout artefact that duplicates its StaticText parent
 * — 91 of them on one real page — and `generic`/`none` are containers with nothing to point
 * at. Dropping these is most of the order-of-magnitude reduction.
 */
const NEVER = new Set(['InlineTextBox', 'generic', 'none', 'presentation', 'LineBreak'])

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE REF IS OPAQUE ON PURPOSE. `r4f2a9c1b`, never `634`.
 *
 * This replaced a truncation notice that told the model not to guess. The notice was A/B
 * tested against the one it replaced and scored WORSE, so it was reverted. **A declaration
 * degrades; a format cannot be argued with.**
 *
 * Two measured failures, and what this does to each:
 *
 *   REF 634 — the model extrapolated the ref numbering to reach an element it could not see.
 *             `link "Item 210"`, real, pruned out, wrong. **Now unreachable: there is no
 *             sequence to extrapolate. A ref is a hash, and you cannot hash an id you were
 *             never shown.**
 *
 *   REF 250 — the model answered the ITEM NUMBER as a ref. It was present, printed, and the
 *             wrong element, so it passed every absence-based check we have. **Now
 *             malformed: `250` is not a ref, and `resolveRef` refuses it outright.**
 *
 * ── WHY A HASH AND NOT A RANDOM TOKEN ────────────────────────────────────────
 * A ref must survive a re-read, or `click` cannot use one taken from an earlier `read_page`.
 * A per-read random token would break that; a hash of `backendDOMNodeId` keeps it, because
 * it is a pure function of the node's own identity and of nothing about this particular read.
 *
 * ── AND WHY NOTHING IS STORED ────────────────────────────────────────────────
 * `resolveRef` recomputes rather than remembering. A stored map is state, and state has a
 * staleness question — 「is this map still the page it came from?」 — that a recomputation
 * simply does not have. If the node is gone, the ref resolves to nothing, which is the
 * correct answer and not an error to recover from.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const crypto = require('node:crypto')

/** Fixed, not secret and not per-read. Secrecy is not what makes the ref unguessable —
 *  not having been shown the id is. The constant exists so refs are stable forever. */
const REF_SALT = 'aroma.axtree.ref.v1'

function refFor (domId) {
  return 'r' + crypto.createHash('sha256').update(REF_SALT + ':' + String(domId)).digest('hex').slice(0, 8)
}

/**
 * A ref back to a DOM node, by recomputation over the tree it came from.
 * @returns {number|null} the backendDOMNodeId, or null — including for anything malformed.
 */
function resolveRef (ref, rawNodes) {
  if (typeof ref !== 'string' || !/^r[0-9a-f]{8}$/.test(ref)) return null
  for (const n of Array.isArray(rawNodes) ? rawNodes : []) {
    const id = n && n.backendDOMNodeId
    if (id === undefined || id === null) continue
    if (refFor(id) === ref) return Number(id)
  }
  return null
}

function valueOf (v) { return v && typeof v === 'object' ? v.value : v }

function normalise (raw) {
  const role = String(valueOf(raw.role) || '')
  const name = String(valueOf(raw.name) || '').replace(/\s+/g, ' ').trim()
  return { role, name }
}

/**
 * @param {object[]} rawNodes  the `nodes` array from Accessibility.getFullAXTree
 * @param {{maxNodes?: number, maxChars?: number}} [opts]
 * @returns {{nodes, text, truncated, totalCandidates, rawNodeCount}}
 */
function readPage (rawNodes, opts = {}) {
  const maxNodes = Number.isFinite(opts.maxNodes) ? opts.maxNodes : 250
  const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : 8000
  const raw = Array.isArray(rawNodes) ? rawNodes : []

  const candidates = []
  for (const n of raw) {
    // The tree's own verdict comes first: a node the platform marks ignored is not
    // something a person can point at.
    if (n.ignored === true) continue
    const { role, name } = normalise(n)
    if (!role || NEVER.has(role)) continue

    const interactive = INTERACTIVE.has(role)
    // Text that carries content is worth keeping; text with no content is not.
    const isText = role === 'StaticText' || role === 'text'
    if (!interactive && !name) continue
    if (isText && name.length < 2) continue
    if (!interactive && !STRUCTURAL.has(role) && !isText) continue

    // THE REF IS THE DOM NODE, not a position in this list. A ref taken from one read must
    // still mean the same node when the click happens — a positional index would silently
    // point somewhere else after any change. It is HASHED rather than printed: see the
    // block comment above `REF_SALT`.
    const domId = n.backendDOMNodeId
    if (domId === undefined || domId === null) continue

    candidates.push({ ref: refFor(domId), domId: Number(domId), role, name, interactive })
  }

  const totalCandidates = candidates.length
  let kept = candidates.slice(0, maxNodes)
  let truncated = totalCandidates > kept.length

  const line = (n) => `[#${n.ref}] ${n.role}${n.name ? ' "' + n.name + '"' : ''}`
  let body = kept.map(line).join('\n')

  // The character budget is a SECOND bound, because 250 short nodes and 250 long ones are
  // not the same prompt. Cutting here must state itself exactly as cutting by count does.
  if (body.length > maxChars) {
    truncated = true
    const lines = []
    let used = 0
    for (const n of kept) {
      const l = line(n)
      if (used + l.length + 1 > maxChars - 120) break
      lines.push(l); used += l.length + 1
    }
    kept = kept.slice(0, lines.length)
    body = lines.join('\n')
  }

  // A CUT THAT SAYS IT WAS CUT. A model reads the text; a flag it never sees is not a
  // disclosure, and a partial page that reads as whole is `count: 43` in a new place.
  //
  // ⚠ REVERTED 2026-08-06 to exactly this one line. The expanded version — a header before
  // the data, 「refs are not sequential」, 「answer only a printed ref」 — was A/B tested against
  // this one and scored WORSE (9/10 against 10/10) while introducing a new failure mode.
  // The Owner's ruling: 「Keeping a change whose sole measured signal is negative because it
  // 『should』 help is the thing we keep removing.」 The fence is now the REF FORMAT, above.
  const notice = truncated
    ? `\n（已截斷 truncated：顯示 ${kept.length} 項，符合條件嘅共 ${totalCandidates} 項；未顯示嘅嘢唔代表唔存在）`
    : ''
  const text = body + notice

  // An ambiguous ref would click the wrong element, so a collision is REPORTED rather than
  // hoped against. At 32 bits over a 4000-node page the expected rate is ~1 in 500 reads of
  // a page that size — rare, and rare is not never.
  const refCollision = new Set(kept.map((n) => n.ref)).size !== kept.length

  return {
    nodes: kept,
    text,
    truncated,
    totalCandidates,
    refCollision,
    rawNodeCount: raw.length
  }
}

module.exports = { readPage, resolveRef, refFor, CORPUS_DIR, INTERACTIVE, NEVER }
