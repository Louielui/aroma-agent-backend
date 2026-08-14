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
 *   TOTALS cannot be faked: shownCount, matchingTotal and sourceTotal come from the EvidenceSet.
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
// ⛔ A4-0A: the gated read-argument shape. Nothing here is used while the A4 gate is off.
const { READ_ARGS_SCHEMA } = require('./a4Contract')
const { t } = require('../i18n/t')
const { looksLikeRankingHeading, normaliseRankingClaim, canonicalOf, RANKING_METRIC, CLAIM_KIND } = require('./rankingProof')

/**
 * ⛔ THE SERVER'S OWN TITLE FOR A PROVEN RANKING.
 *
 * Template plus closed fields, and nothing else: `kind` and `metric` are enum members the
 * validator accepted, and `n` is either the declared count the gate just verified against the
 * proof or the number of rows actually rendered. There is no parameter through which model
 * prose could enter, which is the property that makes the replacement boundary provable
 * rather than merely intended.
 */
function composeRankingHeading (claim, shownCount) {
  const metricLabel = claim.metric === RANKING_METRIC.ABSOLUTE_SHORTFALL
    ? t('rank.metricShortfall')
    : (claim.metric === RANKING_METRIC.SUGGESTED_ORDER_QTY ? t('rank.metricOrderQty') : null)
  if (claim.kind === CLAIM_KIND.ORDERING) {
    return metricLabel ? t('rank.headingOrder', { metric: metricLabel }) : t('rank.headingOrderPlain')
  }
  // A superlative claims a prefix of what it shows, so the verified count IS the count shown.
  const n = claim.kind === CLAIM_KIND.TOP_N ? claim.n : shownCount
  return metricLabel ? t('rank.headingTop', { metric: metricLabel, n }) : t('rank.headingTopPlain', { n })
}

/**
 * THE OWNER-FACING UNIT WORDS. Keys are the codes the LIVE rows carry.
 *
 * Measured 2026-08-05 by reading one live inventory page, read-only: ea · cs · pal · box ·
 * bag · bottle · pack. She was writing 件 and 箱 — translating the code herself — and the
 * translated word is not in the row, so every unit dropped as not_a_value. That is exactly
 * the `active → 啟用中` case, which statuses have always had a table for and units did not.
 *
 * cs and box are kept DISTINCT (箱 / 盒). The source draws that line and collapsing it here
 * would lose a distinction the Owner's own data makes. A code with no entry renders as
 * itself — never guessed.
 */
const UNIT_LABELS = Object.freeze({
  // ⛔ Thunks, not key strings — a table lookup handed to t() is a DYNAMIC key (HR-48).
  ea: () => t('unit.ea'),
  cs: () => t('unit.cs'),
  box: () => t('unit.box'),
  pal: () => t('unit.pal'),
  bag: () => t('unit.bag'),
  bottle: () => t('unit.bottle'),
  pack: () => t('unit.pack')
})

/** The Owner-facing status words. Keys are the API's own values. */
const STATUS_LABELS = Object.freeze({
  // ⛔ Thunks, not key strings — a table lookup handed to t() is a DYNAMIC key (HR-48).
  needs_review: () => t('status.needsReview'),
  approved: () => t('status.approved'),
  sent: () => t('status.sent'),
  received: () => t('status.received'),
  partially_received: () => t('status.partiallyReceived'),
  active: () => t('status.active'),
  inactive: () => t('status.inactive'),
  unknown: () => t('status.unknown')
})

