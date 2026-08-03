'use strict'

/**
 * readResultView.js — the Owner-facing SHAPE of a read result.
 *
 * WHY THE SERVER RENDERS THIS AND THE MODEL DOES NOT.
 * The read layer already holds every retrieved row as structured data before the model is
 * called. Handing those rows to a model and asking it to lay them out again means asking
 * it to re-type an amount, a date, an invoice number and a status — and this pipeline has
 * a written record of what happens when prose is trusted to restate a fact: groundedReply
 * exists because a reply claimed a proposal that was never created, and readStateGuard
 * exists because an explicit contract rule about read state failed five times in a row.
 *
 * WHAT IS SHOWN IS DECIDED BY THE QUESTION, NOT BY WHAT ANSWERED.
 * The first version grouped EVERY source that returned rows, so an invoice question came
 * back carrying architecture documents, a television advertisement, an eye appointment and
 * three commits. A connector returning data is not a reason to show it. Relevance is now
 * decided by two facts that are already known, and by nothing else:
 *
 *   1. the source is one the question could be about        (INTENTS[].sources)
 *   2. the rows were selected BY that question, not by recency (usedFallback === false)
 *
 * There is deliberately NO second, text-level filter on top. Rows that came back from a
 * keyword query were already chosen by the question; re-judging them here would mean
 * overruling the search with my own guess, and silently dropping a genuinely relevant
 * record is the worse failure. Everything not shown is COUNTED in 資料限制, so a wrong
 * exclusion is visible as a number rather than as an absence.
 *
 * PRESENTATION ONLY. Pure, no I/O. It never fetches, never writes, never decides what was
 * read — only what, of what was read, answers the question that was asked.
 */

const { LABELS } = require('./readStateGuard') // Owner-facing source names, derived from ALL_SOURCES
const { intentFor } = require('../context/readContext') // THE one intent table — never a second classifier

/** Owner-facing status words. The keys are the API's own values. */
const STATUS_LABELS = Object.freeze({
  needs_review: '需要審批',
  approved: '已批准',
  sent: '已發送',
  received: '已收貨',
  partially_received: '部分收貨',
  unknown: '狀態未確認'
})

/**
 * WHICH SOURCES HAVE A STATUS AT ALL.
 *
 * Only the restaurant's own records carry one. An email has no approval state, so a Gmail
 * row must render with NO status segment — labelling it 狀態未確認 would not be caution,
 * it would be an invented fact about a thing that has no such field. 狀態未確認 is
 * reserved for an Aroma System row that HAS a status whose value is not in the map.
 */
const STATUS_BEARING_SOURCES = Object.freeze(['aroma_system'])

const CAPS = Object.freeze({
  maxItemsPerSection: 5, // beyond this: 「另外有 X 項」
  maxTitleChars: 60,
  maxRawStatusChars: 24
})

const H = Object.freeze({ limits: '資料限制', opinion: '香香睇法', next: '下一步' })

/** Sentences kept from her reading of the rows. */
const MAX_OPINION_SENTENCES = 3

/**
 * Pull one `name=value` out of the compact content string the adapters build
 * (`k=v · k=v · …`). Values never contain ' · ' because the adapters skip objects and
 * join scalars, so the separator is unambiguous.
 */
function fieldOf (content, name) {
  const s = String(content == null ? '' : content)
  for (const part of s.split(' · ')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      const v = part.slice(eq + 1).trim()
      return v === '' ? null : v
    }
  }
  return null
}

/**
 * A COMPLETE calendar day, or the value untouched.
 *
 * This used to be `slice(0, 10)`, which assumes ISO-8601. Four sources are ISO, but Gmail
 * carries the mail's own `Date:` header — RFC 5322 — so slicing produced "03 Aug 202":
 * not a truncated date, a WRONG one. The origin was here, in the renderer's assumption,
 * not in the adapter and not in the data; both formats are legitimate. A value that parses
 * is formatted; a value that does not is shown AS IT IS, never cut.
 */
const pad = (n) => String(n).padStart(2, '0')
function dayOf (value) {
  const s = String(value == null ? '' : value).trim()
  if (!s) return null
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  if (iso) return iso[1]
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return s // unparseable: the Owner sees the real value rather than a mangled one
}

