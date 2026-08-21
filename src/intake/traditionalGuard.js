'use strict'

/**
 * traditionalGuard.js — the language rule stops being prose. Beside `enforceReadState`.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Measured 2026-08-07: she replied in Simplified — 「查不到是因为系统里还没有它的历史比较基准」.
 * The contract WAS on and WAS applied; the rule simply had no output check.
 *
 * > **成個禮拜都係繁體,唔係因為佢受保護,係因為嗰句指示夠強,加上運氣。**
 *
 * ⛔ IT DETECTS AND RECORDS. IT DOES NOT REWRITE, AND IT DOES NOT SPEAK TO HIM.
 *
 * ⛔ E1 (2026-08-21): THE DIAGNOSTIC USED TO BE APPENDED TO THE REPLY. It was removed, and
 * the reason is worth keeping. The C0 forensic on conversation 2f42f099 found the note on
 * two of four turns, and the damage was not that it looked untidy:
 *
 *   · it reached the Owner as if 香香 had written it — an internal instrument speaking in
 *     her voice, mid-conversation, about her own output;
 *   · and because the reply is pushed back into the live history as her prior turn, the note
 *     RE-ENTERED the model's own context as her prose. The system was teaching the persona
 *     that she writes internal warnings to him.
 *
 * The failure was already countable in `[AROMA-LANG]` before any of that, so the visible
 * sentence bought nothing that the log did not already hold. Detection stayed; the speech
 * went. If you are about to append text to `reply` here again, that is the thing that was
 * removed on purpose — the audit trail belongs in the log line below, not on his screen.
 *
 * Simplified→Traditional is not one-to-one: `发` → 發/髮, `干` → 乾/幹/干, `后` → 後/后.
 * A hand-written mapping produces **wrong Chinese that looks deliberate**, which is worse than
 * right Chinese in the wrong script. The Owner settled it: no rewrite, and no paid re-ask.
 *
 * ⛔ AND IT PASSES ON UNCERTAINTY, DELIBERATELY.
 *
 * The answerable question is not 「is this Traditional?」 — most characters are shared and that
 * question has no answer. It is **「is there POSITIVE EVIDENCE of Simplified?」**
 *
 *   correcting on uncertainty  → rewriting text on no evidence. The only failure mode that
 *                                damages correct output, and it would hit English, numbers and
 *                                proper nouns.
 *   passing on uncertainty     → 「no distinctive character present」. For a reply of any length
 *                                that is strong evidence; for a short one there was nothing to
 *                                act on anyway. **Uncertainty and harmlessness are largely the
 *                                same case.**
 *
 * ⚠ WHAT IT MISSES, STATED: a long Simplified reply that happens to use only shared characters.
 * Rare, not impossible. This narrows the surface; it does not close it.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Characters that exist in Simplified and whose Traditional form is a DIFFERENT character.
 * Deliberately a small, high-confidence set of common ones — a long list would be a maintained
 * list, and the point of a short one is that every entry is certain.
 *
 * ⛔ EVERY ENTRY MUST FAIL THIS TEST: written in Traditional, is it a DIFFERENT character?
 * If the answer is「same character」, it is not evidence of anything and it will fire on
 * correct Traditional prose. 出 and 外 were removed on 2026-08-21 for exactly that reason —
 * both are written identically in both scripts, and 出 fired twice on 「開發出來」 in the
 * Owner's own conversation. They had drifted in beside 进/内, which ARE distinct (進/內);
 * neighbouring a real entry is not what qualifies one.
 */
const SIMPLIFIED_ONLY = '为这来说时会对开关问题实现发现电话语言书写学习经过还没门间与产业动务员单双击图关闭订单价钱银钱铁马鸟鱼东车专业务网络软硬盘线级组织结构规则质量适应该应当机会区别识认识记忆种类样式条数据库编码译码运输进内见观点认为习惯节约简单复杂错误'

const SET = new Set(Array.from(SIMPLIFIED_ONLY))

const VERDICT = Object.freeze({
  CLEAN: 'CLEAN',                   // no distinctive Simplified character found
  SIMPLIFIED_FOUND: 'SIMPLIFIED_FOUND', // positive evidence — flagged and recorded
  NO_EVIDENCE: 'NO_EVIDENCE'        // nothing to judge: no Han characters at all
})

/**
 * ⛔ RETIRED (E1). This sentence used to be appended to the Owner's reply. It is kept as an
 * exported constant for ONE reason: so the regression test can assert its exact bytes are
 * absent from every reply, rather than guessing at a paraphrase. Nothing appends it. If you
 * find yourself reaching for it, read the E1 block at the top of this file first.
 */
const RETIRED_NOTE = '\n\n⚠(呢個回覆入面有簡體字 —— 我冇改佢,因為簡轉繁唔係一對一,改錯咗會變成似係故意噉寫嘅錯中文。)'

/**
 * @param {string} reply
 * @returns {{verdict, found: string[], reply: string, flagged: boolean}}
 */
function enforceTraditional (reply) {
  const text = typeof reply === 'string' ? reply : ''
  const hasHan = /[一-鿿]/.test(text)
  if (!hasHan) {
    // ⛔ Nothing to judge. NOT the same as clean — an English reply was never in scope.
    return { verdict: VERDICT.NO_EVIDENCE, found: [], reply: text, flagged: false }
  }

  const found = []
  for (const ch of text) {
    if (SET.has(ch) && !found.includes(ch)) found.push(ch)
  }

  if (!found.length) {
    return { verdict: VERDICT.CLEAN, found: [], reply: text, flagged: false }
  }

  // ⛔ FLAGGED, NOT FIXED, AND NOT ANNOTATED. `reply` is returned byte-identical to what she
  // wrote — flagging is a fact about the turn, not a change to it. The failure is recorded in
  // `[AROMA-LANG]` by logTraditionalFlag; that is the whole of the audit trail.
  return {
    verdict: VERDICT.SIMPLIFIED_FOUND,
    found: found.slice(0, 12),
    reply: text,
    flagged: true
  }
}

/**
 * ⛔ ONE LINE WHEN IT FIRES, so the failure is COUNTABLE and not merely visible on one screen.
 * Allowlisted by construction: the characters found and the request id — never the reply.
 */
function logTraditionalFlag (result, requestId) {
  if (!result || !result.flagged) return
  try {
    console.log('[AROMA-LANG]', JSON.stringify({
      event: 'SIMPLIFIED_IN_REPLY',
      timestamp: new Date().toISOString(),
      found: result.found,
      requestId: typeof requestId === 'string' ? requestId : null
    }))
  } catch (_) {}
}

module.exports = { enforceTraditional, logTraditionalFlag, VERDICT, SIMPLIFIED_ONLY, RETIRED_NOTE }
