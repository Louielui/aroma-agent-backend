'use strict'

/**
 * readStateGuard.js — a reply may not claim a source was unreadable when it was read.
 *
 * WHY THIS IS CODE AND NOT CONTRACT TEXT. The safety header already spells the rule out
 * in the prompt, in capitals: a line marked "read OK — no matching results" means say
 * 讀到但冇相關結果, and only "UNAVAILABLE" means say 目前讀不到. That instruction has now
 * failed FIVE times. The telemetry for the failing turn was unambiguous —
 * trust:"live", count:2, usedFallback:true, error:null — and 心燈 still told the Owner
 * 「我目前讀唔到你的日程」. The data was honest; the narration was not.
 *
 * So this follows groundedReply.js, the one enforcement in this pipeline that has never
 * failed, and for the same reason: it does not ask the model to be careful. It checks the
 * claim against the RECORDED outcome of that turn and acts on the difference.
 *
 * ── THE CORRECTION IS AN APPENDED, VISIBLE NOTE — not a rewrite, not a refusal ──
 * Three behaviours were possible:
 *   REWRITE  — rejected. Editing the model's sentences changes meaning silently, which is
 *              the one thing the Owner ruled out, and a bad edit is undetectable.
 *   REFUSE   — rejected. Dropping the reply repeats the mistake the interception made
 *              when it discarded a real 622-token answer: the Owner loses a good answer
 *              because one clause was wrong.
 *   CORRECT  — chosen. The reply is kept intact and a deterministic, clearly-labelled
 *              correction is appended, stating what was actually read. The Owner sees
 *              both the claim and the record, and knows which one the system stands
 *              behind. It is visible on screen, countable in telemetry, and testable.
 *
 * The three states and the existing rendering are untouched; this only adds enforcement.
 */

// Ways of saying "I could not read it". Deliberately broad — a false claim phrased
// slightly differently is still a false claim.
const UNREADABLE_CLAIM = /(讀唔到|讀不到|睇唔到|看不到|攞唔到|拿不到|取唔到|無法讀取|無法存取|冇權限|沒有權限|讀取失敗|存取失敗|連唔到|連不上|未能讀取|無法取得|不能讀取|cannot read|can'?t read|unable to read|couldn'?t read|no access|access denied|failed to read)/i

// ── THE SOURCE MAPS ARE DERIVED, NOT LISTED ───────────────────────────────────
// These two tables used to be hardcoded to four sources. A fifth was connected and read
// live, and because it had no entry here `mentionsSource()` could never match it and
// `LABELS` could never name it — so the correction block enumerated the same four names
// while the fifth source's rows sat in the same turn's record. The guard that exists to
// stop a false claim was itself making one.
//
// Now the KEYS come from ALL_SOURCES. A source that is registered but has no human
// vocabulary below still gets its own key as an alias and its own name as a label, so a
// new source is never invisible here — it is merely less well described, and the test
// below fails until someone gives it words.
const { ALL_SOURCES } = require('../context/liveClients')
const { t } = require('../i18n/t')
const { intentFor } = require('../context/readContext') // THE one intent table — the entity a turn is about
const { isReadRequest } = require('./laneRouter') // 「did he ask me to look」 — already the one detector for that

// Human vocabulary only — what the Owner CALLS a thing, never the list of what exists.
const VOCABULARY = Object.freeze({
  // ⛔ THE `words` ARE MATCHING TOKENS — they are compared against WHAT HE TYPES and are
  // NEVER translated. Only `label` is interface. Two classes, one table, marked in place
  // because textClasses is per-file. See governance/textClasses.js.
  calendar: { words: ['日曆', '日程', '行事曆', '行程', '排程', 'calendar', 'schedule'], label: () => t('src.calendar') },
  gmail: { words: ['gmail', '電郵', '郵件', '信箱', '收件箱', 'email', 'e-mail', 'mail', 'inbox'], label: () => 'Gmail' },
  drive: { words: ['drive', '雲端', '雲端硬碟', '文件', '檔案', 'google drive', 'docs'], label: () => 'Drive' },
  github: { words: ['github', '程式碼庫', '版本庫', 'repo', 'repository'], label: () => 'GitHub' },
  aroma_system: { words: ['aroma system', 'aroma-system', 'aroma_system', '餐廳系統', '系統'], label: () => t('src.aromaSystem') },
  // Not a read source — the Decision Recall block, which the Owner can be told about the
  // same way. It is listed here rather than in ALL_SOURCES because nothing reads it.
  decisions: { words: ['過往決定', '決定紀錄'], label: () => t('src.decisions') }
})

