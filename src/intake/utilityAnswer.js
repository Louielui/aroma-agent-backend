'use strict'

/**
 * utilityAnswer.js — the server answers, or it says nothing at all.
 *
 * ── THE CONTRACT ─────────────────────────────────────────────────────────────
 * `answerUtility` returns ONE finished sentence, or NULL. There is no third outcome.
 *
 * NULL means "I cannot do this deterministically" and the caller falls back to the ordinary
 * conversation path. That is a worse answer; it is never a wrong one. Nothing here guesses a
 * number, approximates a unit it does not know, or produces a sentence implying it looked
 * something up — the defect that started this whole migration was a subsystem reporting on a
 * read instead of admitting it had nothing to say.
 *
 * ── THE CLOCK IS ALWAYS LABELLED ─────────────────────────────────────────────
 * Owner requirement: 「現在是下午 4 時 53 分（Winnipeg）」. A stated time carries its zone so a
 * wrong clock is visible immediately rather than discovered a week later. If the zone cannot
 * be resolved — a malformed setting, an unreadable settings file — this DECLINES rather than
 * answering in a zone it cannot name. A clock you cannot trust is one you do not state.
 *
 * ── NO eval, EVER ────────────────────────────────────────────────────────────
 * The arithmetic is a hand-written recursive-descent parser over a closed grammar. This
 * parses text the Owner typed; `eval` on that input would be a code-execution path opened to
 * save forty lines. A test asserts the string does not appear in this file.
 */

const { resolveTimeZone, formatLocal, startOfLocalDay, localParts } = require('../utils/localTime')
const { t } = require('../i18n/t')

/* ── time and date ────────────────────────────────────────────────────────── */

// ⛔ Thunks, not key strings — `t(WEEKDAYS[n])` would be a DYNAMIC key (HR-48).
const WEEKDAYS = Object.freeze([
  () => t('day.sun'), () => t('day.mon'), () => t('day.tue'), () => t('day.wed'),
  () => t('day.thu'), () => t('day.fri'), () => t('day.sat')
])

/**
 * ── THE TIME AND DATE VOCABULARY LIVES HERE, WITH THE CODE THAT ANSWERS IT ──
 *
 * It used to live in turnRouter, written out a second time. That is what actually broke the
 * conversions — 磅 and 公斤 were known to this file and invisible to the router — and it
 * would have broken these the same way. The module that knows how to answer a concept owns
 * the words for recognising it; the router iterates UTILITY_PATTERNS and holds none.
 */

/** 而家 / 今日 / 聽日 / 琴日 → an offset in days from today. */
const DAY_WORDS = Object.freeze([
  // ⛔ THE `re` PATTERNS ARE MATCHING TOKENS — they parse what HE TYPES and are NEVER
  // translated. Only `label` is interface. Two classes in one table, marked in place because
  // textClasses is per-file. See governance/textClasses.js.
  { re: /聽日|明日|明天/, offset: 1, label: () => t('day.tomorrow') },
  { re: /琴日|尋日|昨日|昨天/, offset: -1, label: () => t('day.yesterday') },
  { re: /今日|今天|而家|依家|家陣|現在|目前|宜家/, offset: 0, label: () => t('day.today') }
])

/** The ways he asks for a date. 幾月幾號 is listed so the anchor window can stay tight. */
const DATE_ASK = '幾月幾號|幾多號|幾號|星期幾|禮拜幾|咩日子|什麼日子|邊日|日期'

/** The ways he asks for the clock. 時間 excludes 時間表 — a timetable is not a time. */
const NOW_WORDS = '而家|依家|家陣|現在|目前|宜家'

/** 'America/Argentina/Buenos_Aires' → 'Buenos Aires'. The city, not the whole path. */
function zoneLabel (tz) {
  const s = String(tz || '')
  const last = s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s
  return last.replace(/_/g, ' ')
}

/**
 * The Owner's wall clock. ONE clock — localTime owns it.
 *
 * This used to build its own Intl.DateTimeFormat here, a second implementation of the
 * same thing. That is precisely how a second unit table and a second routing vocabulary
 * started, and both of those shipped bugs. It throws on a malformed timezone; the caller
 * turns that into a decline.
 */