const LIMITS = Object.freeze({
  maxSections: 4,
  maxItemsPerSection: 5,
  maxFactsPerItem: 4,
  // DERIVATIONS DO NOT COMPETE FOR THE FOUR ABOVE (Owner ruling, 2026-08-05). She spent
  // all four slots on ordinary fields and 缺口 — the whole reason derivations were
  // approved — lost to 分類. TWO, because only one derivation is declared today and a
  // second is the most any single row plausibly warrants; a larger allowance would let
  // computed values crowd out the measured ones they are computed from.
  maxDerivationsPerItem: 2,
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
const TELEMETRY_RE = /(未列出|長度上限|判斷為與此問題無關|fallback|usedFallback|shownCount|matchingTotal|sourceTotal|returnedRows|evidence|token)/i

/**
 * THE SCHEMA. Enforced by the provider, not by a prompt. Every object closes
 * additionalProperties so a model cannot smuggle a field past the validator.
 */
const ANSWER_PLAN_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  // ⛔ EVERY PROPERTY IS IN required. OpenAI strict Structured Outputs REJECTS a schema
  // whose properties are not all required — it expresses optionality as a NULL UNION, not
  // by omission. Omitting answerClaims produced a live HTTP 400 invalid_json_schema and
  // every OpenAI turn silently fell back to Claude. Only the canary could see that; a fake
  // adapter never validates a schema.
  required: ['directAnswer', 'answerClaims', 'sections', 'limitations', 'followUp', 'unanswerable', 'citesEvidence'],
  properties: {
    // ⛔ EVERY `description` IN THIS SCHEMA IS MODEL TEXT — she is TOLD it, and it shapes
    // what she produces. Translating it is a BEHAVIOUR change wearing a translation's clothes.
    // It stays Chinese regardless of the interface language. See textClasses.js, class MODEL.
    directAnswer: { type: 'string', description: '一至兩句，直接回答問題。不要覆述逐項細節。' },
    // ── A2 PHASE 2: WHAT EACH DIRECT-ANSWER CLAIM IS ABOUT, STRUCTURALLY ────────────
    //
    // ⛔ OPTIONAL, DELIBERATELY. It is NOT in `required` above, so a provider that does not
    // send it stays valid and the turn behaves exactly as before — the binding state is then
    // recorded as UNBOUND rather than inferred. Adding it to `required` would break every
    // existing provider and would force a model to invent a binding it cannot justify.
    //
    // ⛔ AND IT IS METADATA ONLY IN THIS PHASE. Nothing renders from it, nothing is refused
    // because of it, and `directAnswer` remains the sole source of the answer the Owner reads.
    //
    // The point is to remove a structural blocker: a SENTENCE has no mapping to the source it
    // is about, so a coverage check handed the whole evidenceSets array would let an unrelated
    // source's unknown coverage refuse a sentence about a different one. Declared here,
    // VERIFIED server-side in claimBinding.js — never inferred from the words.
    answerClaims: {
      // null = UNBOUND. verifyClaimBindings(null) already returns [], so the semantics are
      // unchanged: an absent declaration is never an inferred binding.
      type: ['array', 'null'],
      description: '把 directAnswer 拆成一句一個 claim，並宣告每句是關於哪些證據。不要猜；不確定就不要填這個欄位。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'claimKind', 'evidenceSources', 'sourceIds', 'scope'],
        properties: {
          text: { type: 'string', description: 'directAnswer 之中的那一句，原文照抄。' },
          claimKind: {
            type: 'string',
            enum: ['row_local', 'set_scoped', 'source_wide'],
            description: 'row_local＝關於指定的若干列；set_scoped＝關於一個已宣告範圍的整體；source_wide＝關於整個來源。'
          },
          evidenceSources: { type: 'array', items: { type: 'string' }, description: '這一句所依據、本回合確實讀取過的來源。' },
          sourceIds: { type: 'array', items: { type: 'string' }, description: 'row_local 必須填；其他填空陣列。必須是證據中真實存在的 id。' },
          scope: {
            type: 'object',
            additionalProperties: false,
            required: ['field', 'window'],
            description: 'set_scoped 必須填寫，並且要與證據本身的範圍一致；其他情況填 null。',
            properties: {
              field: { type: ['string', 'null'] },
              window: { type: ['string', 'null'] }
            }
          }
        }
      }
    },
    unanswerable: { type: 'boolean', description: '資料無法回答這個問題時填 true —— 這是誠實，不是失敗。' },
    // ── THE DECLARATION THAT REPLACED A FORCED SECTION ───────────────────────────────
    // `sections.minItems: 1` used to sit below. It was added because item detail had been
    // hiding in prose where nothing could check it — but it made evidence MANDATORY, and
    // the read layer reads on every chat turn regardless of what was asked. So
    // 「你好, 你可以幫我做什麼?」 retrieved inventory, the schema demanded a row, and the
    // model described ITSELF in the fields of Napa Cabbage. Every layer obeyed; the schema
    // was the defect.
    //
    // Now the model DECLARES which kind of answer this is, so "no sections" is a stated
    // choice rather than a silent empty array the server cannot distinguish from a failure.
    citesEvidence: {
      type: 'boolean',
      description: 'true = 這個答案引用了下面讀到的記錄，sections 至少要有一節、每節至少一項。false = 這個問題不需要引用任何記錄（例如打招呼、問你會做什麼、或者資料根本無法回答），sections 必須留空。'
    },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'items', 'rankingClaim'],
        properties: {
          heading: { type: 'string' },
          // ── CARDINALITY IS DECLARED, NOT READ OUT OF THE HEADING ────────────────
          //
          // ⛔ REQUIRED AND NULLABLE, like every other optional field here: strict Structured
          // Outputs express optionality as a NULL UNION and REJECT a schema that omits a
          // property from `required`. This repo has already taken a live 400 for that.
          //
          // ⛔ AND A DECLARATION CONFERS NO AUTHORITY. It says WHAT is being claimed so the
          // server knows what to prove; every entitlement — proof ownership, metric,
          // completeness, membership, order — is still earned in rankingProof.js. Four rounds
          // of blockers went into learning that a heading cannot be asked how many.
          rankingClaim: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['kind', 'n', 'metric'],
            description: '這一節如果係排名／最高／頭幾項，就要在這裡宣告；普通清單填 null。宣告不等於成立，伺服器會逐項核對。',
            properties: {
              kind: {
                type: 'string',
                enum: ['ordering', 'superlative', 'top_n'],
                description: 'ordering＝按次序排列；superlative＝最高的若干項；top_n＝指定數量的頭 N 項。'
              },
              n: { type: ['integer', 'null'], description: 'top_n 必須填正整數，而且要等於這一節實際列出的項數；其他填 null。' },
              // ⛔ anyOf, NOT `type: ['string','null']` BESIDE `enum`. Anthropic rejects that
              // pairing — 「Enum value X does not match declared type」 — and OpenAI accepts it,
              // so the defect is invisible on whichever provider the harness happens to use.
              // providerSchemaFence.test.js caught this one before it was ever sent.
              metric: {
                anyOf: [
                  { type: 'string', enum: ['absolute_shortfall', 'suggested_order_qty'] },
                  { type: 'null' }
                ],
                description: '這個排序依據哪一個量；沒有指明就填 null。'
              }
            }
          },
          items: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sourceId', 'title', 'facts'],
              properties: {
                sourceId: { type: 'string', description: '必須是證據中真實存在的 id。' },
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
    followUp: { type: ['string', 'null'], description: '最多一個問題；沒有必要就填 null。' }
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
  // Same strict-mode rule as ANSWER_PLAN_SCHEMA above: required + nullable, never omitted.
  required: ['intent', 'nextRead', 'mode', 'reply', 'answerPlan'],
  properties: {
    intent: { type: 'string' },
    // ── A3 REASONING LOOP: THE ONLY NEW DECISION THE MODEL CAN MAKE. ────────────
    // OPTIONAL, and absent means FINAL — so an ordinary turn is byte-identical and a
    // direct question still costs exactly one model call. It is an ACTION DECISION, not
    // chain-of-thought: the model says WHICH authorised source it wants read, never why.
    // The server verifies the name against the allowlist this turn was already granted.
    nextRead: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['capability'],
      // ⛔ AN OPERATION, NOT A SOURCE. 「aroma_system」 named six different reads and left the
      // server to guess which — which is the whole first-read defect. The enum is pinned per
      // call by withReadChoices(); this text is the fallback when nothing pinned it.
      description: '需要先讀取資料才能回答時填寫；可以直接回答就不要填。只能填本回合列出的讀取操作。若不確定要讀邊一部分，改為 mode="ask" 問一句，不要亂揀。',
      properties: { capability: { type: 'string', description: '本回合已授權的讀取操作，例如 aroma_system.invoices。' } }
    },
    mode: { type: 'string', enum: ['commit', 'recommend', 'ask', 'chat'] },
    reply: { type: 'string', description: '一句自然的說話。逐項清單由系統渲染，不要在這裡覆述。' },
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
  node.description = '必須逐字抄自證據中該行的 ref= 值（例如 ref=aroma_system#2 就寫 aroma_system#2）。不是來源名，不是標題。'
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
  /**
   * ⛔ THE RANKING-SECTION GATE SUMMARY. Its own field, never inferred from an absence.
   * Enum and count only — no heading, title, value, message or prose can reach it.
   */
  const RANK_STATUS = new Set(['not_detected', 'evaluated_allowed', 'evaluated_rejected'])
  const RANK_REASON = new Set(['no_ranking_proof', 'metric_not_proven', 'ranking_incomplete',
    'membership_mismatch', 'order_mismatch', 'cardinality_mismatch',
    // ⛔ A REASON MISSING FROM THIS SET IS PROJECTED AS null — the verdict would be computed,
    // shipped, and unreadable. Every VIOLATION in rankingProof.js belongs here.
    'ranking_claim_missing', 'ranking_claim_invalid'])
  const rankingGate = (Array.isArray(entry.rankingVerdicts) ? entry.rankingVerdicts : [])
    .slice(0, LIMITS.maxDropsLogged)
    .map((v) => ({
      status: RANK_STATUS.has(v && v.status) ? v.status : 'other',
      reason: (v && v.reason && RANK_REASON.has(v.reason)) ? v.reason : null,
      rankedSourceCount: Number.isFinite(v && v.rankedSourceCount) ? v.rankedSourceCount : null
    }))
  const rankingClaims = (entry.rankingClaims && typeof entry.rankingClaims === 'object') ? entry.rankingClaims : {}
  const line = {
    event: 'ANSWER_PLAN',
    timestamp: new Date().toISOString(),
    outcome: String(entry.outcome || 'unknown'),
    reason: entry.reason == null ? null : String(entry.reason).slice(0, 80),
    provider: entry.provider == null ? null : String(entry.provider),
    droppedItems: Number.isFinite(entry.droppedItems) ? entry.droppedItems : 0,
    droppedFacts: Number.isFinite(entry.droppedFacts) ? entry.droppedFacts : 0,
    droppedSentences: Number.isFinite(entry.droppedSentences) ? entry.droppedSentences : 0,
    // Counted since 2026-08-05: a limitation removed by the filter used to leave no trace.
    droppedLimitations: Number.isFinite(entry.droppedLimitations) ? entry.droppedLimitations : 0,
    /**
     * ⛔ HOW MANY SECTIONS PRESENTED A RANKING, HOW MANY DECLARED ONE, AND THE GAP.
     * Three counts, no content. `missing` is the one that matters: it is the number of
     * sections that looked like a ranking and declared nothing, which is the escape this
     * contract closed and the number that says whether the model has learnt to declare.
     * Always present, never absent — an absent counter and a zero counter must not look alike.
     */
    rankingClaims: {
      looksRanking: Number.isFinite(rankingClaims.looksRanking) ? rankingClaims.looksRanking : 0,
      declared: Number.isFinite(rankingClaims.declared) ? rankingClaims.declared : 0,
      missing: Number.isFinite(rankingClaims.missing) ? rankingClaims.missing : 0
    },
    // WHAT THE MODEL OFFERED, beside what survived. Without the pair, "it sent no sections"
    // and "it sent items with no facts" look identical from the log — and telling them
    // apart cost a hand investigation across the archive and the live API.
    modelItemCount: Number.isFinite(entry.modelItemCount) ? entry.modelItemCount : 0,
    keptItemCount: Number.isFinite(entry.keptItemCount) ? entry.keptItemCount : 0,
    // Identifiers only. The projection is explicit rather than a spread, so a new key on a
    // drop record cannot ride into the log unnoticed.
    rankingGate,
    dropped: drops.map((d) => {
      const out = { kind: String(d && d.kind ? d.kind : 'unknown'), sourceId: String(d && d.sourceId != null ? d.sourceId : '').slice(0, LIMITS.maxDropIdChars) }
      if (d && d.field != null) out.field = String(d.field).slice(0, LIMITS.maxDropIdChars)
      // The rejection REASON — an enum, so it says why without saying what.
      if (d && d.why != null) out.why = String(d.why).slice(0, LIMITS.maxDropIdChars)
      // WHAT was rejected. describeValue() already decided whether the value itself may
      // travel; this projection is explicit so a new key on a drop record cannot ride in.
      if (d && d.shape != null) out.shape = String(d.shape).slice(0, 20)
      if (d && Number.isFinite(d.length)) out.length = d.length
      if (d && typeof d.value === 'string') out.value = d.value.slice(0, MAX_DROP_VALUE_CHARS)
      // HOW WRONG, when WHAT is withheld. A score cannot carry content.
      if (d && Number.isFinite(d.score)) out.score = d.score
      if (d && d.nearness != null) out.nearness = String(d.nearness).slice(0, 20)
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
    const tok = m.replace(/[.'’-]+$/, '').toLowerCase()
    if (tok.length >= 2) out.push(tok)
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
 * pretend to; it closes the one channel the live failure actually used.
 *
 * ── READ THIS BEFORE WEAKENING OR REMOVING THIS CHECK ────────────────────────
 * THE "ITEM DETAIL CANNOT HIDE IN PROSE" GUARANTEE NOW RESTS HERE, on this function and on
 * sentenceIsSupported. It used to rest on `sections.minItems: 1` in the schema, which made
 * at least one evidence row MANDATORY — but the read layer reads on every chat turn
 * regardless of the question, so on 2026-08-04 「你好, 你可以幫我做什麼?」 forced the model
 * to describe itself in the fields of a cabbage. minItems was removed and replaced by the
 * `citesEvidence` declaration, plus rule 7 in validatePlan (a plan that cites nothing may
 * not name a retrieved row in prose, unless the Owner named it first).
 *
 * So: this check and sentenceIsSupported are no longer belt-and-braces over a schema
 * guarantee — they ARE the guarantee. Weakening either one reopens the original defect
 * (「2lb portioning bag」 recited from memory as current stock) with nothing behind it.
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
/**
 * WITHDRAWN — Owner decision, 2026-08-04, with the Language Policy.
 *
 * This held two entries: Aroma System → 餐廳系統 and Aroma Bistro → 餐廳. The policy lists
 * Aroma System among the names to PRESERVE, and one rule holds better than two exceptions,
 * so the entries are gone and proper nouns now reach the Owner as written.
 *
 * THE MECHANISM IS KEPT DELIBERATELY EMPTY, NOT DELETED. With no entries `relabel` is an
 * identity function applied at four call sites (directAnswer sentences, section headings,
 * limitations, followUp) and changes nothing. It has NO other user in the codebase — I
 * checked, and there is none — so it should go entirely, together with those four call
 * sites, in the round that next touches this file's presentation. Removing it now would
 * mean editing four more places in a round the Owner scoped to one variable.
 *
 * NOTE FOR WHOEVER READS THIS NEXT: 餐廳系統 has NOT disappeared from the screen. Two other
 * tables still map the source that way — SOURCE_LABELS below, and VOCABULARY/LABELS in
 * readStateGuard.js — so until those are decided (Round 2/3) a reply can show 'Aroma System'
 * in prose and 餐廳系統 as a section label. That inconsistency is a known, temporary
 * consequence of changing one variable at a time, not a bug to be patched around.
 */
const SOURCE_NAME_REWRITES = Object.freeze([])
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
/**
 * Resolve a model-written row reference to exactly one retrieved row, or to nothing.
 *
 * ⛔ FAIL CLOSED ON AMBIGUITY. A canonical `readKey#sourceId` always wins. A legacy alias
 * (bare id, or `source#id`) resolves ONLY when a single canonical row owns it; with two
 * owners it selects NO row. There is no tie-break, deliberately: every available tie-break —
 * first, last, title match, nearest entity type — is a guess presented as an identity, and
 * the measured cost of the last one was a fact rendered under the wrong row's name.
 */
function resolveRowRef (index, ref) {
  const key = String(ref)
  const exact = index.byId.get(key)
  if (exact) return exact
  const owners = index.aliasOwners.get(key)
  if (!owners || owners.size !== 1) return null
  return index.byId.get([...owners][0]) || null
}

function evidenceIndex (evidenceSets = [], itemsBySource = []) {
  const byId = new Map()
  // legacy alias -> the set of canonical refs claiming it. Size 1 resolves; more fails closed.
  const aliasOwners = new Map()
  const values = new Set()
  const numbers = new Set()
  // THE SAME VALUES AS QUANTITIES. MySQL hands back '18.000' where the model writes '18';
  // those are one number and the string comparison called them two, deleting a correct
  // fact. Note what this set does NOT contain: the evidence COUNTS. A count is a fact
  // about the read, not a value any row carried, and admitting it here would let a row
  // claim the shown count as its own quantity.
  const numericValues = new Set()
  // The same values, normalised the two ways matchValue can compare them. Built HERE so
  // the candidate and the evidence are normalised by identical code.
  const dateKeys = new Set()
  const monthDayKeys = new Set()
  const timeKeys = new Set()
  const digitKeys = new Set()
  // Every Latin word this turn actually retrieved. The universe of names an Owner-facing
  // sentence is allowed to contain — see proseIsGrounded.
  const latin = new Set()
  const addNum = (s) => { for (const n of String(s).match(/\d+(?:[.,]\d+)*/g) || []) numbers.add(n.replace(/,/g, '')) }
  const addText = (s) => { for (const t of latinTokens(s)) latin.add(t) }

  for (const g of itemsBySource) {
    for (const row of (g.items || [])) {
      // ── ONE CANONICAL IDENTITY, PLUS ALIASES THAT MUST EARN THEIR RESOLUTION ──
      //
      // ⛔ THE CANONICAL REF IS `readKey#sourceId`, and it is the ONLY key written directly.
      // Two operations of one source can each return a row with raw id 7 — ids are per-table
      // sequences — and both used to key `aroma_system#7` into this very Map. Last write won,
      // so an order-planning quantity could be rendered under a purchase order's title.
      //
      // The bare id and `source#id` remain LEGACY ALIASES, but they are collected as
      // CANDIDATE SETS below and resolve only when exactly one canonical row owns them.
      // Two owners is ambiguous and resolves to nothing — never the first row, never the
      // last, never a title or entity-type guess.
      const readKey = row.readKey || g.readKey || row.source
      const canonical = `${readKey}#${row.sourceId}`
      byId.set(canonical, row)
      const alias = (key) => {
        if (key === canonical) return
        const set = aliasOwners.get(key) || new Set()
        set.add(canonical)
        aliasOwners.set(key, set)
      }
      alias(String(row.sourceId))
      if (row.source) alias(`${row.source}#${row.sourceId}`)
      for (const v of Object.values(row.fields || {})) {
        values.add(String(v))
        // BOTH FORMS. The row carries `cs`; she writes 箱. Indexing only the raw code made
        // every translated unit and status unverifiable — she has to guess which spelling
        // the validator wants, and guessing wrong deleted a correct fact.
        const tv = translate(v)
        if (tv !== String(v)) values.add(tv)
        addNum(v)
        addText(v)
        const n = numericOf(v)
        if (n !== null) numericValues.add(n)
        const dk = dateKeyOf(v); if (dk) dateKeys.add(dk)
        if (dk) monthDayKeys.add(dk.slice(5))
        for (const tk of timeKeysIn(v)) timeKeys.add(tk)
        const gk = digitsKeyOf(v); if (gk) digitKeys.add(gk)
      }
      if (row.title) { values.add(String(row.title)); addText(row.title) }
      if (row.originalDate) { values.add(String(row.originalDate)); addNum(row.originalDate) }
      // ── CONTENT IS EVIDENCE ────────────────────────────────────────────────
      // A calendar row carries only summary/start/location in `fields`; the doctor, the
      // phone number and the to-do live in the event DESCRIPTION, which the adapter puts
      // in `content`. That was never indexed, so anything she read out of a description
      // could never be verified in any format — the only safe calendar answer was a title.
      //
      // The description is ALREADY in the prompt. Not indexing it did not withhold it from
      // her; it only stopped her citing it verifiably.
      //
      // Indexed WHOLE and in SEGMENTS, because either granularity may be what she quotes.
      // Still exact equality: a name that is not in the description does not match.
      if (row.content) {
        const whole = String(row.content)
        // HIERARCHICAL, not one flat split. Splitting on coarse and fine separators at once
        // loses the middle granularity: 「確認郵件、提供保險資料」 is ONE chunk between two ·
        // and ALSO two items between 、, and she may quote either. All three levels are added.
        const coarse = whole.split(/[·;；\n]/)
        const fine = coarse.flatMap((c) => c.split(/[,，、]/))
        for (const seg of [whole, ...coarse, ...fine]) {
          const seg2 = seg.trim()
          if (!seg2) continue
          values.add(seg2)
          addNum(seg2)
          addText(seg2)
          const n = numericOf(seg2); if (n !== null) numericValues.add(n)
          const dk = dateKeyOf(seg2); if (dk) dateKeys.add(dk)
          if (dk) monthDayKeys.add(dk.slice(5))
          for (const tk of timeKeysIn(seg2)) timeKeys.add(tk)
          const gk = digitsKeyOf(seg2); if (gk) digitKeys.add(gk)
          // and any digit run embedded in the segment
          for (const run of seg2.match(DIGIT_RUN_RE) || []) {
            const rk = digitsKeyOf(run); if (rk) digitKeys.add(rk)
          }
        }
      }
      if (row.originalDate) {
        const dk = dateKeyOf(row.originalDate)
        if (dk) { dateKeys.add(dk); monthDayKeys.add(dk.slice(5)) }
        for (const tk of timeKeysIn(row.originalDate)) timeKeys.add(tk)
      }
    }
  }
  // Counts the model is allowed to state, because the server measured them.
  //
  // ⛔ A1: `matchingTotal` and `sourceTotal` are BOTH stateable, and they are different
  // claims. The retired `totalCount` conflated them, so a number that only ever meant 「rows
  // matching a 30-day window」 was equally usable to say 「how many exist」. Admitting both
  // here is deliberate: the guard against misusing one as the other is the SCOPE line telling
  // the model which is which, plus the evidence gate — not a missing number, which would only
  // stop her stating a count she was correctly shown.
  for (const e of evidenceSets) {
    if (Number.isFinite(e.matchingTotal)) numbers.add(String(e.matchingTotal))
    if (Number.isFinite(e.sourceTotal)) numbers.add(String(e.sourceTotal))
    if (Number.isFinite(e.returnedRows)) numbers.add(String(e.returnedRows))
    if (Number.isFinite(e.shownCount)) numbers.add(String(e.shownCount))
  }
  /**
   * ── ⛔ DECLARED DERIVATIONS, BOUND TO THE ROW THAT OWNS THEM ───────────────
   *
   * MEASURED LIVE, requestId a56638cf-8d6a-4306-974b-a1e536eb42b0 on bootCommit 09e50d0:
   * the same declared derivation had two different verdicts depending on where it was written.
   *
   *   section   「缺口 70」  → computeDerivation() runs server-side → PASS
   *   sentence  「Napa Cabbage 缺口 70」 → 70 is in no raw field → number_not_in_evidence
   *
   * `aromaSystemRead.js:203` already declares `inventory: 缺口 = parLevel - currentStock`, and
   * the structured path already trusts the SERVER's arithmetic over the model's. Only the
   * prose path was blind to it. That asymmetry — not model arithmetic in general — is the
   * defect.
   *
   * ⛔ AND THIS IS A BINDING, NOT A PERMISSION. Each entry names ONE row, ONE declared label
   * and that row's OWN server-computed value. It is deliberately NOT merged into `numbers`:
   * a global number pool would let any sentence borrow another row's 70, which is a different
   * false claim wearing the same digits.
   */
  const derived = []
  const derivSpecs = derivationMap(evidenceSets)
  for (const [canonical, row] of byId.entries()) {
    const specs = derivSpecs.get(row && row.source)
    if (!specs) continue
    const title = (row && typeof row.title === 'string') ? row.title.trim() : ''
    if (!title) continue
    for (const [label, spec] of specs) {
      const value = computeDerivation(spec, row)
      if (value === null) continue // both inputs must be present and numeric on THIS row
      // ⛔ THE CANONICAL REF TRAVELS WITH THE VALUE. A title is a display string and two
      // distinct rows may share one; `readKey#sourceId` is what identifies a row here and
      // everywhere else in this file.
      derived.push({ canonical, title, label, value })
    }
  }

  return { byId, aliasOwners, values, numbers, numericValues, latin, dateKeys, digitKeys, monthDayKeys, timeKeys, derived }
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
/**
 * A DATE, NORMALISED — or null when the string is not an unambiguous full date.
 *
 * Accepts 2026-07-06 · 2026/07/06 · 2026年7月6日 · and any of those carrying a time. A
 * partial date (「7 月 6 日」, no year) is NOT a date here: two different years would collapse
 * onto one, which is the kind of relaxation this file exists to refuse.
 */
const DATE_RE = /^(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?(?:[T\s].*)?$/
function dateKeyOf (s) {
  const m = DATE_RE.exec(String(s).trim())
  if (!m) return null
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * A SEPARATED DIGIT SEQUENCE — a phone number and nothing else.
 *
 * Only when the string is digits and SEPARATORS ONLY, and carries at least two digit
 * groups. `.` is deliberately NOT a separator: stripping it would make 191.10 and 19110 the
 * same string, and collapsing a decimal onto an integer is exactly the failure this must
 * never produce.
 */
const SEPARATED_RE = /^[\d\s\-()+]+$/

/**
 * Digit runs found INSIDE prose — 「電話：204-555-1234 請提前十分鐘到達」.
 *
 * digitsKeyOf only accepted a segment that was ENTIRELY digits and separators, so a number
 * embedded in a sentence indexed nothing and could never be cited. Starts and ends on a
 * digit and needs at least six characters, so a lone number is not a "run"; digitsKeyOf
 * still requires two groups, so a partial number fails exactly as before.
 */
const DIGIT_RUN_RE = /\d[\d\s\-()+]{4,}\d/g

function digitsKeyOf (s) {
  const val = String(s).trim()
  if (!SEPARATED_RE.test(val)) return null
  const groups = val.match(/\d+/g) || []
  if (groups.length < 2) return null
  return groups.join('')
}

/**
 * Compare a model-written value against the evidence.
 *
 * ── WHY THIS GREW TWO NORMALISATIONS (2026-08-05) ────────────────────────────
 * This is a QUANTITY checker, and it was being applied to every field. It rejected any
 * string carrying more than one number BEFORE attempting any comparison, so a date could
 * only pass by byte-identical string match — and the row stores a timestamp while the model
 * writes the date. Every business turn therefore carried an omission note.
 *
 * The invoice turn proved it against itself: 「7 月 6 日開立」 passed in PROSE, because
 * sentenceIsSupported checks number tokens individually, while the SAME date dropped as a
 * field. Two checkers, one date, opposite verdicts.
 *
 * BOTH NEW PATHS ARE EXACT EQUALITY OF A NORMALISED FORM. Neither is substring matching and
 * neither is fuzzy: a different date fails, a different phone number fails, a fragment fails.
 */
function matchValue (raw, index) {
  const s = String(raw).trim()
  if (index.values.has(s)) return { ok: true }
  if (index.values.has(translate(s))) return { ok: true }

  const dk = dateKeyOf(s)
  if (dk && index.dateKeys.has(dk)) return { ok: true }

  const gk = digitsKeyOf(s)
  if (gk && index.digitKeys.has(gk)) return { ok: true }

  // WHY it failed, as an enum. Diagnosing the 2026-08-04 six-drop turn meant replaying the
  // live API by hand, because the record said only "this field was dropped" — and the drop
  // record may not carry the value itself. A reason costs nothing and leaks nothing.
  const tokens = s.match(/-?\d+(?:[.,]\d+)*/g)
  if (!tokens) return { ok: false, why: 'not_a_value' }
  if (tokens.length > 1) return { ok: false, why: 'multiple_numbers' }

  const n = numericOf(s)
  if (n === null || !index.numericValues.has(n)) return { ok: false, why: 'number_not_in_row' }

  // The number is real. Whatever else is in the string has to be real too.
  const rest = s
    .replace(/-?\d+(?:[.,]\d+)*/g, ' ')
    .replace(/[$¥€£%,、｜|()（）]/g, ' ')
    .trim()
  if (rest === '' || index.values.has(rest)) return { ok: true }
  return { ok: false, why: 'residue_not_a_value' }
}

/**
 * WHAT WAS REJECTED — enough to diagnose, never enough to leak.
 *
 * The drop record used to carry the field and the reason and NOT the value, so twice this
 * week the honest answer to "did she invent it or write a variant?" was "I cannot tell you".
 * A record that cannot explain its own rejection is not a record.
 *
 * THE VALUE IS CARRIED ONLY WHEN IT IS A SHORT, SPACELESS TOKEN — kg, 公斤, 30.000, a
 * status word. That is the case where knowing the exact string is the whole diagnosis.
 * Anything longer, anything with a space, and anything shaped like an address, a URL or a
 * path is described by SHAPE and LENGTH only: a field value can be third-party content —
 * an event description, a mail subject — and this log is not a place that content may
 * reach. The limit is stated rather than implied: a short token could still be a name, and
 * 12 characters is the smallest window that answers the question it exists to answer.
 */
const MAX_DROP_VALUE_CHARS = 12
const UNSAFE_VALUE_RE = /[@\s]|https?:|[\\/]{1,2}[A-Za-z0-9_.-]+[\\/]|^[A-Za-z]:\\/

/**
 * HOW CLOSE A REJECTED VALUE WAS TO SOMETHING THE EVIDENCE ACTUALLY HELD.
 *
 * Three rounds running, the drop record answered 「was this a paraphrase or an
 * invention?」 with 「withheld at 13 characters」 — and the long values are precisely the
 * ones a question is usually about. The rule that withholds them is right and stays.
 *
 * So the COMPARISON happens here, on the server, on the full value, and only the RESULT
 * leaves. A score is not content: it cannot carry an email address, a URL or a third
 * party&apos;s sentence, so the 12-character limit has nothing to bite on.
 *
 * Dice coefficient over character bigrams — no dependency, and it works on CJK, where
 * there are no word boundaries to tokenise on.
 *
 *   提供保險資訊 vs 需要提供保險資料  → 0.67  paraphrase  (one character apart)
 *   請帶同轉介信及診金               → 0.00  unrelated   (nothing in evidence)
 *
 * THIS DOES NOT ADMIT ANYTHING. matchValue stays exact equality on normalised forms;
 * a score of 0.99 is still a drop. It only lets the log say which kind of wrong it was.
 */
const NEAR_PARAPHRASE = 0.6
const NEAR_PARTIAL = 0.25
const NEAR_MAX_CHARS = 200 // bounded: a score is cheap, but not at any length
const NEAR_MAX_VALUES = 400

function bigramsOf (s) {
  const norm = String(s).toLowerCase().replace(/\s+/g, '')
  const out = new Map()
  for (let i = 0; i + 1 < norm.length; i++) {
    const g = norm.slice(i, i + 2)
    out.set(g, (out.get(g) || 0) + 1)
  }
  return out
}

function dice (a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  let na = 0
  let nb = 0
  for (const n of a.values()) na += n
  for (const [g, n] of b) { nb += n; const m = a.get(g); if (m) shared += Math.min(m, n) }
  return (2 * shared) / (na + nb)
}

function nearnessOf (raw, index) {
  const v = raw === undefined || raw === null ? '' : String(raw).slice(0, NEAR_MAX_CHARS)
  const empty = { score: 0, nearness: 'unrelated' }
  if (v.trim() === '' || !index || !index.values || typeof index.values[Symbol.iterator] !== 'function') return empty
  const mine = bigramsOf(v)
  if (mine.size === 0) return empty
  let best = 0
  let seen = 0
  for (const candidate of index.values) {
    if (++seen > NEAR_MAX_VALUES) break
    const s = dice(mine, bigramsOf(String(candidate).slice(0, NEAR_MAX_CHARS)))
    if (s > best) best = s
    if (best >= 0.999) break
  }
  const score = Math.round(best * 100) / 100
  return {
    score,
    nearness: score >= NEAR_PARAPHRASE ? 'paraphrase' : score >= NEAR_PARTIAL ? 'partial' : 'unrelated'
  }
}

function describeValue (raw, index) {
  const v = raw === undefined || raw === null ? '' : String(raw)
  const out = { shape: 'text', length: v.length }
  if (v.trim() === '') { out.shape = 'empty'; return out }
  if (dateKeyOf(v)) out.shape = 'date'
  else if (/^-?\d+(?:[.,]\d+)*$/.test(v.trim())) out.shape = 'number'
  else if (v.length <= MAX_DROP_VALUE_CHARS && !/\s/.test(v)) out.shape = 'short_token'
  // Carried ONLY when short, spaceless and not address/URL/path shaped.
  if (v.length <= MAX_DROP_VALUE_CHARS && !UNSAFE_VALUE_RE.test(v)) out.value = v
  // The score travels WHETHER OR NOT the value did — that is the whole point of it.
  if (index) Object.assign(out, nearnessOf(v, index))
  return out
}

/** The boolean form. The rule is unchanged; matchValue just also says why not. */
function valueMatches (raw, index) { return matchValue(raw, index).ok === true }

/**
 * WHICH ROW FIELD A MODEL-WRITTEN FACT LABEL REFERS TO.
 *
 * The EvidenceSet already carries the metric labels — currentStock=現有存量,
 * parLevel=安全存量 — and the SCOPE block puts them in the prompt, which is exactly where
 * the model got its field names on the live turn. So a label can be resolved back to the
 * field it names, per source, with no guessing.
 */
/**
 * label -> { minus: [fieldA, fieldB] } per source, from what each read DECLARED.
 * Same shape and same discipline as metricLabelMap: opt-in per source, never inferred.
 */
/**
 * Owner-facing names for columns that are not metrics, per source.
 * Keyed by BOTH the raw column name and the declared label, so whichever she writes is
 * recognised and the rendered one is always the Owner-facing form.
 */
function fieldLabelMap (evidenceSets = []) {
  const out = new Map()
  for (const e of evidenceSets) {
    if (!e || !e.source || typeof e.fieldLabels !== 'object' || !e.fieldLabels) continue
    const m = new Map()
    for (const [column, spec] of Object.entries(e.fieldLabels)) {
      if (!spec || typeof spec.label !== 'string') continue
      const entry = { column, label: spec.label, values: spec.values || {} }
      m.set(column, entry)
      m.set(spec.label, entry)
      for (const alias of (Array.isArray(spec.aliases) ? spec.aliases : [])) m.set(String(alias), entry)
    }
    out.set(e.source, m)
  }
  return out
}

function derivationMap (evidenceSets = []) {
  const out = new Map()
  for (const e of evidenceSets) {
    if (!e || !e.source || typeof e.derivations !== 'object' || !e.derivations) continue
    const m = new Map()
    for (const [label, spec] of Object.entries(e.derivations)) {
      if (spec && Array.isArray(spec.minus) && spec.minus.length === 2) m.set(label, spec)
    }
    out.set(e.source, m)
  }
  return out
}

/**
 * THE SERVER DOES THE ARITHMETIC. Both inputs must be present on THIS row and both must
 * be numbers; anything else returns null and the fact drops as before. Nothing is rounded
 * or reformatted beyond removing trailing zeros — the result is a real subtraction of two
 * measured values, not an approximation of one.
 */
function computeDerivation (spec, row) {
  const f = (row && row.fields) || {}
  const a = numericOf(f[spec.minus[0]])
  const b = numericOf(f[spec.minus[1]])
  if (a === null || b === null) return null
  const v = a - b
  return Number.isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : null
}

function metricLabelMap (evidenceSets = []) {
  const bySource = new Map()
  for (const e of evidenceSets) {
    if (!e || !e.source || !e.metrics || typeof e.metrics !== 'object') continue
    const m = bySource.get(e.source) || new Map()
    for (const [field, meta] of Object.entries(e.metrics)) {
      const label = meta && meta.label
      if (typeof label === 'string' && label) m.set(label, field)
    }
    bySource.set(e.source, m)
  }
  return bySource
}

/** Translate a status-looking value; leave anything else alone. */
function translate (value) {
  const raw = String(value)
  // The tables hold thunks now — see the ⛔ note at each. Calling them here keeps every
  // catalogue key a literal at its own call site (HR-48).
  if (Object.prototype.hasOwnProperty.call(STATUS_LABELS, raw)) return STATUS_LABELS[raw]()
  // Units join statuses on the same terms: a declared table, applied by the server.
  if (Object.prototype.hasOwnProperty.call(UNIT_LABELS, raw)) return UNIT_LABELS[raw]()
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
/**
 * A CLOCK TIME, NORMALISED to HH:MM — or null.
 *
 * 下午 4 時 · 下午4點 · 16:00 · 4pm. Where the meridiem is absent BOTH readings are returned,
 * because 「4 時」 in a sentence about an afternoon appointment is not a claim about 04:00
 * and refusing it would delete a correct statement. Each candidate is still compared by
 * exact equality against a time the evidence actually holds.
 */
/**
 * ⛔ MATCHING TOKENS — NEVER TRANSLATED, NEVER EXTRACTED.
 *
 * These are compared against WHAT HE TYPES. Moving them to the catalogue would delete a parser
 * with no code removed and nothing reported: 「下午三點」 would simply stop being understood.
 * See governance/textClasses.js, class MATCHING.
 */
const MERIDIEM = { 上午: 'am', 早上: 'am', 凌晨: 'am', 中午: 'pm', 下午: 'pm', 晚上: 'pm', 夜晚: 'pm', am: 'am', pm: 'pm' }
const TIME_RE = /(上午|早上|凌晨|中午|下午|晚上|夜晚)?\s*(\d{1,2})\s*(?:[:：]\s*(\d{1,2})|\s*[時点點]\s*(?:(\d{1,2})\s*分)?)\s*(am|pm)?/gi

function timeKeysOf (h, m, mer) {
  const out = new Set()
  const mm = String(m || 0).padStart(2, '0')
  const add = (hh) => { if (hh >= 0 && hh <= 23) out.add(String(hh).padStart(2, '0') + ':' + mm) }
  if (mer === 'pm') add(h === 12 ? 12 : h + 12)
  else if (mer === 'am') add(h === 12 ? 0 : h)
  else { add(h); if (h < 12) add(h + 12) } // no meridiem: both readings
  return out
}

/** Every clock time an evidence value states, as HH:MM. */
function timeKeysIn (value) {
  const out = new Set()
  const iso = /(?:^|[T\s])(\d{1,2}):(\d{2})/.exec(String(value))
  if (iso) out.add(String(Number(iso[1])).padStart(2, '0') + ':' + iso[2])
  return out
}

/**
 * Consume date and time expressions this sentence states that the EVIDENCE also states,
 * so the number rule below never sees their digits.
 *
 * WHY THIS EXISTS. matchValue learned two rounds ago that a date is a date; this checker
 * did not, so the SAME instant passed as a fact and failed in prose — 下午 4 時 against a
 * stored 16:00. Two checkers disagreeing about one instant is the defect the Owner ruled
 * on; it does not get a second life in the prose channel.
 *
 * Only a MATCHING expression is consumed. A different time or a different day keeps its
 * digits and fails exactly as before.
 */
function consumeVerifiedMoments (sentence, index) {
  let s = String(sentence)

  // full dates: 2026-08-11 · 2026/08/11 · 2026年8月11日
  s = s.replace(/(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/g, (m, y, mo, d) => {
    const key = `${y}-${String(Number(mo)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`
    return index.dateKeys.has(key) ? ' ' : m
  })

  // month-day without a year: 8 月 11 日. Matched against the month-day of a date the
  // evidence holds — the year is not invented, it is simply not part of what she wrote.
  s = s.replace(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, (m, mo, d) => {
    const md = `${String(Number(mo)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`
    return index.monthDayKeys.has(md) ? ' ' : m
  })

  // clock times
  s = s.replace(TIME_RE, (m, mer, h, min1, min2, ampm) => {
    const hour = Number(h)
    if (!Number.isFinite(hour)) return m
    const minute = Number(min1 !== undefined ? min1 : (min2 !== undefined ? min2 : 0))
    const key = MERIDIEM[(mer || ampm || '').toLowerCase()] || MERIDIEM[mer] || null
    for (const k of timeKeysOf(hour, minute, key)) if (index.timeKeys.has(k)) return ' '
    return m
  })

  return s
}

const CJK_COUNT_RE = /([零〇一二兩三四五六七八九十百千萬]+)([項張封份件次條間位樣款種批個])/g

/**
 * Does every number in this sentence exist in the evidence?
 *
 * BOTH SPELLINGS. This used to match /\d+/ only, so 「系統讀到三項倉存記錄」 contained no
 * digit, had nothing to check, and passed vacuously against a real total of 199 — while the
 * test that claimed to pin the behaviour asserted the ASCII form. Cantonese writes counts in
 * Chinese numerals by default; checking only the exception is checking nothing.
 */
/**
 * ⛔ ONE NUMERIC-TOKEN GRAMMAR, USED BY BOTH THE VALIDATOR AND THE CONSUMER.
 *
 * These two must agree about where a number starts and ends, or the consumer can eat a PREFIX
 * of a token the validator would have read whole — which is exactly how `70.5` became `.5`.
 * Declared once so they cannot drift apart. (`.replace()` and `.match()` both reset `lastIndex`
 * on a /g regex, so sharing this object is safe.)
 */
const NUMERIC_TOKEN_RE = /\d+(?:[.,]\d+)*/g

/**
 * ⛔ THE CONSUMER READS THE SIGN; THE VALIDATOR DELIBERATELY DOES NOT.
 *
 * `NUMERIC_TOKEN_RE` has no sign, so against a server value of 70 the prose 「缺口 -70」 was
 * tokenised as `70`, consumed, and left a bare `-` — a figure of the OPPOSITE sign validated
 * as true. The consumer therefore matches the sign as part of the token and compares the whole
 * signed token, so `-70` is simply not equal to `70` and nothing is consumed.
 *
 * ⛔ AND THE VALIDATOR'S GRAMMAR IS NOT TOUCHED. Widening the shared constant would change
 * RAW number grounding for every sentence in the system — prose 「-70」 against a row carrying
 * 70 currently passes, and altering that is a different decision from this one. Only what may
 * be CONSUMED as a declared derivation is tightened here.
 */
const SIGNED_TOKEN_RE = /-?\d+(?:[.,]\d+)*/g

/**
 * ⛔ CONSUME A DECLARED DERIVATION, AND ONLY WHERE ALL THREE PARTS ARE PRESENT.
 *
 * Mirrors `consumeVerifiedMoments`: a value the server itself computed is removed from the
 * sentence BEFORE the raw-digit rule can reject it. Three conditions, all structural:
 *
 *   1. the ROW is named in this sentence  — its own retrieved title
 *   2. the declared LABEL is in this sentence — 「缺口」, from the evidence descriptor
 *   3. the numeral EQUALS that row's server-computed value
 *
 * Any one missing and nothing is consumed, so the ordinary rejection still applies. A wrong
 * figure (69 against a computed 70) is not removed and fails as before; an undeclared label
 * has no spec and never reaches here; a row that was not retrieved is not in `byId`.
 *
 * ⛔ WHAT THIS DOES NOT DO. It does not parse the sentence's grammar, so a sentence naming two
 * rows and attributing one's figure to the other is not caught here — the same limit
 * `presentedOrder` carries, and the same reason: guessing at attribution inside prose is not
 * something this layer can do honestly.
 */
function applyDerivations (sentence, index) {
  const list = (index && Array.isArray(index.derived)) ? index.derived : []
  if (list.length === 0) return { text: sentence, refuse: null, labelSeen: false, bound: false }

  /**
   * ⛔ BLOCKER 1 — CO-OCCURRENCE IS NOT ATTRIBUTION, AND FAILING CLOSED IS THE ONLY HONEST
   * ANSWER AVAILABLE HERE.
   *
   * The first cut asked only `sentence.includes(title) && sentence.includes(label)`. So
   * 「Napa Cabbage 同 Jars for Red Chili Oil 都缺貨，Jars 缺口 70。」 consumed Napa's 70 while
   * the sentence attributed it to Jars — a false figure validated as true.
   *
   * ⛔ THERE IS NO STRUCTURAL BINDING TO USE. Section items carry `sourceId`, so a fact is
   * tied to a row by reference; PROSE carries no refs at all — `proseIsGrounded` only tests
   * token membership. Deciding which of two named rows a number belongs to would mean parsing
   * grammar, which is guessing, and guessing is what this whole layer exists to avoid.
   *
   * So: exactly ONE retrieved row title in the sentence, or nothing is consumed. Two titles is
   * ambiguous and the derived number falls through to the ordinary rejection. Zero titles has
   * nothing to bind to. Neither is a silent pass — both end in the normal `number_not_in_evidence`.
   */
  /**
   * ⛔ ONE TITLE IS NOT ONE ROW. The first version counted distinct TITLE STRINGS, but `byId`
   * permits two distinct canonical rows to carry the same title — two `Napa Cabbage` rows
   * collapse to one string, and either row's derived value could then be authorised. Evidence
   * identity everywhere else in this file keys on `readKey#sourceId`; this now does too, and
   * a duplicate title fails closed rather than picking first, last, or by source.
   */
  const named = list.filter((d) => sentence.includes(d.title))
  const rows = new Set(named.map((d) => d.canonical))

  /**
   * ⛔ BLOCKER 5 — A DECLARED LABEL WITH A NUMBER IS A CLAIM, AND IT MUST BE ANSWERED HERE.
   *
   * The consumer only ever REMOVED matching tokens. A non-matching one simply fell through to
   * the generic raw check — so a true number from an unrelated field could launder a false
   * shortfall:
   *
   *     row: parLevel 100, currentStock 30, pack 69   declared 缺口 = 70
   *     prose: 「Napa Cabbage 缺口 69。」
   *     70 ≠ 69 so nothing was consumed → 69 IS a raw value on the row → whole sentence PASSED
   *
   * ⛔ AND MY OWN 「缺口 69」 TEST HAD NOT PROVEN OTHERWISE. It only held because that fixture
   * carried no other 69. The Owner found this in review.
   *
   * > **Owner ruling: once prose structurally makes a numeric claim under a declared derivation
   * > label, that numeral must be validated against that derivation. It may not fall through
   * > and borrow an unrelated raw field.**
   *
   * ── THE BINDING, AS NARROW AS IT CAN BE ──────────────────────────────────
   * For each declared label present, the claim is the FIRST signed numeric token appearing
   * AFTER that label. Adjacency, not grammar. A label with no number after it is not a numeric
   * claim and binds nothing.
   *
   * ⛔ WHAT IT WILL STILL MISS: a number written BEFORE its label (「69 係缺口」), and which of
   * several labels a number belongs to when they interleave. Both would need sentence
   * structure, which this layer does not read. Those cases bind nothing and fall through to
   * the ordinary raw rule exactly as before — no worse than today, and never laundered as a
   * verified derivation.
   */
  const labels = new Set(list.map((d) => d.label))
  // Identifier-level only: WHETHER a declared label appeared, never which one.
  const labelSeen = [...labels].some((l) => sentence.includes(l))
  const claims = []
  for (const label of labels) {
    const at = sentence.indexOf(label)
    if (at < 0) continue
    const m = sentence.slice(at + label.length).match(/-?\d+(?:[.,]\d+)*/)
    if (m) claims.push({ label, token: m[0].replace(/,/g, '') })
  }

  // No declared label carries a number: nothing is claimed under a derivation, nothing to check.
  if (claims.length === 0) return { text: sentence, refuse: null, labelSeen, bound: false }

  // ⛔ A CLAIM WE CANNOT VALIDATE IS REFUSED, NOT WAVED THROUGH. Zero or several candidate rows
  // means no server value exists to compare against — and falling through would re-open the
  // very laundering this rule closes.
  if (rows.size !== 1) return { text: sentence, refuse: GROUNDING_SHAPE.DERIVED_NO_ONE_ROW, labelSeen, bound: false }

  const expected = new Map(named.map((d) => [d.label, String(d.value)]))
  for (const c of claims) {
    if (expected.get(c.label) !== c.token) return { text: sentence, refuse: GROUNDING_SHAPE.DERIVED_WRONG_VALUE, labelSeen, bound: false }
  }

  const values = new Set(
    named.filter((d) => sentence.includes(d.label)).map((d) => String(d.value))
  )
  if (values.size === 0) return { text: sentence, refuse: null, labelSeen, bound: false }

  /**
   * ⛔ BLOCKER 2 — A WHOLE NUMERIC TOKEN, NEVER A PREFIX.
   *
   * `(?<!\d)70(?!\d)` stopped digits but not a decimal point or a comma. Against a server
   * value of 70, 「缺口 70.5」 had its `70` eaten and left `.5` behind — and Napa's raw
   * evidence carries a `5`, so the remainder could pass the generic raw check. A wrong figure
   * would have been validated as true.
   *
   * The tokens are cut with the SAME grammar the prose validator itself uses, and the WHOLE
   * token is compared. `70.5` and `70,000` are single tokens that are not equal to `70`, so
   * neither is consumed and both are rejected downstream as before.
   */
  // Every claim matched the server's own arithmetic and is consumed below: a derivation
  // genuinely BOUND on this sentence, which is a different fact from a label merely appearing.
  return { text: sentence.replace(SIGNED_TOKEN_RE, (tok) => values.has(tok.replace(/,/g, '')) ? ' ' : tok), refuse: null, labelSeen, bound: true }
}

/**
 * ⛔ WHICH NUMERIC FAILURE, WITHOUT SAYING WHICH NUMBER.
 *
 * MEASURED, requestId 01b900ee-9c7f-4753-b241-d2fb1912430a on bootCommit dfd556b: the derived
 * repair shipped and `number_not_in_evidence` was STILL first in the drop array. The
 * live-shaped test had scripted one very clean sentence — 「Napa Cabbage … 缺口 70。」 — and so
 * proved that the canonical SHAPE passes, not that the model writes it.
 *
 * Every distinct failure inside this check has always collapsed to one word, so the log cannot
 * say which. ⛔ AND IT MUST NOT BE GUESSED: a percentage, two rows in one sentence, a label
 * that did not match, a numeral written before its label, or an ordinary unsupported number
 * are five different repairs, and a plausible inference has been wrong six times this week.
 *
 * ⛔ NAMES ARE ≤ 20 CHARACTERS ON PURPOSE. They ride on `shape`, which the drop serializer
 * already ships and already truncates at 20 (`String(d.shape).slice(0, 20)`). A longer name
 * would be silently cut, and two cut names could collide — a log that quietly renames its own
 * enum is worse than no log.
 */
const GROUNDING_SHAPE = Object.freeze({
  /** A declared label bound a numeral, and it disagreed with the server's arithmetic. */
  DERIVED_WRONG_VALUE: 'derived_wrong_value',
  /** A declared label bound a numeral, but no single canonical row could validate it. */
  DERIVED_NO_ONE_ROW: 'derived_no_one_row',
  /** Declared derivations exist for this turn, a label appears, but nothing bound to it. */
  DERIVED_UNBOUND: 'derived_unbound',
  /** An ordinary numeral that is in no retrieved row. No derivation involved. */
  RAW_UNSUPPORTED: 'raw_unsupported',
  /** A CJK-written count that is in no retrieved row. */
  CJK_UNSUPPORTED: 'cjk_unsupported'
})

/**
 * The numeric check, with the failure SHAPE reported. Pure; decides nothing new.
 * @returns {{ok: boolean, shape: string|null}}
 */
function checkSentenceNumbers (sentence, index) {
  // Dates and times the evidence agrees with are consumed BEFORE the digit rule sees them.
  // Declared derivations likewise — the server computed them, so they are evidence.
  // ⛔ A refusal here means a declared-derivation claim contradicted the server's arithmetic,
  // or could not be validated at all. It must NOT fall through to the raw rule, where an
  // unrelated field could launder it.
  const moments = consumeVerifiedMoments(sentence, index)
  const applied = applyDerivations(moments, index)
  if (applied.refuse) return { ok: false, shape: applied.refuse }
  const s = applied.text

  const nums = s.match(NUMERIC_TOKEN_RE) || []
  if (!nums.every((n) => index.numbers.has(n.replace(/,/g, '')))) {
    /**
     * ⛔ A LABEL WAS PRESENT AND NOTHING BOUND TO IT. That is a different problem from a
     * stray unsupported number — it is the numeral-before-its-label and interleaved-label
     * shapes, which are the two limits left open by decision. Distinguished here so the next
     * decision rests on a count, not on my guess about which one production hits.
     */
    const unbound = applied.labelSeen && !applied.bound
    return { ok: false, shape: unbound ? GROUNDING_SHAPE.DERIVED_UNBOUND : GROUNDING_SHAPE.RAW_UNSUPPORTED }
  }

  for (const m of s.matchAll(CJK_COUNT_RE)) {
    if (m[2] === '個' && m[1] === '一') continue // 「一個」 is a classifier, not a count
    const n = cjkToNumber(m[1])
    if (n === null) continue
    if (!index.numbers.has(String(n))) return { ok: false, shape: GROUNDING_SHAPE.CJK_UNSUPPORTED }
  }
  return { ok: true, shape: null }
}

function sentenceIsSupported (sentence, index) {
  return checkSentenceNumbers(sentence, index).ok
}

const splitSentences = (text) => String(text).split(/(?<=[。！？!?])\s*|\n+/).map((s) => s.trim()).filter(Boolean)

/**
 * ⛔ WHY A `directAnswer` SENTENCE WAS REMOVED. A CLOSED ENUM, AND NOTHING ELSE.
 *
 * Four different removers used to share one counter and record nothing, so a turn that lost
 * its conclusion looked identical whichever one killed it. These names say WHY without ever
 * saying WHAT — the same discipline the fact drops already follow.
 */
const SENTENCE_DROP = Object.freeze({
  /** A number in the sentence is not in any retrieved row. */
  NUMBER_NOT_IN_EVIDENCE: 'number_not_in_evidence',
  /** The sentence talked about the machinery rather than the business. */
  TELEMETRY: 'telemetry',
  /** A name this turn did not retrieve — recall is not evidence. */
  NAME_NOT_IN_EVIDENCE: 'name_not_in_evidence',
  /** Rule 7: a plan that cites nothing may not name rows. */
  ROW_NAME_NOT_CITED: 'row_name_not_cited'
})

/**
 * VALIDATE. Returns the plan with unsupported material removed, plus what was dropped.
 * Nothing here rewrites meaning: a claim is kept as written or removed entirely.
 */
const EMPTY_LABELS = new Map()

function validatePlan (plan, { evidenceSets = [], itemsBySource = [], message = '' } = {}) {
  const index = evidenceIndex(evidenceSets, itemsBySource)
  const metrics = metricLabelMap(evidenceSets)
  const derivations = derivationMap(evidenceSets)
  const fieldLabels = fieldLabelMap(evidenceSets)

  // ── THE DECLARATION ──────────────────────────────────────────────────────────
  // Absent is treated as TRUE, so a provider that ignores the field behaves exactly as it
  // did before this change: sections are validated, not silently discarded.
  const citesEvidence = plan.citesEvidence !== false

  // RULE 7 AND THE OWNER'S CARVE-OUT. When the answer does not cite evidence, it may not
  // name a retrieved row either — otherwise "no sections" becomes the new hiding place for
  // the detail that sections exist to verify. But a title the OWNER HIMSELF TYPED is not
  // laundering: he already knows the name, and deleting her sentence for echoing his own
  // words would make 「Napa Cabbage 點解咁少?」 unanswerable. So only titles that appear
  // SOLELY in the retrieved rows are barred.
  const askedText = String(message == null ? '' : message)
  const barredTitles = citesEvidence
    ? []
    : [...index.byId.values()]
        .map((r) => String(r && r.title ? r.title : ''))
        .filter((t) => t.length >= 3 && !askedText.includes(t))
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

  /**
   * ── directAnswer: sentence by sentence ────────────────────────────────────
   *
   * ⛔ WHY EACH REMOVER NOW NAMES ITSELF. Diagnosing the 2026-08-13 turns (bootCommit
   * 5dfb8fd, requestIds 264e6934 / c55f0c37 / 5f703ed0) established that the model DID write
   * a `directAnswer` and it did not survive — but not WHICH of these four removed it, because
   * all four incremented the same counter and recorded nothing else. Those two possibilities
   * have completely different repairs, so the record has to tell them apart.
   *
   * ⛔ IDENTIFIER ONLY. `why` is a closed enum from SENTENCE_DROP; the sentence itself is
   * never pushed, and `kind: 'sentence'` carries no sourceId because a sentence has none.
   * `droppedSentences` is incremented exactly where it was before — this adds a record beside
   * the counter, it does not change the counting.
   */
  // ⛔ `shape` already ships in the drop serializer and is already an enum field, so the
  // detail rides there rather than widening the whitelist. `why` is unchanged for
  // compatibility — every numeric failure still reports `number_not_in_evidence` at the top
  // level, and `shape` says WHICH failure it was.
  const dropSentence = (why, shape) => { droppedSentences++; drops.push(shape ? { kind: 'sentence', why, shape } : { kind: 'sentence', why }) }
  const kept = []
  for (const raw of splitSentences(plan.directAnswer || '')) {
    // Relabel FIRST, so the check runs on the text the Owner will actually read.
    const s = relabel(raw)
    const numeric = checkSentenceNumbers(s, index)
    if (!numeric.ok) { dropSentence(SENTENCE_DROP.NUMBER_NOT_IN_EVIDENCE, numeric.shape); continue }
    if (TELEMETRY_RE.test(s)) { dropSentence(SENTENCE_DROP.TELEMETRY); continue }
    // RECALL IS NOT EVIDENCE. A name this turn did not retrieve does not reach the Owner,
    // whatever the model believes it remembers.
    if (!proseIsGrounded(s, index)) { dropSentence(SENTENCE_DROP.NAME_NOT_IN_EVIDENCE); continue }
    // RULE 7: not citing evidence means not naming rows — unless the Owner named it first.
    if (barredTitles.some((t) => s.includes(t))) { dropSentence(SENTENCE_DROP.ROW_NAME_NOT_CITED); continue }
    kept.push(s)
  }
  let directAnswer = kept.join('').slice(0, LIMITS.maxDirectAnswerChars)

  // ── sections: an item must be a row we actually retrieved ───────────────────
  // THE DECLARATION GOVERNS. A plan that said it cites nothing does not get to render rows
  // anyway: the sections are discarded whole and the contradiction is reported, rather than
  // quietly honouring whichever half of the plan happens to be more convenient.
  const sections = []
  /** Raw declarations, index-aligned with `sections`. Validated in rankingProof, not here. */
  const sectionClaims = []
  /** The leak-guard verdict, taken BEFORE the heading is blanked. A boolean, never text. */
  const sectionLooks = []
  /** Items the resolver rejected, per section — the signal a ranking claim was narrowed. */
  const sectionItemDrops = []
  const declaredSections = Array.isArray(plan.sections) ? plan.sections : []

  /**
   * ⛔ DECLARATION TELEMETRY IS MEASURED AT ITS SOURCE, NOT AS A BY-PRODUCT OF RENDERING.
   *
   * These three counts were taken inside the render loop below, which iterates
   * `(sectionsNotDeclared ? [] : declaredSections).slice(0, LIMITS.maxSections)`. So a ranking
   * section removed by the render cap, or by the `citesEvidence` contradiction, was never scanned
   * and was reported as though the model had never written it:
   *
   *     four ordinary sections then a fifth headed 「頭四項缺貨」, undeclared -> looksRanking 0, missing 0
   *     `citesEvidence: false` with a ranking section present            -> the loop is empty -> 0/0/0
   *
   * ⛔ THE OWNER-FACING OUTPUT WAS NEVER AT RISK — those sections do not ship. The NUMBER was, and
   * in the dangerous direction: `missing` is the only way to tell whether the model has learnt to
   * declare `rankingClaim` or whether safety is being bought by refusing every ranking it writes.
   * A falsely healthy rate would let a provider canary pass over a dead feature.
   *
   * So it is counted from the RAW model sections: before the contradiction handling, before the
   * section cap, before item resolution, before the item cap. What the model wrote is the subject;
   * what survived rendering is a different question, and `rankingGate` is where that one is asked.
   *
   * ⛔ RECORDED, NOT FIXED HERE — a known gap between the two. When every item of a declared
   * ranking section fails to resolve, the section is never pushed, so `declared` counts it while
   * `rankingGate` stays empty: `declared: 1` with no verdict. Zero items means the section cannot
   * ship, so this is observability debt rather than an escape, and closing it would mean widening
   * the ranking architecture. Left visible on purpose.
   */
  let looksRankingCount = 0
  let declaredCount = 0
  let missingDeclarationCount = 0
  for (const sec of declaredSections) {
    const declares = sec && sec.rankingClaim !== null && sec.rankingClaim !== undefined
    const looks = looksLikeRankingHeading(sec ? sec.heading : '')
    if (looks) looksRankingCount++
    if (declares) declaredCount++
    if (looks && !declares) missingDeclarationCount++
  }
  const sectionsNotDeclared = !citesEvidence && declaredSections.length > 0
  for (const sec of (sectionsNotDeclared ? [] : declaredSections).slice(0, LIMITS.maxSections)) {
    const items = []
    let unresolvedItems = 0
    /**
     * ⛔ THE CAP IS THE SECOND WAY A DECLARED ITEM DISAPPEARS BEFORE THE GATE.
     *
     * `unresolvedItems` closed one route — an id naming no retrieved row. This closes the
     * other, and it is quieter: `slice` cuts BEFORE the resolver runs, so the sixth item of a
     * six-item ranking is never rejected, never counted, never anywhere. A declared `ordering`
     * of A B C D E F became a validated ranking of A B C D E and PASSED.
     *
     * So the invariant is not 「an item failed to resolve」: it is that ANY declared ranking item
     * missing from what the gate judges fails the whole claim closed.
     */
    const declaredItems = Array.isArray(sec.items) ? sec.items : []
    const overCapItems = Math.max(0, declaredItems.length - LIMITS.maxItemsPerSection)
    for (const it of declaredItems.slice(0, LIMITS.maxItemsPerSection)) {
      modelItemCount++
      const sourceId = String(it.sourceId)
      const row = resolveRowRef(index, sourceId)
      if (!row) { // an item that was never retrieved is an invention
        // ⛔ AND FOR A RANKING SECTION IT IS ALSO A NARROWED CLAIM — counted, not just dropped.
        unresolvedItems++
        droppedItems++
        drops.push({ kind: 'item', sourceId: sourceId.slice(0, LIMITS.maxDropIdChars) })
        continue
      }
      const facts = []
      const labels = metrics.get(row.source) || EMPTY_LABELS
      // TWO ALLOWANCES, COUNTED SEPARATELY. The ordinary cap is unchanged; a declared
      // derivation is taken from its own budget so it can never be squeezed out by a
      // field she happened to list first.
      const derivMap = derivations.get(row.source) || EMPTY_LABELS
      let ordinaryUsed = 0
      let derivedUsed = 0
      for (const f of (Array.isArray(it.facts) ? it.facts : [])) {
        const isDerived = derivMap.has(String(f.field))
        if (isDerived) { if (derivedUsed >= LIMITS.maxDerivationsPerItem) continue; derivedUsed++ } else { if (ordinaryUsed >= LIMITS.maxFactsPerItem) continue; ordinaryUsed++ }
        const field = String(f.field)

        // ── A QUANTITY IS THE SERVER'S, NOT THE MODEL'S ─────────────────────────
        // The title already works this way and a number deserves it more: it is the fact
        // most likely to be re-typed, and re-typing is what this pipeline exists to stop.
        // When the model names a known metric, the value is looked up in the ROW — so a
        // mistyped or wrong number is CORRECTED rather than deleted, and the Owner keeps
        // the most useful thing on the screen. On 2026-08-04 six quantities were dropped
        // for exactly this and he was left with three category labels.
        //
        // A label is NOT permission to produce a number: if the row does not carry that
        // field, this falls through and the fact is checked (and dropped) as before.
        // ── A DECLARED COLUMN GETS ITS OWNER-FACING NAME AND VALUE ─────────────
        // 「來源 drive」 was a TRUE fact rendered in the row's own vocabulary. The label is
        // normalised and the code is rendered through a declared table, exactly as units
        // and statuses already are. An undeclared code renders as itself.
        const fl = (fieldLabels.get(row.source) || EMPTY_LABELS).get(field)
        if (fl) {
          const raw = row.fields ? row.fields[fl.column] : undefined
          if (raw !== undefined && raw !== null && raw !== '') {
            const shown = fl.values[String(raw)] || String(raw)
            const wrote = String(f.value)
            if (wrote === String(raw) || wrote === shown) {
              facts.push({ field: fl.label, value: shown })
              continue
            }
          }
        }

        // ── A DECLARED DERIVATION IS THE SERVER'S TOO ──────────────────────────
        // Checked BEFORE the metric lookup: she names 缺口, the server subtracts the two
        // declared fields on this row, and whatever number she wrote is discarded. An
        // undeclared label falls through and is checked (and dropped) exactly as before.
        const derived = (derivations.get(row.source) || EMPTY_LABELS).get(field)
        if (derived) {
          const value = computeDerivation(derived, row)
          if (value !== null) { facts.push({ field, value }); continue }
        }
        const metricField = labels.get(field)
        if (metricField !== undefined && row.fields && row.fields[metricField] !== undefined && row.fields[metricField] !== null && row.fields[metricField] !== '') {
          facts.push({ field, value: translate(row.fields[metricField]) })
          continue
        }

        // Everything else: unchanged. Verbatim, the translation of one, or the same
        // quantity written differently — never a substring, never fuzzy.
        const m = matchValue(f.value, index)
        if (!m.ok) {
          droppedFacts++
          drops.push(Object.assign({ kind: 'fact', sourceId: sourceId.slice(0, LIMITS.maxDropIdChars), field: field.slice(0, LIMITS.maxDropIdChars), why: m.why }, describeValue(f.value, index)))
          continue
        }
        facts.push({ field, value: translate(f.value) })
      }
      // The title is the server's, not the model's: it cannot be edited into something else.
      /**
       * ⛔ THE RESOLVED IDENTITY TRAVELS WITH THE ITEM. It was known here and thrown away.
       *
       * `resolveRowRef` has just told us exactly which row this is. Keeping only the model's raw
       * `sourceId` forced the ranking gate to re-derive the identity, and its last resort is a
       * TITLE — so a legitimate citation of daily_count#77 「Napa Cabbage」 was re-read as
       * inventory#1 「Napa Cabbage」 and rode a proof that does not own it.
       *
       * Server-computed, never model-authored, and formatted by `canonicalOf` so there is exactly
       * one definition of what readKey#sourceId means.
       */
      /**
       * ⛔ AND THE OPERATION, CARRIED AS ITS OWN FIELD RATHER THAN PARSED BACK OUT.
       *
       * `canonical` is `readKey#sourceId`, so the operation LOOKS recoverable by splitting it —
       * but `canonicalOf` falls back to `row.source` when a row carries no readKey, and a SOURCE
       * is not an OPERATION. That is the Blocker-8 lesson: `aroma_system` names six different
       * reads. Splitting would hand proof selection a source and call it an operation.
       *
       * So the resolved readKey travels as itself, and `null` when the row has none — 「absent」
       * (a legacy shape) and 「server says none」 are different facts and the gate treats them
       * differently. Server-computed from the RESOLVED ROW; the model's own item is never spread
       * into this object, so a forged `readKey` on it cannot reach here.
       */
      items.push({
        sourceId,
        title: row.title || String(it.title || ''),
        facts,
        canonical: canonicalOf(row),
        readKey: (typeof row.readKey === 'string' && row.readKey) ? row.readKey : null
      })
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
    /**
     * ⛔ THE MODEL'S RANKING HEADING DIES HERE, BEFORE ANY GATE RUNS.
     *
     * Not compared, not corrected, not kept as a fallback. A section that DECLARES a ranking
     * gets its heading from `composeRankingHeading` below once the claim is proven; a section
     * that merely LOOKS like one is about to be refused and takes its heading with it.
     *
     * Blanking here rather than at the allow branch is deliberate: it means no ordering of the
     * gates, and no future bypass of them, can let model-authored ranking prose reach the
     * validated plan, the rendered reply, the log, or anything downstream of them.
     */
    const rawClaim = (sec && sec.rankingClaim !== undefined) ? sec.rankingClaim : null
    const declaresRanking = rawClaim !== null && rawClaim !== undefined
    // ⛔ Recomputed here for THIS section's blanking and gate signal only. The telemetry counts
    // live above, over the raw model sections — this loop never sees the ones it dropped.
    const looksRanking = looksLikeRankingHeading(sec ? sec.heading : '')
    if (declaresRanking || looksRanking) heading = ''
    if (items.length > 0) { sections.push({ heading, items }); sectionClaims.push(rawClaim); sectionLooks.push(looksRanking); sectionItemDrops.push(unresolvedItems + overCapItems) }
  }

  // ── limitations: real ones only, never telemetry ────────────────────────────
  // ── A FILTERED LIMITATION IS COUNTED AND RECORDED ─────────────────────────
  // This filter removed limitations silently: droppedSentences counts directAnswer only,
  // and nothing counted these. Diagnosing 2026-08-05 I could not tell the Owner whether the
  // calendar limitations had been filtered or simply not written — the fifth silent drop
  // this week, and the only one still in place. Same scrubbed record a fact drop carries.
  let droppedLimitations = 0
  const limitations = []
  for (const raw of (Array.isArray(plan.limitations) ? plan.limitations : [])) {
    const l = relabel(String(raw).trim())
    if (!l) continue
    let why = null
    if (TELEMETRY_RE.test(l)) why = 'telemetry'
    else if (!sentenceIsSupported(l, index)) why = 'number_not_in_evidence'
    else if (!proseIsGrounded(l, index)) why = 'name_not_in_evidence'
    if (why) {
      droppedLimitations++
      drops.push(Object.assign({ kind: 'limitation', why }, describeValue(l, index)))
      continue
    }
    if (limitations.length >= LIMITS.maxLimitations) {
      // Over the cap is not a rejection of the sentence, but it is still a removal, so it
      // is counted rather than allowed to vanish.
      droppedLimitations++
      drops.push(Object.assign({ kind: 'limitation', why: 'over_cap' }, describeValue(l, index)))
      continue
    }
    limitations.push(l.slice(0, LIMITS.maxLimitationChars))
  }

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
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ⛔ THE SUPERLATIVE GATE. The machinery below was 「computed and acted on by nothing」;
   * this is the one place a ranking claim is actually consumed before it reaches the Owner.
   *
   * Observed 2026-08-12, bootCommit 0bcdc2f: replies that printed 「最緊急缺貨項目」 and put
   * Jars for Red Chili Oil (shortfall 20) ahead of Napa Cabbage (shortfall 70). Nothing
   * stopped them, because nothing looked.
   *
   * ⛔ IT REORDERS NOTHING AND REWORDS NOTHING. A refused superlative is DROPPED, and the
   * caller renders its deterministic fallback — the same direction every other validator here
   * fails in. Rewriting the model's ranking would be inventing one.
   * ══════════════════════════════════════════════════════════════════════════
   */
  const { verifyRanking, rankingSectionViolations, VERDICT: RANK_VERDICT } = require('./rankingProof')
  /**
   * The rows in PROVEN order, taken from the group whose evidence carries the ranking.
   * ⛔ Only when exactly one ranked group exists. With two, 「which ordering does this
   * sentence report?」 has no structural answer, and guessing is how a gate produces false
   * refusals — the claim and metric checks below still apply, only the order check is skipped.
   */
  const rankedEvidence = (Array.isArray(evidenceSets) ? evidenceSets : [])
    .filter((e) => e && e.trust === 'live' && typeof e.rankingMetric === 'string' && e.rankingMetric)
  /**
   * ⛔ THE PROOF OWNS AN OPERATION, NOT A SOURCE.
   *
   * This selected the group by `g.source === evidence.source`. One `aroma_system` source can
   * carry SEVERAL operations in one turn — the code itself records that only `readKey#sourceId`
   * is canonical identity. So a turn that read invoices and then inventory holds an inventory
   * proof, while `find(g.source === 'aroma_system')` can return the INVOICES group: the
   * inventory proof then validates a section against invoice rows.
   *
   * Commit C fixed identity WITHIN rows. It did not fix WHICH GROUP the proof owns.
   * The readKey of a directed read IS the operation (`aroma_system.inventory`), so the proof's
   * `source` + `endpoint` names the only group it may speak for.
   */
  /**
   * ⛔ USE THE OPERATION IDENTITY THE SYSTEM ALREADY WROTE. DO NOT REBUILD IT.
   *
   * Commit D derived it as `source + "." + endpoint`, which works for inventory only because
   * its endpoint and its operation happen to share a name. Order Planning is the standing
   * counter-example and is already in production: the operation is `aroma_system.replenishment`
   * while the adapter's endpoint is `orderPlanning`. Derivation produced
   * `aroma_system.orderPlanning`, matched nothing, and a real proof was reported as
   * `no_ranking_proof`.
   *
   * `readContext.js:840` attaches the true `readKey` to the evidence and stamps the same value
   * on every row, so the identity is already present and correct. Rebuilding it is a second
   * source of truth that can only drift — and a mapping table would be a third.
   */
  const proofOperation = rankedEvidence.length === 1 && rankedEvidence[0].readKey
    ? String(rankedEvidence[0].readKey)
    : null
  /**
   * ⛔ EXACT OPERATION FIRST, AND A FALLBACK THAT CANNOT REOPEN THE HOLE.
   *
   * `readKey` is the OPERATION for a directed read (`aroma_system.inventory`) but the bare
   * SOURCE for an undirected one — both shapes occur. So an exact operation match is preferred,
   * and a source match is accepted ONLY when that source contributed exactly one group. With
   * two groups under one source there is no fallback, which is precisely the invoices-then-
   * inventory case. This also leaves single-group turns — the directAnswer ranking path included
   * — resolving exactly as before.
   */
  const groups = Array.isArray(itemsBySource) ? itemsBySource : []
  const proofSource = rankedEvidence.length === 1 ? String(rankedEvidence[0].source) : null
  // ⛔ Only a group that carries NO operation information may fall back. A group whose readKey
  // IS operation-shaped and differs from the proof's is a DIFFERENT operation, not a candidate —
  // that is the invoices-only case, and treating it as a match would be the same hole with one
  // group instead of two.
  const sameSource = proofSource
    ? groups.filter((g) => g && String(g.source) === proofSource && String(g.readKey || g.source) === proofSource)
    : []
  /**
   * ⛔ THE PROOF'S OWN readKey IS AUTHORITATIVE. When it is present there is no guessing and no
   * fallback: either a group carries that operation or the proof owns no rows this turn.
   * The same-source fallback exists ONLY for legacy evidence that carries no readKey at all,
   * and even then only when the single candidate group carries no operation of its own.
   */
  const rankedGroup = proofOperation
    ? (groups.find((g) => g && String(g.readKey || g.source) === proofOperation) || null)
    : (rankedEvidence.length === 1 && sameSource.length === 1 ? sameSource[0] : null)
  /**
   * ⛔ NO GROUP FOR THIS PROOF MEANS NO USABLE PROOF. Reporting 1 here would let a claim be
   * judged against rows the proof does not own; reporting 0 is the honest state and makes the
   * gate answer `no_ranking_proof`.
   */
  const usableRankedSources = (rankedEvidence.length === 1 && !rankedGroup) ? 0 : rankedEvidence.length
  const rankingCheck = verifyRanking({
    message,
    directAnswer,
    evidenceSets,
    rankedRows: (rankedGroup && Array.isArray(rankedGroup.items)) ? rankedGroup.items : [],
    claims: plan.answerClaims
  })
  if (!rankingCheck.ok) {
    // IDENTIFIERS ONLY, never the sentence — the same rule the rest of `drops` follows.
    /**
     * ⛔ `why`, NOT `reason` — THE VERDICT WAS BEING COMPUTED AND THROWN AWAY.
     *
     * This pushed `reason: rankingCheck.verdict`, but the drop serializer above whitelists
     * `why` and has never carried `reason`. So the one field that says whether a good answer
     * died for want of a declaration, or was refused on its merits, existed in memory and
     * never reached a log line. Found while diagnosing 264e6934 / c55f0c37 / 5f703ed0.
     *
     * The verdict is already a closed enum (rankingProof.VERDICT), which is exactly what `why`
     * is for. Nothing is widened: the value moves onto a field that already ships.
     */
    drops.push({ field: 'ranking', why: rankingCheck.verdict })
    if (directAnswer.trim().length > 0) droppedSentences++
    directAnswer = ''
    // ⛔ AN ORDERED LIST IS ITSELF THE CLAIM. When the answer's order contradicts the proof,
    // leaving the rendered rows in place would ship the same assertion with the sentence
    // removed — which is the defect wearing a quieter costume.
    if (rankingCheck.verdict === RANK_VERDICT.ORDER_CONTRADICTS_PROOF) sections.length = 0
  }

  /**
   * ⛔ AND A SECTION ASSERTS AN ORDER TOO — THE HOLE THE LIVE TURN WENT THROUGH.
   *
   * Measured on `main@befaed0`: the sentence gate above fired, emptied `directAnswer`, and a
   * section headed 「缺貨項目排序」 still shipped with Jars (20) above Napa (70). It was never
   * examined, because only `directAnswer` was ever handed to the gate.
   *
   * ⛔ RUN INDEPENDENTLY OF THE SENTENCE VERDICT. A heading is its own claim: it can be wrong
   * on a turn whose sentence was fine, and — as the live turn proved — on a turn whose
   * sentence was already withheld. Only the offending SECTION is dropped; a correct section
   * beside it is untouched, because removing evidence the Owner is entitled to would be a new
   * defect rather than a fix.
   */
  const rankingVerdicts = []
  const badRankingSections = rankingSectionViolations({
    // The declaration travels WITH the section; the heading in `sections` is already blank
    // for every ranking section, so the gate has nothing model-authored to read.
    sections: sections.map((sc, n) => ({ heading: '', items: sc.items, rankingClaim: sectionClaims[n], looksLikeRanking: sectionLooks[n], itemsDroppedBeforeGate: sectionItemDrops[n] })),
    rankedRows: (rankedGroup && Array.isArray(rankedGroup.items)) ? rankedGroup.items : [],
    /**
     * ⛔ THE ONE PROOF THAT OWNS THESE ROWS — not the turn's evidence at large. Passing all of
     * it let one source's complete proof entitle another source's ranking, and the count is
     * passed too so 「more than one ordering in this turn」 can fail closed rather than fall
     * through the empty-rows path.
     */
    /**
     * ⛔ EVERY RANKED PROOF, EACH BESIDE THE GROUP IT OWNS — so a SECTION can name its own.
     *
     * The turn-wide `rankingEvidence`/`rankedRows` below stay exactly as they were, for the
     * sentence path and for callers with no server-resolved item identity. This list is what
     * lets a section that belongs to inventory be judged against inventory on a turn that also
     * read replenishment — the live failure on `c382708`, requestId 34705891.
     *
     * The group is matched by the proof's own `readKey` and must be UNIQUE: a proof that matches
     * two groups, or none, owns no rows this turn and entitles nothing.
     */
    rankedProofs: rankedEvidence.map((e) => {
      const key = (e && typeof e.readKey === 'string' && e.readKey) ? e.readKey : null
      const owned = key ? groups.filter((g) => g && String(g.readKey || g.source) === key) : []
      return { readKey: key, evidence: e, group: owned.length === 1 ? owned[0] : null }
    }),
    rankingEvidence: rankedEvidence.length === 1 ? rankedEvidence[0] : null,
    rankedSourceCount: usableRankedSources,
    /**
     * ⛔ THE VERDICT HAS TO REACH THE LOG, OR IT IS NOT OBSERVABILITY.
     *
     * `onVerdict` existed and production never supplied it, so every section rejection was
     * recorded as `order_contradicts_proof` whatever the true cause. That is the third time
     * this project has shipped a mechanism the real path never called — `artifactStore`
     * undefined in assembly, and the claim-binding block this file itself described as
     * 「computed, returned, and acted on by nothing」.
     *
     * Enum and count only: status, a closed reason, and how many ranked sources the turn had.
     */
    onVerdict: (v) => { if (v) rankingVerdicts.push(v) }
  })
  /**
   * ⛔ THE SERVER TITLES WHAT IT PROVED. Composed from a server-owned template and the
   * VERIFIED closed fields only — kind, the verified N, the proven metric. No model heading,
   * title, prose, user text or free-text label is interpolated, so there is no path by which
   * anything the model wrote can reach the screen through this line.
   *
   * Composed BEFORE the rejected sections are spliced out, because splicing renumbers them.
   */
  for (let n = 0; n < sections.length; n++) {
    const d = normaliseRankingClaim(sectionClaims[n])
    if (!d.present || !d.valid || badRankingSections.includes(n)) continue
    /**
     * ⛔ THE SERVER WILL NOT TITLE A SECTION THAT STILL CARRIES MODEL PROSE — and this is a
     * RUNTIME CHECK, not a comment claiming the blanking above happened.
     *
     * Found by the mandatory mutation, which is the only reason it exists: removing the blanking
     * left every test GREEN, because the composition below overwrites an allowed heading and a
     * refused section is dropped whole. A line no test can kill is the shape this task has
     * already removed once, in Commit B. Rather than delete a boundary the Owner asked for, the
     * invariant is asserted here: if anything is left in `heading` at this point the blanking did
     * not run, so the section ships UNTITLED — verified rows with no claim over them, which is
     * the safe direction — instead of being titled by the server as though it were clean.
     */
    if (sections[n].heading !== '') { sections[n].heading = ''; continue }
    sections[n].heading = composeRankingHeading(d, sections[n].items.length)
  }
  if (badRankingSections.length > 0) {
    for (let n = badRankingSections.length - 1; n >= 0; n--) {
      const removed = sections.splice(badRankingSections[n], 1)[0]
      const lost = (removed && Array.isArray(removed.items)) ? removed.items.length : 0
      droppedItems += lost
      keptItemCount -= lost
    }
    // IDENTIFIERS ONLY — never the heading, never a row value.
    // ⛔ THE REAL REASON, not a constant. Each rejected section reports its own closed
    // verdict; `length` carries rankedSourceCount, a plain count the serializer already ships.
    for (const v of rankingVerdicts) {
      if (v.status !== 'evaluated_rejected') continue
      drops.push({ kind: 'ranking_section', field: 'ranking_section', why: v.reason, shape: v.status, length: v.rankedSourceCount })
    }
  }

  const answerSurvived = directAnswer.trim().length > 0
  if (!answerSurvived) directAnswer = ''

  // ── A2 PHASE 2: CLAIM BINDING. COMPUTED, RETURNED, AND ACTED ON BY NOTHING. ──
  //
  // ⛔ THE RETURNED `plan` ABOVE IS NOT TOUCHED BY THIS, and no branch below reads
  // `claimBindings`. It is metadata for a future gating phase. A test asserts the rendered
  // reply is byte-identical with and without `answerClaims` present, because 「it only adds
  // metadata」 is a claim about code, and this project has been wrong about that before.
  //
  // An absent declaration yields [] — UNBOUND, never an inferred binding.
  const { verifyClaimBindings } = require('./claimBinding')
  const claimBindings = verifyClaimBindings(plan.answerClaims, { evidenceSets, itemsBySource })

  return {
    plan: { directAnswer, sections, limitations, followUp, unanswerable: plan.unanswerable === true, citesEvidence },
    // Structural verdicts only — no claim text, no row values. See claimBinding.js.
    claimBindings,
    droppedFacts,
    droppedItems,
    droppedSentences,
    droppedLimitations,
    // The model said it cites nothing and then supplied rows. The rows are gone; the
    // contradiction is not, because a caller must be able to tell this from a clean turn.
    sectionsNotDeclared,
    drops: drops.slice(0, LIMITS.maxDropsLogged),
    /**
     * ⛔ ABSENCE MUST NOT ENCODE TWO STATES. Only rejections reached `drops`, so 「no claim
     * was detected」 and 「a claim was evaluated and allowed」 were BOTH an empty array —
     * and the tests pinned that as correct, which is worse than the gap alone.
     */
    rankingVerdicts,
    /** Shape only: how many sections presented a ranking, declared one, and did neither. */
    rankingClaims: { looksRanking: looksRankingCount, declared: declaredCount, missing: missingDeclarationCount },
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
  const live = evidenceSets.filter((e) => e && e.trust === 'live' && (e.shownCount > 0 || e.matchingTotal > 0))
  if (live.length === 0) return t('plan.cannotRead')
  const parts = live.map((e) => {
    // ⛔ A1: the MATCHING total, never a source total. This sentence is the deterministic
    // fallback the Owner actually reads, so the number in it is the one number that must not
    // over-claim. `sourceTotal` is deliberately NOT used even when known — the fallback says
    // what this read found, not what the business holds.
    const n = Number.isFinite(e.matchingTotal) ? e.matchingTotal : e.shownCount
    const kind = ENTITY_LABELS[e.entityType] ? ENTITY_LABELS[e.entityType]() : t('entity.generic')
    const src = SOURCE_LABELS[e.source] ? SOURCE_LABELS[e.source]() : e.source
    return src + ' ' + t('plan.countOf', { n, kind })
  })
  // A SUCCESSFUL READ AND A FAILED COMPOSITION ARE DIFFERENT EVENTS.
  // The Owner saw this sentence sitting above a correction that read 「上面講『讀唔到』係
  // 唔啱嘅」 — two subsystems asserting opposite things in one message. The read had in
  // fact succeeded; only the composing failed. So this says both, in that order, and it
  // deliberately contains NO read-failure phrase for the guard to catch: an answer and its
  // safety control must not be able to argue with each other.
  // ⚠ WHEN THIS WORDING IS REWRITTEN INTO WRITTEN CHINESE (Round 2/3 of the Language
  // Policy), WIDEN answerPlan.test.js's /讀唔到|睇唔到|攞唔到/ NEGATIVE ASSERTION IN THE SAME
  // COMMIT. It lists Cantonese spellings only; rewrite this line to 讀不到 and that guard
  // silently stops protecting anything while still passing. Owner instruction, 2026-08-04.
  // WRITTEN CHINESE, and deliberately free of every phrase in UNREADABLE_CLAIM — 組不出 is
  // chosen over 無法組出 because 無法讀取/無法取得 are IN that list and a near neighbour is
  // an invitation to the same argument. The test asserts against UNREADABLE_CLAIM itself,
  // not against a hand-copied list of spellings.
  return t('plan.readButNoAnswer', { parts: parts.join(t('punct.listSep')) })
}

const ENTITY_LABELS = Object.freeze({
  [ENTITY_TYPES.INVENTORY_ITEM]: () => t('entity.inventoryItem'),
  [ENTITY_TYPES.SUPPLIER]: () => t('entity.supplier'),
  [ENTITY_TYPES.INVOICE]: () => t('entity.invoice'),
  [ENTITY_TYPES.PURCHASE_ORDER]: () => t('entity.purchaseOrder'),
  [ENTITY_TYPES.DAILY_COUNT]: () => t('entity.dailyCount'),
  [ENTITY_TYPES.ORDER_SUGGESTION]: () => t('entity.orderSuggestion'),
  [ENTITY_TYPES.MAIL]: () => t('entity.mail'),
  [ENTITY_TYPES.FILE]: () => t('entity.file'),
  [ENTITY_TYPES.EVENT]: () => t('entity.event'),
  [ENTITY_TYPES.COMMIT]: () => t('entity.commit'),
  [ENTITY_TYPES.PULL_REQUEST]: () => t('entity.pullRequest')
})

const SOURCE_LABELS = Object.freeze({
  aroma_system: () => t('source.aromaSystem'),
  gmail: () => 'Gmail',
  drive: () => 'Drive',
  calendar: () => t('source.calendar'),
  github: () => 'GitHub'
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

/**
 * ⛔ SHOW THE MODEL ITS ACTUAL CHOICES. (Live canary, blocker 2.)
 *
 * capability was a bare string, so the model had to GUESS a source name it had never been
 * shown. Claude noticed Gmail was missing and still did not ask for it — it had no
 * structural way to know Gmail was askable, or what it was called.
 *
 * The enum is pinned per call to sources that are BOTH authorised for the active provider
 * AND not already read this turn. Re-reading the same source with the same message yields
 * nothing new at this capability grain, so it is not offered.
 *
 * ⛔ THE SCHEMA CONSTRAINS; IT DOES NOT AUTHORISE. authorisedSourcesFor() upstream and the
 * allowlist inside reasoningLoop.js remain the boundary. A model that somehow returned a
 * name outside the enum would still be refused server-side.
 *
 * With nothing left to read, nextRead becomes null-ONLY — never an empty enum, which is
 * itself an invalid strict schema.
 */
/**
 * ⛔ THE ZERO-READ DECISION SCHEMA. The loop could EXTEND a read and never INITIATE one.
 *
 * answerPlanFormat() returns no schema at all when nothing was retrieved, so on a turn that
 * read nothing the model was never offered nextRead — and 「你能看到 aroma system 嗎？」 was
 * answered with 「我無法確認」 while the connector sat there, authorised and working.
 *
 * This is the SAME envelope minus answerPlan. An Answer Plan is evidence-shaped: forcing one
 * before any evidence exists would ask the model to invent sections and sourceIds it cannot
 * have. So the first call gets the ordinary reply shape plus one decision — read, or do not.
 *
 * Strict-mode rules are identical: every property in required, optionality as a NULL UNION.
 */
const DISTILL_WITH_READ_DECISION_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'mode', 'reply', 'nextRead'],
  properties: {
    intent: DISTILL_WITH_PLAN_SCHEMA.properties.intent,
    mode: DISTILL_WITH_PLAN_SCHEMA.properties.mode,
    reply: DISTILL_WITH_PLAN_SCHEMA.properties.reply,
    nextRead: DISTILL_WITH_PLAN_SCHEMA.properties.nextRead
  }
})
/**
 * ⛔ THE ENUM CARRIES OPERATIONS, NOT SOURCES (A3 first-read initiation).
 *
 * `aroma_system` alone told the model nothing about WHICH of the six restaurant views it was
 * asking for, so the server had to re-derive that from the Owner's message — and vetoed the
 * read whenever the message named the system rather than a business entity. The enum is now
 * `aroma_system.invoices`, `aroma_system.inventory`, … so the choice IS the request.
 *
 * `description` is the Owner-facing gloss for those names (see readOperations.describeOperations).
 * It is MODEL TEXT: an opaque `aroma_system.purchasing` is a guess waiting to happen. Generated
 * from the same frozen table as the enum, so they cannot disagree.
 */
/**
 * ⛔ A4-0A: ADD THE READ-ARGUMENT CHANNEL, GATED.
 *
 * With the gate off this returns the schema UNTOUCHED — not a clone with the same content, the
 * same object — so an A4-off turn cannot differ from today by even a key order.
 *
 * With the gate on, `nextRead` gains `args` under the strict-mode rules the last two live 400s
 * taught: `args` joins `required`, optionality is a NULL UNION, and additionalProperties is
 * false at the new boundary. Applied BEFORE withReadChoices, so a turn with nothing left to
 * read still collapses `nextRead` to null-only and the argument channel goes with it.
 *
 * ⛔ IT GRANTS NOTHING. This widens what a read REQUEST may say, never what may be read.
 */
/**
 * ⛔ A4-1C: THE CHAT LANE MAY NOT OFFER `commit` — MADE STRUCTURALLY IMPOSSIBLE.
 *
 * ── THE CONTRADICTION THIS RESOLVES ──────────────────────────────────────────
 * The classifier tells the model that an operational request — anything with 做/建立/改/停/
 * 查 — is `mode:"commit"`. laneRouter and the intake governance already disagree: a
 * read/look/check/find request is a KNOWLEDGE READ, not an action, and a chat turn cannot
 * execute anything. So on 「幫我查下…」 the model was being told two different things at once,
 * and the A4 semantic guidance was arguing with the classifier rather than extending it.
 *
 * Two calibrations of that prose failed in opposite directions — the second moved the failure
 * from over-asking to under-asking without ever removing it. The lesson is not "write better
 * prose": it is that an invalid state was REPRESENTABLE, so the model kept representing it.
 *
 * ⛔ THIS REMOVES NO CAPABILITY. intakeService already intercepts `mode:'commit'` on a chat
 * turn and creates NO Decision, NO Task, NO Proposal and no dispatch — the chat opts do not
 * even carry the proposal seam. Real actions reach the proposal lane through laneRouter,
 * BEFORE any content is fetched, and that boundary is untouched. This narrows the model's
 * output contract to what the server was always going to honour, and nothing else.
 *
 * ⛔ OFF RETURNS THE SAME OBJECT, not an equal one, so an A4-off turn cannot differ by key
 * order. Applied ONLY for A4 ON + chat; the proposal and email_draft lanes keep `commit`.
 */
const CHAT_KNOWLEDGE_MODES = Object.freeze(['recommend', 'ask', 'chat'])

function withChatKnowledgeModes (schema, enabled) {
  if (!enabled) return schema
  const modeNode = schema && schema.properties && schema.properties.mode
  if (!modeNode || !Array.isArray(modeNode.enum)) return schema
  // Preserve the repository's canonical ORDER; only `commit` is removed.
  const narrowed = modeNode.enum.filter((m) => m !== 'commit')
  if (narrowed.length === modeNode.enum.length) return schema
  const out = JSON.parse(JSON.stringify(schema))
  out.properties.mode.enum = narrowed
  return out
}

function withReadArgs (schema, enabled) {
  if (!enabled) return schema
  const nr = schema && schema.properties && schema.properties.nextRead
  if (!nr || !nr.properties || nr.properties.args) return schema
  const out = JSON.parse(JSON.stringify(schema))
  const node = out.properties.nextRead
  node.properties.args = JSON.parse(JSON.stringify(READ_ARGS_SCHEMA))
  node.required = [...new Set([...(Array.isArray(node.required) ? node.required : []), 'args'])]
  return out
}

function withReadChoices (schema, available, description) {
  const out = JSON.parse(JSON.stringify(schema))
  const nr = out.properties && out.properties.nextRead
  if (!nr) return out
  const list = Array.from(new Set((available || []).filter((x) => typeof x === 'string' && x)))
  if (list.length === 0) {
    // Nothing left to read — but the description still matters: it is where "these were
    // ALREADY read, do not claim you could not" is said. Dropping it here is how a turn that
    // read everything would be told nothing about what it holds.
    out.properties.nextRead = { type: 'null', description: (typeof description === 'string' && description) ? description : (nr.description || null) }
    return out
  }
  nr.properties.capability.enum = list
  if (typeof description === 'string' && description) nr.properties.capability.description = description
  return out
}
module.exports = {
  ANSWER_PLAN_SCHEMA,
  DISTILL_WITH_PLAN_SCHEMA,
  withRowRefs,
  withReadChoices,
  withReadArgs,
  withChatKnowledgeModes,
  CHAT_KNOWLEDGE_MODES,
  DISTILL_WITH_READ_DECISION_SCHEMA,
  STATUS_LABELS,
  ENTITY_LABELS,
  SOURCE_LABELS,
  SOURCE_NAME_REWRITES, // exported so languagePolicy.test.js can prove it stays empty
  UNIT_LABELS,
  LIMITS,
  TELEMETRY_RE,
  logAnswerPlan,
  evidenceIndex,
  nearnessOf,
  validatePlan,
  parsePlan,
  minimalAnswer,
  translate,
  valueMatches,
  matchValue,
  metricLabelMap,
  numericOf,
  cjkToNumber,
  sentenceIsSupported,
  splitSentences
}
