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

const { LABELS, enforceReadState } = require('./readStateGuard') // Owner-facing source names, derived from ALL_SOURCES
const { intentFor } = require('../context/readContext') // THE one intent table — never a second classifier
const { enforceRouteEvidence } = require('./routeEvidenceGuard') // STEP 4: an answer with nothing behind it
const { t } = require('../i18n/t')

const { pruneRepeatedScopeNotes } = require('./scopeNotes') // a source's fixed properties: once per conversation

/** Owner-facing status words. The keys are the API's own values. */
const STATUS_LABELS = Object.freeze({
  // ⛔ Thunks, not key strings — a table lookup handed to t() is a DYNAMIC key (HR-48).
  needs_review: () => t('status.needsReview'),
  approved: () => t('status.approved'),
  sent: () => t('status.sent'),
  received: () => t('status.received'),
  partially_received: () => t('status.partiallyReceived'),
  unknown: () => t('status.unknown')
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
  get limits () { return t('rrv.limits') },
  get opinion () { return t('rrv.opinion') },
  get next () { return t('rrv.next') }
})

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
  if (mapped) return mapped() // ⛔ CALL it — STATUS_LABELS holds thunks, not strings
  // NEVER silently dropped: an unrecognised value is shown, with its raw form.
  const shown = raw.length > CAPS.maxRawStatusChars ? raw.slice(0, CAPS.maxRawStatusChars) + '…' : raw
  return t('rrv.unknownStatusRaw', { label: STATUS_LABELS.unknown(), raw: shown })
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
  // ⛔ `total`, not `t` — `t` is the resolver, and a local of that name silently shadows it.
  // Second time in two files (recallCheck.js was the first). Now caught by a fence:
  // governance/resolverShadow.test.js.
  const total = fieldOf(item.content, 'total')
  if (total === null) return null
  return /^[\d.,]+$/.test(total) ? `$${total}` : null
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
  const title = item.title ? cap(item.title, CAPS.maxTitleChars) : t('rrv.untitled')
  const ident = identifierOf(item)
  const head = `**${ident ? `${title} — ${ident}` : title}**`

  const segs = []
  const amount = amountOf(item)
  if (amount) segs.push(amount)
  segs.push(dayOf(item.originalDate) || t('rrv.noDate'))
  const status = statusSegment(item)
  if (status) segs.push(status)

  return `${head}\n${segs.join('｜')}`
}

/**
 * ⛔ THE SERVER DECIDES WHAT COUNTS AS 「EVERYTHING」, FROM THE OWNER'S OWN WORDS.
 *
 * If a model field could declare a request exhaustive, the model would hold the key to the
 * one channel that prints the whole table — precisely the authority this design takes away
 * from it. So the rule reads the message and nothing else: no plan, no claim, no heading.
 *
 * ⛔ AND IT IS BIASED TOWARD NOT FIRING. This path prints data. A wrongly-triggered 36-row
 * dump is noise; the recognised set is deliberately small and literal. The cost of missing a
 * phrasing is paid by the withheld-count line below, which tells the Owner how many rows he
 * is not seeing so he can ask again — silence is the failure this whole change exists to fix.
 */
const EXHAUSTIVE_PHRASES = Object.freeze([
  '列出全部', '全部供應商', '所有供應商', '完整供應商名單', '供應商完整名單', '供應商全部名單'
])

function isExhaustiveListRequest (message) {
  const m = typeof message === 'string' ? message.trim() : ''
  if (!m) return false
  return EXHAUSTIVE_PHRASES.some((phrase) => m.includes(phrase))
}

/**
 * ⛔ TWO ARGUMENTS, AND NEITHER CAN CARRY MODEL OUTPUT.
 *
 * No `reply`, no `answerPlan`, no `answerClaims`, no heading parameter — there is nowhere
 * for model text to enter, which is a stronger guarantee than a rule saying it must not.
 * The heading is a server constant, the values come straight off the retrieval rows, and
 * the order is retrieval order: no ranking, no sorting, no summarising, no rewriting.
 */
