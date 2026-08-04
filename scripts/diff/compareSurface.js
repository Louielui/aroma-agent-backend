'use strict'

/**
 * compareSurface.js — compare two behaviourSurface.js dumps, and EARN THE ZERO.
 *
 * This exists because the first comparison was done with an ad-hoc `diff` of two command
 * substitutions that both errored. It reported zero differences, which read as proof and
 * was nothing of the kind — see the note at the top of behaviourSurface.js.
 *
 * So this refuses to report "identical" unless it has first shown the measurement happened:
 * both files must parse, both must carry the expected number of turns, and the surface must
 * be non-empty. Only then does equality mean anything.
 *
 *   node scripts/diff/compareSurface.js base.json head.json
 *
 * Exit code 0 = identical and earned · 1 = differs · 2 = the comparison itself is invalid.
 */

const fs = require('fs')

const [, , A, B] = process.argv
if (!A || !B) { console.error('usage: node scripts/diff/compareSurface.js <a.json> <b.json>'); process.exit(2) }

function load (p) {
  let raw
  try { raw = fs.readFileSync(p, 'utf8') } catch (e) { console.error(`INVALID: cannot read ${p}: ${e.message}`); process.exit(2) }
  if (!raw.trim()) { console.error(`INVALID: ${p} is empty — the run produced nothing`); process.exit(2) }
  try { return JSON.parse(raw) } catch (e) { console.error(`INVALID: ${p} is not JSON: ${e.message}`); process.exit(2) }
}

const a = load(A)
const b = load(B)

// ── EARN THE ZERO ───────────────────────────────────────────────────────────
// Before comparing, prove both sides actually measured something.
for (const [name, d] of [[A, a], [B, b]]) {
  if (!Array.isArray(d.surface) || d.surface.length === 0) { console.error(`INVALID: ${name} has no surface records`); process.exit(2) }
  if (d.surface.length !== d.turns) { console.error(`INVALID: ${name} recorded ${d.surface.length} of ${d.turns} turns`); process.exit(2) }
  const errored = d.surface.filter((s) => s.error)
  if (errored.length === d.surface.length) { console.error(`INVALID: every turn in ${name} threw — nothing was measured`); process.exit(2) }
}
if (a.surface.length !== b.surface.length) { console.error('INVALID: the two runs cover different turn counts'); process.exit(2) }

const sa = JSON.stringify(a.surface)
const sb = JSON.stringify(b.surface)
const la = a.logs.join('\n')
const lb = b.logs.join('\n')

console.log(`turns compared    : ${a.surface.length} (both sides, none wholly errored)`)
console.log(`surface identical : ${sa === sb}  (${sa.length} vs ${sb.length} bytes)`)
console.log(`log lines         : ${a.logs.length} vs ${b.logs.length}`)
console.log(`logs identical    : ${la === lb}`)

if (sa !== sb) {
  for (let i = 0; i < a.surface.length; i++) {
    if (JSON.stringify(a.surface[i]) !== JSON.stringify(b.surface[i])) {
      console.log(`  surface differs at turn ${i}: ${a.surface[i] && a.surface[i].turn}`)
    }
  }
}
if (la !== lb) {
  const A2 = new Set(a.logs); const B2 = new Set(b.logs)
  const onlyA = a.logs.filter((l) => !B2.has(l))
  const onlyB = b.logs.filter((l) => !A2.has(l))
  if (onlyA.length) console.log('  only in A:', onlyA.slice(0, 5))
  if (onlyB.length) console.log('  only in B:', onlyB.slice(0, 5))
  // A log-only difference on ONE side is a harness bug until proven otherwise: that is
  // exactly how the AROMA_DATA_DIR asymmetry nearly got reported as a code change.
  console.log('  NOTE: a difference visible only in logs, only on one side, is a HARNESS bug')
  console.log('        until proven otherwise. Check env parity and AROMA_DATA_DIR first.')
}

process.exit(sa === sb && la === lb ? 0 : 1)
