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
 * ⚠ WHY THE TRUNCATION NOTICE LOOKS OVER-WRITTEN. Do not trim it back to one line.
 *
 * The 2026-08-06 benchmark ran this against a real model. On the truncated list it answered
 * `REF 634` — **a ref that was not in its input.** 634 is a REAL node (`link "Item 210"`)
 * that the pruner had cut; the model reached it by extrapolating the ref numbering from the
 * visible lines. The true ref was 754. `click` would have hit Item 210 and reported success.
 *
 * The old notice was one line, in Chinese, placed AFTER 250 lines of data, and it said only
 * that unshown things may exist. It never said the two things that would have stopped this:
 * **refs are not sequential**, and **only a printed ref may be answered.**
 *
 * ── AND IT IS A RATE, NOT A PROPERTY ────────────────────────────────────────
 * Three re-runs of the same question answered ABSENT correctly. Roughly 1 in 4. That is
 * WORSE than a deterministic bug, because the retest most people would run is the one that
 * says it is fine. If you are editing this, you cannot check your change by running it once.
 *
 * ── THE STRONGER FIX WE DID NOT TAKE, AND WHY IT IS STILL OPEN ───────────────
 * A notice is a DECLARATION. The structural fix is an opaque ref — a deterministic hash of
 * backendDOMNodeId — which stays stable across reads (so it keeps the property the ref
 * exists for) while being **impossible to extrapolate**. That is a mechanism, not an
 * intention, and by this project's own rule it beats a warning. It was not taken here
 * because the Owner scoped this round to the notice; it costs `click` a reverse map and
 * costs a human reading the tree the ability to correlate to the DOM. **If the notice does
 * not carry the benchmark, this is the next move, not a bigger notice.**
 */
const NOTICE_WHY = 'see the block comment above'

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
    // point somewhere else after any change.
    const ref = n.backendDOMNodeId
    if (ref === undefined || ref === null) continue

    candidates.push({ ref: Number(ref), role, name, interactive })
  }

  const totalCandidates = candidates.length
  let kept = candidates.slice(0, maxNodes)
  let truncated = totalCandidates > kept.length

  const line = (n) => `[#${n.ref}] ${n.role}${n.name ? ' "' + n.name + '"' : ''}`

  // Rebuilt after the benchmark caught the old notice failing. `header` is the whole point:
  // a limit announced after 250 lines is announced to a reader who has already stopped
  // reading. See the block comment above `NOTICE_WHY`.
  const header = (shown) => `⚠ TRUNCATED — this page was CUT. You are seeing ${shown} of ${totalCandidates} matching elements.
Refs are opaque DOM identifiers. They are NOT sequential and NOT contiguous — you cannot work
out the ref of an element you cannot see, and a plausible-looking number will be a different
element. Answer only with a ref that appears literally in the lines below. If what you want is
not printed below, say it is NOT SHOWN; it may still exist further down the page.

`
  const footer = (shown) => `

（已截斷 truncated：顯示 ${shown} 項，符合條件嘅共 ${totalCandidates} 項；未顯示嘅嘢唔代表唔存在）
Only the ${shown} refs printed above may be answered. Do not infer any other.`

  // The character budget is a SECOND bound, because 250 short nodes and 250 long ones are
  // not the same prompt — and the notice must fit INSIDE it, not be added on top. A
  // disclosure that pushes the prompt past its own budget is not a disclosure.
  const reserve = () => header(kept.length).length + footer(kept.length).length + 40
  if (kept.map(line).join('\n').length + (truncated ? reserve() : 0) > maxChars) {
    truncated = true
    const budget = maxChars - reserve()
    const lines = []
    let used = 0
    for (const n of kept) {
      const l = line(n)
      if (used + l.length + 1 > budget) break
      lines.push(l); used += l.length + 1
    }
    kept = kept.slice(0, lines.length)
  }

  const body = kept.map(line).join('\n')

  // A CUT THAT SAYS IT WAS CUT, BEFORE AND AFTER. And an untruncated page carries NO notice
  // at all — a warning that always fires is a warning nobody reads.
  const text = truncated ? header(kept.length) + body + footer(kept.length) : body

  return {
    nodes: kept,
    text,
    truncated,
    totalCandidates,
    rawNodeCount: raw.length
  }
}

module.exports = { readPage, CORPUS_DIR, INTERACTIVE, NEVER }