function renderCompleteSupplierList (rows, labels) {
  const list = Array.isArray(rows) ? rows : []
  const label = (labels && typeof labels.aroma_system === 'string' && labels.aroma_system) || LABELS.aroma_system || 'aroma_system'
  const lines = ['### ' + label + '（完整名單，共 ' + list.length + ' 項）']
  list.forEach((r, i) => {
    const title = (r && typeof r.title === 'string' && r.title) ? r.title : '(untitled)'
    const ref = r && r.sourceId != null ? String(r.sourceId) : '—'
    lines.push(String(i + 1) + '. ' + title + '｜' + ref)
  })
  return lines.join(String.fromCharCode(10))
}

/**
 * ⛔ ONE DECISION, EVALUATED ONCE, USED TWICE.
 *
 * When the Owner asks for everything and the server HOLDS everything, completeness is the
 * server's fact, not the model's. The model saw four rows and describes four rows — accurate
 * about its context and wrong about the reply, because the server appends the other thirty-two
 * after it has spoken. (Live: requestId b67fa68f-a8c4-45d1-b4ce-f7c2f1b35eab.)
 *
 * ⛔ SUPPRESSION, NOT FILTERING. Nothing here inspects the model's words for 「sample」 or
 * 「incomplete」 or their Chinese forms. A phrase list is a queue that never ends, and editing
 * a sentence would put words in the model's mouth it never wrote. The comment is withheld in
 * the one context where it can no longer be true.
 *
 * ⛔ AND ONE VALUE DRIVES BOTH EFFECTS. Rendering the list and withholding the prose are two
 * uses of a single result. Evaluated separately they could drift, and the failure mode of that
 * drift is suppression with no list — a blank answer, worse than the contradiction being fixed.
 *
 * @returns {object[]|null} the complete retrieved supplier rows, or null when this is not one
 *   of those turns. Null means 「behave exactly as before」.
 */
function serverOwnedSupplierList (input) {
  if (!isExhaustiveListRequest(input && input.message)) return null
  const groups = Array.isArray(input && input.retrievedItemsBySource) ? input.retrievedItemsBySource : []
  const group = groups.find((g) => g && g.readKey === 'aroma_system.suppliers' && Array.isArray(g.items) && g.items.length > 0)
  return group ? group.items : null
}

