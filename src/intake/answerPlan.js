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
  maxFollowUpChars: 120,
  // Drop records are identifiers, and identifiers are short. Both bounds exist so a model
  // cannot turn the log line into a payload by inventing long ids or many of them.
  maxDropIdChars: 40,
  maxDropsLogged: 12
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
      // STRUCTURE IS MANDATORY WHEN THIS TURN READ ROWS — and this schema is only ever
      // sent when it did (intakeService gates responseFormat on turnItems.size > 0). The
      // model was told to put item detail in sections and put it in prose instead, where
      // nothing could check it; prompt-level rules have failed here too often to be the
      // control. So the provider refuses a plan with no items, and the detail has nowhere
      // to go but the channel that is verified against the evidence.
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'items'],
        properties: {
          heading: { type: 'string' },
          items: {
            type: 'array',
            minItems: 1,
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

/**
 * THE WHOLE ENVELOPE, when a turn read something.
 *
 * The distill envelope and the Answer Plan travel together in ONE call — the model reasons
 * about the question and returns its answer in the same response, so there is no second
 * paid round trip and no added latency. `answerPlan` is required by the schema when this
 * format is used at all, which is the point: with strict json_schema the provider will not
 * return a response without it, so "the model forgot" stops being a failure mode.
 */
const DISTILL_WITH_PLAN_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'mode', 'reply', 'answerPlan'],
  properties: {
    intent: { type: 'string' },
    mode: { type: 'string', enum: ['commit', 'recommend', 'ask', 'chat'] },
    reply: { type: 'string', description: '一句自然嘅說話。逐項清單由系統渲染,唔好喺呢度覆述。' },
    answerPlan: ANSWER_PLAN_SCHEMA
  }
})

/**
 * THE SAME ENVELOPE, WITH THIS TURN'S ROW REFERENCES PINNED INTO IT.
 *
 * The static schema can say "a real id"; only a per-turn schema can say WHICH. Given the
 * refs actually retrieved, `sourceId` becomes an enum of exactly those strings, so a
 * provider honouring the schema cannot return "aroma_system", a title, or an invented id —
 * the failure mode stops being POSSIBLE rather than being caught after the fact. The
 * validator still checks, because "the provider promised" is not "the bytes are valid".
 *
 * With no refs the schema is returned UNCHANGED: an empty enum is not a valid schema, and
 * a turn that retrieved nothing is never sent this format anyway.
 */
function withRowRefs (schema, refs) {
  const list = [...new Set((Array.isArray(refs) ? refs : []).map(String).filter(Boolean))]
  if (list.length === 0) return schema
  const out = structuredClone(schema)
  const node = out.properties.answerPlan.properties.sections.items.properties.items.items.properties.sourceId
  node.enum = list
  node.description = '必須逐字抄自證據入面該行嘅 ref= 值(例如 ref=aroma_system#2 就寫 aroma_system#2)。唔係來源名,唔係標題。'
  return out
}

/**
 * One countable line per turn. Reason enums, counts, and — since 2026-08-03 — the IDENTITY
 * of whatever was deleted.
 *
 * THE ONE DELIBERATE WIDENING OF THIS LOG'S CONTRACT. Every other projection here carries
 * counts and short enums only, and content never reaches it. `dropped` carries two
 * model-authored strings: a sourceId and a field NAME. Never a field VALUE — the row's
 * content still cannot reach the log. Both are truncated at maxDropIdChars and the array at
 * maxDropsLogged, so a long or repetitive plan cannot turn a log line into a payload.
 *
 * It is here because the alternative was demonstrated: a validator that deleted three items
 * and recorded only the number 3 cost three rounds of diagnosis, and the deletions were of
 * a DIFFERENT KIND than the number implied.
 */
