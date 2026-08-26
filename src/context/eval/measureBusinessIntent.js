'use strict'
/**
 * measureBusinessIntent.js — MEASURE ONLY. Changes nothing, fixes nothing.
 *
 * Runs the labelled corpus through the CURRENT deterministic router and reports where it
 * generalises and where it stops. Pure: intentFor and routeTurn make no model call and no
 * connector call, so this is free and repeatable.
 */

const { CORPUS } = require('./businessIntentCorpus')
const { intentFor } = require('../readContext')
const { routeTurn } = require('../../intake/turnRouter')

function run () {
  const rows = CORPUS.map((r) => {
    const rt = routeTurn(r.q, { previousLane: null })
    const it = intentFor(r.q)
    return { r, route: rt.route, reason: rt.reason, sources: rt.sources || [], intent: it ? it.key : null }
  })

  const bizRead = rows.filter((x) => x.r.expect.kind === 'BUSINESS' && x.r.expect.mode === 'READ')
  const nonBiz = rows.filter((x) => x.r.expect.kind === 'NON_BUSINESS')
  const actions = rows.filter((x) => x.r.expect.mode === 'ACTION')

  const correct = bizRead.filter((x) => x.intent === x.r.expect.intent)
  const missToConversation = bizRead.filter((x) => x.intent === null)
  const crossIntent = bizRead.filter((x) => x.intent !== null && x.intent !== x.r.expect.intent)
  const wrongSource = bizRead.filter((x) => {
    const want = x.r.expect.source
    return want && !(x.sources.includes(want))
  })
  const falsePos = nonBiz.filter((x) => x.intent !== null)
  const actionErrors = actions.filter((x) => x.route === 'BUSINESS_QUERY')

  return { rows, bizRead, nonBiz, actions, correct, missToConversation, crossIntent, wrongSource, falsePos, actionErrors }
}

/**
 * The named safety metrics, separated on purpose.
 *
 * ⛔ NO_READ and WRONG_SOURCE ARE NOT THE SAME FAILURE AND MUST NEVER BE SUMMED AWAY. A miss
 * reads nothing and says so. A wrong-source read answers confidently out of the wrong table,
 * and the Owner has no way to see that it happened. TOTAL_INTENT_FAILURES exists so the two
 * can be traded against each other deliberately — trading a wrong-source read for a miss is
 * a WIN even though the total is unchanged.
 */
function metrics () {
  const m = run()
  return {
    BUSINESS_READ_TOTAL: m.bizRead.length,
    BUSINESS_INTENT_CORRECT: m.correct.length,
    NO_READ_MISSES: m.missToConversation.length,
    WRONG_SOURCE_READS: m.crossIntent.length,
    TOTAL_INTENT_FAILURES: m.missToConversation.length + m.crossIntent.length,
    FALSE_POSITIVES: m.falsePos.length,
    ACTION_MISROUTES: m.actionErrors.length,
    ACTION_AUTHORITY_WIDENED: m.actionErrors.some((x) => (x.sources || []).length > 0) ? 'YES' : 'NO'
  }
}

function report () {
  const m = run()
  const pct = (n, d) => d === 0 ? 'n/a' : (100 * n / d).toFixed(1) + '%'

  console.log('=== HEADLINE ===')
  console.log('  corpus                       ' + m.rows.length)
  console.log('  business READ rows           ' + m.bizRead.length)
  console.log('  intent correct               ' + m.correct.length + '   (' + pct(m.correct.length, m.bizRead.length) + ')')
  console.log('  BUSINESS -> CONVERSATION     ' + m.missToConversation.length + '   (read nothing)')
  console.log('  cross-intent collisions      ' + m.crossIntent.length)
  console.log('  wrong source                 ' + m.wrongSource.length)
  console.log('  false positives (non-biz)    ' + m.falsePos.length + ' / ' + m.nonBiz.length)
  console.log('  ACTION authority errors      ' + m.actionErrors.length + ' / ' + m.actions.length)

  console.log('')
  console.log('=== ACCURACY BY CLASS ===')
  const classes = [...new Set(m.bizRead.map((x) => x.r.cls))].sort()
  for (const c of classes) {
    const rows = m.bizRead.filter((x) => x.r.cls === c)
    const ok = rows.filter((x) => x.intent === x.r.expect.intent)
    console.log('  ' + c + '  ' + String(ok.length + '/' + rows.length).padEnd(7) + pct(ok.length, rows.length))
  }

  console.log('')
  console.log('=== RECALL BY INTENT ===')
  const intents = [...new Set(m.bizRead.map((x) => x.r.expect.intent))]
  for (const i of intents) {
    const rows = m.bizRead.filter((x) => x.r.expect.intent === i)
    const ok = rows.filter((x) => x.intent === i)
    console.log('  ' + i.padEnd(16) + String(ok.length + '/' + rows.length).padEnd(7) + pct(ok.length, rows.length))
  }

  console.log('')
  console.log('=== EVERY MISS (business question that read nothing) ===')
  for (const x of m.missToConversation) {
    console.log('  [' + x.r.cls + '] ' + x.r.q.padEnd(18) + ' want=' + x.r.expect.intent.padEnd(15) + ' got=' + x.route)
  }

  if (m.crossIntent.length) {
    console.log('')
    console.log('=== CROSS-INTENT COLLISIONS (read the WRONG source) ===')
    for (const x of m.crossIntent) {
      console.log('  [' + x.r.cls + '] ' + x.r.q.padEnd(18) + ' want=' + x.r.expect.intent + ' got=' + x.intent)
    }
  }
  if (m.falsePos.length) {
    console.log('')
    console.log('=== FALSE POSITIVES ===')
    for (const x of m.falsePos) console.log('  [' + x.r.cls + '] ' + x.r.q.padEnd(18) + ' got=' + x.intent + ' route=' + x.route)
  }
  if (m.actionErrors.length) {
    console.log('')
    console.log('=== ACTION ROUTED AS READ ===')
    for (const x of m.actionErrors) console.log('  ' + x.r.q + ' -> ' + x.route + ' / ' + x.intent)
  }
  return m
}

module.exports = { run, report, metrics }
if (require.main === module) report()