/** The status segment, or null when there should not be one. */
function statusSegment (item) {
  if (!item || !STATUS_BEARING_SOURCES.includes(item.source)) return null
  const raw = fieldOf(item.content, 'status')
  if (raw === null) return null // the row itself carries no status — say nothing
  const mapped = STATUS_LABELS[raw]
  if (mapped) return mapped
  // NEVER silently dropped: an unrecognised value is shown, with its raw form.
  const shown = raw.length > CAPS.maxRawStatusChars ? raw.slice(0, CAPS.maxRawStatusChars) + '…' : raw
  return `${STATUS_LABELS.unknown}（${shown}）`
}

/** The human identifier for a row, when it has one. Never the internal row id. */
function identifierOf (item) {
  const n = fieldOf(item.content, 'invoiceNumber') ||
    fieldOf(item.content, 'invoice_number') ||
    fieldOf(item.content, 'poNumber') ||
    fieldOf(item.content, 'po_number')
  return n ? `#${n}` : null
}

/** The money segment, when the row carries a total. Rendered, never recomputed. */
function amountOf (item) {
  const t = fieldOf(item.content, 'total')
  if (t === null) return null
  return /^[\d.,]+$/.test(t) ? `$${t}` : null
}

const cap = (s, n) => (String(s).length <= n ? String(s) : String(s).slice(0, n) + '…')

/**
 * ONE ITEM, AT MOST TWO LINES.
 *   **A-1 Environmental Services Ltd.**
 *   $191.10｜2026-07-06｜需要審批
 * No 來源 segment: the section heading above it already names the source. A segment with
 * no value is omitted rather than filled in, and the date is the row's own or the explicit
 * words 冇日期 — never today, never guessed.
 */
function renderItem (item) {
  const title = item.title ? cap(item.title, CAPS.maxTitleChars) : '(未命名)'
  const ident = identifierOf(item)
  const head = `**${ident ? `${title} — ${ident}` : title}**`

  const segs = []
  const amount = amountOf(item)
  if (amount) segs.push(amount)
  segs.push(dayOf(item.originalDate) || '冇日期')
  const status = statusSegment(item)
  if (status) segs.push(status)

  return `${head}\n${segs.join('｜')}`
}

/** ONE SECTION PER SOURCE — so two sources can never share a paragraph. */
function renderSection (source, items) {
  const label = LABELS[source] || source
  const shown = items.slice(0, CAPS.maxItemsPerSection)
  const rest = items.length - shown.length
  const lines = [`### ${label}`]
  for (const it of shown) lines.push(renderItem(it))
  if (rest > 0) lines.push(`另外有 ${rest} 項。`)
  return lines.join('\n\n')
}

/**
 * WHAT ANSWERS THIS QUESTION. Returns the groups to render and the count of everything
 * retrieved that will not be shown.
 */
function selectRelevant (intent, itemsBySource, perSource) {
  const rows = new Map((Array.isArray(perSource) ? perSource : []).map((r) => [r.source, r]))
  const groups = []
  let hidden = 0
  for (const g of (Array.isArray(itemsBySource) ? itemsBySource : [])) {
    if (!g || !g.source || !Array.isArray(g.items) || g.items.length === 0) continue
    const row = rows.get(g.source)
    const inScope = intent.sources.includes(g.source)
    // A FALLBACK IS NOT AN ANSWER. Recent-items rows were selected because they are
    // recent, not because they match; showing them as the result is how a television
    // advertisement ended up under an invoice question.
    const bySearch = !(row && row.usedFallback === true)
    if (inScope && bySearch) groups.push(g)
    else hidden += g.items.length
  }
  return { groups, hidden }
}

/**
 * 結果摘要 — generated here, one sentence, counts only.
 *
 * The model used to write this and restated the whole list inside it, which was the single
 * prompt dependency left in the design. It is now a fact about the turn, so it is computed
 * from the turn: no item detail can leak into it because no item detail is available to it.
 */
function renderSummary (intent, groups) {
  const parts = groups.map((g) => `${LABELS[g.source] || g.source} ${g.items.length} ${intent.unit}${intent.noun}`)
  const body = parts.length === 0
    ? `暫時搵唔到同「${intent.noun}」直接相符嘅記錄。`
    : `目前確認到${parts.join('、')}。`
  return `### ${intent.heading}\n\n${body}`
}

/**
 * 資料限制 — ONLY what could not be retrieved or proven this turn, plus the count of what
 * was hidden. The count is the whole reason hiding is safe: a wrongly excluded record is
 * visible as a number the Owner can challenge, instead of an absence nobody can see.
 */
