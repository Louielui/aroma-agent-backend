'use strict'

/**
 * shapeDriftRunner.js — the daily errand that reads the six endpoints and compares.
 *
 * ⛔ THE COMPARISON IS NOT HERE. `shapeDrift.js` is pure and tested without a network; this file
 * only fetches and maps the result onto the errand vocabulary. Keeping the judgement out of the
 * I/O is what let the rulings (alarm vs report, noise on the row) be tested at all.
 *
 * ⛔ AND THE OUTCOME MAPPING IS THE SURFACING DECISION:
 *
 *   alarms present  → STOPPED_FOR_YOU  unresolved rows are listed by the briefing, so a field
 *                     that vanished reaches the Owner WITHOUT him going to look for it. A
 *                     report nobody opens is one of the 489: real, correct, asserting nothing.
 *   no alarms       → ANSWERED         the coverage line rides along as the answer. It never
 *                     escalates, because no threshold for 「enough」 can be derived.
 *   a read failed   → BLOCKED_BY_SITE  never a clean 「no drift」. Five of six comparing is not
 *                     a comparison, and saying so is the capture defect avoided again.
 *
 * READ ONLY. Six GETs, zero writes, zero model tokens. Measured 2026-08-11: 10.8s, 112 KB.
 */

const { CAPTURED, CAPTURED_ON } = require('../intake/goal/capturedShapes')
const { ENDPOINTS, readOne } = require('../../scripts/verify/captureShapes')
const { shapeDrift } = require('./shapeDrift')
const { OUTCOME } = require('../home/errandStore')

/**
 * @param {{read?:Function}} deps  `read` is injected so tests never touch the network.
 * @returns {Promise<{outcome:string, answer:string, drift:object, capturedOn:string}>}
 */
async function runShapeDrift (deps = {}) {
  const read = typeof deps.read === 'function' ? read0(deps.read) : read0(readOne)
  const live = {}
  const unreadable = []

  for (const [key, path] of Object.entries(ENDPOINTS)) {
    const r = await read(key, path)
    if (r && r.ok) live[key] = { rowsSeen: r.rowsSeen, fields: r.fields, arrays: r.arrays }
    else unreadable.push({ key, reason: (r && r.reason) || 'unreadable' })
  }

  const drift = shapeDrift(CAPTURED, live)

  if (unreadable.length) {
    return {
      outcome: OUTCOME.BLOCKED_BY_SITE,
      answer: null,
      detail: unreadable.map((u) => u.key + ': ' + u.reason).join('; '),
      drift,
      capturedOn: CAPTURED_ON
    }
  }

  return {
    outcome: drift.alarmed ? OUTCOME.STOPPED_FOR_YOU : OUTCOME.ANSWERED,
    answer: summarise(drift, CAPTURED_ON),
    drift,
    capturedOn: CAPTURED_ON
  }
}

/** Identity wrapper so an injected reader and the real one are called the same way. */
function read0 (fn) { return (key, path) => fn(key, path) }

/**
 * The line the Owner reads.
 *
 * ⛔ SMALL DENOMINATORS ARE MARKED IN THE SENTENCE, NOT IN A FOOTNOTE. His requirement, and his
 * reason: 「or I will treat it as a trend the first time I am tired.」 So a 3-of-36 move says
 * 「數字太細,唔算趨勢」 on its own line rather than appearing as a percentage swing.
 */
function summarise (drift, capturedOn) {
  const real = drift.coverage.filter((c) => !c.noise)
  const noisy = drift.coverage.filter((c) => c.noise)
  const parts = []

  parts.push('欄位知識捕捉於 ' + capturedOn + '，今日對比咗 ' + drift.endpointsCompared + ' 個 endpoint。')

  if (!drift.coverage.length) {
    parts.push('覆蓋率冇變。')
  } else {
    const falls = real.filter((c) => c.direction === 'down')
    if (falls.length) {
      parts.push('跌咗：' + falls.slice(0, 5).map((c) =>
        c.endpoint + '.' + c.field + ' ' + pct(c.was.rate) + '→' + pct(c.now.rate) +
        '（' + c.now.nonEmpty + '/' + c.now.present + '）').join('、'))
    }
    const rises = real.filter((c) => c.direction === 'up')
    if (rises.length) parts.push('升咗 ' + rises.length + ' 項。')
    if (noisy.length) parts.push('另有 ' + noisy.length + ' 項分子太細,數字上會郁但唔算趨勢。')
  }

  return parts.join(' ')
}

const pct = (r) => Math.round(r * 100) + '%'

module.exports = { runShapeDrift, summarise }
