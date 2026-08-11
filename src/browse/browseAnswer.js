'use strict'

/**
 * browseAnswer.js — what the Owner reads, derived from the descriptor and A1's gate.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ IT MAY NEVER SAY 「Superstore 賣 $4.99」.
 *
 * > **Owner: 「It is one row from a page we could not count.」**
 *
 * The deleted `browseResult.js` rendered `<label> 查到：<product> — <price>` from the first
 * observation. That sentence is a claim about what the shop charges. What we hold is one row of
 * page one of a search, filtered by a store predicate nobody chose, with no total printed
 * anywhere. Every one of those facts is in the descriptor; this file's only job is to refuse to
 * write a sentence the descriptor does not support.
 *
 * ⛔ AND 「沒有找到」 IS NOT 「沒有」.
 *
 * `NO_RELEVANT_RESULTS` is a fact about OUR SEARCH. 「Superstore 冇花生醬」 is a claim about the
 * shop. A1 knows the difference — its gate refuses the second as `ABSENCE_AS_PROOF` — and the
 * distinction is kept in the words here, not only in the field, because the field is not what
 * the Owner reads.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { checkEvidence, GATE } = require('../agent/evidenceGate')

/** Read off the descriptor's own readState rather than re-deriving it. */
const isFailed = (e) => typeof e.readState === 'string' && e.readState.startsWith('READ_FAILED')
const isNone = (e) => e.readState === 'NO_RELEVANT_RESULTS'

/**
 * The Owner-facing answer for one browse run.
 *
 * @param {object} evidence  the descriptor from `describeBrowseRun`
 * @param {{query?: string}} [ctx]
 */
function renderBrowseAnswer (evidence, ctx = {}) {
  const label = (evidence && evidence.sourceLabel) || '網站'
  const what = (ctx && typeof ctx.query === 'string' && ctx.query.trim()) ? ctx.query.trim() : '你要搵嘅嘢'

  // ── 1. WE NEVER GOT THERE ────────────────────────────────────────────────
  if (!evidence || isFailed(evidence)) {
    const why = evidence ? String(evidence.readState).replace(/^READ_FAILED:\s*/, '') : 'unknown'
    return {
      readState: evidence ? evidence.readState : 'READ_FAILED: no evidence',
      text: `去唔到 ${label} 嗰個頁面（${why}），所以乜都未睇過。`
    }
  }

  // ── 2. WE LOOKED AND FOUND NOTHING ───────────────────────────────────────
  if (isNone(evidence)) {
    /**
     * ⛔ THE SENTENCE THE OLD CODE COULD NOT WRITE. 「搵唔到」 is what happened; 「冇」 would be a
     * claim about the shop's shelves that one search of one page cannot support. A1's gate
     * refuses the second as ABSENCE_AS_PROOF, and the wording here matches the verdict rather
     * than leaving the distinction in a field nobody reads.
     */
    return {
      readState: evidence.readState,
      text: `喺 ${label} 搵唔到「${what}」。⚠ 呢句係講我哋搵唔到，唔係講 ${label} 冇貨 —— 我哋只睇咗搜尋結果嘅第一頁。`
    }
  }

  // ── 3. WE HAVE ROWS. WHAT MAY WE SAY ABOUT THEM? ─────────────────────────
  const priced = evidence.items.filter((i) => i.price)
  if (!priced.length) {
    return {
      readState: evidence.readState,
      text: `喺 ${label} 見到${evidence.items.length}項相關商品，但頁面冇顯示可信價格，所以未能核實價格。`
    }
  }

  const first = priced[0]
  const size = first.packageSize ? ` ${first.packageSize}` : ''

  /**
   * ⛔ MEASURED WHILE BUILDING THIS, AND IT DECIDES THE FILE'S SHAPE.
   *
   * A1's gate refuses EVERY browse result, always, with `TRUNCATED`:
   *
   *     if (e.truncated === true) return refuse(GATE.TRUNCATED, 'the read was cut off by a
   *                                             cap; the number is a floor, not a total')
   *
   * That rule is unconditional, and a search results page is truncated by construction. So no
   * browse run can ever support a CLAIM under A1 — not once, not for any wording.
   *
   * The rule is right about what it was written for: a truncated read cannot support 「there are
   * N items」, because the count is a floor. It is too blunt for 「THIS row showed THIS price」,
   * which is an observation of one row and is unaffected by how many rows we did not read. A1's
   * own source already names this gap — 「THE FIX IS A STRUCTURALLY CLAIM-LOCAL SCOPE SIGNAL …
   * that is a later phase and its own decision」.
   *
   * ⛔ SO THIS FILE DOES NOT MAKE CLAIMS. It reports observations with their provenance, which
   * is a different speech act and needs no gate. That is also exactly the Owner's requirement:
   * it must never render 「Superstore 賣 $4.99」 — and it cannot, because it never asserts what
   * the shop charges at all.
   *
   * The gate is still consulted and its verdict is CARRIED OUT, unmodified, so a caller that
   * wants to make a claim from this can see that it may not. Not calling it because it always
   * says no would be removing a check for being inconvenient.
   */
  const claim = `${first.product}${size} 喺 ${label} 賣 ${first.price}`
  const verdict = checkEvidence({ claim, evidence: [evidence] })

  /**
   * ⛔ EVERY QUALIFIER BELOW IS A DESCRIPTOR FIELD, NOT A HAND-WRITTEN CAVEAT.
   *
   *   completeness 'sample'   -> 「搜尋結果第一頁」
   *   matchingTotal null      -> 「總共有幾多款，頁面冇講」
   *   filtersApplied null     -> 「唔知網站用咗咩篩選」   (HR-58: this replaces the old
   *                              `locationDependent` boolean and its Chinese sentence)
   *   rowShape.hasLocation    -> which branch, or that none was chosen
   */
  const lines = [
    `${label}：${first.product}${size} 標價 ${first.price}`,
    `⚠ 呢個係搜尋結果第一頁見到嘅其中一項，唔係 ${label} 嘅「售價」。`
  ]
  if (evidence.matchingTotal == null) lines.push('· 一共有幾多款，頁面冇講，我哋數唔到。')
  if (evidence.filtersApplied === null) lines.push('· 網站用咗咩篩選（例如分店），我哋唔知道。')
  lines.push(evidence.rowShape.hasLocation
    ? `· 呢個價屬於：${evidence.storeContext}。`
    : '· 未揀分店，所以呢個價未必係你嗰間嘅價。')
  if (priced.length > 1) {
    lines.push('· 同頁其他標價：' + priced.slice(1, 3).map((p) => `${p.product}${p.packageSize ? ' ' + p.packageSize : ''} ${p.price}`).join('；'))
  }

  return {
    readState: evidence.readState,
    /** What A1's gate said about turning this into a claim. Carried, never overridden. */
    gate: verdict.ok ? null : verdict.reason,
    /**
     * ⛔ THE CEILING, MACHINE-READABLE. `false` means: this may be reported, and it may NOT be
     * summarised into 「the price is X」 by anything downstream. Today it is always false.
     */
    mayAssertClaim: verdict.ok === true,
    text: lines.join('\n')
  }
}

module.exports = { renderBrowseAnswer, GATE }