const SOURCE_KEYS = Object.freeze([...new Set([...ALL_SOURCES, ...Object.keys(VOCABULARY)])])

/** Every key gets aliases: its own name, its spaced form, and any human words for it. */
const SOURCE_ALIASES = Object.freeze(SOURCE_KEYS.reduce((acc, key) => {
  const extra = (VOCABULARY[key] && VOCABULARY[key].words) || []
  acc[key] = [...new Set([key, key.replace(/_/g, ' '), ...extra])]
  return acc
}, {}))

/** The Owner-facing name. Falls back to the key so a new source is named, not skipped. */
/**
 * ⛔ GETTERS, so `LABELS[x]` is still a STRING at every call site while being read at use time.
 * A thunk here would have forced every consumer — readResultView, the correction block, the
 * settings screen — to learn that a label is now a function.
 */
const LABELS = Object.freeze(SOURCE_KEYS.reduce((acc, key) => {
  Object.defineProperty(acc, key, {
    enumerable: true,
    get () { return (VOCABULARY[key] && VOCABULARY[key].label()) || key }
  })
  return acc
}, {}))

function mentionsSource (reply, source) {
  const aliases = SOURCE_ALIASES[source]
  if (!aliases) return false
  const low = String(reply).toLowerCase()
  return aliases.some((a) => low.includes(a.toLowerCase()))
}

/**
 * Did this reply claim something was unreadable that was, in fact, read?
 *
 * Two-tier, deliberately conservative so a TRUE statement is never "corrected":
 *   1. the reply names a source that was LIVE this turn        → violation (that source)
 *   2. no source was unavailable at all, yet the reply says it
 *      could not read                                          → violation (generic)
 *   3. some source genuinely WAS unavailable and none of the
 *      live ones is named                                      → no violation; the claim
 *                                                                is plausibly about it
 *
 * @param {string} reply
 * @param {Array<{source, trust, count, usedFallback}>} perSource  the turn's real outcome
 * @returns {{ violated: boolean, sources: string[], kind: 'named'|'generic'|null }}
 */
/**
 * THE CLAUSE IS THE UNIT OF ATTRIBUTION.
 *
 * A claim is read in relation to what it NAMES, and a name in a different clause names
 * nothing here: 「日曆有 3 件安排；發票的服務項目內容無法讀取」 must not be corrected because
 * the calendar appears earlier in the sentence.
 */
const CLAUSE_SPLIT = /[。！？!?；;\n]|(?<=[，,])/

function clausesOf (text) {
  return String(text).split(CLAUSE_SPLIT).map((c) => (c || '').trim()).filter(Boolean)
}

/**
 * IS THE SOURCE THE THING THAT COULD NOT BE READ, OR JUST WHAT IT BELONGS TO?
 *
 * 「行事曆項目的與會者名單看不到」 names the calendar and is NOT about the calendar: the
 * alias is a modifier and the head noun is 與會者名單. My own test caught this after the
 * clause rule was already in — naming a source is not the same as being the subject of the
 * failure.
 *
 * The signal is 的 standing BETWEEN the alias and the failure phrase, which in Chinese marks
 * everything before it as a modifier of what follows. It applies only when the alias comes
 * FIRST: 「讀唔到你的日程」 puts the failure before the alias, so the alias is its object and
 * the 的 belongs to 你, not to a competing head noun.
 *
 * COST, STATED: 「日曆的資料讀唔到」 is arguably a source claim and is now left alone. That is
 * the asymmetry the Owner ruled for — silence when it cannot tell.
 */
function isModifierNotSubject (clause, source, failIndex) {
  const low = String(clause).toLowerCase()
  for (const alias of SOURCE_ALIASES[source] || []) {
    const at = low.indexOf(String(alias).toLowerCase())
    if (at === -1) continue
    if (at > failIndex) return false // the failure names it: 讀唔到…日程
    const between = clause.slice(at + alias.length, failIndex)
    if (!between.includes('的')) return false // nothing stands between them
  }
  return true
}