function logAnswerPlan (entry, sink) {
  const drops = Array.isArray(entry.drops) ? entry.drops.slice(0, LIMITS.maxDropsLogged) : []
  const line = {
    event: 'ANSWER_PLAN',
    timestamp: new Date().toISOString(),
    outcome: String(entry.outcome || 'unknown'),
    reason: entry.reason == null ? null : String(entry.reason).slice(0, 80),
    provider: entry.provider == null ? null : String(entry.provider),
    droppedItems: Number.isFinite(entry.droppedItems) ? entry.droppedItems : 0,
    droppedFacts: Number.isFinite(entry.droppedFacts) ? entry.droppedFacts : 0,
    droppedSentences: Number.isFinite(entry.droppedSentences) ? entry.droppedSentences : 0,
    // WHAT THE MODEL OFFERED, beside what survived. Without the pair, "it sent no sections"
    // and "it sent items with no facts" look identical from the log — and telling them
    // apart cost a hand investigation across the archive and the live API.
    modelItemCount: Number.isFinite(entry.modelItemCount) ? entry.modelItemCount : 0,
    keptItemCount: Number.isFinite(entry.keptItemCount) ? entry.keptItemCount : 0,
    // Identifiers only. The projection is explicit rather than a spread, so a new key on a
    // drop record cannot ride into the log unnoticed.
    dropped: drops.map((d) => {
      const out = { kind: String(d && d.kind ? d.kind : 'unknown'), sourceId: String(d && d.sourceId != null ? d.sourceId : '').slice(0, LIMITS.maxDropIdChars) }
      if (d && d.field != null) out.field = String(d.field).slice(0, LIMITS.maxDropIdChars)
      return out
    }),
    requestId: entry.requestId == null ? null : String(entry.requestId)
  }
  try { (sink || ((l) => console.log('[AROMA-ANSWER-PLAN]', JSON.stringify(l))))(line) } catch (_) {}
  return line
}

/**
 * THE ONE NUMBER IN A STRING, normalized — or null when there is not exactly one.
 *
 * '18.000' → 18 · '18' → 18 · '$191.10' → 191.1 · '1,250' → 1250
 * '2026-08-03' → null (three tokens: a date is not a quantity)
 *
 * Exactly one, deliberately: a string carrying two numbers is a sentence, not a value, and
 * guessing which of them the model meant would be the kind of inference this file exists
 * to refuse.
 */
