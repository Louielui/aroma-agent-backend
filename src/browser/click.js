'use strict'

/**
 * click.js — the second verb, and it is an ADAPTER, not an implementation.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * HR-18 WAS APPLIED TO THIS BEFORE IT WAS DESIGNED. See docs/BASELINE-CLICK.md.
 *
 * Measured, not assumed: playwright-core ALREADY scrolls an offscreen element into view,
 * REFUSES a covered one, REFUSES one that will not stop moving, REFUSES a disabled one,
 * reaches into iframes, and dispatches events with `isTrusted: true`. **Five of six hazards,
 * handled by the library, with no code from us.**
 *
 * So this file does not re-implement any of that. It closes the three gaps the baseline
 * found, and nothing else.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── GAP 1: `force: true` SILENTLY CLICKS THE WRONG THING ────────────────────
 * Measured: `force` on a covered button returns SUCCESS and the button is never clicked —
 * the overlay eats the event. No error, no exception. **That is the worst failure shape in
 * this codebase, delivered as a library flag**, so it is structurally absent here, the same
 * way `headless` is in launch.js. There is no parameter to set.
 *
 * ── GAP 2: A STALE REF DOES NOT FAIL AT RESOLUTION ──────────────────────────
 * Measured: `DOM.resolveNode` RESOLVES a node that has been removed from the document. The
 * staleness check is therefore not the resolve — it is the round trip
 * **ref → tag the node → locate by attribute → click**, because a detached node carries the
 * attribute but the locator finds nothing.
 *
 *   ⛔ DO NOT SHORTEN THIS PATH. `DOM.resolveNode` + `Runtime.callFunctionOn` calling
 *   `.click()` directly is the obvious optimisation, and it would act on a detached node and
 *   report success — the same defect as `force`, reached from the other side.
 *
 * ── GAP 3: A REFUSAL IS AN OPAQUE TIMEOUT ───────────────────────────────────
 * Covered, moving and disabled all produce the identical `Timeout 4000ms exceeded`. Nothing
 * in it says which. The report is the only remaining review, so on refusal we ask the page
 * what state the element is in and name the cause. **When the probe cannot say, the reason is
 * UNKNOWN and the raw message is carried as detail — never a guess.**
 */

const { checkNavigation, NAV } = require('./navigate')
const { checkPaymentStop } = require('./paymentStop')

const REFUSAL = Object.freeze({
  ORIGIN: 'ORIGIN_NOT_IN_ORDER',
  GONE: 'ELEMENT_GONE',
  CHANGED: 'ELEMENT_CHANGED_SINCE_READ',
  AMBIGUOUS: 'REF_MATCHED_MORE_THAN_ONE',
  PAYMENT: 'LOOKS_LIKE_A_PAYMENT_COMMIT',
  COVERED: 'COVERED_BY_ANOTHER_ELEMENT',
  UNSTABLE: 'STILL_MOVING',
  DISABLED: 'DISABLED',
  UNKNOWN: 'REFUSED_REASON_UNKNOWN'
})

const TAG = 'data-aroma-ref'
const CLICK_TIMEOUT_MS = 5000

/**
 * Runs IN THE PAGE on refusal. Reports state; it never decides anything.
 *
 * ⚠ `stable` is MEASURED, by sampling the rect across two animation frames. The first version
 * returned a hardcoded `stable: true`, which made `REFUSAL.UNSTABLE` **unreachable in
 * production** while its unit test passed on a fake that returned `false`. That is precisely
 * the defect this project refused to stub in `DESIGN-DISPATCH-PATH` — a branch that reads as
 * a safeguard and can never fire — and it would have shipped inside the file that exists to
 * explain why a click was refused.
 */
const STATE_PROBE = (sel) => new Promise((resolve) => {
  const el = document.querySelector(sel)
  if (!el) return resolve({ connected: false })
  const a = el.getBoundingClientRect()
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const b = el.getBoundingClientRect()
    const moved = Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5 ||
                  Math.abs(a.width - b.width) > 0.5 || Math.abs(a.height - b.height) > 0.5
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
    const covered = Boolean(top) && top !== el && !el.contains(top)
    resolve({
      connected: el.isConnected,
      disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
      covered,
      coveredBy: covered ? (top.tagName + (top.id ? '#' + top.id : '')) : null,
      stable: !moved
    })
  }))
})