function wallClock (now, opts) { return localParts(now, opts) }

function timeSentence (now, opts) {
  const c = wallClock(now, opts)
  const meridiem = c.hour < 12 ? t('time.am') : t('time.pm')
  const h12 = c.hour % 12 === 0 ? 12 : c.hour % 12
  return t('util.timeIs', { meridiem, h: h12, m: c.minute, zone: zoneLabel(c.tz) })
}

/**
 * Today, tomorrow or yesterday — computed, not refused.
 *
 * THE OFFSET IS APPLIED TO THE OWNER'S DAY, NOT TO THE INSTANT. Adding 24h to `now` and
 * reformatting would land on the wrong date across a DST change; this takes his local
 * midnight, steps a whole day, and re-reads the wall clock in his zone. A relative date
 * therefore carries the timezone for exactly the same reason today does — the day depends
 * on the zone whichever day is being asked about.
 */
function dateSentence (now, opts, message) {
  const hit = DAY_WORDS.find((d) => d.re.test(String(message || ''))) || DAY_WORDS[2]
  let at = now
  if (hit.offset !== 0) {
    const start = startOfLocalDay(now, opts)
    // Noon of the shifted day: far from either DST boundary, so the calendar date is stable.
    at = new Date(start.getTime() + (hit.offset * 24 + 12) * 60 * 60 * 1000)
  }
  const c = wallClock(at, opts)
  return t('util.dateIs', {
    label: hit.label(),
    y: c.year,
    mo: c.month,
    d: c.day,
    weekday: WEEKDAYS[c.weekday] ? WEEKDAYS[c.weekday]() : '',
    zone: zoneLabel(c.tz)
  })
}

/* ── arithmetic ───────────────────────────────────────────────────────────── */

/**
 * A closed grammar, parsed by hand:
 *   expr   := term (('+' | '-') term)*
 *   term   := factor (('*' | '/') factor)*
 *   factor := '-'? ( number | '(' expr ')' )
 * Anything the tokenizer does not recognise, or any leftover input, is a decline.
 */
function tokenize (src) {
  const s = String(src).replace(/[，,](?=\d{3}\b)/g, '') // thousand separators only
  const out = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      const raw = s.slice(i, j)
      if ((raw.match(/\./g) || []).length > 1) return null
      const n = Number(raw)
      if (!Number.isFinite(n)) return null
      out.push({ t: 'num', v: n }); i = j; continue
    }
    if ('+-*/×÷()'.includes(ch)) {
      out.push({ t: ch === '×' ? '*' : (ch === '÷' ? '/' : ch) }); i++; continue
    }
    return null // anything else at all → decline
  }
  return out.length ? out : null
}

function parseExpression (tokens) {
  let i = 0
  const peek = () => tokens[i]
  const eat = (t) => (tokens[i] && tokens[i].t === t ? tokens[i++] : null)

  function factor () {
    if (eat('-')) { const v = factor(); return v === null ? null : -v }
    const n = eat('num')
    if (n) return n.v
    if (eat('(')) {
      const v = expr()
      if (v === null || !eat(')')) return null
      return v
    }
    return null
  }
  function term () {
    let v = factor()
    if (v === null) return null
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = tokens[i++].t
      const r = factor()
      if (r === null) return null
      if (op === '/') {
        if (r === 0) return null // Infinity and NaN are not answers
        v = v / r
      } else v = v * r
    }
    return v
  }
  function expr () {
    let v = term()
    if (v === null) return null
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = tokens[i++].t
      const r = term()
      if (r === null) return null
      v = op === '+' ? v + r : v - r
    }
    return v
  }

  const value = expr()
  if (value === null || i !== tokens.length) return null // leftover input → decline
  return Number.isFinite(value) ? value : null
}

/** Trim floating-point noise without inventing precision. */
function tidy (n) {
  const r = Math.round(n * 1e10) / 1e10
  return String(r)
}

