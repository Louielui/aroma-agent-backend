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
 * Formatting is a weaker rule than either, held over a longer output, and the chat lane
 * now runs two providers with different habits.
 *
 * So the model writes only the two things that need judgement — 結果摘要 and 下一步 — and
 * every fact-bearing line below is produced here, deterministically. A rendered amount
 * cannot be mistyped, and a status value this module does not recognise cannot be quietly
 * dropped: it renders as 狀態未確認 WITH the raw value attached.
 *
 * PRESENTATION ONLY. Pure, no I/O. It reads what the turn already retrieved and returns
 * markdown text. It never fetches, never writes, never decides what was read.
 */

const { LABELS } = require('./readStateGuard') // Owner-facing source names, derived from ALL_SOURCES

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

const H = Object.freeze({
  summary: '結果摘要',
  limits: '資料限制',
  next: '下一步'
})

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
 * The status segment, or null when there should not be one.
 * Returns null for every source that has no status concept.
 */
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
 *   **Miller's Meats — #74284**
 *   $461.30｜2026-08-03｜需要審批｜來源：餐廳系統
 * A segment that has no value is omitted rather than filled in. The date is the row's own
 * date or the explicit words 冇日期 — never today, never guessed.
 */
function renderItem (item) {
  const title = item.title ? cap(item.title, CAPS.maxTitleChars) : '(未命名)'
  const ident = identifierOf(item)
  const head = `**${ident ? `${title} — ${ident}` : title}**`

  const segs = []
  const amount = amountOf(item)
  if (amount) segs.push(amount)
  segs.push(item.originalDate ? String(item.originalDate).slice(0, 10) : '冇日期')
  const status = statusSegment(item)
  if (status) segs.push(status)
  segs.push(`來源：${LABELS[item.source] || item.source}`)

  return `${head}\n${segs.join('｜')}`
}

/**
 * ONE SECTION PER SOURCE. Gmail and Aroma System can never share a paragraph because a
 * section is generated per source key, from the source's own rows.
 */
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
 * 資料限制 — ONLY what could not be retrieved or proven this turn. When everything was
 * read and everything is shown, the section is omitted entirely rather than padded with
 * a reassurance.
 */
function renderLimits (perSource, opts = {}) {
  const rows = Array.isArray(perSource) ? perSource : []
  const parts = []
  for (const r of rows) {
    const label = LABELS[r.source] || r.source
    if (r.trust !== 'live') parts.push(`${label}：讀唔到${r.error ? `（${cap(r.error, 60)}）` : ''}`)
    else if (!r.count) parts.push(`${label}：讀到，但冇相關結果`)
    else if (r.usedFallback) parts.push(`${label}：搵唔到直接相符嘅，顯示緊最近嘅項目`)
  }
  if (opts.truncated) parts.push('部分項目因長度上限未顯示 —— 見唔到唔代表冇。')
  if (parts.length === 0) return null
  return `### ${H.limits}\n\n` + parts.join('\n')
}

/**
 * Split the model's reply at 下一步 so the deterministic sections land BETWEEN the summary
 * and the single next question.
 *
 * FAIL-SOFT AND VISIBLE. If the model did not write the headings — the one prompt-level
 * dependency left in this design — nothing is lost: its whole reply is kept as the
 * summary and the sections follow. A malformed reply degrades to a slightly worse
 * ordering, never to missing data.
 */
function splitModelReply (reply) {
  const text = String(reply == null ? '' : reply).trim()
  const m = /(^|\n)#{0,3}\s*【?下一步】?\s*\n?/.exec(text)
  if (!m) return { summary: text, next: null }
  return {
    summary: text.slice(0, m.index).trim(),
    next: text.slice(m.index + m[0].length).trim() || null
  }
}

/**
 * Build the whole Owner-facing reply.
 *
 * @param {{ reply: string, itemsBySource: Array<{source, items}>, perSource: Array, truncated?: boolean }} input
 * @returns {{ reply: string, applied: boolean, sections: string[] }}
 */
function buildReadResultReply (input = {}) {
  const groups = (Array.isArray(input.itemsBySource) ? input.itemsBySource : [])
    .filter((g) => g && g.source && Array.isArray(g.items) && g.items.length > 0)

  // Nothing was retrieved → this view has nothing to say, and the reply is left exactly
  // as the model wrote it. Presentation must never manufacture a result.
  if (groups.length === 0) return { reply: String(input.reply == null ? '' : input.reply), applied: false, sections: [] }

  const { summary, next } = splitModelReply(input.reply)
  const out = []
  if (summary) out.push(summary.startsWith('#') ? summary : `### ${H.summary}\n\n${summary}`)

  const sections = []
  for (const g of groups) {
    const s = renderSection(g.source, g.items)
    sections.push(s)
    out.push(s)
  }

  const limits = renderLimits(input.perSource, { truncated: input.truncated === true })
  if (limits) out.push(limits)

  if (next) out.push(`### ${H.next}\n\n${next}`)

  return { reply: out.join('\n\n'), applied: true, sections }
}

module.exports = {
  buildReadResultReply,
  renderItem,
  renderSection,
  renderLimits,
  splitModelReply,
  statusSegment,
  fieldOf,
  STATUS_LABELS,
  STATUS_BEARING_SOURCES,
  CAPS,
  HEADINGS: H
}