function numericOf (raw) {
  const m = String(raw).match(/-?\d+(?:[.,]\d+)*/g)
  if (!m || m.length !== 1) return null
  const n = Number(m[0].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * LATIN-SCRIPT WORDS IN A STRING, normalized. The unit the prose check works in.
 * One-letter runs are ignored: 'A' and 'B' carry no business fact, and 「A 定 B」 is a
 * sentence shape, not a claim about the restaurant.
 */
const LATIN_RUN = /[A-Za-z][A-Za-z'’.-]*/g
function latinTokens (text) {
  const out = []
  for (const m of String(text).match(LATIN_RUN) || []) {
    const t = m.replace(/[.'’-]+$/, '').toLowerCase()
    if (t.length >= 2) out.push(t)
  }
  return out
}

/**
 * THE ORDINARY LATIN WORDS PROSE MAY CARRY WITHOUT EVIDENCE.
 *
 * Deliberately tiny and enumerable: source names (which are not business facts about the
 * restaurant, they are names of the places we read) and a few format words. Everything
 * else in Latin script has to have been retrieved THIS TURN. A large allowlist would
 * quietly defeat the rule, so this list is meant to be argued with, not grown by habit.
 */
const PROSE_ALLOWED = Object.freeze(new Set([
  'gmail', 'drive', 'github', 'calendar', 'google', 'aroma', 'system', 'bistro',
  'ok', 'no', 'yes', 'email', 'e-mail', 'mail', 'pdf', 'csv', 'doc', 'docs', 'api', 'url', 'app', 'pos', 'ai'
]))

/**
 * IS THIS OWNER-FACING SENTENCE GROUNDED IN THIS TURN'S EVIDENCE?
 *
 * ── WHY THIS EXISTS, AND WHAT IT IS NOT ──────────────────────────────────────
 * On 2026-08-04 an answer named 「2lb portioning bag」 and 「8oz Spice Jar With Lids」 as
 * current inventory. Neither was in the read. Both came verbatim from HER OWN archived
 * reply in an earlier conversation — the original broken turn — which conversation recall
 * had injected as memory. The validator logged droppedItems:0, droppedFacts:0 and was
 * telling the truth: every claim was in PROSE, and prose names were never checked. A
 * refuted answer made itself permanent by being repeated.
 *
 * THE RULE: a name, quantity, amount, date or status in an Owner-facing answer must come
 * from THIS turn's EvidenceSet. Recall may inform tone, context and continuity; it may
 * never supply a business fact.
 *
 * THE MECHANISM, and its limit, stated plainly. This restaurant's items, suppliers, files
 * and repositories are named in LATIN script, while her prose is Cantonese — so a Latin
 * word is almost always a name, and a Latin word that was not retrieved is almost always
 * a name from somewhere other than this turn. That asymmetry is what makes a deterministic
 * check possible at all.
 *
 * IT DOES NOT VERIFY PROSE. A fabricated CJK item name still passes, and so does a wrong
 * judgement about a real one. Prose cannot be fully validated and this function does not
 * pretend to; it closes the one channel the live failure actually used. The structural
 * answer to the rest is to keep prose THIN and make the sections mandatory, which is
 * enforced at the schema layer, not here.
 */
function proseIsGrounded (text, index) {
  for (const t of latinTokens(text)) {
    if (PROSE_ALLOWED.has(t)) continue
    if (index.latin.has(t)) continue
    return false
  }
  return true
}

/**
 * OWNER-FACING SOURCE NAMES. 「Aroma System」 is what the API calls itself; 「餐廳系統」 is
 * what the Owner calls it. The label map already existed and only minimalAnswer used it,
 * so the model's own prose reached the screen in English. A pure lookup, like translate()
 * for status enums — no judgement, nothing inferred.
 */
const SOURCE_NAME_REWRITES = Object.freeze([
  [/\bAroma\s+System\b/gi, '餐廳系統'],
  [/\bAroma\s+Bistro\b/gi, '餐廳']
])
function relabel (text) {
  let s = String(text == null ? '' : text)
  for (const [re, to] of SOURCE_NAME_REWRITES) s = s.replace(re, to)
  return s
}

/**
 * 「A 定 B？」 IS TWO QUESTIONS. The contract asks for exactly one, and the old template
 * path has rejected this shape for as long as it has existed — the plan path never
 * inherited the rule, so 「想睇完整倉存報告,定係查特定物料？」 shipped. When it fires the
 * follow-up becomes NOTHING: the plan path has no intent to fall back to, and inventing a
 * question the model did not ask would be the same over-claiming everything here prevents.
 */
const TWO_OPTION_RE = /定係|定|或者|\bor\b/

/** Every scalar value in the evidence, as strings — the universe of provable values. */
function evidenceIndex (evidenceSets = [], itemsBySource = []) {
  const byId = new Map()
  const values = new Set()
  const numbers = new Set()
  // THE SAME VALUES AS QUANTITIES. MySQL hands back '18.000' where the model writes '18';
  // those are one number and the string comparison called them two, deleting a correct
  // fact. Note what this set does NOT contain: the evidence COUNTS. A count is a fact
  // about the read, not a value any row carried, and admitting it here would let a row
  // claim the shown count as its own quantity.
  const numericValues = new Set()
  // Every Latin word this turn actually retrieved. The universe of names an Owner-facing
  // sentence is allowed to contain — see proseIsGrounded.
  const latin = new Set()
  const addNum = (s) => { for (const n of String(s).match(/\d+(?:[.,]\d+)*/g) || []) numbers.add(n.replace(/,/g, '')) }
  const addText = (s) => { for (const t of latinTokens(s)) latin.add(t) }

  for (const g of itemsBySource) {
    for (const row of (g.items || [])) {
      // TWO KEYS FOR ONE ROW, and neither is a relaxation. `ref` (source#id) is what the
      // prompt shows and what the schema pins; the bare id is what the old contract
      // accepted and still does. A SOURCE NAME is a key to nothing, which is the point.
      byId.set(String(row.sourceId), row)
      if (row.source) byId.set(`${row.source}#${row.sourceId}`, row)
      for (const v of Object.values(row.fields || {})) {
        values.add(String(v))
        addNum(v)
        addText(v)
        const n = numericOf(v)
        if (n !== null) numericValues.add(n)
      }
      if (row.title) { values.add(String(row.title)); addText(row.title) }
      if (row.originalDate) { values.add(String(row.originalDate)); addNum(row.originalDate) }
    }
  }
  // Counts the model is allowed to state, because the server measured them.
  for (const e of evidenceSets) {
    if (Number.isFinite(e.totalCount)) numbers.add(String(e.totalCount))
    if (Number.isFinite(e.shownCount)) numbers.add(String(e.shownCount))
  }
  return { byId, values, numbers, numericValues, latin }
}

/**
 * IS THIS RENDERED VALUE A REAL ONE?
 *
 * Three ways to be real, and no fourth:
 *   1. it is a value the evidence carries, verbatim;
 *   2. it is the translation of one (an enum → the Owner's word);
 *   3. it is the SAME QUANTITY as one, written differently — 「18」 and 「18 ea」 against a
 *      stored '18.000'.
 *
 * SUBSTRING MATCHING IS NOT ONE OF THEM, and this is the whole care of the third rule.
 * '8.0' and '1' are both substrings of '18.000' and neither is that number, so the
 * comparison is numeric — parse both sides, compare as quantities. Anything left over
 * after the number is removed must ITSELF be a real value: 「18 ea」 survives because the
 * row carries 'ea', and 「18 apples」 does not, because no row ever said apples.
 */
function valueMatches (raw, index) {
  const s = String(raw).trim()
  if (index.values.has(s)) return true
  if (index.values.has(translate(s))) return true

  const n = numericOf(s)
  if (n === null || !index.numericValues.has(n)) return false

  // The number is real. Whatever else is in the string has to be real too.
  const rest = s
    .replace(/-?\d+(?:[.,]\d+)*/g, ' ')
    .replace(/[$¥€£%,、｜|()（）]/g, ' ')
    .trim()
  return rest === '' || index.values.has(rest)
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
const CJK_DIGITS = Object.freeze({ 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 })
const CJK_UNITS = Object.freeze({ 十: 10, 百: 100, 千: 1000, 萬: 10000 })

/**
 * A Chinese numeral → a number. 三 → 3 · 十五 → 15 · 一百九十九 → 199 · 兩千 → 2000.
 * Returns null for anything that is not purely numeric characters.
 */
function cjkToNumber (s) {
  let total = 0
  let section = 0
  let digit = 0
  for (const ch of String(s)) {
    if (Object.prototype.hasOwnProperty.call(CJK_DIGITS, ch)) { digit = CJK_DIGITS[ch]; continue }
    if (!Object.prototype.hasOwnProperty.call(CJK_UNITS, ch)) return null
    const unit = CJK_UNITS[ch]
    if (unit === 10000) { section = (section + digit) * unit; total += section; section = 0 } else { section += (digit || 1) * unit }
    digit = 0
  }
  return total + section + digit
}

/**
 * WHICH CHINESE NUMERALS ARE A COUNT CLAIM.
 *
 * A numeral ALONE cannot be checked: 一 lives inside 一齊, 一定, 一啲 and a dozen other
 * ordinary words, and dropping honest prose over a particle would be a worse failure than
 * the one being fixed here. So a numeral counts as a claim only when a MEASURE WORD follows
 * it — 「三項」, 「兩張」, 「四封」 — which is how a count is actually written.
 *
 * 個 IS DELIBERATELY ABSENT WHEN THE NUMERAL IS 一. 「一個問題」 is prose, not arithmetic,
 * while 「三個供應商」 is a count; the rule below keeps the second and lets the first pass.
 * That boundary is written here rather than implied, and it means a bare 「一個」 over-claim
 * is NOT caught. The digit spelling of every one of these is still checked.
 */
const CJK_COUNT_RE = /([零〇一二兩三四五六七八九十百千萬]+)([項張封份件次條間位樣款種批個])/g

/**
 * Does every number in this sentence exist in the evidence?
 *
 * BOTH SPELLINGS. This used to match /\d+/ only, so 「系統讀到三項倉存記錄」 contained no
 * digit, had nothing to check, and passed vacuously against a real total of 199 — while the
 * test that claimed to pin the behaviour asserted the ASCII form. Cantonese writes counts in
 * Chinese numerals by default; checking only the exception is checking nothing.
 */
function sentenceIsSupported (sentence, index) {
  const s = String(sentence)
  const nums = s.match(/\d+(?:[.,]\d+)*/g) || []
  if (!nums.every((n) => index.numbers.has(n.replace(/,/g, '')))) return false

  for (const m of s.matchAll(CJK_COUNT_RE)) {
    if (m[2] === '個' && m[1] === '一') continue // 「一個」 is a classifier, not a count
    const n = cjkToNumber(m[1])
    if (n === null) continue
    if (!index.numbers.has(String(n))) return false
  }
  return true
}

const splitSentences = (text) => String(text).split(/(?<=[。！？!?])\s*|\n+/).map((s) => s.trim()).filter(Boolean)

/**
 * VALIDATE. Returns the plan with unsupported material removed, plus what was dropped.
 * Nothing here rewrites meaning: a claim is kept as written or removed entirely.
 */
function validatePlan (plan, { evidenceSets = [], itemsBySource = [] } = {}) {
  const index = evidenceIndex(evidenceSets, itemsBySource)
  // TWO COUNTERS, BECAUSE THEY ARE TWO FAILURES. They used to share one, and the shared
  // number sent a live diagnosis after the wrong defect: `droppedFacts:3` was read as three
  // deleted values when it was three deleted ITEMS, which is why the screen was empty
  // rather than merely thin. An unprovable value and a row that does not exist are not the
  // same event and no longer report as one.
  let droppedFacts = 0
  let droppedItems = 0
  let droppedSentences = 0
  // WHAT was dropped, not just how much. IDENTIFIERS ONLY — a sourceId and a field name.
  // Never a value: the log is not allowed to carry row content, and a validator that
  // deletes without leaving a record is how this defect survived three rounds.
  const drops = []
  let modelItemCount = 0
  let keptItemCount = 0

  // ── directAnswer: sentence by sentence ──────────────────────────────────────
  const kept = []
  for (const raw of splitSentences(plan.directAnswer || '')) {
    // Relabel FIRST, so the check runs on the text the Owner will actually read.
    const s = relabel(raw)
    if (!sentenceIsSupported(s, index)) { droppedSentences++; continue }
    if (TELEMETRY_RE.test(s)) { droppedSentences++; continue }
    // RECALL IS NOT EVIDENCE. A name this turn did not retrieve does not reach the Owner,
    // whatever the model believes it remembers.
    if (!proseIsGrounded(s, index)) { droppedSentences++; continue }
    kept.push(s)
  }
  let directAnswer = kept.join('').slice(0, LIMITS.maxDirectAnswerChars)

  // ── sections: an item must be a row we actually retrieved ───────────────────
  const sections = []
  for (const sec of (Array.isArray(plan.sections) ? plan.sections : []).slice(0, LIMITS.maxSections)) {
    const items = []
    for (const it of (Array.isArray(sec.items) ? sec.items : []).slice(0, LIMITS.maxItemsPerSection)) {
      modelItemCount++
      const sourceId = String(it.sourceId)
      const row = index.byId.get(sourceId)
      if (!row) { // an item that was never retrieved is an invention
        droppedItems++
        drops.push({ kind: 'item', sourceId: sourceId.slice(0, LIMITS.maxDropIdChars) })
        continue
      }
      const facts = []
      for (const f of (Array.isArray(it.facts) ? it.facts : []).slice(0, LIMITS.maxFactsPerItem)) {
        // The value must be a real one — verbatim, the translation of one, or the same
        // quantity written differently. See valueMatches: never a substring.
        if (!valueMatches(f.value, index)) {
          droppedFacts++
          drops.push({ kind: 'fact', sourceId: sourceId.slice(0, LIMITS.maxDropIdChars), field: String(f.field).slice(0, LIMITS.maxDropIdChars) })
          continue
        }
        facts.push({ field: String(f.field), value: translate(f.value) })
      }
      // The title is the server's, not the model's: it cannot be edited into something else.
      items.push({ sourceId, title: row.title || String(it.title || ''), facts })
      keptItemCount++
    }
    // A SECTION WITH NOTHING LEFT IS STILL NEWS. It is not rendered — a bare heading over
    // nothing is worse than no heading — but the count above travels out with it, and
    // readResultView states the omission on screen instead of quietly shrinking.
    // The heading is Owner-facing too: relabelled, and blanked rather than allowed to
    // carry a name this turn did not retrieve. renderValidatedPlan omits an empty heading
    // instead of printing a bare '###'.
    let heading = relabel(String(sec.heading || ''))
    if (heading && !proseIsGrounded(heading, index)) heading = ''
    if (items.length > 0) sections.push({ heading, items })
  }

  // ── limitations: real ones only, never telemetry ────────────────────────────
  const limitations = (Array.isArray(plan.limitations) ? plan.limitations : [])
    .map((l) => relabel(String(l).trim()))
    .filter((l) => l && !TELEMETRY_RE.test(l) && sentenceIsSupported(l, index) && proseIsGrounded(l, index))
    .slice(0, LIMITS.maxLimitations)
    .map((l) => l.slice(0, LIMITS.maxLimitationChars))

  // ── followUp: zero or one, never two options ────────────────────────────────
  let followUp = typeof plan.followUp === 'string' ? relabel(plan.followUp.trim()) : null
  if (followUp) {
    const at = followUp.search(/[？?]/)
    followUp = at === -1 ? null : followUp.slice(0, at + 1).slice(0, LIMITS.maxFollowUpChars)
  }
  // 「A 定 B？」 — the rule the plan path never inherited. No question beats two.
  if (followUp && TWO_OPTION_RE.test(followUp)) followUp = null
  // A question is Owner-facing text: it may not smuggle in a name either.
  if (followUp && !(sentenceIsSupported(followUp, index) && proseIsGrounded(followUp, index))) followUp = null

  // A directAnswer that lost every sentence cannot stand in for one.
  const answerSurvived = directAnswer.trim().length > 0
  if (!answerSurvived) directAnswer = ''

  return {
    plan: { directAnswer, sections, limitations, followUp, unanswerable: plan.unanswerable === true },
    droppedFacts,
    droppedItems,
    droppedSentences,
    drops: drops.slice(0, LIMITS.maxDropsLogged),
    // How much content the model offered, and how much of it was real. The pair is what
    // lets the caller tell "a thin answer" from "an answer with nothing left in it".
    modelItemCount,
    keptItemCount,
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
  // A SUCCESSFUL READ AND A FAILED COMPOSITION ARE DIFFERENT EVENTS.
  // The Owner saw this sentence sitting above a correction that read 「上面講『讀唔到』係
  // 唔啱嘅」 — two subsystems asserting opposite things in one message. The read had in
  // fact succeeded; only the composing failed. So this says both, in that order, and it
  // deliberately contains NO read-failure phrase for the guard to catch: an answer and its
  // safety control must not be able to argue with each other.
  return `我讀到 ${parts.join('、')}。資料讀取成功,但我今次砌唔出一個可靠嘅答案,所以唔會亂講。`
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
  DISTILL_WITH_PLAN_SCHEMA,
  withRowRefs,
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
  valueMatches,
  numericOf,
  cjkToNumber,
  sentenceIsSupported,
  splitSentences
}
