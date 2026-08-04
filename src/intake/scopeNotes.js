'use strict'

/**
 * scopeNotes.js — a source's fixed properties are said ONCE per conversation.
 *
 * ── WHAT THIS EXISTS FOR ─────────────────────────────────────────────────────
 * Every turn hands the model a SCOPE block (readContext.js) describing each read: the
 * total, the shown count, whether it is a sample, and which dimensions the rows do NOT
 * have. The model dutifully writes those back out under 資料限制. Correctly — and every
 * single turn, in different words each time, because it is re-derived from scratch.
 *
 * Across seven consecutive turns of one live conversation, every 資料限制 block restated
 * the same three fixed properties of the same source: no location, no timestamp, a sample
 * of 199. Those are facts about the SOURCE. They are as true on turn seven as on turn one
 * and he had already read them six times. That repetition is a large part of why she began
 * to read as a disclaimer generator rather than as someone he had a conversation with.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 * A limitation is dropped only when BOTH hold:
 *   1. it restates a fixed scope property THIS TURN'S EvidenceSet actually asserts, and
 *   2. she already stated that same property earlier in THIS conversation.
 * Everything else survives byte-identical. The first statement always survives — he still
 * gets told, once. Genuinely per-turn notes always survive, including every server-authored
 * omission count, which is the whole point of the omission machinery next door.
 *
 * ── WHAT IS PROVEN AND WHAT IS NOT (READ THIS BEFORE WIDENING IT) ────────────
 * The concept match is KEYWORD-ANCHORED. It is not proven the way a value check is proven,
 * and it is the only inexact judgement in this file. Two gates bound it:
 *
 *   • THE EVIDENCE GATE. A concept is only suppressible when the EvidenceSet asserts it for
 *     a live source this turn. If the rows DO carry a location, a sentence about location is
 *     saying something else and is never touched.
 *   • THE NUMBER GATE. A sentence carrying any number the EvidenceSet does not already own
 *     is per-turn by construction and is kept. 「有 4 項冇地點資料」 is about four rows;
 *     「199 項入面顯示咗 20 項」 is about the source. Both spellings are read, because
 *     Cantonese writes counts in Chinese numerals by default and checking only the ASCII
 *     exception is checking nothing (the same hole sentenceIsSupported had).
 *
 * It can only ever DELETE a repeated line. It never rewrites one, never adds one, and never
 * removes a first statement. If it is ever wrong, the cost is one fixed property said once
 * fewer than it should have been — not a fabricated claim.
 */

const { cjkToNumber } = require('./answerPlan')

/**
 * THE FIXED PROPERTIES, and the words that state them.
 *
 * `asserted` reads the EvidenceSet, so the keyword list can never act on its own. Keep the
 * word lists narrow: every word added here widens what can be deleted, and the failure this
 * module is allowed to have is "said once too often", never "silently dropped something
 * about this turn".
 */
const CONCEPTS = Object.freeze([
  {
    key: 'location',
    asserted: (e) => e.scope.hasLocation === false,
    words: ['地點', '位置', '倉庫', '分倉', '邊個倉', '門市', '分店', 'location']
  },
  {
    key: 'asOf',
    asserted: (e) => e.scope.hasAsOf === false,
    words: ['時間戳', '幾時更新', '更新時間', '更新日期', '幾時嘅', '幾時的', '時效', 'timestamp', 'as-of', 'as of']
  },
  {
    key: 'sample',
    asserted: (e) => e.completeness === 'sample',
    // 只/淨係顯示 is how she states sampling in practice, without ever writing 「樣本」.
    // Narrow on purpose, and still behind the number gate: a line pairing it with a count
    // the evidence does not own ('只顯示咗 17 項') is per-turn and survives.
    words: ['樣本', '抽樣', '只顯示', '淨係顯示', '部分記錄', '部份記錄', '唔係全部', '不是全部', '並非全部', 'sample']
  }
])

/** Every number the sentence claims, in both spellings. */
const CJK_COUNT_RE = /([零〇一二兩三四五六七八九十百千萬]+)([項張封份件次條間位樣款種批個])/g

