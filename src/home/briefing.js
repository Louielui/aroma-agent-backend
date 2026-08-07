'use strict'

/**
 * briefing.js — what 首頁 says. Three rulings the Owner has already made live here.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 1. NEVER BLANK, and 「我睇唔到差事紀錄」 NEVER collapses into 「冇嘢等你」.
 *    They look identical to a tired reader and mean opposite things — the `count: 43` shape,
 *    in the one surface he acts on.
 *
 * 2. TIMESTAMPED. 「Nothing waiting」 without a time is not a claim.
 *
 * 3. AMOUNTS AGE OUT, and the LINK DOES NOT.
 *    過期嘅係主張，唔係 access. Refusing to open his own cart would be the system
 *    overreaching; removing a number it can no longer support is the system being honest.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { OUTCOME } = require('./errandStore')
const { localParts } = require('../utils/localTime')

/**
 * ⛔ THE CLOCK IS THE OWNER'S, AND IT IS RESOLVED HERE.
 *
 * The same rule as the greeting: 早晨/午安/晚安 depends on the hour and the hour depends on
 * HIS timezone, not the browser's. A page open on a laptop in another zone must still show
 * his times, so the client is never given an epoch to format -- it is given a string.
 * The existing guard 「the client never computes the greeting from the browser clock」 caught
 * a first version of this file that sent raw milliseconds.
 */
function hhmm (ms) {
  if (!ms) return ''
  try {
    const p = localParts(new Date(Number(ms)))
    return String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0')
  } catch (_) { return '' }
}

const AGE = Object.freeze({ FRESH: 'FRESH', STALE: 'STALE', EXPIRED: 'EXPIRED' })
const TWO_HOURS = 2 * 3600 * 1000
const A_DAY = 24 * 3600 * 1000

function ageOf (readAt, now) {
  const d = now - (Number(readAt) || 0)
  if (d < TWO_HOURS) return AGE.FRESH
  if (d < A_DAY) return AGE.STALE
  return AGE.EXPIRED
}

function cardFor (e, now) {
  const s = e.stop || {}
  const age = ageOf(s.amountReadAt || e.at, now)
  const hours = Math.round((now - (s.amountReadAt || e.at)) / 3600000)
  return {
    id: e.id,
    title: e.title,
    atLabel: hhmm(e.at),
    where: s.where,
    account: s.account || null,
    filled: s.filled || [],
    notPressed: s.notPressed,
    whichLayer: s.whichLayer || null,
    amountAge: age,
    // FRESH: plain. STALE: still shown, struck. EXPIRED: REMOVED — HR-5, absent stays absent,
    // applied to a number that has aged out of being true.
    amount: age === AGE.EXPIRED ? null : (s.amount || null),
    amountStruck: age === AGE.STALE,
    amountNote: age === AGE.FRESH
      ? ''
      : age === AGE.STALE
        ? '呢個價我 ' + hours + ' 個鐘之前讀,可能唔同咗。'
        : '太耐(' + hours + ' 個鐘)。個價同存貨都要重新睇 —— 建議我重新行一次,唔好接住做。',
    // ⛔ At EVERY age. What expires is the CLAIM, not the ACCESS.
    openHref: '/api/v1/home/errand/' + encodeURIComponent(e.id) + '/open'
  }
}

/**
 * @param {{store:object, backlog?:object, now?:number}} args
 */
function buildBriefing ({ store, backlog, now }) {
  const t = Number(now) || Date.now()

  // ── errands + waiting, from one read, so the two sections cannot disagree ──
  let rows = null
  let unreadable = false
  try { rows = store.list() } catch (_) { unreadable = true }

  const errands = unreadable
    ? { state: 'CANNOT_READ', rows: [], line: '我睇唔到差事紀錄。', checkedAt: t, checkedAtLabel: hhmm(t) }
    : rows.length
      ? { state: 'HAS_ROWS', rows, line: '', checkedAt: t, checkedAtLabel: hhmm(t) }
      : { state: 'NONE_RAN', rows: [], line: '今日冇差事跑過。', checkedAt: t, checkedAtLabel: hhmm(t) }

  let waiting
  if (unreadable) {
    // ⛔ The whole point. An unreadable record is NOT 「nothing waiting」 — it is 「I cannot
    // tell you」, and the difference could cost him a cart he was waiting to pay for.
    waiting = { state: 'CANNOT_READ', cards: [], line: '我睇唔到差事紀錄,所以答唔到你有冇嘢等緊。', checkedAt: t, checkedAtLabel: hhmm(t) }
  } else {
    const w = rows.filter((e) => e.outcome === OUTCOME.STOPPED_FOR_YOU && !e.resolvedAt)
    waiting = w.length
      ? { state: 'WAITING', cards: w.map((e) => cardFor(e, t)), line: '', checkedAt: t, checkedAtLabel: hhmm(t) }
      : { state: 'NOTHING_WAITING', cards: [], line: '冇嘢等你決定。', checkedAt: t, checkedAtLabel: hhmm(t) }
  }

  // ── the Franco line, its own row, off the greeting ──
  let back
  if (!backlog) back = { state: 'NOT_CHECKED', line: '我未睇過 Drive。', checkedAt: t, checkedAtLabel: hhmm(t) }
  else if (backlog.error) back = { state: 'CANNOT_READ', line: '我睇唔到 Drive 個資料夾(' + backlog.error + ')。', checkedAt: t, checkedAtLabel: hhmm(t) }
  else if (backlog.empty) back = { state: 'NOTHING', line: 'Drive 度冇等緊處理嘅發票。', checkedAt: backlog.checkedAt || t, checkedAtLabel: hhmm(backlog.checkedAt || t) }
  else back = { state: 'PRESENT', line: backlog.line, checkedAt: backlog.checkedAt || t, checkedAtLabel: hhmm(backlog.checkedAt || t) }

  if (errands.rows && errands.rows.length) {
    errands.rows = errands.rows.map((r) => ({ ...r, atLabel: hhmm(r.at) }))
  }
  return { errands, waiting, backlog: back, builtAt: t, builtAtLabel: hhmm(t) }
}

module.exports = { buildBriefing, AGE }
