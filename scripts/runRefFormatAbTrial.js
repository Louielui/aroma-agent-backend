'use strict'
/**
 * runRefFormatAbTrial.js — did OPAQUE REFS cost the point, or was it the page?
 *
 * Benchmark run 3 dropped to 87.5%: on `modal-over-content` the model answered the ref of
 * `StaticText "Continue"` instead of `button "Continue"` — same accessible name, different
 * role, both printed. Run 2 (numeric refs) got the same question right.
 *
 * ⚠ THAT IS n=1 AGAINST n=1. HR-14: a rate is not a rate at n=1, and the mistake that rule
 * exists to stop is exactly this one — concluding a format change caused a single flip.
 *
 * So: same question, same nodes, same session, interleaved arms, N runs each. The ONLY
 * difference is whether refs are printed as `[#12]` or `[#r1d194297]`.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { readPage, CORPUS_DIR } = require('../src/browser/axTree')
const { resolveAgentCliCommand } = require('../src/agent/agentBridgeWorker')

const CLI = resolveAgentCliCommand()
if (!CLI.ok) { console.error('no agent CLI'); process.exit(1) }

const N = 10
const CAP_USD = 2.50
const ASK = 'which ref is the 「Continue」 button in the dialog?'

const raw = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'modal-over-content.json'), 'utf8'))
const nodes = readPage(raw.nodes || raw).nodes
const TRUE_DOM = nodes.find(n => n.role === 'button' && n.name === 'Continue').domId
const DECOY_DOM = nodes.find(n => n.role === 'StaticText' && n.name === 'Continue').domId

const render = (opaque) => nodes
  .map(n => `[#${opaque ? n.ref : n.domId}] ${n.role}${n.name ? ' "' + n.name + '"' : ''}`).join('\n')

const prompt = (opaque) => `You are reading a serialized accessibility tree of a web page.
Each line is: [#ref] role "accessible name"

${render(opaque)}

QUESTION: ${ASK}

Answer with EXACTLY ONE line and nothing else:
  either  REF <ref>      — copied EXACTLY as printed
  or      ABSENT
Answer ABSENT if the thing asked for is not on the page. Do not guess.`

function ask (opaque) {
  const o = JSON.parse(execFileSync(CLI.command, ['-p', prompt(opaque), '--output-format', 'json'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180000 }))
  const said = String(o.result || '').trim().split('\n').pop().trim()
  const m = said.match(/REF\s+#?(r[0-9a-f]{8}|\d+)/i)
  const tok = m ? m[1] : null
  const node = tok === null ? null : nodes.find(n => String(opaque ? n.ref : n.domId) === tok)
  const kind = tok === null ? 'NO_REF'
    : !node ? 'NOT_IN_INPUT'
      : node.domId === TRUE_DOM ? 'CORRECT'
        : node.domId === DECOY_DOM ? 'DECOY_STATICTEXT'
          : 'OTHER_WRONG'
  return { said, kind, cost: Number(o.total_cost_usd) || 0 }
}

const arms = { NUMERIC: [], OPAQUE: [] }
let spent = 0
outer:
for (let i = 0; i < N; i++) {
  for (const [label, opaque] of [['NUMERIC', false], ['OPAQUE', true]]) {
    if (spent + 0.20 > CAP_USD) { console.log(`\n⚠ STOPPED ON CAP after ${arms.NUMERIC.length}/${arms.OPAQUE.length}`); break outer }
    let r
    try { r = ask(opaque) } catch (e) { r = { said: 'ERR', kind: 'ERROR', cost: 0 } }
    spent += r.cost
    arms[label].push(r)
    console.log(`  ${label.padEnd(8)} run ${String(i + 1).padStart(2)}  ${r.kind.padEnd(18)} ${JSON.stringify(r.said.slice(0, 22))}`)
  }
}

console.log('\n=== did the ref FORMAT change the answer? ===')
for (const label of ['NUMERIC', 'OPAQUE']) {
  const a = arms[label]
  const c = (k) => a.filter(r => r.kind === k).length
  console.log(`  ${label.padEnd(8)}  correct ${c('CORRECT')}/${a.length}   decoy(StaticText) ${c('DECOY_STATICTEXT')}   not-in-input ${c('NOT_IN_INPUT')}   other ${c('OTHER_WRONG') + c('NO_REF')}`)
}
console.log(`\n  spent $${spent.toFixed(4)} of $${CAP_USD.toFixed(2)} cap`)
