'use strict'

/**
 * routeEvidenceGuard.js — STEP 4 of the Intent Router migration, and its last piece.
 *
 * Steps 1–3 governed the READ end: which sources a turn is allowed to touch. Nothing
 * governed the ANSWER end. A business question the router does not recognise falls to
 * CONVERSATION, reads nothing at all, and is then answered out of the model's own fluency
 * with zero evidence behind it — and because nothing was read, no evidence layer runs.
 *
 * That gap is real. The phrase it was built for — 「今日邊啲貨要補？」 — has since been repaired
 * IN THE INTENT TABLE (readContext.js learned the topicalised 貨要補), so it now routes to
 * BUSINESS_QUERY and never reaches this guard. The guard was not weakened and its scope did
 * not change; one question stopped being unrouted. Others still are — 「上星期嗰批菜點呀？」 is
 * the recorded one — and this remains the answer-end net for them.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS CANNOT CATCH — READ THIS BEFORE CHANGING THE VOCABULARY
 * ════════════════════════════════════════════════════════════════════════════════
 * The guard has two halves and they are not equally strong.
 *
 * THE NUMERIC HALF is precise. It reuses sentenceIsSupported() against an EMPTY evidence
 * index, so any quantity in prose — ASCII or CJK — is by construction unsupported. No new
 * rule, no second implementation, and it inherits every fix that file ever receives.
 *
 * THE ENTITY-PLUS-STATUS HALF is a heuristic and is known to be porous. It matches the
 * INTENT TABLE's own nouns, which means:
 *
 *   IT CANNOT CATCH A BUSINESS CLAIM PHRASED WITHOUT ONE OF THOSE NOUNS.
 *   「今日一切正常，不用做什麼。」 is an operational assertion, carries no number and names
 *   no entity, and passes straight through.
 *
 * That is the SAME blind spot that sent the turn to CONVERSATION in the first place: the
 * guard shares the router's vocabulary, so IT CANNOT CATCH WHAT THE ROUTER COULD NOT ROUTE.
 * The two fail together, by construction.
 *
 * This is a deliberate trade, not an oversight. The alternative — a private, wider list
 * here — would make the guard fire on turns the router considers ordinary conversation, and
 * a false withholding trains the Owner to distrust the control, which is the more expensive
 * failure. ONE vocabulary per concept; that rule was paid for once already.
 *
 * SO: the way to narrow this hole is to widen INTENTS in readContext.js, which narrows it in
 * the router and the guard at the same time. Do not grow a list in this file — there is a
 * test that fails if you do.
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * WITHHOLDING IS VISIBLE, NEVER SILENT. A confident answer with nothing behind it is the
 * failure; deleting it quietly is the same failure with the trace removed. The offending
 * sentences are dropped, everything else survives, and a SERVER-GENERATED line says what was
 * withheld and which source would have to be consulted to answer properly.
 */

const { routeTurn } = require('./turnRouter')
const { generalRequestKind } = require('./generalKnowledge')
const { INTENTS } = require('../context/readContext')
const { sentenceIsSupported, splitSentences, evidenceIndex, SOURCE_LABELS, cjkToNumber } = require('./answerPlan')
const { checkConversationClaim } = require('./conversationEvidence')
const { conversationClaimNotice } = require('./conversationEvidenceView')

/** An index over nothing — the point being that NOTHING was read this turn. */
const EMPTY_INDEX = evidenceIndex([], [])

/** THE INTENT TABLE'S NOUNS, borrowed rather than copied. See the header. */
const ENTITY_NOUNS = INTENTS.flatMap((i) => i.cjk || [])
const SOURCES_BY_NOUN = new Map()
for (const i of INTENTS) for (const n of i.cjk || []) if (!SOURCES_BY_NOUN.has(n)) SOURCES_BY_NOUN.set(n, (i.sources || [])[0] || null)

/**
 * A STATE OR SUFFICIENCY WORD. Deliberately small: 「存貨」 alone is a topic, and talking
 * about a topic is conversation. 「存貨全部充足」 asserts a condition of the business.
 */
