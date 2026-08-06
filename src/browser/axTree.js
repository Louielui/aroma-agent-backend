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
const { budgetGroups } = require('./groupBudget')

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

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CONTAINMENT — 「結構一直喺 payload 度，係我第一行就掉咗佢。」
 *
 * A CDP AXNode carries `parentId` and `childIds`. Measured on the frozen real Costco capture:
 * **parentId on 3564 of 3565 nodes**, and every one of the 21 `button "Add to Cart"` resolves
 * to a distinct product-naming ancestor. This file used to treat `rawNodes` as a flat array
 * and throw all of that away on its first line.
 *
 * ── CONTEXT IS EARNED, NEVER UNIVERSAL ──────────────────────────────────────
 * Measured cost of labelling every line: **+22% MDN, +47% Costco, +228% Wikipedia portal.**
 * On the portal that triples the output, so the budget cuts more nodes, so more of the page
 * goes invisible — **the truncation problem back in a new shape.**
 *
 * So a node whose (role, name) is UNIQUE gets no container and must not: every character
 * spent labelling `link "Skip to Main Content"` is a character not spent on a node the model
 * cannot otherwise reach. On Costco only 82 of 548 nodes pay.
 *
 * ── AND NO FIXED DEPTH ──────────────────────────────────────────────────────
 * The depth to a usable label measured **1–6, varying within a single page.** Costco's
 * uniform depth 3 would have produced exactly the wrong rule. The chain is walked until it
 * resolves, then COLLAPSED to that one ancestor — output nesting is at most 1 regardless.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/** A label must actually distinguish; a two-character name distinguishes nothing. */
const MIN_LABEL = 12
const MAX_CLIMB = 8

function buildIndex (raw) {
  const byId = new Map()
  for (const n of raw) if (n && n.nodeId !== undefined) byId.set(n.nodeId, n)
  return byId
}

function subtreeLabel (node, byId, ownName, seen = new Set()) {
  for (const cid of node.childIds || []) {
    if (seen.has(cid)) continue
    seen.add(cid)
    const c = byId.get(cid)
    if (!c) continue
    const nm = String(valueOf(c.name) || '').replace(/\s+/g, ' ').trim()
    if (nm && nm !== ownName && nm.length >= MIN_LABEL) return nm
    const deeper = subtreeLabel(c, byId, ownName, seen)
    if (deeper) return deeper
  }
  return null
}

/**
 * For each duplicate node, the NEAREST ancestor that both (a) differs from every
 * same-named sibling's ancestor at that height and (b) carries a usable label.
 *
 * ⛔ Returns null when no such ancestor exists — the genuinely-identical-siblings case.
 * That is REPORTED as ambiguity, never resolved by picking one. Two real `Add` buttons are
 * the page's own ambiguity, and choosing between them is the pruner lying about the page.
 */
