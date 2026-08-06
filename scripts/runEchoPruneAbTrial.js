'use strict'
/**
 * runEchoPruneAbTrial.js — the Owner's condition on the name-echo fix.
 *
 * 「Build the pruner fix — but A/B it before keeping it, exactly as you did here. Not because
 *  I doubt it, but because 『應該會有幫助』 has now failed measurement once in this same round,
 *  and the discipline is worth more than the change.」
 *
 * ⚠ A/B'ing ONLY the modal question would be close to tautological — with the echo pruned the
 * wrong answer no longer exists. So this runs the WHOLE frozen question set through both
 * arms, interleaved, because the risk worth measuring is not 「does it fix the decoy」 but
 * 「does removing 34% of the surviving nodes cost anything ELSEWHERE」.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { readPage, refFor, CORPUS_DIR } = require('../src/browser/axTree')
const { resolveAgentCliCommand } = require('../src/agent/agentBridgeWorker')

const CLI = resolveAgentCliCommand()
if (!CLI.ok) { console.error('no agent CLI'); process.exit(1) }
const CAP_USD = 4.00

const Q = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'QUESTIONS.json'), 'utf8')).questions
const KEY = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'ANSWERS.json'), 'utf8')).answers
const rawOf = (n) => { const r = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, n + '.json'), 'utf8')); return r.nodes || r }
const view = (page, prune) => readPage(rawOf(page), { dropNameEchoes: prune })

const PROMPT = (text, ask) => `You are reading a serialized accessibility tree of a web page.
Each line is: [#ref] role "accessible name"

${text}

QUESTION: ${ask}

Answer with EXACTLY ONE line and nothing else:
  either  REF <ref>      — copied EXACTLY as printed
  or      ABSENT
Answer ABSENT if the thing asked for is not on the page. Do not guess.`

function ask (v, q) {
  const o = JSON.parse(execFileSync(CLI.command, ['-p', PROMPT(v.text, q.ask), '--output-format', 'json'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180000 }))
  const said = String(o.result || '').trim().split('\n').pop().trim()
  const m = said.match(/REF\s+#?(r[0-9a-f]{8})/i)
  const a = KEY.find(x => x.page === q.page && x.ask === q.ask)
  const shown = new Set(v.nodes.map(n => n.ref))
  let pass
  if (a.expect === 'ABSENT') pass = !m && /ABSENT/i.test(said)
  else if (q.expect === 'present-or-truncation-stated') {
    pass = (!m && /ABSENT/i.test(said) && v.truncated) || (m && shown.has(m[1]) && m[1] === refFor(a.ref))
  } else pass = Boolean(m) && shown.has(m[1]) && m[1] === refFor(a.ref)
  return { pass, said, cost: Number(o.total_cost_usd) || 0 }
}

const arms = { PRUNED: [], UNPRUNED: [] }
let spent = 0
outer:
for (const q of Q) {
  for (const [label, prune] of [['UNPRUNED', false], ['PRUNED', true]]) {
    if (spent + 0.30 > CAP_USD) { console.log('\n⚠ STOPPED ON CAP'); break outer }
    const v = view(q.page, prune)
    let r
    try { r = ask(v, q) } catch (e) { r = { pass: false, said: 'ERR', cost: 0 } }
    spent += r.cost
    arms[label].push({ q, ...r })
    if (!r.pass) console.log(`  FAIL ${label.padEnd(9)} ${q.page.padEnd(19)} ${JSON.stringify(r.said.slice(0, 20))}  ↳ ${q.ask}`)
  }
}

console.log('\n=== does dropping the name echoes cost anything? ===')
for (const label of ['UNPRUNED', 'PRUNED']) {
  const a = arms[label]
  const pres = a.filter(r => r.q.expect !== 'ABSENT')
  const abs = a.filter(r => r.q.expect === 'ABSENT')
  const pct = (x) => x.length ? (x.filter(r => r.pass).length / x.length * 100).toFixed(1) : '-'
  console.log(`  ${label.padEnd(9)}  targets ${pct(pres)}% (${pres.filter(r => r.pass).length}/${pres.length})   absent-refusals ${pct(abs)}% (${abs.filter(r => r.pass).length}/${abs.length})`)
}
console.log(`\n  spent $${spent.toFixed(4)} of $${CAP_USD.toFixed(2)} cap`)