/* ── Chinese arithmetic ──────────────────────────────────────────────────── */

/**
 * CHINESE OPERATORS AND NUMERALS ARE THE NORMAL CASE. 「12乘34係幾多？」 「三加四」 「100除以4」
 *
 * 除以 is listed before 除 and 乘以 before 乘: the longer form must win, or 「100除以4」
 * tokenizes as 100 ÷ 以4 and declines.
 */
const CJK_OPS = Object.freeze([
  [/除以|除/g, '/'], [/乘以|乘/g, '*'], [/加/g, '+'], [/減|扣/g, '-']
])

/** The numeral run this borrows from answerPlan — ONE Chinese-numeral reader, not a second. */
const { cjkToNumber } = require('./answerPlan')
const CJK_NUM_RE = /[零〇一二兩三四五六七八九十百千萬]+/g

/**
 * Rewrite the Owner's arithmetic into ASCII, so ONE parser handles both scripts.
 * Nothing here evaluates: it only substitutes tokens the grammar already understands.
 */
function normalizeArithmetic (message) {
  let s = String(message)
  for (const [re, op] of CJK_OPS) s = s.replace(re, op)
  s = s.replace(/[xX](?=\s*\d)/g, '*')     // 「12 x 34」
  s = s.replace(/[×]/g, '*').replace(/[÷]/g, '/')
  s = s.replace(CJK_NUM_RE, (run) => {
    const n = cjkToNumber(run)
    return n === null ? run : String(n)     // unreadable numeral is left alone → declines
  })
  return s
}

/** How the expression is shown back, so 12*34 reads as 12 × 34. */
function prettyExpression (ascii) {
  return ascii.trim()
    .replace(/\*/g, ' × ').replace(/\//g, ' ÷ ')
    .replace(/\+/g, ' + ').replace(/-/g, ' − ')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
}

/**
 * A DATE IS NOT A SUBTRACTION. 「發票 2026-08-04」 was computed as 2026 − 08 − 04 = 2014 —
 * a wrong number, produced confidently, from an invoice date. Caught by the test that asks
 * whether an invoice number can be mistaken for an expression.
 *
 * Two guards, because either alone leaks: the ISO shape catches 2026-08-04 and 04/08/2026,
 * and the leading-zero rule catches the rest — nobody writes 「08 + 5」 when they mean
 * arithmetic, but every date does.
 */
const DATE_LIKE = /\d{4}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,2}|\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4}/
const LEADING_ZERO = /(^|[^\d.])0\d/

function calcSentence (message) {
  if (DATE_LIKE.test(String(message))) return null

  // Only the arithmetic part is parsed; the sentence wrapped around it (係幾多？) is not an
  // expression and is dropped by taking the longest arithmetic run, never by guesswork.
  const normalized = normalizeArithmetic(message)
  const m = normalized.match(/[-+*/().,\d\s]+/g)
  if (!m) return null
  const candidate = m.sort((a, b) => b.length - a.length)[0]
  if (LEADING_ZERO.test(candidate)) return null // 08 is a month, not a number
  const tokens = tokenize(candidate)
  if (!tokens) return null
  const v = parseExpression(tokens)
  if (v === null) return null
  // An expression with no operator at all is not a calculation — 「第 3 張」 must not become
  // 「3 = 3」. parseExpression accepts a bare number, so the check belongs here.
  if (!/[-+*/]/.test(candidate.replace(/^\s*-/, ''))) return null
  return t('util.calc', { expr: prettyExpression(candidate), value: tidy(v) })
}

/* ── unit conversion ──────────────────────────────────────────────────────── */

/**
 * NARROW ON PURPOSE. Only units a kitchen actually asks about, only within one dimension.
 * A converter that answers 「2 kg 等於幾多毫升？」 is worse than no converter at all: a
 * kilogram of flour is not a litre of flour, and the number would look authoritative.
 */
