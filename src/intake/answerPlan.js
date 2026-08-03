'use strict'

/**
 * answerPlan.js — the model says what the answer IS; the server proves every fact in it.
 *
 * WHY THIS EXISTS. The composer swung from "the model rambles" to "the server fills a
 * template", and the template could not answer a question. It rendered whichever four
 * rows the API returned first and called them 「4 項存貨」 — a sample presented as a whole,
 * and an untimed unplaced number presented as stock on hand. Determinism removed the
 * fabrication and the judgement together.
 *
 * So the split is by WHO CAN KNOW:
 *   the MODEL knows what was really asked, whether the data answers it, which rows
 *   matter, and when saying "I cannot answer that" is more honest than answering;
 *   the SERVER knows what was retrieved, and can therefore prove or disprove every
 *   factual claim the model makes about it.
 *
 * ── WHAT SURVIVES THE MODEL IGNORING ITS INSTRUCTIONS ────────────────────────
 * This project has watched prompt-level rules fail repeatedly, most recently and most
 * clearly here: told to emit 「### 香香睇法」 and 「### 下一步」, the model wrote NEITHER,
 * in every one of three real turns. So nothing here depends on it choosing to comply.
 *
 *   SHAPE is guaranteed at the API layer (json_schema, strict) — not requested.
 *   FACTS are checked against the retrieved rows here — every number in the prose must
 *     appear in the evidence, and every rendered value must equal a real one.
 *   TOTALS cannot be faked: shownCount and totalCount come from the EvidenceSet.
 *   STATUS words are translated here, so a raw enum cannot reach the screen.
 *
 * And, stated plainly rather than papered over: a JUDGEMENT is not machine-checkable.
 * 「呢間供應商成日遲」 carries no number to verify. That claim can be wrong and this file
 * will not catch it. Judgement is the reason there is a model in the loop at all, and
 * pretending to validate it would be the same over-claiming everything else here prevents.
 *
 * EVERY fallback emits one [AROMA-ANSWER-PLAN] line. A degradation that leaves no trace
 * is indistinguishable from working, which is the failure mode this round exists to end.
 */

const { ENTITY_TYPES } = require('../context/contextResult')

/** The Owner-facing status words. Keys are the API's own values. */
const STATUS_LABELS = Object.freeze({
  needs_review: '需要審批',
  approved: '已批准',
  sent: '已發送',
  received: '已收貨',
  partially_received: '部分收貨',
  active: '啟用中',
  inactive: '已停用',
  unknown: '狀態未確認'
})

const LIMITS = Object.freeze({
  maxSections: 4,
  maxItemsPerSection: 5,
  maxFactsPerItem: 4,
  maxDirectAnswerChars: 200,
  maxLimitations: 3,
  maxLimitationChars: 120,
  maxFollowUpChars: 120
})

/** Words that mean the system is talking about itself. They are telemetry, not an answer. */
const TELEMETRY_RE = /(未列出|長度上限|判斷為與此問題無關|fallback|usedFallback|shownCount|totalCount|evidence|token)/i

/**
 * THE SCHEMA. Enforced by the provider, not by a prompt. Every object closes
 * additionalProperties so a model cannot smuggle a field past the validator.
 */
const ANSWER_PLAN_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['directAnswer', 'sections', 'limitations', 'followUp', 'unanswerable'],
  properties: {
    directAnswer: { type: 'string', description: '一至兩句,直接答到問題。唔好覆述逐項細節。' },
    unanswerable: { type: 'boolean', description: '資料答唔到呢條問題時 true —— 呢個係誠實,唔係失敗。' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'items'],
        properties: {
          heading: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sourceId', 'title', 'facts'],
              properties: {
                sourceId: { type: 'string', description: '必須係證據入面真實存在嘅 id。' },
                title: { type: 'string' },
                facts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['field', 'value'],
                    properties: { field: { type: 'string' }, value: { type: 'string' } }
                  }
                }
              }
            }
          }
        }
      }
    },
    limitations: { type: 'array', items: { type: 'string' } },
    followUp: { type: ['string', 'null'], description: '最多一個問題;冇必要就 null。' }
  }
})

