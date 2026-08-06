'use strict'
/**
 * runProximityTrial.js — is proximity RELIABLE, or was 4/4 at n=3 a lucky afternoon?
 *
 * > **Owner: 「n=3 is a prompt to measure, not a finding — and this round has now been burned
 * > twice by exactly that.」**
 *
 * FLAT output only. Ten runs per container question. If document-order adjacency is what
 * lets a model reach one of 21 identical buttons, it should hold across repeats; if it is
 * near-chance, the whole 「grouping is unnecessary」 conclusion collapses and the container
 * code earns its budget after all.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { readPage, refFor, CORPUS_DIR } = require('../src/browser/axTree')
const { resolveAgentCliCommand } = require('../src/agent/agentBridgeWorker')

const CLI = resolveAgentCliCommand()
if (!CLI.ok) { console.error('no agent CLI'); process.exit(1) }
const N = 10
const CAP_USD = 5.00

const load = (f) => JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8'))
const KEY = load('ANSWERS-V3.json').answers
const QS = load('QUESTIONS-V3.json').questions.filter(q => q.kind === 'container-disambiguation')
const view = readPage(load('real-costco-search.json').nodes)   // DEFAULT = flat, post-ruling
const shown = new Set(view.nodes.map(n => n.ref))

const PROMPT = (ask) => `You are reading a serialized accessibility tree of a web page.
Each line is: [#ref] role "accessible name"

${view.text}

QUESTION: ${ask}

Answer with EXACTLY ONE line and nothing else:
  either  REF <ref>      — copied EXACTLY as printed
  or      ABSENT
Answer ABSENT if the thing asked for is not on the page. Do not guess.`

const results = QS.map(q => ({ q, key: KEY.find(a => a.ask === q.ask), runs: [] }))
let spent = 0
outer:
for (let i = 0; i < N; i++) {
  for (const r of results) {
    if (spent + 0.25 > CAP_USD) { console.log(`\n⚠ STOPPED ON CAP after ${r.runs.length} runs each`); break outer }
    let said = 'ERR'
    try {
      const o = JSON.parse(execFileSync(CLI.command, ['-p', PROMPT(r.q.ask), '--output-format', 'json'],
        { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180000 }))
      said = String(o.result || '').trim().split('\n').pop().trim()
      spent += Number(o.total_cost_usd) || 0
    } catch (e) { /* recorded as ERR */ }
    const m = said.match(/REF\s+#?(r[0-9a-f]{8})/i)
    const want = refFor(r.key.ref)
    const kind = !m ? (/ABSENT/i.test(said) ? 'REFUSED' : 'UNPARSED')
      : m[1] === want ? 'CORRECT'
        : shown.has(m[1]) ? 'WRONG_ELEMENT' : 'NOT_IN_INPUT'
    r.runs.push(kind)
  }
}

console.log('\n=== FLAT output, document-order proximity, ' + N + ' runs each ===')
let allCorrect = 0, allRuns = 0
for (const r of results) {
  const c = r.runs.filter(x => x === 'CORRECT').length
  allCorrect += c; allRuns += r.runs.length
  const other = [...new Set(r.runs.filter(x => x !== 'CORRECT'))]
  console.log(`  ${String(c) + '/' + r.runs.length}  ${r.key.product.slice(0, 44).padEnd(46)} ${other.length ? 'misses: ' + other.join(',') : ''}`)
}
console.log(`\n  overall ${allCorrect}/${allRuns} = ${(allCorrect / allRuns * 100).toFixed(1)}%`)
console.log(`  spent $${spent.toFixed(4)} of $${CAP_USD.toFixed(2)} cap`)
