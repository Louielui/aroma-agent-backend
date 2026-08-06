'use strict'
/**
 * runAxBenchmarkV2.js — the acceptance bar on the corpus that can actually measure it.
 *
 * V1 asked ONE truncation question against a defect reproducing ~1 in 14, so its 100% was a
 * real number and not evidence. V2 asks FOUR, on four REAL pages captured HEADED, and adds
 * three ROLE-AMBIGUITY questions — two genuinely distinct elements sharing a name — because
 * the name-echo prune must remove manufactured duplicates without removing real ones.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { readPage, refFor, CORPUS_DIR } = require('../src/browser/axTree')
const { resolveAgentCliCommand } = require('../src/agent/agentBridgeWorker')

const CLI = resolveAgentCliCommand()
if (!CLI.ok) { console.error('no agent CLI'); process.exit(1) }
const CAP_USD = 4.50

const Q = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'QUESTIONS-V2.json'), 'utf8'))
const KEY = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'ANSWERS-V2.json'), 'utf8')).answers
const cache = new Map()
const viewOf = (p) => {
  if (!cache.has(p)) cache.set(p, readPage(JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, p + '.json'), 'utf8')).nodes))
  return cache.get(p)
}

const PROMPT = (text, ask) => `You are reading a serialized accessibility tree of a web page.
Each line is: [#ref] role "accessible name"

${text}

QUESTION: ${ask}

Answer with EXACTLY ONE line and nothing else:
  either  REF <ref>      — copied EXACTLY as printed
  or      ABSENT
Answer ABSENT if the thing asked for is not on the page. Do not guess.`

let spent = 0
const rows = []
for (const q of Q.questions) {
  const v = viewOf(q.page)
  const a = KEY.find(x => x.page === q.page && x.ask === q.ask)
  if (spent + 0.40 > CAP_USD) { rows.push({ q, skipped: true }); continue }
  let said, cost = 0
  try {
    const o = JSON.parse(execFileSync(CLI.command, ['-p', PROMPT(v.text, q.ask), '--output-format', 'json'],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180000 }))
    said = String(o.result || '').trim().split('\n').pop().trim(); cost = Number(o.total_cost_usd) || 0
  } catch (e) { said = 'ERR ' + String(e.message).split('\n')[0] }
  spent += cost
  const m = said.match(/REF\s+#?(r[0-9a-f]{8})/i)
  const shown = new Set(v.nodes.map(n => n.ref))
  const isAbsent = !m && /ABSENT/i.test(said)
  let pass, why
  if (q.kind === 'ABSENT') { pass = isAbsent; why = 'not on the page at all' }
  else if (q.kind === 'truncated') {
    // it EXISTS on the page but was cut. The only correct answer is that it is not shown —
    // any ref would be a different element, which is the REF 250 failure.
    pass = isAbsent; why = 'on the page but CUT from the output'
  } else { pass = Boolean(m) && shown.has(m[1]) && m[1] === refFor(a.ref); why = 'must be the exact element' }
  rows.push({ q, said, pass, why })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${q.kind.padEnd(15)} ${q.page.padEnd(22)} ${JSON.stringify(said.slice(0, 22))}`)
  if (!pass) console.log(`         ↳ ${q.ask}  (${why})`)
}

const grp = (k) => rows.filter(r => r.q.kind === k && !r.skipped)
const pct = (x) => x.length ? (x.filter(r => r.pass).length / x.length * 100).toFixed(1) : '-'
const targets = rows.filter(r => !r.skipped && (r.q.kind === 'present' || r.q.kind === 'role-ambiguity'))
const refusals = rows.filter(r => !r.skipped && (r.q.kind === 'ABSENT' || r.q.kind === 'truncated'))

console.log('\n=== BY CLASS ===')
for (const k of ['present', 'role-ambiguity', 'truncated', 'ABSENT']) {
  const g = grp(k)
  console.log(`  ${k.padEnd(16)} ${pct(g)}%  (${g.filter(r => r.pass).length}/${g.length})`)
}
console.log('\n=== BAR ===')
console.log(`  targetsIdentified     ${pct(targets)}%  (bar 90%)   ${targets.filter(r => r.pass).length}/${targets.length}`)
console.log(`  absentTargetRefusals  ${pct(refusals)}%  (bar 100%)  ${refusals.filter(r => r.pass).length}/${refusals.length}`)
console.log(`\n  spent $${spent.toFixed(4)} of $${CAP_USD.toFixed(2)} cap`)
const met = targets.length && refusals.length &&
  targets.filter(r => r.pass).length / targets.length >= 0.90 &&
  refusals.filter(r => r.pass).length / refusals.length >= 1.0
console.log('\n  VERDICT: ' + (met ? 'BAR MET' : 'BAR NOT MET'))