/** ONE SECTION PER SOURCE — so two sources can never share a paragraph. */
function renderSection (source, items) {
  const label = LABELS[source] || source
  const shown = items.slice(0, CAPS.maxItemsPerSection)
  const rest = items.length - shown.length
  const lines = [`### ${label}`]
  for (const it of shown) lines.push(renderItem(it))
  if (rest > 0) lines.push(t('rrv.andMore', { n: rest }))
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
    ? t('rrv.noDirectMatch', { noun: intent.noun })
    // ⛔ The separator is interface too — 、 between English words reads as a typo.
    : t('rrv.confirmedSoFar', { parts: parts.join(t('punct.listSep')) })
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
    if (r.trust !== 'live') parts.push(t('rrv.sourceUnreadable', { label, error: r.error ? t('rrv.sourceError', { error: cap(r.error, 60) }) : '' }))
    else if (r.usedFallback) parts.push(t('rrv.sourceFallback', { label, noun: intent.noun, n: r.count }))
    else if (!r.count) parts.push(t('rrv.sourceEmpty', { label }))
  }
  if (hidden > 0) parts.push(t('rrv.hidden', { n: hidden }))
  if (opts.truncated) parts.push(t('rrv.truncated'))
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

  // `message` travels so rule 7 can honour the Owner's carve-out: a row title HE typed is
  // not laundering, so it is not barred from her prose.
  const v = validatePlan(input.answerPlan, { evidenceSets, itemsBySource, message: input.message })
  const out = []

  // THE ANSWER OFFERED ROWS AND NONE OF THEM WERE REAL. Distinct from an unsupported
  // directAnswer, and previously invisible: the sections simply vanished, headings and all,
  // while the log still read "validated" and the Owner saw a confident sentence over an
  // empty screen. An answer that lost all of its content is a fallback, whatever survived
  // of its opening line.
  const contentLost = v.modelItemCount > 0 && v.keptItemCount === 0
  const lostSomething = v.droppedItems > 0 || v.droppedFacts > 0 || v.droppedSentences > 0

  // Computed here so WHICH fixed property was suppressed reaches the log line below with
  // everything else this turn dropped. The property KEY, never the text — a suppression is
  // still a removal, and a removal this layer cannot account for is the failure mode it
  // exists to prevent. It is deliberately not counted as a degradation: nothing unprovable
  // happened, he was simply not told the same thing twice.
  const scopePrune = pruneRepeatedScopeNotes(v.plan.limitations, {
    evidenceSets,
    history: Array.isArray(input.history) ? input.history : []
  })

  const common = {
    provider: input.provider || null,
    droppedItems: v.droppedItems,
    droppedFacts: v.droppedFacts,
    droppedSentences: v.droppedSentences,
    // ADDED 2026-08-05. validatePlan has counted this since the day the silent
    // limitation drop was closed; the log projection has read it since the same day; it
    // was never put in between, so every line read lims:0 while carrying limitation drop
    // records in the SAME entry. A counter added to end a silent drop, itself dropped.
    droppedLimitations: v.droppedLimitations,
    drops: v.drops,
    // ⛔ THE SAME MISTAKE AS `droppedLimitations` ABOVE, CAUGHT BEFORE IT SHIPPED. validatePlan
    // produces the ranking-gate verdicts and logAnswerPlan projects them; without this line the
    // two would never meet and every real turn would report an empty summary.
    rankingVerdicts: v.rankingVerdicts,
    // ⛔ AND THE SAME MISTAKE ONE MORE TIME IF THIS LINE IS MISSING. validatePlan counts the
    // ranking declarations and logAnswerPlan projects them; without this the two never meet and
    // every production line reports 0/0/0 — a counter added to end a silent gap, silently gapped.
    // It has happened twice already on this object: `droppedLimitations` and `rankingVerdicts`.
    rankingClaims: v.rankingClaims,
    modelItemCount: v.modelItemCount,
    keptItemCount: v.keptItemCount,
    scopeNotesSuppressed: scopePrune.concepts.length ? scopePrune.concepts : null,
    requestId: input.requestId || null
  }

  // ── A FAILED SENTENCE NO LONGER DISCARDS VERIFIED ROWS ─────────────────────
  // This used to fall back whenever the opening sentence failed, whatever else had passed.
  // On 2026-08-05 a calendar answer lost a checked appointment because she wrote the time
  // as 下午 4 時 against a stored 16:00 — one unverifiable sentence, and the whole answer
  // became 「組不出一個可靠的答案」 with the appointment sitting validated behind it.
  //
  // Owner ruling: drop the sentence, keep the rows. The rows were checked and passed; they
  // earned their place, and a narrow failure escalating into a total one is the shape of
  // every defect removed this week.
  const rowsSurvived = v.keptItemCount > 0
  if (!v.answerSurvived && !rowsSurvived) {
    // Nothing survived at all — no sentence AND no row. There is genuinely nothing to show,
    // so the fallback still speaks, and it still says so out loud.
    logAnswerPlan(Object.assign({ outcome: 'fallback', reason: 'answer_unsupported' }, common))
    out.push(minimalAnswer(evidenceSets))
  } else if (!v.answerSurvived) {
    // The sentence went; the rows stay. DEGRADED, never "validated" — and the loss is
    // stated on screen below, not only in the log.
    logAnswerPlan(Object.assign({ outcome: 'degraded', reason: 'answer_unsupported' }, common))
  } else if (contentLost) {
    logAnswerPlan(Object.assign({ outcome: 'fallback', reason: 'items_unsupported' }, common))
    out.push(minimalAnswer(evidenceSets))
  } else {
    // 'degraded', not 'validated', when anything was deleted. The two used to log
    // identically, so a turn that lost most of its content was indistinguishable from a
    // clean one at a glance — the exact silent degradation this layer exists to end.
    //
    // A plan that declared citesEvidence:false and then supplied rows is its own reason:
    // nothing was unprovable, the answer simply contradicted itself, and that reads very
    // differently in a log from a value that failed its evidence check.
    const degraded = lostSomething || v.sectionsNotDeclared
    const reason = v.sectionsNotDeclared ? 'sections_not_declared' : (lostSomething ? 'partial_drop' : null)
    logAnswerPlan(Object.assign({ outcome: degraded ? 'degraded' : 'validated', reason }, common))
    out.push(v.plan.directAnswer)
  }

  // A fallback replaced the whole answer; its sections are not shown underneath it.
  //
  // THE CONDITION MUST MATCH THE ONE ABOVE. It used to read `!v.answerSurvived || contentLost`
  // and so suppressed the rows on exactly the turns the new rule keeps them — the fallback was
  // gone and the appointment still did not appear, because the decision to fall back and the
  // decision to render sections had drifted into two different tests of the same thing.
  const fellBack = (!v.answerSurvived && !rowsSurvived) || contentLost
  const sections = fellBack ? [] : v.plan.sections
  for (const sec of sections) {
    // A blanked heading (one the validator would not stand behind) is omitted, not
    // printed as a bare '###'.
    const lines = sec.heading ? [`### ${sec.heading}`] : []
    for (const it of sec.items) {
      const facts = it.facts.map((f) => `${f.field} ${f.value}`).join('｜')
      lines.push(facts ? `**${it.title}**\n${facts}` : `**${it.title}**`)
    }
    out.push(lines.join('\n\n'))
  }

  // WHAT WAS REMOVED IS SAID ON SCREEN, not only in a log the Owner never reads. A silently
  // shorter answer looks exactly like a complete one; a stated omission is a number he can
  // challenge. Server-authored, so no model prose can be laundered through it.
  //
  // ONLY WHEN SOMETHING WAS ACTUALLY SHOWN. 「有 3 個數值核對唔到,冇顯示。」 reached the
  // Owner on a turn that displayed no data at all — it is a note about what is missing
  // BESIDE something, and with nothing on screen it says nothing he can act on. When no
  // item survived, the answer is either a fallback (which speaks for itself) or a turn
  // that legitimately cites nothing.
  const omissions = []
  if (v.keptItemCount > 0) {
    if (v.droppedItems > 0) omissions.push(t('rrv.droppedItems', { n: v.droppedItems }))
    if (v.droppedFacts > 0) omissions.push(t('rrv.droppedFacts', { n: v.droppedFacts }))
    // A DROPPED SENTENCE IS ALSO A REMOVAL. Before the rows were allowed to survive one,
    // a failed sentence produced a fallback that announced itself; now it produces an
    // answer that simply starts at the heading. Said out loud rather than left to be
    // noticed — the same rule as the two counts above.
    if (v.droppedSentences > 0) omissions.push(t('rrv.droppedSentences', { n: v.droppedSentences }))
  }

  // A SOURCE'S FIXED PROPERTIES ARE SAID ONCE PER CONVERSATION, NOT ONCE PER TURN.
  // The model re-derives them from the SCOPE block every turn and writes them back out
  // every turn, reworded; over seven live turns he read the same three facts seven times.
  // Only the MODEL's limitations are eligible — the omission counts below are about THIS
  // turn and are appended afterwards, where nothing can reach them. See scopeNotes.js for
  // what is proven here and what is keyword-anchored.
  const limitations = scopePrune.kept.concat(omissions)

  if (limitations.length) out.push(`### ${H.limits}\n\n` + limitations.join('\n'))
  if (v.plan.followUp) out.push(`### ${H.next}\n\n${v.plan.followUp}`)

  // ── THE GUARD JUDGES WHAT IS SHOWN ──────────────────────────────────────────
  // `input.correction` was produced by running the guard over the model's `reply` prose —
  // and in THIS path that prose is never rendered at all: the answer is built from the
  // plan. So the correction was always about text the Owner cannot see, and above a
  // fallback it read as a flat contradiction: 「今次組唔到一個可靠嘅答案」 with
  // 「上面講『讀唔到』係唔啱嘅」 underneath it. Both subsystems were right about the read;
  // the correction's premise was what was false.
  //
  // Running it here instead fixes the mirror-image hole in the same move: directAnswer was
  // never checked by the guard, so a false read claim INSIDE the plan reached the Owner
  // unchallenged. The safety control still cannot be lost — it is applied to the finished
  // text rather than carried from an earlier draft of it.
  /**
   * ⛔ THE DETERMINISTIC LIST IS NOT AT THE MODEL'S MERCY.
   *
   * This path runs when the model sent a plan — including one that failed validation and
   * collapsed to a fallback. Without this, a bad plan would SILENTLY SUPPRESS an exhaustive
   * request the Owner made in his own words: the model's failure deciding whether he gets the
   * data he asked for. The section is built from retrieval rows by a function that cannot be
   * handed model text, so it belongs on every exit, not only the tidy one.
   */
  /**
   * ⛔ SERVER-OWNED OUTPUT. Validation and telemetry above ran unchanged — only PRESENTATION
   * authority moves. What the model wrote is still validated, counted and logged; it simply
   * does not appear beside a list it never saw.
   */
  const serverOwnedRows = serverOwnedSupplierList(input)
  if (serverOwnedRows) {
    out.length = 0
    out.push(renderCompleteSupplierList(serverOwnedRows, LABELS))
  }

  const composed = out.join('\n\n')
  const guarded = enforceReadState(composed, Array.isArray(input.perSource) ? input.perSource : [], input.message)
  if (guarded.corrected && guarded.correction) out.push(guarded.correction.trim())

  return {
    reply: out.join('\n\n'),
    applied: true,
    intent: null,
    validated: !lostSomething && !contentLost,
    droppedItems: v.droppedItems,
    droppedFacts: v.droppedFacts,
    droppedSentences: v.droppedSentences
  }
}

