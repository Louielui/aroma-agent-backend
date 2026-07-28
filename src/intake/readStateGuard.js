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

// What the Owner calls each source. Used to tell WHICH source a claim is about.
const SOURCE_ALIASES = Object.freeze({
  calendar: ['日曆', '日程', '行事曆', '行程', '排程', 'calendar', 'schedule'],
  gmail: ['gmail', '電郵', '郵件', '信箱', '收件箱', 'email', 'e-mail', 'mail', 'inbox'],
  drive: ['drive', '雲端', '雲端硬碟', '文件', '檔案', 'google drive', 'docs'],
  github: ['github', '程式碼庫', '版本庫', 'repo', 'repository']
})

const LABELS = Object.freeze({ calendar: '日曆', gmail: 'Gmail', drive: 'Drive', github: 'GitHub', decisions: '過往決定' })

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
function detectFalseReadClaim (reply, perSource) {
  const text = typeof reply === 'string' ? reply : ''
  const rows = Array.isArray(perSource) ? perSource : []
  if (!text || rows.length === 0) return { violated: false, sources: [], kind: null }
  if (!UNREADABLE_CLAIM.test(text)) return { violated: false, sources: [], kind: null }

  const live = rows.filter((r) => r && r.trust === 'live')
  const unavailable = rows.filter((r) => r && r.trust !== 'live')
  if (live.length === 0) return { violated: false, sources: [], kind: null } // nothing was read; the claim is true

  const namedLive = live.filter((r) => mentionsSource(text, r.source)).map((r) => r.source)
  if (namedLive.length > 0) return { violated: true, sources: namedLive, kind: 'named' }
  if (unavailable.length === 0) return { violated: true, sources: live.map((r) => r.source), kind: 'generic' }
  return { violated: false, sources: [], kind: null }
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
  return {
    reply: String(reply) + buildCorrection(perSource, found.sources),
    corrected: true,
    sources: found.sources,
    kind: found.kind
  }
}

module.exports = { enforceReadState, detectFalseReadClaim, buildCorrection, UNREADABLE_CLAIM, SOURCE_ALIASES, LABELS }
