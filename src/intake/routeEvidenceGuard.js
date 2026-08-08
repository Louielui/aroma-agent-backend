'use strict'

/**
 * routeEvidenceGuard.js — STEP 4 of the Intent Router migration, and its last piece.
 *
 * Steps 1–3 governed the READ end: which sources a turn is allowed to touch. Nothing
 * governed the ANSWER end. A business question the router does not recognise falls to
 * CONVERSATION, reads nothing at all, and is then answered out of the model's own fluency
 * with zero evidence behind it — and because nothing was read, no evidence layer runs.
 *
 * That gap is live. 「今日邊啲貨要補？」 routes to CONVERSATION today: the intent table has
 * 補貨 but not 要補. The question is unmistakably operational; the answer would be invented.
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
const { INTENTS } = require('../context/readContext')
const { sentenceIsSupported, splitSentences, evidenceIndex, SOURCE_LABELS } = require('./answerPlan')

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

/**
 * @param {{reply:string, message:string, evidenceSets?:Array}} input
 * @returns {{reply:string, violated:boolean, withheld:string[], sources:string[]}}
 */
function enforceRouteEvidence (input) {
  const reply = typeof input.reply === 'string' ? input.reply : ''
  const message = typeof input.message === 'string' ? input.message : ''
  const none = { reply, violated: false, withheld: [], sources: [] }
  if (!reply.trim()) return none

  // SCOPE, exactly as ruled. A turn that read something is answerPlan's to judge; judging it
  // twice, from a layer that cannot see the rows, would be the false-correction fault again.
  const evidenceSets = Array.isArray(input.evidenceSets) ? input.evidenceSets : []
  if (evidenceSets.length > 0) return none

  // CONVERSATION only. UTILITY's numbers are computed and honest; ACTION reports its own
  // work; BUSINESS_QUERY has the whole read path in front of it.
  let route = null
  try { route = routeTurn(message) } catch (_) { return none }
  if (!route || route.route !== 'CONVERSATION') return none

  const kept = []
  const withheld = []
  const sources = new Set()
  for (const sentence of splitSentences(reply)) {
    const s = String(sentence)
    if (!s.trim() || ASKING.test(s.trim()) || OWN_OFFER.test(s) || ROUTE_EVIDENCE_NOTE_RE.test(s)) { kept.push(s); continue }

    const noun = entityIn(s)
    // (a) THE NUMERIC HALF — precise, and not ours to reimplement. A bare number is not
    // enough on its own: it must sit in an operational sentence, which is either an entity
    // noun or a state word. 「今日有 3 樣貨要補。」 names NO entity the intent table knows —
    // 要補 is not 補貨, which is exactly why the turn fell to CONVERSATION — so requiring a
    // noun here would have made the guard miss the very case it was built for.
    const numeric = !sentenceIsSupported(s, EMPTY_INDEX) && !onlyEchoesTheOwner(s, message) &&
      (noun !== null || STATUS_WORD.test(s))
    // (b) THE ENTITY-PLUS-STATUS HALF — no number at all. Porous by construction; see header.
    const asserted = noun !== null && STATUS_WORD.test(s)

    if (numeric || asserted) {
      withheld.push(s)
      const src = noun ? SOURCES_BY_NOUN.get(noun) : (entityIn(message) ? SOURCES_BY_NOUN.get(entityIn(message)) : null)
      if (src) sources.add(src)
      continue
    }
    kept.push(s)
  }

  if (withheld.length === 0) return none

  // SOURCE_LABELS holds thunks now (see answerPlan.js) — a key string there would be a
  // dynamic key at the call site.
  const named = [...sources].map((s) => (SOURCE_LABELS[s] ? SOURCE_LABELS[s]() : s))
  const note = named.length
    ? `有 ${withheld.length} 句講到營運狀況，但這一輪沒有查任何來源，所以我沒有顯示它。這個問題要查${named.join('、')}才答得準，要我現在查嗎？`
    : `有 ${withheld.length} 句講到營運狀況，但這一輪沒有查任何來源，所以我沒有顯示它。要我查過再答嗎？`

  return {
    // The note NEVER stands in for the answer silently, and never leaves an empty reply.
    reply: (kept.join('').trim() ? kept.join('').trim() + '\n\n' : '') + note,
    violated: true,
    withheld,
    sources: [...sources]
  }
}

module.exports = { enforceRouteEvidence, ROUTE_EVIDENCE_NOTE_RE, ENTITY_NOUNS }
