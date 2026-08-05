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

const { resolveTimeZone, formatLocal } = require('../utils/localTime')

/* ── time and date ────────────────────────────────────────────────────────── */

const WEEKDAYS = Object.freeze(['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'])

/** 'America/Argentina/Buenos_Aires' → 'Buenos Aires'. The city, not the whole path. */
function zoneLabel (tz) {
  const s = String(tz || '')
  const last = s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s
  return last.replace(/_/g, ' ')
}

/** The Owner's wall clock, as numbers, in his zone. */
function wallClock (now, opts) {
  const tz = resolveTimeZone(opts) // throws on malformed — the caller turns that into a decline
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short'
  })
  const p = {}
  for (const part of f.formatToParts(now)) if (part.type !== 'literal') p[part.type] = part.value
  // The weekday index comes from the formatted local date, never from getDay() on the
  // instant — those disagree either side of midnight.
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  return { tz, year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute), weekday: wd }
}

function timeSentence (now, opts) {
  const c = wallClock(now, opts)
  const meridiem = c.hour < 12 ? '上午' : '下午'
  const h12 = c.hour % 12 === 0 ? 12 : c.hour % 12
  return `現在是${meridiem} ${h12} 時 ${c.minute} 分（${zoneLabel(c.tz)}）。`
}

function dateSentence (now, opts) {
  const c = wallClock(now, opts)
  return `今天是 ${c.year} 年 ${c.month} 月 ${c.day} 日，${WEEKDAYS[c.weekday] || ''}（${zoneLabel(c.tz)}）。`
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

function calcSentence (message) {
  // Only the arithmetic part of the message is parsed; a sentence wrapped around it is not
  // an expression and is declined rather than stripped by guesswork.
  const m = String(message).match(/[-+*/×÷().,\d\s]+/g)
  if (!m) return null
  const candidate = m.sort((a, b) => b.length - a.length)[0]
  const tokens = tokenize(candidate)
  if (!tokens) return null
  const v = parseExpression(tokens)
  if (v === null) return null
  return `${candidate.trim()} = ${tidy(v)}。`
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
  let f = fromScale
  let t = toScale
  if (f === '?' && t === '?') return null
  if (f === '?') f = t === 'C' ? 'F' : 'C'
  if (t === '?') t = f === 'C' ? 'F' : 'C'
  if (f === t) return null
  const value = f === 'C' ? (amount * 9 / 5) + 32 : (amount - 32) * 5 / 9
  if (!Number.isFinite(value)) return null
  return `${tidy(amount)} °${f} = ${tidy(Math.round(value * 100) / 100)} °${t}。`
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
  const suffix = notes.length ? `（${notes.join('/')} 量度）` : ''
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
    else if (kind === 'date') text = dateSentence(now, opts)
    else if (kind === 'calc') text = calcSentence(message)
    else if (kind === 'convert') text = convertSentence(message)
    return text ? { text, kind } : null
  } catch (_) {
    // An unresolvable timezone lands here. DECLINE — never answer in a zone we cannot name,
    // and never let this throw into the turn.
    return null
  }
}

module.exports = { answerUtility, zoneLabel, UNITS, TEMPERATURE, UNIT_TOKENS, unitAlternation }