const STATUS_WORD = /(充足|足夠|夠用|不足|不夠|短缺|缺貨|斷貨|沒有了|用完|正常|沒問題|沒有問題|全部|都要|要補|需要補|要訂|已經|全都|一切)/

// A pending action modifying its object is not a status predicate: "items to
// order" differs from "items need ordering". Other status words and all numeric
// checks remain in force, including claims about those same pending objects.
const NOMINAL_HEAD = new RegExp('^(?:' + ENTITY_NOUNS.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).concat(['貨品','貨物','物品','商品','項目','清單']).join('|') + ')')
const hasStatusPredicate = s => {
  const text = String(s)
  // An explicitly current/company-specific description is still evidence-bound.
  if (BUSINESS_REFERENT.test(text)) return STATUS_WORD.test(text)
  return STATUS_WORD.test(text.replace(/(?:需要補|要補|要訂)(?:的|嘅)/gu, (match, offset) => {
    // Admit only an action's direct nominal object, not a subject's predicate or
    // classification. A known entity before that action must be a prepositional
    // grouping key, rather than the actor/stock whose condition is being stated.
    const prefix=text.slice(0,offset),action=prefix.match(/(?:整理|列出|彙整|草擬)\s*$/u)
    if (!action || !NOMINAL_HEAD.test(text.slice(offset+match.length))) return match
    const lead=prefix.slice(0,action.index).trim()
    if (entityIn(lead) && !/^(?:按|依照|依|根據)[\p{Script=Han}A-Za-z0-9\s]+$/u.test(lead)) return match
    return ''
  }))
}

/**
 * THREE THINGS THAT ARE NOT CLAIMS ABOUT THE BUSINESS, and are exempt for the same reason:
 * a question, an offer, and a statement about what SHE can do.
 *
 * The third earns its place. 「我可以幫你做三件事：查存貨、查發票、排日程。」 carries an
 * unsupported number and an entity noun and is completely honest — it is about her, not
 * about the stock. Without this, the guard would withhold a capability list, and a false
 * withholding teaches the Owner to distrust the control. That is the more expensive failure.
 */
const ASKING = /[？?]\s*$|(嗎|呢|好不好|好嗎|要不要)\s*[。．.!！]?\s*$/
const OWN_OFFER = /(我可以|我能|我會幫|我幫你|要我|讓我|等我)/

/** The server line, so the guard never trips over its own output. */
const ROUTE_EVIDENCE_NOTE_RE = /這一輪沒有查任何來源/

// Concept details (field counts, paid/unpaid definitions) are not observations of
// this business. Keep this bounded to a whole-request definition; named-company,
// possessive and time-specific claims still pass through the original guard.
// Generic "you pay" or "this means" explains a concept. Possessive company
// references and specific records still designate facts that need evidence.
const BUSINESS_REFERENT = /Aroma|Imagine|Xiangxiang|香香|我(?:們|们|哋|(?:的|嘅)(?:公司|餐廳|餐厅|發票|发票|庫存|库存)|已|收到|查到|發現|发现)|你(?:的|嘅|公司|餐廳|餐厅)|佢(?:的|嘅)|本店|門店|门店|(?:這|这|那|呢|嗰)(?:張|张|批|筆|笔|間|间|份)|今日|今天|昨日|昨天|目前|現在|现在|最新|上星期|上週|上周|剛才|刚才|\b(?:our|my|your|current|latest|today|yesterday|now|previous|last)\b/i

function numbersIn (s) {
  return String(s).match(/\d+(?:[.,]\d+)*|[零一二兩三四五六七八九十百千萬]+/g) || []
}

/**
 * THE OWNER'S OWN NUMBERS, THIS TURN. His standing ruling, applied here: repeating something
 * he just wrote back to him is not a claim she is making, it is the conversation working.
 */
function onlyEchoesTheOwner (sentence, message) {
  const ns = numbersIn(sentence)
  if (ns.length === 0) return false
  const m = String(message == null ? '' : message)
  return ns.every((n) => m.includes(n))
}