function renderLimits (intent, perSource, hidden, opts = {}) {
  const rows = Array.isArray(perSource) ? perSource : []
  const parts = []
  for (const r of rows) {
    if (!intent.sources.includes(r.source)) continue // out of scope: covered by the count
    const label = LABELS[r.source] || r.source
    if (r.trust !== 'live') parts.push(`${label}：讀唔到${r.error ? `（${cap(r.error, 60)}）` : ''}`)
    else if (r.usedFallback) parts.push(`${label}：搵唔到直接相符嘅${intent.noun}（最近項目 ${r.count} 項未列出）`)
    else if (!r.count) parts.push(`${label}：讀到，但冇相關結果`)
  }
  if (hidden > 0) parts.push(`另有 ${hidden} 項未列出（判斷為與此問題無關）`)
  if (opts.truncated) parts.push('部分項目因長度上限未顯示 —— 見唔到唔代表冇。')
  if (parts.length === 0) return null
  return `### ${H.limits}\n\n` + parts.join('\n')
}

/**
 * 香香睇法 — THE ONE PLACE HER OWN WORDS SURVIVE.
 *
 * A rendered table cannot say "this one has been sitting a month", and her judgement is
 * the reason there is a 香香 at all. So she gets a short section of her own, after the
 * data and before the question — but the numbers stay the server's.
 *
 * WHAT IS ENFORCED, AND WHAT IS NOT. Any sentence containing a digit is dropped. That is
 * blunt on purpose: an amount, an invoice number, a date and a count are all digits, and
 * the summary above is the single source for every one of them, so a digit in her prose
 * is either a restatement or an invention. It costs her nothing she needs — 「其中一張拖
 * 咗成個月」 carries no digit.
 *
 * It does NOT verify that a non-numeric claim is supported by the rows. 「呢間供應商成日
 *遲」 cannot be checked mechanically, and pretending otherwise would be the same
 * over-claiming this module was built to stop. The contract asks her not to; the
 * structural guarantee here covers numbers only, and this comment is where that limit is
 * written down rather than implied.
 */
function extractOpinion (reply) {
  const text = String(reply == null ? '' : reply)
  const start = new RegExp('(^|\\n)#{0,3}\\s*【?' + H.opinion + '】?\\s*\\n?').exec(text)
  if (!start) return null
  const after = text.slice(start.index + start[0].length)
  const end = /(^|\n)#{0,3}\s*【?(下一步|資料限制)】?/.exec(after)
  return sanitizeOpinion(end ? after.slice(0, end.index) : after)
}

