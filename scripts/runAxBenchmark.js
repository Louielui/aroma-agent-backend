'use strict'
/**
 * runAxBenchmark.js — the acceptance condition, actually evaluated.
 *
 * Owner: 「an acceptance condition that has never been evaluated is HR-12 wearing a plan.」
 *
 * One INDEPENDENT model call per question. Not batched per page, deliberately: a model that
 * sees an ABSENT question sitting beside a present one on the same page has been told
 * something the real situation would not tell it.
 *
 * ⚠ THE ANSWER KEY WAS NOT FROZEN. QUESTIONS.json froze the questions and the expected KIND
 * (present / ABSENT), not the ref. The key below is derived from the fixture by accessible
 * name, after the fact. That is weaker than a frozen key and is reported as such.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { readPage, CORPUS_DIR } = require('../src/browser/axTree')
const { resolveAgentCliCommand } = require('../src/agent/agentBridgeWorker')

const CLI = resolveAgentCliCommand()
if (!CLI.ok) { console.error('no agent CLI: ' + CLI.reason); process.exit(1) }

const CAP_USD = 3.00

const Q = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'QUESTIONS.json'), 'utf8'))
const pages = new Map()
function pageOf (name) {
  if (!pages.has(name)) {
    const raw = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, name + '.json'), 'utf8'))
    pages.set(name, readPage(raw.nodes || raw))
  }
  return pages.get(name)
}

/** Ground truth by accessible name, derived from the fixture. */
function keyFor (q) {
  if (q.expect === 'ABSENT') return { kind: 'ABSENT' }
  const m = q.ask.match(/「([^」]+)」/)
  const view = pageOf(q.page)
  // GRADER BUG 1, found by the first run and fixed here: this matched /password/i against
  // every name and hit `link "Forgot password"` before `textbox "Password"`. The model answered
  // #11 (the textbox) and was marked FAIL. THE MODEL WAS RIGHT AND THE KEY WAS WRONG — which
  // is the same shape as HR-12: the measurement was wrong in the direction of the thing it
  // was measuring.
  if (q.page === 'login-form' && /password/i.test(q.ask)) {
    const n = view.nodes.find(x => x.interactive && /password/i.test(x.name))
    return n ? { kind: 'REF', ref: n.ref } : { kind: 'UNRESOLVED' }
  }
  if (!m) return { kind: 'UNRESOLVED' }
  const n = view.nodes.find(x => x.name === m[1]) || view.nodes.find(x => x.name.includes(m[1]))
  return n ? { kind: 'REF', ref: n.ref } : { kind: 'NOT_IN_OUTPUT' }
}

const PROMPT = (text, ask) => `You are reading a serialized accessibility tree of a web page.
Each line is: [#ref] role "accessible name"

${text}

QUESTION: ${ask}

Answer with EXACTLY ONE line and nothing else:
  either  REF <number>
  or      ABSENT
Answer ABSENT if the thing asked for is not on the page. Do not guess.`

function ask (prompt) {
  const out = execFileSync(CLI.command, ['-p', prompt, '--output-format', 'json'], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180000
  })
  const j = JSON.parse(out)
  return { text: String(j.result || '').trim(), cost: Number(j.total_cost_usd) || 0 }
}

;(async () => {
  let spent = 0
  const rows = []
  for (const q of Q.questions) {
    const view = pageOf(q.page)
    const truth = keyFor(q)
    if (spent + 0.30 > CAP_USD) { rows.push({ q, truth, skipped: 'CAP' }); continue }
    let r
    try { r = ask(PROMPT(view.text, q.ask)) }
    catch (e) { rows.push({ q, truth, error: String(e.message).split('\n')[0] }); continue }
    spent += r.cost
    const said = r.text.split('\n').pop().trim()
    const mRef = said.match(/REF\s+#?(\d+)/i)
    const answer = mRef ? { kind: 'REF', ref: Number(mRef[1]) } : (/ABSENT/i.test(said) ? { kind: 'ABSENT' } : { kind: 'UNPARSED', said })
    // GRADER BUG 2, and it is the more serious one. The first run accepted ANY `REF n` for a
    // `present-or-truncation-stated` question. The model answered REF 634 on the truncated
    // huge-list — a ref that was NOT IN ITS INPUT. It is a real node (`link "Item 210"`) that
    // the pruner had cut, reached by extrapolating the numbering pattern from visible refs.
    //
    // ⚠ A REF THE MODEL WAS NEVER SHOWN IS NEVER A PASS. `click` would have hit Item 210 and
    // reported success. This is the Owner's rule as code: a model that invents refs is worse
    // than one that finds fewer.
    const shown = new Set(view.nodes.map(n => n.ref))
    const inInput = answer.kind === 'REF' && shown.has(answer.ref)
    let pass
    if (q.expect === 'ABSENT') pass = answer.kind === 'ABSENT'
    else if (q.expect === 'present-or-truncation-stated') pass = inInput || (answer.kind === 'ABSENT' && view.truncated)
    else pass = inInput && truth.kind === 'REF' && answer.ref === truth.ref
    if (answer.kind === 'REF' && !inInput) answer.invented = true
    rows.push({ q, truth, answer, pass, cost: r.cost, said })
  }

  const absent = rows.filter(r => r.q.expect === 'ABSENT')
  const present = rows.filter(r => r.q.expect !== 'ABSENT')
  const rate = (a) => a.length ? a.filter(r => r.pass).length / a.length : 0

  console.log('\n=== PER QUESTION ===')
  for (const r of rows) {
    const mark = r.skipped ? 'SKIP' : r.error ? 'ERR ' : (r.pass ? 'PASS' : 'FAIL')
    const truth = r.truth.kind === 'REF' ? ('#' + r.truth.ref) : r.truth.kind
    console.log(`  ${mark}  ${r.q.page.padEnd(19)} truth=${String(truth).padEnd(14)} said=${JSON.stringify((r.said || r.error || r.skipped || '').slice(0, 40))}`)
    if (!r.skipped && !r.error && !r.pass) console.log(`        ↳ ${r.q.ask}`)
  }
  console.log('\n=== BAR ===')
  console.log(`  targetsIdentified     ${(rate(present) * 100).toFixed(1)}%  (bar 90%)   ${present.filter(r => r.pass).length}/${present.length}`)
  console.log(`  absentTargetRefusals  ${(rate(absent) * 100).toFixed(1)}%  (bar 100%)  ${absent.filter(r => r.pass).length}/${absent.length}`)
  console.log(`\n  spent $${spent.toFixed(4)} of $${CAP_USD.toFixed(2)} cap`)
  const verdict = rate(present) >= 0.90 && rate(absent) >= 1.0
  console.log('\n  VERDICT: ' + (verdict ? 'BAR MET' : 'BAR NOT MET'))
})()