function refused (reason, detail, record) {
  return { outcome: 'REFUSED', reason, detail: detail || '', record }
}

/**
 * @param {{page:object, cdp:object, order:{allowedOrigins:string[]}}} ctx
 * @returns {(target:{ref:string, domId:number, expectRole:string, expectName:string}) => Promise<object>}
 */
function buildClick ({ page, cdp, order }) {
  return async function click (target) {
    // Structural, not a validated option: there is no supported way to ask for it.
    if ('force' in target) {
      throw new Error('force is refused — measured: force on a covered element reports ' +
        'success and clicks nothing. See docs/BASELINE-CLICK.md gap 1.')
    }

    const record = { ref: target.ref, role: target.expectRole, name: target.expectName }

    // THE SAME SEALED ORDER AS navigate. An element on an origin the order did not name is a
    // HALT, not an error to retry — and an absent order blocks everything.
    const nav = checkNavigation(page.url(), order)
    if (nav.verdict !== NAV.ALLOWED) {
      return { outcome: 'BLOCKED', reason: REFUSAL.ORIGIN, detail: nav.reason, record }
    }

    // ref -> the node, then TAG it. Resolution can succeed on a removed node, so this is not
    // yet a liveness check; the locator below is.
    const tagValue = target.ref
    try {
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: target.domId })
      await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: 'function(){ this.setAttribute("' + TAG + '", ' + JSON.stringify(tagValue) + ') }'
      })
    } catch (e) {
      return refused(REFUSAL.GONE, String(e.message).split('\n')[0], record)
    }

    // ── L1, THE SOFT STOP — wired HERE, before anything is clicked ──────────────
    // Measured 45% on pages it had never seen, so it is a CONVENIENCE, not the fence. It runs
    // anyway, because the half it does catch is the difference between a report the Owner
    // reads and an order he has to unwind. L3 is the guardrail.
    const l1 = checkPaymentStop(
      { role: target.expectRole, name: target.expectName },
      { url: page.url() }
    )
    if (l1.stop) {
      return {
        outcome: 'STOPPED_FOR_YOU',
        reason: REFUSAL.PAYMENT,
        detail: 'this control ' + l1.why + '. I do not press the last step — you do.',
        record
      }
    }

    const sel = '[' + TAG + '=' + JSON.stringify(tagValue) + ']'
    const loc = page.locator(sel)

    const n = await loc.count()
    if (n === 0) return refused(REFUSAL.GONE, 'the tagged element is not in the document', record)
    // Two matches means the ref does not identify one thing. Picking would be the pruner
    // lying about the page, one layer down.
    if (n > 1) return refused(REFUSAL.AMBIGUOUS, n + ' elements carry this ref', record)

    // Verify BEFORE acting that this is still what read_page described. Checking after the
    // click would be reporting on something already done.
    if (target.expectName) {
      const actual = String(await loc.innerText()).replace(/\s+/g, ' ').trim()
      if (actual && actual !== target.expectName) {
        return refused(REFUSAL.CHANGED,
          'read as ' + JSON.stringify(target.expectName) + ', now reads ' + JSON.stringify(actual), record)
      }
    }

    try {
      await loc.click({ timeout: CLICK_TIMEOUT_MS })   // no force, ever
      return { outcome: 'CLICKED', record }
    } catch (e) {
      const raw = String(e.message).split('\n')[0]
      let s = null
      try { s = await page.evaluate(STATE_PROBE, sel) } catch (_) { s = null }
      if (!s) return refused(REFUSAL.UNKNOWN, raw, record)
      if (s.connected === false) return refused(REFUSAL.GONE, 'it left the document while we were acting', record)
      if (s.disabled) return refused(REFUSAL.DISABLED, 'the element is disabled', record)
      if (s.covered) return refused(REFUSAL.COVERED, 'covered by ' + (s.coveredBy || 'another element'), record)
      if (s.stable === false) return refused(REFUSAL.UNSTABLE, 'it did not stop moving', record)
      return refused(REFUSAL.UNKNOWN, raw, record)
    }
  }
}

module.exports = { buildClick, REFUSAL, TAG }
