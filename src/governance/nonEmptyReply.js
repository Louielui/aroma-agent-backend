'use strict'

/**
 * nonEmptyReply.js — no code path may ship silence.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED, 17:18 local, real UI, POST /api/v1/demo/intake.
 *
 *   user   「公開網站網址是什麼?」
 *   stored  { role: 'assistant', servedBy: 'claude-haiku-4-5-20251001', content: '' }
 *
 * A completed model call — `servedBy` is populated — that shipped a zero-length reply. The UI
 * rendered its meta label and nothing else.
 *
 * > **Owner: 「An empty reply is worse than a wrong one because it is silent.」**
 *
 * A wrong answer tells him something is broken. Silence tells him nothing, and it is
 * indistinguishable from a slow network, a closed tab, or his own message not sending.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ⛔ THIS IS A LAST-RESORT FLOOR, NOT A FIX FOR THE CAUSE. It guarantees the turn carries a
 * signal; it does not know why the text vanished, and it must never be read as having repaired
 * anything. Whatever emptied the reply is still there — see the note on the cause below.
 *
 * ⛔ AND THE SENTENCE MUST ANNOUNCE ITSELF AS A FAULT. A neutral placeholder (「我唔知」,
 * 「請再試」) would read as an ANSWER, and the Owner would file it as her being unhelpful
 * rather than as the system failing. That is the silence defect moved one layer up.
 */

/**
 * The one defined outcome. ⛔ INTERFACE text — he reads it — but its SHAPE is load-bearing:
 * it must name itself a fault, and a test pins that.
 */
const EMPTY_REPLY_DEFECT =
  '⛔ 系統出錯：呢個回合冇產生到任何回覆內容。呢個係一個故障，唔係一個答案 —— ' +
  '唔好當我係答咗「冇嘢」。請再問一次；如果再出現，話我知，因為呢個要查。'

/**
 * @param {*} reply whatever the pipeline is about to ship
 * @returns {{reply:string, wasEmpty:boolean}}
 */
function ensureNonEmptyReply (reply) {
  const s = typeof reply === 'string' ? reply : ''
  if (s.trim().length === 0) return { reply: EMPTY_REPLY_DEFECT, wasEmpty: true }
  return { reply: s, wasEmpty: false }
}

module.exports = { ensureNonEmptyReply, EMPTY_REPLY_DEFECT }