/**
 * CHINESE UNITS ARE THE NORMAL CASE, NOT AN EDGE CASE. Owner instruction, 2026-08-04, after
 * 「5磅是多少公斤？」 fell through and read all five sources.
 *
 * `per` is the amount in the dimension's base unit (g, ml, cm). Temperature is NOT here —
 * it is an offset scale, not a ratio, and multiplying it would be wrong. See TEMPERATURE.
 *
 * `note` marks a unit whose size is genuinely ambiguous. A cup is 236.588 ml in US
 * customary and 250 ml metric; the answer states which one it used rather than picking one
 * silently, because a recipe scaled with the wrong cup is a real loss and an unlabelled
 * number hides it.
 */
const UNITS = Object.freeze({
  // ── mass, base g ──
  g: { dim: 'mass', per: 1, name: 'g' },
  克: { dim: 'mass', per: 1, name: 'g' },
  kg: { dim: 'mass', per: 1000, name: 'kg' },
  公斤: { dim: 'mass', per: 1000, name: 'kg' },
  千克: { dim: 'mass', per: 1000, name: 'kg' },
  lb: { dim: 'mass', per: 453.59237, name: 'lb' },
  lbs: { dim: 'mass', per: 453.59237, name: 'lb' },
  磅: { dim: 'mass', per: 453.59237, name: 'lb' },
  oz: { dim: 'mass', per: 28.349523125, name: 'oz' },
  安士: { dim: 'mass', per: 28.349523125, name: 'oz' },
  盎司: { dim: 'mass', per: 28.349523125, name: 'oz' },
  // ── volume, base ml ──
  ml: { dim: 'volume', per: 1, name: 'ml' },
  毫升: { dim: 'volume', per: 1, name: 'ml' },
  l: { dim: 'volume', per: 1000, name: 'L' },
  公升: { dim: 'volume', per: 1000, name: 'L' },
  升: { dim: 'volume', per: 1000, name: 'L' },
  cup: { dim: 'volume', per: 236.5882365, name: 'cup', note: 'US' },
  cups: { dim: 'volume', per: 236.5882365, name: 'cup', note: 'US' },
  杯: { dim: 'volume', per: 236.5882365, name: 'cup', note: 'US' },
  tsp: { dim: 'volume', per: 4.92892159375, name: 'tsp', note: 'US' },
  茶匙: { dim: 'volume', per: 4.92892159375, name: 'tsp', note: 'US' },
  tbsp: { dim: 'volume', per: 14.78676478125, name: 'tbsp', note: 'US' },
  湯匙: { dim: 'volume', per: 14.78676478125, name: 'tbsp', note: 'US' },
  gallon: { dim: 'volume', per: 3785.411784, name: 'gallon', note: 'US' },
  gallons: { dim: 'volume', per: 3785.411784, name: 'gallon', note: 'US' },
  加侖: { dim: 'volume', per: 3785.411784, name: 'gallon', note: 'US' },
  // ── length, base cm ──
  cm: { dim: 'length', per: 1, name: 'cm' },
  厘米: { dim: 'length', per: 1, name: 'cm' },
  公分: { dim: 'length', per: 1, name: 'cm' },
  m: { dim: 'length', per: 100, name: 'm' },
  米: { dim: 'length', per: 100, name: 'm' },
  ft: { dim: 'length', per: 30.48, name: 'ft' },
  feet: { dim: 'length', per: 30.48, name: 'ft' },
  呎: { dim: 'length', per: 30.48, name: 'ft' },
  英尺: { dim: 'length', per: 30.48, name: 'ft' },
  inch: { dim: 'length', per: 2.54, name: 'inch' },
  inches: { dim: 'length', per: 2.54, name: 'inch' },
  吋: { dim: 'length', per: 2.54, name: 'inch' },
  英寸: { dim: 'length', per: 2.54, name: 'inch' }
})

/**
 * TEMPERATURE IS SEPARATE, because it is an offset scale: 0 °C is not 0 °F, so `per` cannot
 * express it. 度 on its own is AMBIGUOUS and is resolved only when the other side of the
 * question names a scale — 「180度是多少華氏度？」 has an explicit target, so the source is
 * Celsius. If BOTH sides are bare 度, this declines rather than guessing which scale the
 * Owner meant.
 */
