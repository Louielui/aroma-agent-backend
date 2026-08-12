'use strict'

/**
 * unreachedModules.js — production modules that nothing production requires.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THREE TIMES THIS MONTH, EACH FOUND BY HAND, EACH AFTER IT MATTERED.
 *
 *   B (`intake/goal/`)          built, 23 tests green, ZERO call sites — for a week.
 *   `checkEvidence`             built, named for the exact failure, ZERO call sites in chat.
 *   `selfDescription.describe`  built, 8 tests green, ZERO call sites — she answered from
 *                               memory while the registry holding the answer sat unused.
 *
 * ⛔ AND THIS SHAPE IS ACTUALLY COUNTABLE, unlike the last three sweeps. It is not a judgement
 * about prose or polarity — it is reachability, which is a fact about requires. The previous
 * detectors failed because their target was semantic; this one's target is a graph edge.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A module is REACHED when some other production file requires it, transitively from an entry
 * point. Tests do not count: a file reachable only from its own test is exactly the state all
 * three instances were in.
 *
 * ⚠ WHAT IT CANNOT SEE, stated so the number is read correctly: a module that IS required but
 * whose export is never CALLED. `checkEvidence` today is required by `browseAnswer.js` on the
 * closed browse line, so this would call it reached. Reachability is coarser than use.
 */

const fs = require('fs')
const path = require('path')

const SRC = path.resolve(__dirname, '..', '..', 'src')
/** Where the running process actually starts. Anything not reachable from here is not running. */
const ENTRY = ['index.js', 'app.js']

function productionFiles (dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n)
    if (fs.statSync(p).isDirectory()) { if (n !== 'node_modules') productionFiles(p, out); continue }
    if (/\.js$/.test(n) && !/\.test\.js$/.test(n)) out.push(p)
  }
  return out
}

const ALL = productionFiles(SRC)
const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/')

/** Resolve a relative require to a file we know about. */
function resolveReq (fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const cand of [base, base + '.js', path.join(base, 'index.js')]) {
    if (ALL.includes(cand)) return cand
  }
  return null
}

const edges = new Map()
for (const f of ALL) {
  const src = fs.readFileSync(f, 'utf8')
  const outs = new Set()
  for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const t = resolveReq(f, m[1])
    if (t) outs.add(t)
  }
  edges.set(f, outs)
}

// Walk from the entry points.
const reached = new Set()
const stack = ENTRY.map((e) => path.join(SRC, e)).filter((f) => ALL.includes(f))
while (stack.length) {
  const f = stack.pop()
  if (reached.has(f)) continue
  reached.add(f)
  for (const t of edges.get(f) || []) stack.push(t)
}

const unreached = ALL.filter((f) => !reached.has(f)).map(rel).sort()

console.log('production modules      ' + ALL.length)
console.log('reachable from entry    ' + reached.size)
console.log('⛔ REACHED BY NOTHING   ' + unreached.length)
console.log('')
for (const u of unreached) console.log('  ' + u)
