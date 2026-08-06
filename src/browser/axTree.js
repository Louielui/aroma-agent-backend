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
  const notice = truncated
    ? `\n（已截斷 truncated：顯示 ${kept.length} 項，符合條件嘅共 ${totalCandidates} 項；未顯示嘅嘢唔代表唔存在）`
    : ''

  return {
    nodes: kept,
    text: body + notice,
    truncated,
    totalCandidates,
    rawNodeCount: raw.length
  }
}

module.exports = { readPage, CORPUS_DIR, INTERACTIVE, NEVER }