/**
 * Did this reply claim a SOURCE was unreadable when that source was, in fact, read?
 *
 * ── WHY THIS WAS REWRITTEN, 2026-08-05 ───────────────────────────────────────
 * The old rule fired whenever the text matched UNREADABLE_CLAIM and either named a live
 * source OR named nothing at all while nothing was unavailable. That second branch —
 * `kind: 'generic'` — is the shape of a TRUE statement about a missing field, and it
 * produced exactly that: 「發票的具體服務項目內容無法讀取」 is correct (the invoice record
 * carries no line items) and was contradicted with 「餐廳系統：讀到咗（1 項）」.
 *
 * The distinction the old rule could not make is between a claim about a SOURCE and a claim
 * about a FIELD INSIDE a record. Narrowing the regex would not have fixed it: the line
 * between 無法讀取 and 無法確認 was arbitrary — the first fired, the second did not, for no
 * defensible reason.
 *
 * NOW: the claim must be ATTRIBUTABLE. It fires only when the clause carrying the failure
 * phrase also names a source that was read live. Anything it cannot attribute, it leaves
 * alone.
 *
 * ── THE ASYMMETRY IS DELIBERATE, AND IT COSTS SOMETHING ──────────────────────
 * A bare 「我讀唔到」 with everything live is now NOT corrected. That is a real loss and the
 * Owner ruled on it directly: a missed correction is recoverable, a wrong one teaches him to
 * ignore the control. A safety control that argues with a true statement is worse than one
 * that stays quiet.
 *
 * @returns {{ violated: boolean, sources: string[], kind: 'named'|null }}
 */
/**
 * WHAT THIS TURN WAS ABOUT — the intent's own noun, when the message names one.
 *
 * 「今日的安排目前讀不到」 named no SOURCE, so the clause rule left it alone — and the calendar
 * had returned a row. The thing she made a claim about was 安排, which is exactly what the
 * intent table already calls the entity a schedule question is about.
 *
 * This is a BACKSTOP, not the fix. The fix is upstream, in the header that now names the
 * state she was in; a guard cannot make her say the right thing, only argue afterwards.
 *
 * It costs no new vocabulary and reopens nothing: the modifier rule already separates
 * 「今日的安排目前讀不到」 (安排 directly before the failure — the subject) from
 * 「發票的具體服務項目內容無法讀取」 (發票 separated by 的 + another noun — a modifier).
 */
function entityAnchorOf (message) {
  const hit = intentFor(typeof message === 'string' ? message : '')
  if (!hit || !hit.noun || !Array.isArray(hit.sources)) return null
  return { noun: String(hit.noun), sources: hit.sources.slice() }
}

function detectFalseReadClaim (reply, perSource, message) {
  const text = typeof reply === 'string' ? reply : ''
  const rows = Array.isArray(perSource) ? perSource : []
  if (!text || rows.length === 0) return { violated: false, sources: [], kind: null }
  if (!UNREADABLE_CLAIM.test(text)) return { violated: false, sources: [], kind: null }

  const live = rows.filter((r) => r && r.trust === 'live')
  if (live.length === 0) return { violated: false, sources: [], kind: null } // nothing was read; the claim is true

  // Only clauses that actually carry a failure phrase can attribute one.
  const entity = entityAnchorOf(message)
  const named = new Set()
  for (const clause of clausesOf(text)) {
    const fail = UNREADABLE_CLAIM.exec(clause)
    if (!fail) continue
    for (const r of live) {
      if (mentionsSource(clause, r.source) && !isModifierNotSubject(clause, r.source, fail.index)) {
        named.add(r.source)
        continue
      }
      // THE ENTITY THIS TURN WAS ABOUT anchors a claim the same way a source name does,
      // and is held to the same modifier test.
      if (!entity || !entity.sources.includes(r.source)) continue
      const at = clause.indexOf(entity.noun)
      if (at === -1) continue
      if (at < fail.index && clause.slice(at + entity.noun.length, fail.index).includes('的')) continue
      named.add(r.source)
    }
  }

  if (named.size === 0) return { violated: false, sources: [], kind: null } // unattributable → silent
  return { violated: true, sources: [...named], kind: 'named' }
}

/**
 * The deterministic correction. Built from the recorded outcome only — it states counts
 * and states, never content, and never guesses what the answer should have been.
 */
function buildCorrection (perSource, sources) {
  const rows = (Array.isArray(perSource) ? perSource : []).filter((r) => sources.includes(r.source))
  const parts = rows.map((r) => {
    const label = LABELS[r.source] || r.source
    if (r.count > 0) {
      return r.usedFallback
        ? t('rsg.readOutOfWindow', { label, n: r.count })
        : t('rsg.readCount', { label, n: r.count })
    }
    return t('rsg.readNothing', { label })
  })
  return t('rsg.correction', { parts: parts.join(t('punct.clauseSep')) })
}

