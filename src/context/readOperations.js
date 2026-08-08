'use strict'

/**
 * readOperations.js — the CLOSED vocabulary a reasoning model may choose a read from.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY A SOURCE NAME WAS NOT ENOUGH.
 *
 * A3 offered the model `aroma_system` as one capability. It is not one read. It is six:
 * inventory, suppliers, daily counts, replenishment, purchasing and invoices, each its own
 * endpoint, each a different answer. So the server had to rediscover WHICH by running
 * aromaMethodFor() over the Owner's original message — and when the message named the SYSTEM
 * rather than a business entity ('你能看到 aroma system 嗎？'), that returned null and the read
 * was vetoed as `notAsked`. The model asked; the planner refused on its behalf.
 *
 * The fix is not to relax the veto. It is to stop the model from making an under-specified
 * request in the first place: it names an OPERATION, not a source, and an operation already
 * carries the view.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── THREE PROPERTIES, AND NONE OF THEM IS NEGOTIABLE ─────────────────────────
 *
 * CLOSED. The list is generated here, from a frozen table, and handed to the provider as a
 * schema enum. The model picks from it; it never composes a name, a method or a path.
 *
 * DETERMINISTIC. One name maps to exactly one existing adapter method, forever. There is no
 * matching, no fuzziness and no fallback — an unrecognised name resolves to null and is
 * refused before the connector.
 *
 * AUTHORISATION STAYS SOURCE-BASED. `operationsForSources` only ever EXPANDS sources the
 * caller has ALREADY authorised. If `aroma_system` is not in that list — READ_ACCESS off, the
 * source disabled, or the Owner withholding it from this provider — not one of its child
 * operations is generated. This file grants nothing.
 *
 * ── AND IT TERMINATES IN THE FROZEN GET-ONLY ADAPTER ─────────────────────────
 * Every `method` below is one of the six read methods already on aromaSystemRead.js, which
 * readConnector independently refuses to call under a write-shaped name. Nothing here opens a
 * path that did not already exist for the automatic reader; it only lets the MODEL choose
 * among the paths the message-driven planner was choosing among on its own.
 */

/**
 * ⛔ THE NAMES AVOID THE WRITE-SHAPED VOCABULARY ON PURPOSE — AND A TEST ENFORCES IT.
 *
 * reasoningLoop.js refuses any capability matching WRITE_SHAPED, which is an UNANCHORED
 * substring test including `order` and `pay`. That was written when a capability was a bare
 * source name (gmail, drive, aroma_system), where no such substring could occur.
 *
 * `aroma_system.order_planning` and `aroma_system.purchase_orders` both contain 'order', so
 * both would have been silently refused at runtime by a guard meant for writes. The guard is
 * correct and is NOT being weakened to accommodate a name — the names are chosen to clear it,
 * using terms the Aroma System itself already uses (the Order Planning page is
 * Replenishment.tsx; purchasing is the purchase-order function).
 *
 * readOperations.test.js asserts every generated name passes WRITE_SHAPED, so a future
 * operation named with a write verb is a FAILING TEST rather than an operation that silently
 * never runs.
 */
const AROMA_SOURCE = 'aroma_system'

/**
 * intent key (readContext.AROMA_INTENTS) → the operation the model may name.
 *
 * Keyed by intent key so the drift test can assert this table and the routing table describe
 * the same six reads. `label` is Owner-facing and travels to the model in the schema
 * description, so a name like `purchasing` cannot be misread as something else.
 */
const AROMA_OPERATIONS = Object.freeze([
  Object.freeze({ intentKey: 'inventory', operation: 'aroma_system.inventory', source: AROMA_SOURCE, method: 'listInventory', label: '倉存' }),
  Object.freeze({ intentKey: 'supplier', operation: 'aroma_system.suppliers', source: AROMA_SOURCE, method: 'listSuppliers', label: '供應商' }),
  Object.freeze({ intentKey: 'daily_count', operation: 'aroma_system.daily_counts', source: AROMA_SOURCE, method: 'listDailyCounts', label: '盤點紀錄' }),
  Object.freeze({ intentKey: 'order_planning', operation: 'aroma_system.replenishment', source: AROMA_SOURCE, method: 'listOrderPlanning', label: '訂貨建議' }),
  Object.freeze({ intentKey: 'purchase_order', operation: 'aroma_system.purchasing', source: AROMA_SOURCE, method: 'listPurchaseOrders', label: '採購單' }),
  Object.freeze({ intentKey: 'invoice', operation: 'aroma_system.invoices', source: AROMA_SOURCE, method: 'listInvoices', label: '發票' })
])