function numbersIn (text) {
  const out = new Set()
  for (const n of String(text).match(/\d+(?:[.,]\d+)*/g) || []) out.add(n.replace(/,/g, ''))
  for (const m of String(text).matchAll(CJK_COUNT_RE)) {
    const n = cjkToNumber(m[1])
    if (n !== null) out.add(String(n))
  }
  return out
}

/**
 * What this turn's evidence asserts: which concepts are in play, and which numbers belong
 * to the sources rather than to the turn.
 *
 * Only `trust === 'live'` reads count — the same bar renderScopeLine uses to decide a source
 * has anything true to say about itself.
 */
function scopeFacts (evidenceSets) {
  const concepts = new Set()
  const numbers = new Set()
  if (!Array.isArray(evidenceSets)) return { concepts, numbers }
  for (const raw of evidenceSets) {
    if (!raw || typeof raw !== 'object' || raw.trust !== 'live') continue
    const e = { completeness: raw.completeness, scope: (raw.scope && typeof raw.scope === 'object') ? raw.scope : {} }
    for (const c of CONCEPTS) if (c.asserted(e)) concepts.add(c.key)
    if (Number.isFinite(raw.totalCount)) numbers.add(String(raw.totalCount))
    if (Number.isFinite(raw.shownCount)) numbers.add(String(raw.shownCount))
  }
  return { concepts, numbers }
}

/** Which of the asserted concepts a sentence states. Empty when it carries a foreign number. */
function conceptsStated (text, facts) {
  const s = String(text || '')
  if (!s) return []
  for (const n of numbersIn(s)) if (!facts.numbers.has(n)) return [] // per-turn by construction
  return CONCEPTS.filter((c) => facts.concepts.has(c.key) && c.words.some((w) => s.includes(w))).map((c) => c.key)
}

/**
 * WHOSE PRIOR WORDS COUNT.
 *
 * HERS ONLY. The Owner asking 「啲數字冇分地點㗎可？」 is him raising it, not her having
 * explained it — and treating his turns as hers is precisely the attribution defect this
 * round fixed one file over. Roles other than 'assistant' are his, matching the same
 * default buildDistillPrompt now uses. Both `text` (the wire shape) and `content` (the
 * stored shape) are read, for the same reason historyTextOf now reads both.
 */
function alreadySaid (history, facts) {
  const said = new Set()
  if (!Array.isArray(history)) return said
  for (const h of history) {
    if (!h || typeof h !== 'object' || h.role !== 'assistant') continue
    const text = [h.text, h.content].filter((v) => typeof v === 'string' && v).join('\n')
    for (const k of conceptsStated(text, facts)) said.add(k)
  }
  return said
}

/**
 * Drop limitations that repeat a fixed scope property already stated in this conversation.
 *
 * @param {string[]} limitations   the lines about to be rendered under 資料限制
 * @param {{ evidenceSets?: object[], history?: object[] }} ctx
 * @returns {{ kept: string[], dropped: number, concepts: string[] }}
 *          `concepts` is for the log — WHICH property was suppressed, never the text.
 */
function pruneRepeatedScopeNotes (limitations, { evidenceSets = [], history = [] } = {}) {
  if (!Array.isArray(limitations)) return { kept: [], dropped: 0, concepts: [] }

  const facts = scopeFacts(evidenceSets)
  if (!facts.concepts.size) return { kept: limitations.slice(), dropped: 0, concepts: [] }

  const said = alreadySaid(history, facts)
  if (!said.size) return { kept: limitations.slice(), dropped: 0, concepts: [] }

  const kept = []
  const suppressed = new Set()
  for (const line of limitations) {
    const stated = conceptsStated(line, facts)
    // Repeat only when EVERY property the line states has already been said. A line that
    // pairs a known property with a new one still carries something he has not read.
    if (stated.length && stated.every((k) => said.has(k))) {
      for (const k of stated) suppressed.add(k)
      continue
    }
    kept.push(line)
  }
  return { kept, dropped: limitations.length - kept.length, concepts: [...suppressed] }
}

module.exports = { pruneRepeatedScopeNotes, CONCEPTS }