/**
 * Build the whole Owner-facing reply.
 *
 * @param {{ reply, message, itemsBySource, perSource, truncated? }} input
 * @returns {{ reply, applied, intent }}
 */
/**
 * STEP 4 — THE ROUTE/EVIDENCE GUARD, wrapped around every exit rather than placed at one.
 *
 * buildReadResultReplyInner returns from three different points, and the read-state guard
 * already taught us what happens when a safety control sits on one path: directAnswer went
 * unchecked for weeks because the guard was applied to a draft rather than to the finished
 * text. A wrapper cannot be bypassed by a future early return.
 *
 * It is INERT unless the turn read nothing AND the router called it CONVERSATION, so every
 * retrieval path passes through byte-identical.
 */
function buildReadResultReply (input = {}) {
  const out = buildReadResultReplyInner(input)
  const routed = enforceRouteEvidence({
    reply: out && typeof out.reply === 'string' ? out.reply : '',
    message: input.message,
    evidenceSets: Array.isArray(input.evidenceSets) ? input.evidenceSets : []
  })
  if (!routed.violated) return out
  // COUNTS ONLY. The withheld sentences are exactly the content that must not be logged.
  try {
    console.log('[AROMA-ROUTE-EVIDENCE]', JSON.stringify({
      withheld: routed.withheld.length,
      sources: routed.sources,
      requestId: input.requestId == null ? null : String(input.requestId)
    }))
  } catch (_) {}
  return Object.assign({}, out, { reply: routed.reply, routeEvidenceWithheld: routed.withheld.length })
}