const BY_OPERATION = new Map(AROMA_OPERATIONS.map((o) => [o.operation, o]))
const BY_METHOD = new Map(AROMA_OPERATIONS.map((o) => [o.method, o]))

/**
 * The closed vocabulary for a set of ALREADY-AUTHORISED sources, in source order.
 *
 * aroma_system expands to its six views; every other source is its own single operation, so
 * gmail / drive / calendar / github behave EXACTLY as before — their read plan was never
 * derived from an intent, so there is nothing to disambiguate.
 *
 * @param {string[]} sources sources the caller has already authorised for this turn
 * @returns {string[]}
 */
function operationsForSources (sources = []) {
  const out = []
  for (const s of Array.isArray(sources) ? sources : []) {
    if (typeof s !== 'string' || !s) continue
    if (s === AROMA_SOURCE) { for (const o of AROMA_OPERATIONS) out.push(o.operation) } else out.push(s)
  }
  return [...new Set(out)]
}

/**
 * An operation name → what the server will actually do.
 *
 * `{ source, method }` where method is null for a source whose plan is not intent-derived.
 * Returns NULL for anything not in the vocabulary — an invented name resolves to nothing and
 * is refused before the connector, never guessed at.
 *
 * ⛔ THE CALLER MUST STILL CHECK MEMBERSHIP. This resolves a name; it does not authorise one.
 * A dotted name is only valid if it is in the frozen table. A bare name is returned as a
 * source verbatim, because only the caller knows which sources it authorised this turn — so
 * `resolveReadOperation('gmail')` succeeding is not permission to read Gmail.
 */
function resolveReadOperation (name) {
  const s = typeof name === 'string' ? name.trim() : ''
  if (!s) return null
  if (s.includes('.')) {
    const hit = BY_OPERATION.get(s)
    return hit ? { source: hit.source, method: hit.method } : null
  }
  return { source: s, method: null }
}

/** The operation a given Aroma method IS — so an automatic read can be recorded as one. */
function operationForAromaMethod (method) {
  const hit = BY_METHOD.get(String(method || ''))
  return hit ? hit.operation : null
}

/**
 * The Owner-facing gloss shown to the MODEL beside the enum.
 *
 * ⛔ MODEL TEXT (textClasses.js, class MODEL) — she is told this, and it decides which view she
 * picks. `aroma_system.purchasing` alone is guessable; 「aroma_system.purchasing＝採購單」 is not.
 * Generated from the same frozen table as the enum, so the two can never disagree.
 *
 * ⛔ AN ABSENT OPERATION IS AMBIGUOUS, AND THE LIVE CANARY PROVED IT.
 *
 * The enum offers only what is still UNREAD, so a view already read this turn simply vanishes
 * from it. On the 「庫存」 follow-up, the automatic read fetched inventory correctly, the rows
 * were in her prompt — and GPT, seeing no 倉存 in the list, replied
 * 「目前可讀取的資料沒有『庫存』操作 … 目前無法直接讀取庫存資料。」 and then spent a second paid
 * read on 盤點紀錄 as a substitute. She denied data she was holding: the exact false
 * read-failure claim readStateGuard exists to prevent, manufactured by a wording.
 *
 * So the two states are now NAMED SEPARATELY. Still-readable is a list of choices; already-read
 * is a statement that the answer is above, with an explicit instruction not to claim otherwise.
 * Silence about the second state is what produced the wrong answer.
 */
function label (op) {
  const hit = BY_OPERATION.get(op)
  return hit ? `${op}＝${hit.label}` : op
}

function describeOperations (operations = [], alreadyRead = []) {
  const open = (Array.isArray(operations) ? operations : []).map(label)
  const done = (Array.isArray(alreadyRead) ? alreadyRead : []).map(label)
  const parts = []
  if (open.length) parts.push(`本回合可用的讀取操作：${open.join('；')}。只能填其中一個。`)
  if (done.length) {
    parts.push(
      `本回合已經讀取：${done.join('；')}。呢啲資料已經喺上面，唔會出現喺可選清單度 —— ` +
      '唔好再讀一次，更加唔好講「讀唔到」「沒有這個操作」或者「無法直接讀取」。'
    )
  }
  return parts.length ? parts.join('\n') : null
}

module.exports = {
  AROMA_SOURCE,
  AROMA_OPERATIONS,
  operationsForSources,
  resolveReadOperation,
  operationForAromaMethod,
  describeOperations
}
