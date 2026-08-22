'use strict'
/**
 * workingContext.js — X2 Part A. The turn the Owner is actually in the middle of.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS IS NOT CONVERSATION RECALL, AND WHY BOTH EXIST.
 *
 * `lab/conversationRecall.js` deliberately skips the live conversation — 「the live one is not
 * memory」 — and that rule is right and stays. Memory is what happened in OTHER conversations.
 *
 * The consequence was measured in production, request 7b0699ce: the Owner wrote 「我說的是…」,
 * a correction of a goal established two turns earlier, and the Cognitive Core saw that
 * sentence ALONE. Recall was present and correctly contained other conversations; the current
 * one was excluded by design; `history` was never passed to the core at all. The finalVerifier
 * and the source resolver both had four Owner messages. The component whose entire job is
 * understanding what he wants had one.
 *
 * WORKING CONTEXT is the missing third thing: the immediately preceding turns of THIS
 * conversation, already in hand on this request. No store, no archive, no connector, no model
 * call — the array arrives with the request and this only bounds and renders it.
 *
 * ⛔ CONTEXT, NEVER EVIDENCE. It carries no source, no id, no trust and no retrieval date, so
 * nothing in it can enter the evidence index or be cited by an Answer Plan. A source NAMED in
 * here authorises nothing: `sourcesForPlan` reads facts and their operations, and the Owner's
 * own flags decide what may be reached.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ⛔ BOUNDS. Deliberately small: this is the thread of the current exchange, not a long-context
 * system. `publicQueryEgressPlanner` already carries a bounded owner-context extractor with
 * 4 messages / 1,200 total, and those two caps are matched here on purpose so two bounded
 * views of the same conversation cannot disagree about how much is 「a little」. Its per-message
 * cap is 400 and this one is 300, because that extractor keeps ONLY Owner messages while this
 * keeps both sides and therefore holds roughly twice as many.
 */
const MAX_MESSAGES = 4
const MAX_MESSAGE_CHARS = 300
const MAX_TOTAL_CHARS = 1200

const OWNER_ROLE = 'user'
const ASSISTANT_ROLE = 'assistant'

const LABEL = '【WORKING CONTEXT — 當前對話前文；CONTEXT，不是 EVIDENCE】'

/**
 * Bound the current conversation's preceding turns.
 *
 * ⛔ THE CURRENT MESSAGE IS NOT IN HERE. It is the question, and a question that also appears
 * as its own context reads as though he said it twice.
 *
 * @param {Array<{role:string,text:string}>} history  as the request already carries it
 * @returns {{block:string|null, messages:number, chars:number}}
 */
function buildWorkingContext (history) {
  const rows = []
  for (const h of (Array.isArray(history) ? history : [])) {
    if (!h || typeof h !== 'object') continue
    const role = h.role === ASSISTANT_ROLE ? ASSISTANT_ROLE : (h.role === OWNER_ROLE ? OWNER_ROLE : null)
    if (!role) continue
    // Both shapes are accepted: the wire carries `text`, the stored transcript uses `content`.
    const raw = typeof h.text === 'string' ? h.text : (typeof h.content === 'string' ? h.content : '')
    const s = raw.trim().slice(0, MAX_MESSAGE_CHARS)
    if (!s) continue
    rows.push({ role, text: s })
  }
  if (!rows.length) return { block: null, messages: 0, chars: 0 }

  // Newest-first while trimming, then restored to reading order — when a cap bites it drops the
  // OLDEST turn, not the one he just corrected.
  const kept = []
  let total = 0
  for (const r of rows.slice(-MAX_MESSAGES).reverse()) {
    if (total + r.text.length > MAX_TOTAL_CHARS) break
    total += r.text.length
    kept.unshift(r)
  }
  if (!kept.length) return { block: null, messages: 0, chars: 0 }

  const lines = [
    LABEL,
    '呢啲係當前對話緊接住嘅前幾句，用嚟解決指代、修正同跟進。',
    '⛔ 佢哋唔係「而家嘅事實」嘅證明。就算入面提到 Gmail、Drive 或者 Aroma System，都唔等於獲准去讀嗰個來源。',
    '',
    ...kept.map((r) => (r.role === ASSISTANT_ROLE ? '香香: ' : 'Louie: ') + r.text),
    '',
    /**
     * ⛔ SEMANTIC GUIDANCE, NOT A ROUTER. No keyword list decides this — the model reads the
     * exchange above and judges whether the new sentence continues, corrects, refines or
     * replaces what was already being solved. A regex for 「我說的是」 would be the same defect
     * as the keyword source router, one layer up.
     */
    'Owner 呢句好可能係喺延續、修正或者補充上面正在傾緊嗰件事，而唔係一條全新嘅獨立問題。',
    '先判斷佢係「繼續／更正／補充／換咗新題目」邊一種，再決定要答乜。'
  ]
  return { block: lines.join('\n'), messages: kept.length, chars: total }
}

module.exports = {
  buildWorkingContext,
  LABEL,
  MAX_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_TOTAL_CHARS
}
