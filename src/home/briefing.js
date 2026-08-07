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
  if (!ms) return undefined
  try {
    const p = localParts(new Date(Number(ms)))
    return String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0')
  } catch (_) { return undefined }
}

/**
 * ⛔ THE ONLY WAY A SECTION GETS A TIME.
 *
 * `readAt` must come FROM THE READ. When there was no read it is undefined and the section
 * carries **no time at all** — 「一個非聲稱配一個時間，衰過冇時間」.
 *
 * The old `|| t` fallback lent the briefing's own build time to any reader that supplied
 * none, **invisibly**, because the result is a plausible clock either way. It sat under the
 * sections that happen to be honest today, waiting for the ordering luck to run out.
 */
function stamped (section, readAt) {
  if (!readAt) return section
  return { ...section, checkedAt: readAt, checkedAtLabel: hhmm(readAt) }
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

  // ── errands + waiting ──────────────────────────────────────────────────────
  // ⛔ A MISSING STORE IS A DEFECT, NOT A CONDITION. Before this, `store.list()` threw a
  // TypeError that the same catch reported as CANNOT_READ — so a WIRING FAILURE rendered
  // identically to a corrupt file, in a calm operational sentence. That is exactly what
  // NOT_CHECKED did for Drive, and it is the answer to 「what is the equivalent for errands
  // before the ordering luck runs out」.
  let errands
  let waiting
  if (!store || typeof store.list !== 'function') {
    errands = { state: 'NOT_WIRED', rows: [], line: '差事紀錄未接線 —— 呢個係一個缺陷,唔係一個狀態。' }
    waiting = { state: 'NOT_WIRED', cards: [], line: '差事紀錄未接線,所以我答唔到有冇嘢等你。呢個係一個缺陷。' }
  } else {
    let rows = null
    let unreadable = false
    try { rows = store.list() } catch (_) { unreadable = true }

    if (unreadable) {
      errands = stamped({ state: 'CANNOT_READ', rows: [], line: '我睇唔到差事紀錄。' }, t)
      // ⛔ An unreadable record is NOT 「nothing waiting」 — it is 「I cannot tell you」, and
      // the difference could cost him a cart he was waiting to pay for.
      waiting = stamped({ state: 'CANNOT_READ', cards: [], line: '我睇唔到差事紀錄,所以答唔到你有冇嘢等緊。' }, t)
    } else {
      // The store WAS read, at t. That is why these carry a time — from the read, not by default.
      errands = stamped(rows.length
        ? { state: 'HAS_ROWS', rows: rows.map((r) => ({ ...r, atLabel: hhmm(r.at) })), line: '' }
        : { state: 'NONE_RAN', rows: [], line: '未有差事紀錄 —— 到今日為止每單都係手動跑,冇記低。' }, t)

      const w = rows.filter((e) => e.outcome === OUTCOME.STOPPED_FOR_YOU && !e.resolvedAt)
      waiting = stamped(w.length
        ? { state: 'WAITING', cards: w.map((e) => cardFor(e, t)), line: '' }
        : { state: 'NOTHING_WAITING', cards: [], line: '冇嘢等你決定。' }, t)
    }
  }

  // ── the Drive line, its own row, and its time comes FROM THE READ ──────────
  let back
  if (backlog === undefined) {
    back = { state: 'NOT_WIRED', line: 'Drive 未接線 —— 我根本冇去睇。呢個係一個缺陷,唔係一個狀態。' }
  } else if (backlog === null) {
    back = { state: 'NOT_CHECKED', line: '我未睇過 Drive。' }
  } else if (backlog.error) {
    back = stamped({ state: 'CANNOT_READ', line: '我睇唔到 Drive 個資料夾(' + backlog.error + ')。' }, backlog.checkedAt)
  } else if (backlog.empty) {
    back = stamped({ state: 'NOTHING', line: 'Drive 度冇等緊處理嘅發票。' }, backlog.checkedAt)
  } else {
    back = stamped({ state: 'PRESENT', line: backlog.line }, backlog.checkedAt)
  }

  return { errands, waiting, backlog: back, builtAt: t, builtAtLabel: hhmm(t) }
}

module.exports = { buildBriefing, AGE }