/** One countable line per fallback. Reason enums only — never the plan, never a row. */
function logAnswerPlan (entry, sink) {
  const line = {
    event: 'ANSWER_PLAN',
    timestamp: new Date().toISOString(),
    outcome: String(entry.outcome || 'unknown'),
    reason: entry.reason == null ? null : String(entry.reason).slice(0, 80),
    provider: entry.provider == null ? null : String(entry.provider),
    droppedFacts: Number.isFinite(entry.droppedFacts) ? entry.droppedFacts : 0,
    droppedSentences: Number.isFinite(entry.droppedSentences) ? entry.droppedSentences : 0,
    requestId: entry.requestId == null ? null : String(entry.requestId)
  }
  try { (sink || ((l) => console.log('[AROMA-ANSWER-PLAN]', JSON.stringify(l))))(line) } catch (_) {}
  return line
}

/** Every scalar value in the evidence, as strings — the universe of provable values. */
function evidenceIndex (evidenceSets = [], itemsBySource = []) {
  const byId = new Map()
  const values = new Set()
  const numbers = new Set()
  const addNum = (s) => { for (const n of String(s).match(/\d+(?:[.,]\d+)*/g) || []) numbers.add(n.replace(/,/g, '')) }

  for (const g of itemsBySource) {
    for (const row of (g.items || [])) {
      byId.set(String(row.sourceId), row)
      for (const v of Object.values(row.fields || {})) { values.add(String(v)); addNum(v) }
      if (row.title) values.add(String(row.title))
      if (row.originalDate) { values.add(String(row.originalDate)); addNum(row.originalDate) }
    }
  }
  // Counts the model is allowed to state, because the server measured them.
  for (const e of evidenceSets) {
    if (Number.isFinite(e.totalCount)) numbers.add(String(e.totalCount))
    if (Number.isFinite(e.shownCount)) numbers.add(String(e.shownCount))
  }
  return { byId, values, numbers }
}

/** Translate a status-looking value; leave anything else alone. */
function translate (value) {
  const raw = String(value)
  if (Object.prototype.hasOwnProperty.call(STATUS_LABELS, raw)) return STATUS_LABELS[raw]
  return raw
}

/**
 * Does every number in this sentence exist in the evidence?
 *
 * A number is the one part of prose that can be checked, and it is also the part that
 * does the damage: 「291 張待審批」 and 「4 項存貨」 are both numbers that were never
 * measured. Non-numeric prose passes — see the note at the top about what is not checked.
 */
function sentenceIsSupported (sentence, index) {
  const nums = String(sentence).match(/\d+(?:[.,]\d+)*/g) || []
  return nums.every((n) => index.numbers.has(n.replace(/,/g, '')))
}

const splitSentences = (text) => String(text).split(/(?<=[。！？!?])\s*|\n+/).map((s) => s.trim()).filter(Boolean)

/**
 * VALIDATE. Returns the plan with unsupported material removed, plus what was dropped.
 * Nothing here rewrites meaning: a claim is kept as written or removed entirely.
 */
function validatePlan (plan, { evidenceSets = [], itemsBySource = [] } = {}) {
  const index = evidenceIndex(evidenceSets, itemsBySource)
  let droppedFacts = 0
  let droppedSentences = 0

  // ── directAnswer: sentence by sentence ──────────────────────────────────────
  const kept = []
  for (const s of splitSentences(plan.directAnswer || '')) {
    if (!sentenceIsSupported(s, index)) { droppedSentences++; continue }
    if (TELEMETRY_RE.test(s)) { droppedSentences++; continue }
    kept.push(s)
  }
  let directAnswer = kept.join('').slice(0, LIMITS.maxDirectAnswerChars)

  // ── sections: an item must be a row we actually retrieved ───────────────────
  const sections = []
  for (const sec of (Array.isArray(plan.sections) ? plan.sections : []).slice(0, LIMITS.maxSections)) {
    const items = []
    for (const it of (Array.isArray(sec.items) ? sec.items : []).slice(0, LIMITS.maxItemsPerSection)) {
      const row = index.byId.get(String(it.sourceId))
      if (!row) { droppedFacts++; continue } // an item that was never retrieved is an invention
      const facts = []
      for (const f of (Array.isArray(it.facts) ? it.facts : []).slice(0, LIMITS.maxFactsPerItem)) {
        const value = translate(f.value)
        // The value must be a real one — either verbatim, or the translation of one.
        if (!index.values.has(String(f.value)) && !index.values.has(value)) { droppedFacts++; continue }
        facts.push({ field: String(f.field), value })
      }
      // The title is the server's, not the model's: it cannot be edited into something else.
      items.push({ sourceId: String(it.sourceId), title: row.title || String(it.title || ''), facts })
    }
    if (items.length > 0) sections.push({ heading: String(sec.heading || ''), items })
  }

  // ── limitations: real ones only, never telemetry ────────────────────────────
  const limitations = (Array.isArray(plan.limitations) ? plan.limitations : [])
    .map((l) => String(l).trim())
    .filter((l) => l && !TELEMETRY_RE.test(l) && sentenceIsSupported(l, index))
    .slice(0, LIMITS.maxLimitations)
    .map((l) => l.slice(0, LIMITS.maxLimitationChars))

  // ── followUp: zero or one, never two options ────────────────────────────────
  let followUp = typeof plan.followUp === 'string' ? plan.followUp.trim() : null
  if (followUp) {
    const at = followUp.search(/[？?]/)
    followUp = at === -1 ? null : followUp.slice(0, at + 1).slice(0, LIMITS.maxFollowUpChars)
  }

  // A directAnswer that lost every sentence cannot stand in for one.
  const answerSurvived = directAnswer.trim().length > 0
  if (!answerSurvived) directAnswer = ''

  return {
    plan: { directAnswer, sections, limitations, followUp, unanswerable: plan.unanswerable === true },
    droppedFacts,
    droppedSentences,
    answerSurvived
  }
}

