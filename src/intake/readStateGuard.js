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

// Human vocabulary only — what the Owner CALLS a thing, never the list of what exists.
const VOCABULARY = Object.freeze({
  calendar: { words: ['日曆', '日程', '行事曆', '行程', '排程', 'calendar', 'schedule'], label: '日曆' },
  gmail: { words: ['gmail', '電郵', '郵件', '信箱', '收件箱', 'email', 'e-mail', 'mail', 'inbox'], label: 'Gmail' },
  drive: { words: ['drive', '雲端', '雲端硬碟', '文件', '檔案', 'google drive', 'docs'], label: 'Drive' },
  github: { words: ['github', '程式碼庫', '版本庫', 'repo', 'repository'], label: 'GitHub' },
  aroma_system: { words: ['aroma system', 'aroma-system', 'aroma_system', '餐廳系統', '系統'], label: '餐廳系統' },
  // Not a read source — the Decision Recall block, which the Owner can be told about the
  // same way. It is listed here rather than in ALL_SOURCES because nothing reads it.
  decisions: { words: ['過往決定', '決定紀錄'], label: '過往決定' }
})

const SOURCE_KEYS = Object.freeze([...new Set([...ALL_SOURCES, ...Object.keys(VOCABULARY)])])

/** Every key gets aliases: its own name, its spaced form, and any human words for it. */
const SOURCE_ALIASES = Object.freeze(SOURCE_KEYS.reduce((acc, key) => {
  const extra = (VOCABULARY[key] && VOCABULARY[key].words) || []
  acc[key] = [...new Set([key, key.replace(/_/g, ' '), ...extra])]
  return acc
}, {}))

/** The Owner-facing name. Falls back to the key so a new source is named, not skipped. */
const LABELS = Object.freeze(SOURCE_KEYS.reduce((acc, key) => {
  acc[key] = (VOCABULARY[key] && VOCABULARY[key].label) || key
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
function detectFalseReadClaim (reply, perSource) {
  const text = typeof reply === 'string' ? reply : ''
  const rows = Array.isArray(perSource) ? perSource : []
  if (!text || rows.length === 0) return { violated: false, sources: [], kind: null }
  if (!UNREADABLE_CLAIM.test(text)) return { violated: false, sources: [], kind: null }

  const live = rows.filter((r) => r && r.trust === 'live')
  if (live.length === 0) return { violated: false, sources: [], kind: null } // nothing was read; the claim is true

  // Only clauses that actually carry a failure phrase can attribute one.
  const named = new Set()
  for (const clause of clausesOf(text)) {
    const fail = UNREADABLE_CLAIM.exec(clause)
    if (!fail) continue
    for (const r of live) {
      if (!mentionsSource(clause, r.source)) continue
      if (isModifierNotSubject(clause, r.source, fail.index)) continue
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
        ? `${label}：讀到咗（${r.count} 項，但唔喺你問嗰段時間內，係之後嘅）`
        : `${label}：讀到咗（${r.count} 項）`
    }
    return `${label}：讀到咗，但冇相關結果`
  })
  return '\n\n〔系統更正 — 依實際讀取紀錄〕上面講「讀唔到」係唔啱嘅。' + parts.join('；') + '。以呢個紀錄為準。'
}

/**
 * Enforce. Returns the reply to actually use, plus whether a correction was applied.
 * The original reply is NEVER edited — the correction is appended after it.
 *
 * @returns {{ reply: string, corrected: boolean, sources: string[], kind: string|null }}
 */
function enforceReadState (reply, perSource) {
  const found = detectFalseReadClaim(reply, perSource)
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

module.exports = { enforceReadState, detectFalseReadClaim, buildCorrection, UNREADABLE_CLAIM, SOURCE_ALIASES, LABELS, SOURCE_KEYS, VOCABULARY }