/** Keep at most three digit-free sentences; nothing left means no section at all. */
function sanitizeOpinion (raw) {
  const text = String(raw == null ? '' : raw).replace(/^[#\s]*/, '').trim()
  if (!text) return null
  const kept = text
    .split(/(?<=[。！？!?])\s*|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !/\d/.test(s)) // a number here is either a restatement or an invention
    .slice(0, MAX_OPINION_SENTENCES)
  const joined = kept.join('').trim()
  // Padding is worse than silence: if she had nothing to add, say nothing.
  return joined.length > 0 ? joined : null
}

/** Split the model's reply at 下一步 — everything before it is discarded, see below. */
function splitModelReply (reply) {
  const text = String(reply == null ? '' : reply).trim()
  const m = /(^|\n)#{0,3}\s*【?下一步】?\s*\n?/.exec(text)
  if (!m) return { before: text, next: null }
  return { before: text.slice(0, m.index).trim(), next: text.slice(m.index + m[0].length).trim() || null }
}

/**
 * EXACTLY ONE QUESTION. The contract asks for one; when it arrives as 「A 定 B？」 or as
 * three options, only the first question survives. A reply with no question at all falls
 * back to the intent's own — never to silence, and never to an invented offer.
 */
function oneQuestion (next, intent) {
  const s = String(next == null ? '' : next).trim()
  if (!s) return intent.defaultQuestion
  const at = s.search(/[？?]/)
  if (at === -1) return intent.defaultQuestion
  const first = s.slice(0, at + 1).trim()
  // 「A 定 B？」 is two options in one sentence — the contract's own example of what not
  // to do. It cannot be split reliably, so the intent's single question replaces it.
  return /定|定係|或者|\bor\b/.test(first) ? intent.defaultQuestion : first
}

/**
 * RENDER A VALIDATED PLAN. Nothing here decides business meaning: the model chose the
 * answer, the validator removed anything the evidence did not support, and this turns
 * what survived into text.
 *
 * The fallback is a true, smaller answer — a count and provenance — never arbitrary rows,
 * and it is always logged, so a degradation cannot pass for a working turn.
 */
function renderValidatedPlan (input) {
  const { validatePlan, minimalAnswer, logAnswerPlan } = require('./answerPlan')
  const evidenceSets = Array.isArray(input.evidenceSets) ? input.evidenceSets : []
  const itemsBySource = Array.isArray(input.itemsBySource) ? input.itemsBySource : []

  const v = validatePlan(input.answerPlan, { evidenceSets, itemsBySource })
  const out = []

  if (!v.answerSurvived) {
    // Every sentence of the answer failed its evidence check. That is a fallback, and it
    // says so out loud rather than quietly showing the sections underneath it.
    logAnswerPlan({ outcome: 'fallback', reason: 'answer_unsupported', provider: input.provider || null, droppedFacts: v.droppedFacts, droppedSentences: v.droppedSentences, requestId: input.requestId || null })
    out.push(minimalAnswer(evidenceSets))
  } else {
    logAnswerPlan({ outcome: 'validated', reason: null, provider: input.provider || null, droppedFacts: v.droppedFacts, droppedSentences: v.droppedSentences, requestId: input.requestId || null })
    out.push(v.plan.directAnswer)
  }

  for (const sec of v.plan.sections) {
    const lines = [`### ${sec.heading}`]
    for (const it of sec.items) {
      const facts = it.facts.map((f) => `${f.field} ${f.value}`).join('｜')
      lines.push(facts ? `**${it.title}**\n${facts}` : `**${it.title}**`)
    }
    out.push(lines.join('\n\n'))
  }

  if (v.plan.limitations.length) out.push(`### ${H.limits}\n\n` + v.plan.limitations.join('\n'))
  if (v.plan.followUp) out.push(`### ${H.next}\n\n${v.plan.followUp}`)
  if (typeof input.correction === 'string' && input.correction.trim()) out.push(input.correction.trim())

  return { reply: out.join('\n\n'), applied: true, intent: null, validated: true, droppedFacts: v.droppedFacts, droppedSentences: v.droppedSentences }
}

/**
 * Build the whole Owner-facing reply.
 *
 * @param {{ reply, message, itemsBySource, perSource, truncated? }} input
 * @returns {{ reply, applied, intent }}
 */
function buildReadResultReply (input = {}) {
  const original = String(input.reply == null ? '' : input.reply)

  // ── THE HYBRID PATH ─────────────────────────────────────────────────────────
  // When the model returned an Answer Plan, IT decides what the answer is and which rows
  // matter; this module's job narrows to proving and rendering. The template path below
  // stays only as the fallback for turns with no plan, and every fall-through is logged.
  if (input.answerPlan && typeof input.answerPlan === 'object') {
    return renderValidatedPlan(input)
  }

  const intent = intentFor(input.message)

  // NO INTENT, NO RESTRUCTURING. An ordinary conversation that happens to have context
  // attached is not a read result, and dressing it up as one is the over-showing this
  // module exists to stop.
  if (!intent) return { reply: original, applied: false, intent: null }

  const { groups, hidden } = selectRelevant(intent, input.itemsBySource, input.perSource)
  const limits = renderLimits(intent, input.perSource, hidden, { truncated: input.truncated === true })

  // Nothing relevant AND nothing to report about why: leave the reply alone.
  if (groups.length === 0 && !limits) return { reply: original, applied: false, intent }

  const out = [renderSummary(intent, groups)]
  for (const g of groups) out.push(renderSection(g.source, g.items))
  if (limits) out.push(limits)
  // Her reading of what is above — after the data, before the question.
  const opinion = extractOpinion(original)
  if (opinion) out.push(`### ${H.opinion}\n\n${opinion}`)
  out.push(`### ${H.next}\n\n${oneQuestion(splitModelReply(original).next, intent)}`)

  // A CORRECTION SURVIVES THE RESTRUCTURING. readStateGuard's note is a safety control,
  // not prose, so it is carried through rather than discarded with the model's text. In
  // practice the false sentence it corrects is now REMOVED here rather than merely
  // corrected — but the note stays on screen, because a failure that leaves no trace on
  // screen is the thing the guard was built to stop.
  if (typeof input.correction === 'string' && input.correction.trim()) out.push(input.correction.trim())

  return { reply: out.join('\n\n'), applied: true, intent }
}

module.exports = {
  buildReadResultReply,
  renderItem,
  renderSection,
  renderSummary,
  renderLimits,
  selectRelevant,
  extractOpinion,
  sanitizeOpinion,
  splitModelReply,
  oneQuestion,
  statusSegment,
  fieldOf,
  dayOf,
  STATUS_LABELS,
  STATUS_BEARING_SOURCES,
  CAPS,
  HEADINGS: H
}