/**
 * THE DETERMINISTIC MINIMUM. Count, kind, provenance and the honest limitation — never
 * arbitrary rows. This is what every fallback path returns, so a degradation is always a
 * true, smaller answer rather than a confident wrong one.
 */
function minimalAnswer (evidenceSets = []) {
  const live = evidenceSets.filter((e) => e && e.trust === 'live' && (e.shownCount > 0 || e.totalCount > 0))
  if (live.length === 0) return '我今次讀唔到可以用嚟答呢條問題嘅資料。'
  const parts = live.map((e) => {
    const n = Number.isFinite(e.totalCount) ? e.totalCount : e.shownCount
    const kind = ENTITY_LABELS[e.entityType] || '項記錄'
    return `${SOURCE_LABELS[e.source] || e.source} ${n} ${kind}`
  })
  return `我讀到 ${parts.join('、')},但今次組唔到一個可靠嘅答案,所以唔會亂講。`
}

const ENTITY_LABELS = Object.freeze({
  [ENTITY_TYPES.INVENTORY_ITEM]: '項存貨記錄',
  [ENTITY_TYPES.SUPPLIER]: '個供應商',
  [ENTITY_TYPES.INVOICE]: '張發票',
  [ENTITY_TYPES.PURCHASE_ORDER]: '張採購單',
  [ENTITY_TYPES.DAILY_COUNT]: '次盤點',
  [ENTITY_TYPES.ORDER_SUGGESTION]: '項訂貨建議',
  [ENTITY_TYPES.MAIL]: '封郵件',
  [ENTITY_TYPES.FILE]: '份文件',
  [ENTITY_TYPES.EVENT]: '件安排',
  [ENTITY_TYPES.COMMIT]: '個改動',
  [ENTITY_TYPES.PULL_REQUEST]: '個 PR'
})

const SOURCE_LABELS = Object.freeze({
  aroma_system: '餐廳系統', gmail: 'Gmail', drive: 'Drive', calendar: '日曆', github: 'GitHub'
})

/**
 * Parse whatever the model returned into a plan, or say why not.
 * Strict schemas make this cheap; it still runs, because "the provider promised" is not
 * the same as "the bytes are valid".
 */
function parsePlan (text) {
  const s = String(text == null ? '' : text).trim()
  if (!s) return { ok: false, reason: 'empty_response' }
  let obj
  try { obj = JSON.parse(s) } catch (_) {
    // A schema-honouring provider does not fence its output; a non-honouring one might.
    const m = /\{[\s\S]*\}/.exec(s)
    if (!m) return { ok: false, reason: 'not_json' }
    try { obj = JSON.parse(m[0]) } catch (_) { return { ok: false, reason: 'not_json' } }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'not_an_object' }
  if (typeof obj.directAnswer !== 'string') return { ok: false, reason: 'missing_direct_answer' }
  return { ok: true, plan: obj }
}

module.exports = {
  ANSWER_PLAN_SCHEMA,
  STATUS_LABELS,
  ENTITY_LABELS,
  SOURCE_LABELS,
  LIMITS,
  TELEMETRY_RE,
  logAnswerPlan,
  evidenceIndex,
  validatePlan,
  parsePlan,
  minimalAnswer,
  translate,
  sentenceIsSupported,
  splitSentences
}
