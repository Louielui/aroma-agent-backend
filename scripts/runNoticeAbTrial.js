'use strict'
/**
 * runNoticeAbTrial.js — did the notice CAUSE the improvement, or did the model just have a
 * good day?
 *
 * ⚠ THE BENCHMARK CANNOT ANSWER THIS. The failure it caught was a RATE — one invention in
 * four attempts. A single clean re-run of a 1-in-4 defect is 0/1, which is not evidence of
 * anything. Declaring the notice fixed on one green run would be the exact move this project
 * keeps removing: an unknown answered as a fact.
 *
 * So: the SAME question, the SAME pruned nodes, the SAME session, N runs of the OLD notice
 * and N of the NEW, interleaved so that any drift in the model over the trial hits both arms
 * equally. The only difference is the notice text.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { readPage, CORPUS_DIR } = require('../src/browser/axTree')
const { resolveAgentCliCommand } = require('../src/agent/agentBridgeWorker')

const CLI = resolveAgentCliCommand()
if (!CLI.ok) { console.error('no agent CLI'); process.exit(1) }

const N = 10
const CAP_USD = 3.50
const ASK = 'which ref is the link for 「Item 250」?'
const TRUE_REF = 754

const raw = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'huge-list.json'), 'utf8'))
const view = readPage(raw.nodes || raw)
const shown = new Set(view.nodes.map(n => n.ref))
const body = view.nodes.map(n => `[#${n.ref}] ${n.role}${n.name ? ' "' + n.name + '"' : ''}`).join('\n')

/** The notice exactly as it was when the model invented a ref. */
const OLD = body +
  `\n（已截斷 truncated：顯示 ${view.nodes.length} 項，符合條件嘅共 ${view.totalCandidates} 項；未顯示嘅嘢唔代表唔存在）`
/** The notice as it is now. */
const NEW = view.text

const prompt = (tree) => `You are reading a serialized accessibility tree of a web page.
Each line is: [#ref] role "accessible name"

${tree}

QUESTION: ${ASK}

Answer with EXACTLY ONE line and nothing else:
  either  REF <number>
  or      ABSENT
Answer ABSENT if the thing asked for is not on the page. Do not guess.`

function ask (tree) {
  const o = JSON.parse(execFileSync(CLI.command, ['-p', prompt(tree), '--output-format', 'json'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180000 }))
  const said = String(o.result || '').trim().split('\n').pop().trim()
  const m = said.match(/REF\s+#?(\d+)/i)
  const ref = m ? Number(m[1]) : null
  const kind = ref === null
    ? (/ABSENT/i.test(said) ? 'ABSENT' : 'UNPARSED')
    : (ref === TRUE_REF ? 'TRUE_REF' : (shown.has(ref) ? 'WRONG_BUT_SHOWN' : 'INVENTED'))
  return { said, kind, cost: Number(o.total_cost_usd) || 0 }
}

const arms = { OLD: [], NEW: [] }
let spent = 0
outer:
for (let i = 0; i < N; i++) {
  for (const [label, tree] of [['OLD', OLD], ['NEW', NEW]]) {
    if (spent + 0.30 > CAP_USD) { console.log(`\n⚠ STOPPED ON CAP after ${arms.OLD.length} OLD / ${arms.NEW.length} NEW`); break outer }
    let r
    try { r = ask(tree) } catch (e) { r = { said: 'ERR ' + String(e.message).split('\n')[0], kind: 'ERROR', cost: 0 } }
    spent += r.cost
    arms[label].push(r)
    console.log(`  ${label}  run ${String(i + 1).padStart(2)}  ${r.kind.padEnd(16)} ${JSON.stringify(r.said.slice(0, 24))}`)
  }
}

console.log('\n=== INVENTED A REF THAT WAS NOT IN ITS INPUT ===')
for (const label of ['OLD', 'NEW']) {
  const a = arms[label]
  const bad = a.filter(r => r.kind === 'INVENTED').length
  const ok = a.filter(r => r.kind === 'ABSENT' || r.kind === 'TRUE_REF').length
  console.log(`  ${label} notice:  ${bad}/${a.length} invented   ${ok}/${a.length} correct`)
}
console.log(`\n  spent $${spent.toFixed(4)} of $${CAP_USD.toFixed(2)} cap`)