function buildReadResultReplyInner (input = {}) {
  const original = String(input.reply == null ? '' : input.reply)

  // ── THE HYBRID PATH ─────────────────────────────────────────────────────────
  // When the model returned an Answer Plan, IT decides what the answer is and which rows
  // matter; this module's job narrows to proving and rendering. The template path below
  // stays only as the fallback for turns with no plan, and every fall-through is logged.
  if (input.answerPlan && typeof input.answerPlan === 'object') {
    return renderValidatedPlan(input)
  }

  // ── THE PATH WAS NOT TAKEN, AND THAT IS NEWS ────────────────────────────────
  // The old promise was "a fallback cannot happen without a log line", which was true and
  // far too narrow: it covered failures INSIDE this path and said nothing about the path
  // being skipped. So when a sequencing defect meant no plan was ever requested, three
  // live turns fell back to the template in complete silence — no line, no fallback, no
  // trace. A read turn that reaches here without a plan is now recorded with a reason,
  // because "the layer did not run" must be as visible as "the layer ran and failed".
  if (Array.isArray(input.itemsBySource) && input.itemsBySource.some((g) => g && Array.isArray(g.items) && g.items.length > 0)) {
    const { logAnswerPlan } = require('./answerPlan')
    logAnswerPlan({
      outcome: 'fallback',
      reason: 'no_plan_returned',
      provider: input.provider || null,
      requestId: input.requestId || null
    })
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

  /**
   * ⛔ THE COMPLETE SET GOES TO THE SCREEN, NEVER TO THE PROMPT. These rows never entered
   * the model block, evidence indexing or claim binding — they came straight from retrieval
   * and are rendered by a function that cannot be handed model text.
   */
  const retrievedGroups = Array.isArray(input.retrievedItemsBySource) ? input.retrievedItemsBySource : []
  const supplierRetrieved = retrievedGroups.find((g) => g && g.readKey === 'aroma_system.suppliers' && Array.isArray(g.items))
  // ⛔ THE SAME ONE DECISION as the plan path — same helper, same two effects.
  const serverOwnedRows = serverOwnedSupplierList(input)
  if (serverOwnedRows) {
    out.length = 0
    out.push(renderCompleteSupplierList(serverOwnedRows, LABELS))
  } else if (supplierRetrieved) {
    /**
     * ⛔ 7B — WITHHOLDING IS SAID OUT LOUD. Showing five of thirty-six without a word is the
     * defect this tranche exists to remove; a phrasing outside the recognised set must still
     * leave the Owner able to see that there is more and ask again.
     */
    const shownHere = groups.filter((g) => g.readKey === 'aroma_system.suppliers' || g.source === 'aroma_system')
      .reduce((n, g) => n + Math.min(g.items.length, CAPS.maxItemsPerSection), 0)
    const withheld = supplierRetrieved.items.length - shownHere
    if (withheld > 0) out.push('（供應商共 ' + supplierRetrieved.items.length + ' 項，此處只顯示 ' + shownHere + ' 項，未顯示 ' + withheld + ' 項；想睇齊全部請講「列出全部供應商」。）')
  }

  // ⛔ In server-owned mode the deterministic list IS the answer: no server limits about
  //    hidden rows (nothing is hidden), and no model reading of a view it never had.
  if (!serverOwnedRows) {
    if (limits) out.push(limits)
    // Her reading of what is above — after the data, before the question.
    const opinion = extractOpinion(original)
    if (opinion) out.push(`### ${H.opinion}\n\n${opinion}`)
    out.push(`### ${H.next}\n\n${oneQuestion(splitModelReply(original).next, intent)}`)
  }

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
  isExhaustiveListRequest,
  renderCompleteSupplierList,
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