const TEMPERATURE = Object.freeze({
  '°c': 'C', '℃': 'C', 攝氏: 'C', celsius: 'C',
  '°f': 'F', '℉': 'F', 華氏: 'F', fahrenheit: 'F',
  度: '?', 度數: '?', degrees: '?', degree: '?'
})

/** Every token either table knows, longest first so 公斤 wins over 斤-like prefixes. */
const UNIT_TOKENS = Object.freeze(
  [...Object.keys(UNITS), ...Object.keys(TEMPERATURE)].sort((a, b) => b.length - a.length)
)

const isCjk = (s) => /[^\x00-\x7F]/.test(s)

/**
 * ONE VOCABULARY, SHARED. turnRouter builds its convert pattern from this rather than
 * keeping its own list — the router had its own hand-written units and its own connector
 * words, so 磅 and 公斤 were known to the answerer and invisible to the router, and every
 * conversion the Owner typed fell through. Two tables for one feature is the same defect
 * shape as a role string nothing sends.
 *
 * Latin tokens get a word boundary (so `m` does not match inside "minutes"); CJK tokens
 * must NOT (磅 and 是 are both non-word characters, so there is no boundary between them —
 * the `\b` that used to be here is precisely why nothing matched).
 */
function unitAlternation () {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const latin = UNIT_TOKENS.filter((t) => !isCjk(t)).map(esc)
  const cjk = UNIT_TOKENS.filter(isCjk).map(esc)
  return '(?:' + cjk.join('|') + '|(?:' + latin.join('|') + ')\\b)'
}

