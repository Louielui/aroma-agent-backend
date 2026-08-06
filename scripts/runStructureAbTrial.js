'use strict'
/**
 * runStructureAbTrial.js — the acceptance condition for grouping, as the Owner set it:
 *
 *   「zero cost on already-passing questions, plus the question that has no answer today.」
 *
 * FLAT vs GROUPED, interleaved, on V2 (16 questions that already pass) and V3 (the
 * container-disambiguation questions frozen BEFORE this change, which have no gradeable
 * answer against flat output).
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { readPage, refFor, CORPUS_DIR } = require('../src/browser/axTree')
const { resolveAgentCliCommand } = require('../src/agent/agentBridgeWorker')

const CLI = resolveAgentCliCommand()
if (!CLI.ok) { console.error('no agent CLI'); process.exit(1) }
const CAP_USD = 7.00

const load = (f) => JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8'))
const V2Q = load('QUESTIONS-V2.json').questions
const V2A = load('ANSWERS-V2.json').answers
const V3Q = load('QUESTIONS-V3.json').questions.filter(q => q.kind !== 'group-truncation')
const V3A = load('ANSWERS-V3.json').answers
const rawOf = (p) => load(p + '.json').nodes
const view = (p, grouped) => readPage(rawOf(p), { group: grouped })

const ITEMS = [
  ...V2Q.map(q => ({ q, key: V2A.find(a => a.page === q.page && a.ask === q.ask), set: 'V2' })),
  ...V3Q.map(q => ({ q, key: V3A.find(a => a.page === q.page && a.ask === q.ask), set: 'V3' }))
]

const PROMPT = (text, ask) => `You are reading a serialized accessibility tree of a web page.
Each line is: [#ref] role "accessible name". A line indented under a group line belongs to
that group.

${text}

QUESTION: ${ask}

Answer with EXACTLY ONE line and nothing else:
  either  REF <ref>      — copied EXACTLY as printed
  or      ABSENT
Answer ABSENT if the thing asked for is not on the page. Do not guess.`

function run (item, grouped) {
  const v = view(item.q.page, grouped)
  const o = JSON.parse(execFileSync(CLI.command, ['-p', PROMPT(v.text, item.q.ask), '--output-format', 'json'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180000 }))
  const said = String(o.result || '').trim().split('\n').pop().trim()
  const m = said.match(/REF\s+#?(r[0-9a-f]{8})/i)
  const shown = new Set(v.nodes.map(n => n.ref))
  const wantAbsent = (item.key && item.key.expect === 'ABSENT') || item.q.kind === 'truncated'
  const pass = wantAbsent
    ? (!m && /ABSENT/i.test(said))
    : Boolean(m) && shown.has(m[1]) && m[1] === refFor(item.key.ref)
  return { pass, said, cost: Number(o.total_cost_usd) || 0 }
}

const arms = { FLAT: [], GROUPED: [] }
let spent = 0
outer:
for (const item of ITEMS) {
  for (const [label, grouped] of [['FLAT', false], ['GROUPED', true]]) {
    if (spent + 0.35 > CAP_USD) { console.log('\n⚠ STOPPED ON CAP'); break outer }
    let r
    try { r = run(item, grouped) } catch (e) { r = { pass: false, said: 'ERR', cost: 0 } }
    spent += r.cost
    arms[label].push({ ...item, ...r })
    if (!r.pass) console.log(`  FAIL ${label.padEnd(7)} ${item.set} ${item.q.page.padEnd(21)} ${JSON.stringify(r.said.slice(0, 18))} ↳ ${item.q.ask.slice(0, 54)}`)
  }
}

console.log('\n=== FLAT vs GROUPED ===')
for (const label of ['FLAT', 'GROUPED']) {
  const a = arms[label]
  const v2 = a.filter(r => r.set === 'V2'), v3 = a.filter(r => r.set === 'V3')
  const p = (x) => x.length ? (x.filter(r => r.pass).length / x.length * 100).toFixed(1) : '-'
  console.log(`  ${label.padEnd(8)}  V2 (already passing) ${p(v2)}% (${v2.filter(r => r.pass).length}/${v2.length})   V3 (no answer today) ${p(v3)}% (${v3.filter(r => r.pass).length}/${v3.length})`)
}
console.log(`\n  spent $${spent.toFixed(4)} of $${CAP_USD.toFixed(2)} cap`)