function entityIn (sentence) {
  for (const n of ENTITY_NOUNS) if (sentence.includes(n)) return n
  return null
}

// A requirement can count the open questions it explicitly lists. Verify that
// local structure rather than treating an obligation ("all must document") as
// a measured state. This admits neither operational subjects nor closed facts;
// ambiguous, mismatched and non-question lists retain the original guard.
function isQuestionEnumeration (clause) {
  const text = String(clause).trim().replace(/^[-*+]\s+/u, '')
  if (BUSINESS_REFERENT.test(text) || entityIn(text)) return false
  const match = text.match(/^([\p{L}\s]+?)(?:都)?(?:應該|應|必須|須|需要|要)(?:寫清楚|列明|說明|交代)\s*([0-9零〇一二兩三四五六七八九十百千萬]+)\s*(?:件事|點|項(?:內容|資料|要求))\s*[:：](.+?)[。.!！]?$/u)
  // Stricter than the business-count parser: numeral-free subject/items avoid
  // admitting units outside its known measure words or a quantified actor.
  const numeral = /[\p{N}零〇一二兩三四五六七八九十百千萬]/u
  if (!match || STATUS_WORD.test(match[1]) || numeral.test(match[1])) return false
  const count = /^\d+$/.test(match[2]) ? Number(match[2]) : cjkToNumber(match[2])
  const items = match[3].split('、').map(item => item.trim())
  return count >= 2 && count <= 16 && items.length === count && new Set(items).size === count &&
    items.every(item => /^[\p{L}\s]*(?:什麼|甚麼|哪些|何時|哪裡|哪裏|如何)$/u.test(item) && !STATUS_WORD.test(item) && !numeral.test(item))
}

// Numeric and entity predicates must concern the same clause. A later negative
// statement about code changes cannot turn an earlier proposal count into a
// business claim. Retain an explicit subject for elliptical status clauses.
function assertionClauses (sentence) {
  const parts = String(sentence).split(/([，；;—]+|,(?!\d))/u)
  const clauses = []
  for (let i = 0; i < parts.length; i += 2) if (parts[i]) clauses.push(parts[i] + (parts[i + 1] || ''))
  return clauses
}

/**
 * @param {{reply:string, message:string, evidenceSets?:Array}} input
 * @returns {{reply:string, violated:boolean, withheld:string[], sources:string[]}}
 */