function resolveContainers (dupNodes, byId) {
  const result = new Map()
  const ancestorAt = (n, h) => {
    let c = byId.get(n.nodeId)
    for (let i = 0; i < h && c; i++) c = byId.get(c.parentId)
    return c || null
  }
  for (let h = 1; h <= MAX_CLIMB; h++) {
    const pending = dupNodes.filter((n) => !result.has(n.nodeId))
    if (!pending.length) break
    const at = new Map()
    for (const n of pending) {
      const a = ancestorAt(n, h)
      if (!a) continue
      if (!at.has(a.nodeId)) at.set(a.nodeId, [])
      at.get(a.nodeId).push(n)
    }
    for (const [aid, members] of at) {
      if (members.length !== 1) continue // still shares its ancestor with a twin — climb again
      const a = byId.get(aid)
      const own = String(valueOf(members[0].name) || '').replace(/\s+/g, ' ').trim()
      const label = subtreeLabel(a, byId, own)
      if (label) result.set(members[0].nodeId, { containerNode: a, label })
    }
  }
  return result
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

    candidates.push({ ref: refFor(domId), domId: Number(domId), role, name, interactive, nodeId: n.nodeId })
  }

  // ── NAME ECHO — HR-16 ───────────────────────────────────────────────────────
  // A node carrying the same accessible name as an INTERACTIVE node is that element's own
  // content, not a second thing to point at: the text inside a button, the label beside a
  // field, the logo image inside the logo link. Printing it as a peer manufactures a choice
  // the page does not offer — and the model took the wrong branch 2 times in 10.
  //
  // Measured before writing this: 584 of 1724 surviving corpus nodes (34%) sat in a name
  // group mixing interactive with non-interactive, across FIVE role combinations including
  // `image + link` — which is why this keys on INTERACTIVITY and not on the role StaticText.
  //
  // ⚠ Two things it deliberately does NOT do:
  //   - it never drops an interactive node. Two real buttons named 「Add」 are a genuine
  //     ambiguity ON THE PAGE, and hiding one would be the pruner lying about the page.
  //   - it never drops a name that has no interactive twin. `StaticText + heading` is
  //     redundancy, not a clickable-or-not choice, and is out of scope until measured.
  //
  // `opts.dropNameEchoes` exists ONLY so the A/B trial can measure this against its own
  // absence without maintaining a second copy of the pruner — comparing two code paths would
  // measure the difference between the copies. It defaults ON and a test asserts that.
  // It is not a feature flag and nothing in the runtime passes it.
  const interactiveNames = new Set()
  for (const c of candidates) if (c.interactive && c.name) interactiveNames.add(c.name)
  // NOT an in-place mutation: `candidates.length = 0` once emptied the very array the
  // unpruned branch had aliased, and every node vanished. Caught by the seam test.
  const kept0 = opts.dropNameEchoes === false
    ? candidates.slice()
    : candidates.filter((c) => c.interactive || !c.name || !interactiveNames.has(c.name))
  const nameEchoesDropped = candidates.length - kept0.length

  const totalCandidates = kept0.length

  // ── CONTAINERS, FOR DUPLICATES ONLY ─────────────────────────────────────────
  const byId = buildIndex(raw)
  const nameCount = new Map()
  for (const c of kept0) {
    if (!c.name) continue
    const k = c.role + "|" + c.name
    nameCount.set(k, (nameCount.get(k) || 0) + 1)
  }
  const dupes = kept0.filter((c) => c.name && nameCount.get(c.role + "|" + c.name) > 1)
  // ⚠ THE SEAM MUST ISOLATE EXACTLY ONE THING, AND PROVING THAT IS NOT THE SAME AS
  // INTENDING IT. This line used to read `opts.group === false ? new Map() : resolve(...)`.
  // Ambiguity is DEFINED as a duplicate with no resolving container — so skipping the
  // resolution made every duplicate unresolvable, and the "flat" arm of the A/B carried
  // "do NOT choose between them" on 32 nodes. It was not a baseline; it was a different
  // treatment. See HR-17's worked example.
  //
  // So the resolution ALWAYS runs — it is pure computation over the raw tree — and the seam
  // controls only whether containers are EMITTED as group lines.
  const resolved = resolveContainers(dupes, byId)

  // A duplicate with NO resolving ancestor is genuinely indistinguishable on the page.
  // It is FLAGGED, never merged away and never given a container that would imply it was
  // told apart. See HR-16 finding 2.
  // BY NODE, NOT BY NAME. Flagging by name was the seam bug's residue: where a name has some
  // resolvable instances and some not, a name-keyed flag marks the resolvable ones too — and
  // it marked them only in the flat arm, because the grouped arm had already moved them into
  // groups. 153 flagged flat against 134 grouped, for the same page.
  // A node is ambiguous iff IT is a duplicate and IT has no resolving container.
  const ambiguousIds = new Set()
  for (const c of dupes) if (!resolved.has(c.nodeId)) ambiguousIds.add(c.nodeId)
  const dupCount = (c) => nameCount.get(c.role + '|' + c.name) || 1

  const groups = []
  const byContainer = new Map()
  const grouped = new Set()
  for (const c of kept0) {
    const r = resolved.get(c.nodeId)
    if (!r) continue
    c.groupName = r.label             // metadata either way — identical in both arms
    // ⛔ GROUPING IS OFF BY DEFAULT. Owner ruling 2026-08-06, on measurement:
    //
    //   FLAT     V2 87.5%   V3 100%
    //   GROUPED  V2 56.3%   V3 100%
    //
    // It costs 31 points on the questions that already passed and buys NOTHING on the
    // questions it was built for — because the flat list is emitted in DOCUMENT ORDER, so a
    // product link already sits immediately above its own 「Add to Cart」. Proximity carried
    // the association the whole time.
    //
    // The code stays because it is correct and tested. What is unproven is whether it EARNS
    // ITS BUDGET. Do not turn this on without a measurement showing it does.
    if (opts.group !== true) continue
    const gid = r.containerNode.nodeId
    if (!byContainer.has(gid)) {
      const gref = r.containerNode.backendDOMNodeId
      const grp = { ref: gref === undefined || gref === null ? "g" + gid : refFor(gref), name: r.label, members: [] }
      byContainer.set(gid, grp)
      groups.push(grp)
    }
    byContainer.get(gid).members.push(c)
    grouped.add(c.ref)
  }

  const loose = kept0.filter((c) => !grouped.has(c.ref)).map((c) => {
    if (ambiguousIds.has(c.nodeId)) {
      c.ambiguous = true
      const n = dupCount(c)
      return { ...c, name: c.name + ` ⚠ indistinguishable from ${n - 1} other${n === 2 ? '' : 's'} on this page — do NOT choose between them` }
    }
    return c
  })

  const budget = budgetGroups(groups, { maxNodes, maxChars, looseFirst: opts.looseFirst === true }, loose)
  const kept = kept0.filter((c) => budget.emittedRefs.has(c.ref))

  const refCollision = new Set(kept.map((n) => n.ref)).size !== kept.length

  return {
    nodes: kept,
    text: budget.text,
    truncated: budget.truncated,
    totalCandidates,
    refCollision,
    nameEchoesDropped,
    groupCount: budget.groups.length,
    groupsDropped: budget.groupsDropped,
    ambiguousCount: kept.filter((n) => n.ambiguous).length,
    rawNodeCount: raw.length
  }
}

module.exports = { readPage, resolveRef, refFor, CORPUS_DIR, INTERACTIVE, NEVER }
