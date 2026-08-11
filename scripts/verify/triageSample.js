'use strict'
/**
 * triageSample.js — draw 40 ⛔ markers for BLIND labelling by the Owner.
 *
 * The question he is answering, per marker:
 *   Does this sentence say something that must be true of a CATEGORY of things — every
 *   connector, every fence, every reply — or does it explain why THIS thing is as it is?
 *
 * ⛔ SEEDED, SO THE SELECTION IS REPRODUCIBLE AND I CANNOT HAVE CHERRY-PICKED. Re-running this
 * script yields the identical 40. The seed is stated below and was fixed before the draw.
 *
 * ⛔ AND STRATIFIED, because the two strata have very different densities and wildly different
 * sizes. 61 prefilter hits, 852 misses. The MISS stratum is 93% of the population and therefore
 * carries the answer, so it gets the larger share of the sample:
 *
 *     estimate = (hitRate × 61) + (missRate × 852)
 *
 * Sampling 20/20 would have spent half the budget on 7% of the population.
 */
const fs = require('fs')
const path = require('path')

const SRC = path.resolve(__dirname, '..', '..', 'src')
const SEED = 20260811
const N_HIT = 12
const N_MISS = 28

/** mulberry32 — small, seeded, adequate for drawing a sample. */
function rng (seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function files (dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n)
    if (fs.statSync(p).isDirectory()) { if (n !== 'node_modules') files(p, out); continue }
    if (/\.js$/.test(n) && !/\.test\.js$/.test(n)) out.push(p)
  }
  return out
}

function markers (file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('⛔')) continue
    const buf = [lines[i]]
    for (let j = i + 1; j < lines.length && j < i + 6; j++) {
      const l = lines[j]
      if (!/^\s*(\*|\/\/)/.test(l)) break
      if (/^\s*\*\s*$/.test(l) || /^\s*\/\/\s*$/.test(l)) break
      if (l.includes('⛔')) break
      buf.push(l)
    }
    out.push(buf.join(' '))
  }
  return out
}

const QUANT = /\b(every|each|all|any|no|none|never|always|whenever|nothing|anything|nobody)\b/i
const MODAL = /\b(must|may not|cannot|can never|has to|shall|required to|is forbidden|do not|does not)\b/i
const PLURAL = /\b(connectors?|adapters?|stores?|routes?|providers?|callers?|modules?|files?|tests?|sites?|pages?|fields?|handlers?|endpoints?|clients?|sources?|writers?|readers?)\b/i

/**
 * ⛔ DE-IDENTIFY. The Owner's instruction: no file names, no surrounding context. If he can tell
 * where a sentence came from he reads my INTENT rather than the sentence, which is the exact
 * bias this exercise exists to measure. Inline paths are replaced, not deleted, so the sentence
 * still reads as a sentence.
 */
function clean (s) {
  return s
    .replace(/^[\s*/]+/, '')
    .replace(/\s*[\s*/]+\s*/g, ' ')
    .replace(/⛔/g, '')
    .replace(/\b[\w.-]+\/[\w./-]+\.(js|md|ts|json)\b/g, '‹path›')
    .replace(/\b[\w.-]+\.(js|md|ts|json)\b/g, '‹file›')
    .replace(/\s+/g, ' ')
    .trim()
}

function draw (pool, n, rand) {
  const a = pool.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

const all = files(SRC).flatMap(markers)
const isHit = (t) => QUANT.test(t) && MODAL.test(t) && PLURAL.test(t)
const hits = all.filter(isHit)
const misses = all.filter((t) => !isHit(t))

const rand = rng(SEED)
const picked = draw(hits, N_HIT, rand).concat(draw(misses, N_MISS, rand))
// Interleave the strata so their boundary is invisible in the printed sheet.
const sheet = draw(picked, picked.length, rand)

console.log('# THE 40 — blind, shuffled, de-identified')
console.log('# populations: ' + hits.length + ' hit / ' + misses.length + ' miss, seed ' + SEED)
console.log('')
sheet.forEach((s, i) => {
  const body = clean(s)
  console.log((i + 1) + '. ' + (body.length > 240 ? body.slice(0, 240) + '…' : body))
  console.log('')
})
