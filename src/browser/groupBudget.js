'use strict'

/**
 * groupBudget.js — spending a fixed budget across groups, and SAYING what was cut.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * BUILT BEFORE THE GROUPING ITSELF, ON PURPOSE.
 *
 * > **Owner: 「Build the per-group 『2 of 7 shown』 first, before the grouping itself works —
 * > if it arrives last it will arrive as a nice-to-have.」**
 *
 * Grouping creates one new failure, and it is invisible in a way the flat version's was not:
 *
 *   a cut FLAT list looks like a shorter list — the reader can see it is short.
 *   a cut GROUP looks like a COMPLETE group with fewer members.
 *
 * Nothing about 「Kirkland — 2 items」 says Kirkland has 7. **21 件貨睇落係 3 件.**
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── THE INVARIANT ───────────────────────────────────────────────────────────
 * **Every node that existed and is not printed is inside some stated count.** There are
 * exactly three fates and all three are visible:
 *   shown                    — it is on a line
 *   cut from a shown group   — the group line says `N of M shown`
 *   in a group that did not fit — the global notice says how many groups were dropped
 *
 * ── AND A BARE HEADER IS NEVER EMITTED ──────────────────────────────────────
 * A group line with no members under it is not something anyone can act on; it is a claim
 * that something exists, with no way to reach it. Such a group is dropped whole and counted.
 */

const line = (n) => `[#${n.ref}] ${n.role}${n.name ? ' "' + n.name + '"' : ''}`
const groupLine = (grp, shown, partial) =>
  `[#${grp.ref}] group "${grp.name}"` + (partial ? ` — ${shown} of ${grp.total ?? grp.members.length} shown` : '')

/**
 * @param {Array<{ref,name,members:Array}>} groups
 * @param {{maxNodes?:number, maxChars?:number}} opts
 * @param {Array} [loose] nodes that belong to no group — the common case, and they are NOT
 *        wrapped in one. A group that exists only to hold one unambiguous node is noise.
 */
function budgetGroups (groups, opts = {}, loose = []) {
  const maxNodes = Number.isFinite(opts.maxNodes) ? opts.maxNodes : 250
  const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : 8000

  const out = []
  const emitted = []
  let nodes = 0
  let chars = 0
  let groupsDropped = 0
  let looseDropped = 0
  let truncated = false
  const emittedRefs = new Set()

  // Held back so the truncation notice itself always fits — a disclosure that gets truncated
  // is not a disclosure. PROPORTIONAL, not fixed: a flat 180 exceeded the whole budget at
  // small maxChars and silently dropped every group, which the char-budget test caught.
  const RESERVE = Math.min(180, Math.max(40, Math.floor(maxChars / 3)))

  // A group line costs a slot, exactly like a node line — otherwise the budget is a promise
  // about a number that is not the number of lines produced.
  const fits = (text, cost = 1) => nodes + cost <= maxNodes && chars + text.length + 1 <= maxChars - RESERVE

  // ── ORDER: WHO GETS THE BUDGET FIRST ────────────────────────────────────────
  // Measured 2026-08-06: emitting every group first took roughly HALF the node budget in
  // header lines (82, 77 and 93 headers on the three real pages), and four UNIQUE-name
  // targets that flat output carried were pushed out entirely. The model answered ABSENT
  // about things that were genuinely absent — a 25-point regression on already-passing
  // questions, with the cause being allocation, not comprehension.
  //
  // A unique target costs ONE line and is what a model most often needs. A group costs a
  // header plus members. `looseFirst` serves the cheap, unambiguous nodes before spending
  // what remains on disambiguation.
  //
  // ⚠ IT IS A SEAM, NOT A SETTING, and it is here to be A/B'd — the reasoning above is
  // exactly the shape of 「應該會有幫助」 that lost a trial earlier the same day.
  const emitLoose = () => {
    for (const n of loose) {
      const l = line(n)
      if (!fits(l)) { looseDropped++; truncated = true; continue }
      out.push(l)
      emittedRefs.add(n.ref)
      nodes++
      chars += l.length + 1
    }
  }
  let looseEmitted = false
  if (opts.looseFirst) { emitLoose(); looseEmitted = true }

  for (const grp of groups) {
    const total = grp.total ?? grp.members.length
    // Probe: can this group afford its header AND at least one member?
    const head = groupLine(grp, 1, false)
    if (!fits(head) || !fits(head + '\n  ' + line(grp.members[0]), 2)) {
      groupsDropped++
      truncated = true
      continue
    }
    const memberLines = []
    for (const m of grp.members) {
      const l = '  ' + line(m)
      // +1 slot for the header, already counted below; check against the running totals
      if (nodes + 1 + memberLines.length + 1 > maxNodes ||
          chars + head.length + 1 + memberLines.join('\n').length + l.length + 2 > maxChars - RESERVE) break
      memberLines.push(l)
    }
    // ⚠ THE PROBE IS NOT THE LOOP. The probe said one member would fit; the loop's own
    // arithmetic can still take zero, and on the real Wikipedia capture it did — emitting
    // `group "Panorama…" — 0 of 1 shown`, a BARE HEADER, which is precisely the thing the
    // header rule forbids: a claim that something exists with no way to reach it.
    // Found by checking real fixtures, not by the unit tests, which used synthetic groups.
    if (memberLines.length === 0) {
      groupsDropped++
      truncated = true
      continue
    }
    const partial = memberLines.length < total
    if (partial) truncated = true
    const header = groupLine({ ...grp, total }, memberLines.length, partial)
    out.push(header, ...memberLines)
    for (const m of grp.members.slice(0, memberLines.length)) emittedRefs.add(m.ref)
    nodes += 1 + memberLines.length
    chars += header.length + 1 + memberLines.reduce((s, l) => s + l.length + 1, 0)
    emitted.push({ ref: grp.ref, name: grp.name, shown: memberLines.length, total, partial })
  }

  if (!looseEmitted) emitLoose()

  const parts = []
  if (groupsDropped) parts.push(`${groupsDropped} group${groupsDropped === 1 ? '' : 's'} not shown at all`)
  if (looseDropped) parts.push(`${looseDropped} further item${looseDropped === 1 ? '' : 's'} not shown`)
  const notice = truncated
    ? '\n（已截斷 truncated' + (parts.length ? '：' + parts.join('；') : '') +
      '；未顯示嘅嘢唔代表唔存在）'
    : ''

  return {
    text: out.join('\n') + notice,
    groups: emitted,
    // What was ACTUALLY emitted, reported rather than re-derived. The caller previously
    // recovered this by searching the rendered text for "[#ref]" — a string search standing
    // in for a fact this function already knew. Anything reconstructed from formatted output
    // is one formatting change away from being silently wrong.
    emittedRefs,
    groupsDropped,
    looseDropped,
    truncated
  }
}

module.exports = { budgetGroups }