/**
 * Enforce. Returns the reply to actually use, plus whether a correction was applied.
 * The original reply is NEVER edited — the correction is appended after it.
 *
 * @returns {{ reply: string, corrected: boolean, sources: string[], kind: string|null }}
 */
function enforceReadState (reply, perSource, message) {
  const found = detectFalseReadClaim(reply, perSource, message)
  if (!found.violated) return { reply, corrected: false, sources: [], kind: null }
  const correction = buildCorrection(perSource, found.sources)
  return {
    reply: String(reply) + correction,
    // THE CORRECTION ON ITS OWN. The presentation layer rebuilds a read reply from the
    // retrieved rows and keeps only the model's final question, so a correction appended
    // to the end of her prose would be discarded with the prose. Returning it separately
    // lets the renderer carry it through — a safety control may not be lost to a layout
    // change, and this is cheaper and less fragile than searching the text for it again.
    correction,
    corrected: true,
    sources: found.sources,
    kind: found.kind
  }
}

/**
 * ── A TURN THAT READ NOTHING MAY NOT LEAVE A CAPABILITY CLAIM STANDING ────────
 *
 * > **Owner: 「冇讀過就只准講『我冇去睇』，唔准講『我冇權限』」**
 *
 * Everything above this line matches PHRASINGS, and that is precisely how the 2026-08-08 turn
 * escaped: `UNREADABLE_CLAIM` holds 「沒有權限」 and she wrote 「沒有直接連接到 Aroma System 的
 * 讀取權限」. Four more variants missed the same way (「我未連接」,「我沒有讀取權限」…). Widening
 * the list is worth doing and is still a list.
 *
 * ⛔ SO THIS FUNCTION NEVER LOOKS AT HER WORDS. Its inputs are the TURN RECORD — was anything
 * read — and the OWNER'S message — did he ask for a look. Both are facts the server already
 * holds. A phrasing nobody has thought of is covered, because phrasing is not consulted.
 *
 * ── WHY IT IS GATED ON 「he asked for a look」 ────────────────────────────────
 * Most turns read nothing, correctly. Annotating all of them would be noise, and a control
 * that fires on correct work gets switched off — which is the other half of HR-47 and the
 * reason `detectFalseReadClaim` above was narrowed rather than widened. The note is earned
 * only when he ASKED her to look and the record shows she did not.
 *
 * ⚠ WHAT IT CANNOT DO: it cannot stop her saying it, only put the record beside it. And it
 * cannot tell a capability claim from an honest 「我沒有去看」 — it does not read either — so
 * on an honest reply the note is redundant. Redundant-and-true is the safe side of that trade.
 */
function detectUnreadTurnClaim (perSource, message) {
  const readAnything = Array.isArray(perSource) && perSource.length > 0
  if (readAnything) return false // that case belongs to detectFalseReadClaim, above

  const text = typeof message === 'string' ? message : ''
  if (!text.trim()) return false

  // Did he ask her to look? Either he named a source, or the message is a lookup request.
  const namedSource = SOURCE_KEYS.some((k) => mentionsSource(text, k))
  return namedSource || isReadRequest(text)
}

/**
 * @param {string} reply
 * @param {object[]} perSource  the turn's read records — EMPTY is the case this owns
 * @param {string} message      the Owner's words
 * @param {{reason?: string}} [route]  the router's own reason, when known
 * @returns {{ reply: string, flagged: boolean, note: string }}
 */
function enforceNoReadClaim (reply, perSource, message, route) {
  if (!detectUnreadTurnClaim(perSource, message)) {
    return { reply, flagged: false, note: '' }
  }
  // The router already knows why it read nothing. Saying so turns 「nothing was read」 from an
  // assertion into an explanation, which is the difference between a warning and a diagnosis.
  const why = (route && route.reason && route.reason !== 'intent')
    ? t('rsg.nothingReadWhyNoIntent')
    : ''
  const note = t('rsg.nothingReadNote', { what: t('rsg.nothingRead'), why })
  return { reply: String(reply) + note, flagged: true, note }
}

module.exports = { enforceReadState, enforceNoReadClaim, detectFalseReadClaim, detectUnreadTurnClaim, buildCorrection, UNREADABLE_CLAIM, SOURCE_ALIASES, LABELS, SOURCE_KEYS, VOCABULARY }