const UNIT_RE = new RegExp('(' + UNIT_TOKENS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi')

const lookup = (tok) => UNITS[String(tok).toLowerCase()] || UNITS[tok] || null
const tempOf = (tok) => TEMPERATURE[String(tok).toLowerCase()] || TEMPERATURE[tok] || null

/** C↔F, the one conversion that is not a ratio. */
function temperatureSentence (amount, fromScale, toScale) {
  // 度 on its own is resolved ONLY by the other side naming a scale. Both bare → decline.
  /**
   * ⛔ `to`, NOT `t` — AND THIS ONE WAS LIVE. The line below calls `t('util.temperature')`; with
   * a local `t` holding a scale letter it would have thrown on the first temperature question.
   * Caught by governance/resolverShadow.test.js, which is why that fence exists.
   */
  let f = fromScale
  let to = toScale
  if (f === '?' && to === '?') return null
  if (f === '?') f = to === 'C' ? 'F' : 'C'
  if (to === '?') to = f === 'C' ? 'F' : 'C'
  if (f === to) return null
  const value = f === 'C' ? (amount * 9 / 5) + 32 : (amount - 32) * 5 / 9
  if (!Number.isFinite(value)) return null
  return t('util.temperature', { amount: tidy(amount), from: f, result: tidy(Math.round(value * 100) / 100), to })
}

function convertSentence (message) {
  const s = String(message)
  // The source: a number followed by a known token. Latin tokens carry a word boundary,
  // CJK tokens must not — see unitAlternation().
  const src = new RegExp('(\\d[\\d,.]*)\\s*' + unitAlternation(), 'i').exec(s)
  if (!src) return null
  const amount = Number(src[1].replace(/,/g, ''))
  if (!Number.isFinite(amount)) return null
  const srcTok = src[0].slice(String(src[1]).length).trim()

  // The target: the first known token appearing AFTER the source.
  const after = s.slice(src.index + src[0].length)
  let toTok = null
  for (const m of after.matchAll(UNIT_RE)) { toTok = m[1]; break }
  if (!toTok) return null // nothing to convert into → decline

  // Temperature first: it is a different kind of arithmetic, not a ratio.
  const fs = tempOf(srcTok)
  const ts = tempOf(toTok)
  if (fs || ts) {
    if (!fs || !ts) return null // 「5磅是多少度」 is not a conversion → decline
    return temperatureSentence(amount, fs, ts)
  }

  const from = lookup(srcTok)
  const to = lookup(toTok)
  if (!from || !to) return null
  if (to.dim !== from.dim) return null       // mass ↔ volume ↔ length → decline
  if (to.name === from.name) return null     // nothing was asked

  const value = (amount * from.per) / to.per
  if (!Number.isFinite(value)) return null
  // A unit whose size is ambiguous says which one was used, on either side of the sum.
  const notes = [...new Set([from.note, to.note].filter(Boolean))]
  const suffix = notes.length ? t('util.measureNote', { notes: notes.join('/') }) : ''
  return `${tidy(amount)} ${from.name} = ${tidy(Math.round(value * 1000) / 1000)} ${to.name}${suffix}。`
}

/* ── the entry point ──────────────────────────────────────────────────────── */

/**
 * @param {'time'|'date'|'calc'|'convert'|null} kind  from turnRouter's decision
 * @param {string} message                            the Owner's own words
 * @param {{root?, env?, now?: Date}} opts
 * @returns {{text: string, kind: string}|null}       NULL means "fall to CONVERSATION"
 */
function answerUtility (kind, message, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date()
  try {
    let text = null
    if (kind === 'time') text = timeSentence(now, opts)
    else if (kind === 'date') text = dateSentence(now, opts, message)
    else if (kind === 'calc') text = calcSentence(message)
    else if (kind === 'convert') text = convertSentence(message)
    return text ? { text, kind } : null
  } catch (_) {
    // An unresolvable timezone lands here. DECLINE — never answer in a zone we cannot name,
    // and never let this throw into the turn.
    return null
  }
}

/**
 * ── THE ONE PUBLISHED TABLE ──────────────────────────────────────────────────
 * turnRouter iterates this and holds NO utility vocabulary of its own. The order is the
 * priority order and is published with it, so the router cannot reorder the concepts by
 * accident either.
 *
 * Every pattern is built from the same constants the answering code above uses, so a word
 * cannot be known to one half and invisible to the other. That asymmetry — not the missing
 * words — is what made every Chinese conversion fall through and read five sources.
 */
const UTILITY_PATTERNS = Object.freeze([
  {
    kind: 'time',
    // 時間(?!表): a timetable is not a clock.
    re: new RegExp(`(?:${NOW_WORDS})\\s*(?:係|是)?\\s*幾(?:多)?點|幾點鐘|(?:${NOW_WORDS})[^。？?]{0,3}時間(?!表)` +
      '|\\bwhat(?:\'s| is) the time\\b|\\bwhat time is it\\b|\\bcurrent time\\b', 'i')
  },
  {
    kind: 'date',
    // The anchor window is {0,2} ON PURPOSE: 「今日幾月幾號」 fits, 「今日張發票幾號到期」 does
    // not, so a business question with a date word in it stays a business question.
    re: new RegExp(`(?:${DAY_WORDS.map((d) => d.re.source).join('|')})[^。？?]{0,2}(?:${DATE_ASK})` +
      '|\\bwhat(?:\'s| is) (?:the |today\'?s )?date\\b|\\btoday\'?s date\\b', 'i')
  },
  {
    kind: 'calc',
    // A number, an operator and a number — in either script. Requiring the operator between
    // two numbers is what keeps 「12月3號」 and 「加拿大」 out.
    re: (() => {
      const NUM = '(?:\\d[\\d,.]*|[零〇一二兩三四五六七八九十百千萬]+)'
      const OP = '(?:[+\\-*/×÷]|[xX]|加|減|扣|乘以|乘|除以|除)'
      return new RegExp(`${NUM}\\s*${OP}\\s*${NUM}`)
    })()
  },
  { kind: 'convert', re: new RegExp('\\d[\\d,.]*\\s*' + unitAlternation() + '[\\s\\S]{0,14}?' + unitAlternation() + '|換算|單位轉換', 'i') }
])

module.exports = {
  answerUtility,
  zoneLabel,
  UNITS,
  TEMPERATURE,
  UNIT_TOKENS,
  unitAlternation,
  UTILITY_PATTERNS,
  DAY_WORDS
}