function enforceRouteEvidence (input) {
  const reply = typeof input.reply === 'string' ? input.reply : ''
  const message = typeof input.message === 'string' ? input.message : ''
  const none = { reply, violated: false, withheld: [], sources: [] }
  if (!reply.trim()) return none

  // Only the owner-intent verifier can mark a memory-only answer. Historical codes/dates
  // are not live operational claims; no memory rows are promoted to business EvidenceSets.
  if (input.historicalMemoryAnswer === true) return none

  // SCOPE, exactly as ruled. A turn that read something is answerPlan's to judge; judging it
  // twice, from a layer that cannot see the rows, would be the false-correction fault again.
  const evidenceSets = Array.isArray(input.evidenceSets) ? input.evidenceSets : []
  if (evidenceSets.length > 0) return none

  // CONVERSATION only. UTILITY's numbers are computed and honest; ACTION reports its own
  // work; BUSINESS_QUERY has the whole read path in front of it.
  let route = null
  try { route = routeTurn(message) } catch (_) { return none }
  // A host-reviewed no-read recommendation must also check a reviewer's edits,
  // even when the keyword router called the original question BUSINESS_QUERY.
  if (!route || (route.route !== 'CONVERSATION' && input.reviewedNoReadAdvice !== true)) return none
  const definition = generalRequestKind(message) === 'definition'

  const removedSpans = []
  const withheld = []
  let conversationWithheld = 0
  const sources = new Set()
  let sentenceCursor = 0
  for (const sentence of splitSentences(reply)) {
    const sentenceStart = reply.indexOf(sentence, sentenceCursor)
    if (sentenceStart < 0) throw Error('guard_span_unavailable')
    sentenceCursor = sentenceStart + sentence.length
    let subject = null
    let clauseCursor = 0
    for (const clause of assertionClauses(sentence)) {
      const s = String(clause)
      const clauseStart = sentence.indexOf(s, clauseCursor)
      if (clauseStart < 0) throw Error('guard_span_unavailable')
      clauseCursor = clauseStart + s.length
      const explicitNoun = entityIn(s)
      if (explicitNoun) subject = explicitNoun
      // Conversation evidence is neither a business read nor permission to
      // bypass this whole reply. Check only a complete typed speech-count claim.
      const conversation = subject === null ? checkConversationClaim(s, input.conversationEvidence) : null
      if (conversation) {
        if (!conversation.supported) {
          withheld.push(s)
          conversationWithheld++
          removedSpans.push({start:sentenceStart+clauseStart,end:sentenceStart+clauseStart+s.length})
        }
        continue
      }
      if (!s.trim() || ASKING.test(s.trim()) || OWN_OFFER.test(s) || ROUTE_EVIDENCE_NOTE_RE.test(s)) continue
      if (definition && !BUSINESS_REFERENT.test(s)) continue
      if (input.reviewedNoReadAdvice === true && subject === null && isQuestionEnumeration(s)) continue
  
      const noun = explicitNoun || subject
      // (a) THE NUMERIC HALF — precise, and not ours to reimplement. A bare number is not
      // enough on its own: it must sit in an operational sentence, which is either an entity
      // noun or a state word. 「今日有 3 樣貨要補。」 names NO entity the intent table knows —
      // 要補 is not 補貨, which is exactly why the turn fell to CONVERSATION — so requiring a
      // noun here would have made the guard miss the very case it was built for.
      const numeric = !sentenceIsSupported(s, EMPTY_INDEX) && !onlyEchoesTheOwner(s, message) &&
        (noun !== null || hasStatusPredicate(s))
      // (b) THE ENTITY-PLUS-STATUS HALF — no number at all. Porous by construction; see header.
      const asserted = noun !== null && hasStatusPredicate(s)
  
      if (numeric || asserted) {
        withheld.push(s)
        removedSpans.push({start:sentenceStart+clauseStart,end:sentenceStart+clauseStart+s.length})
        const src = noun ? SOURCES_BY_NOUN.get(noun) : (entityIn(message) ? SOURCES_BY_NOUN.get(entityIn(message)) : null)
        if (src) sources.add(src)
        continue
      }
      }
    }
  
    if (withheld.length === 0) return none
    // Delete only measured source spans; sentence splitting is for judgement,
    // never a renderer. Keep every unaffected newline, list marker and space.
    let preserved = reply
    for (const span of removedSpans.sort((a,b)=>b.start-a.start)) preserved = preserved.slice(0,span.start)+preserved.slice(span.end)
  
    // A rejected model assertion does not establish what the Owner requested.
    // Keep withholding and source audit, without inventing a retrieval obligation.
    const named = [...sources].map(s => SOURCE_LABELS[s] ? SOURCE_LABELS[s]() : s)
    const businessWithheld = withheld.length - conversationWithheld
    const notes = []
    if (businessWithheld) notes.push(`有 ${businessWithheld} 句講到營運狀況，但這一輪沒有查任何來源，所以我沒有顯示它。` +
      (named.length ? `未核實的敘述涉及：${named.join('、')}。` : ''))
    if (conversationWithheld) notes.push(conversationClaimNotice(conversationWithheld))
    const note = notes.join('\n')
  
    return {
      // The note NEVER stands in for the answer silently, and never leaves an empty reply.
      reply: (preserved.trim() ? preserved + '\n\n' : '') + note,
      violated: true,
      withheld,
      sources: [...sources]
    }
  }
  
  module.exports = { enforceRouteEvidence: input=>{const result=enforceRouteEvidence(input),usage=require('../actions/usageBudget');if(usage.currentScope())usage.service().capture('route_guard',{input,result});return result}, ROUTE_EVIDENCE_NOTE_RE, ENTITY_NOUNS }
