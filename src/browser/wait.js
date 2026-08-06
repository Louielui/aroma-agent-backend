'use strict'

/**
 * wait.js — `wait_for` and `screenshot`. The two thinnest verbs in the set.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * HR-18: measured before designing. See docs/BASELINE-TYPE-WAIT.md.
 *
 * `waitFor({state:'visible'})` returned at 1325ms for something appearing at 1200ms;
 * `waitForFunction` at 841ms; a real page went `domcontentloaded` 239ms → `networkidle` 504ms;
 * a wait for something that never appears refused at its timeout.
 *
 * **So `wait_for` is not a thing to build. It is a bounded pass-through**, and the whole of
 * our contribution is the three rules below.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── 1. A TIMEOUT IS AN OUTCOME, NEVER A SILENT PASS ─────────────────────────
 * The dangerous shape is `try { await waitFor() } catch {}` — a wait that gives up and lets
 * the caller carry on as though the condition were met. That is `count: 43` with a stopwatch:
 * the next verb acts on a page that never reached the state it was waiting for.
 *
 * ── 2. NAMED CONDITIONS ONLY ────────────────────────────────────────────────
 * `waitForFunction` takes a predicate that runs IN THE PAGE. Exposing it would be **arbitrary
 * code execution wearing a wait**, reached through a verb whose name sounds passive. The
 * caller picks from a fixed list; it never supplies code.
 *
 * ── 3. ALWAYS BOUNDED ───────────────────────────────────────────────────────
 * There is no 「wait until it happens」. Every call carries a ceiling, and the ceiling is in
 * the outcome so a reader can tell 「it took 8s」 from 「it never happened and we stopped at 8s」.
 */

const WAIT = Object.freeze({
  VISIBLE: 'element_visible',
  HIDDEN: 'element_hidden',
  DOM_READY: 'dom_ready',
  NETWORK_IDLE: 'network_idle'
})

const MAX_WAIT_MS = 30000
const TAG = 'data-aroma-ref'

/**
 * @param {{page:object}} ctx
 * @returns {(req:{condition:string, ref?:string, timeoutMs?:number}) => Promise<object>}
 */
function buildWaitFor ({ page }) {
  return async function waitFor (req) {
    const condition = req && req.condition
    if (!Object.values(WAIT).includes(condition)) {
      // An unknown condition is a REFUSAL, not a default. Defaulting here would turn a typo
      // into a wait for something nobody asked for, and then report success.
      return { outcome: 'REFUSED', reason: 'UNKNOWN_CONDITION', condition: String(condition), waitedMs: 0 }
    }
    // Bounded by construction: a caller asking for longer gets the ceiling, and is told.
    const asked = Number(req.timeoutMs) || 10000
    const timeout = Math.min(asked, MAX_WAIT_MS)
    const capped = timeout < asked

    const t0 = Date.now()
    try {
      if (condition === WAIT.VISIBLE || condition === WAIT.HIDDEN) {
        if (!req.ref) return { outcome: 'REFUSED', reason: 'REF_REQUIRED', condition, waitedMs: 0 }
        const sel = '[' + TAG + '=' + JSON.stringify(req.ref) + ']'
        await page.locator(sel).waitFor({ state: condition === WAIT.VISIBLE ? 'visible' : 'hidden', timeout })
      } else {
        await page.waitForLoadState(condition === WAIT.DOM_READY ? 'domcontentloaded' : 'networkidle', { timeout })
      }
      return { outcome: 'HAPPENED', condition, waitedMs: Date.now() - t0, capped }
    } catch (e) {
      // ⛔ NOT a silent pass. TIMED_OUT is its own outcome and it says what it was waiting for.
      return {
        outcome: 'TIMED_OUT',
        reason: 'CONDITION_NOT_MET',
        condition,
        waitedMs: Date.now() - t0,
        timeoutMs: timeout,
        capped,
        detail: 'gave up after ' + timeout + 'ms; the condition was never met'
      }
    }
  }
}

/**
 * `screenshot` — measured working: `page.screenshot()` returns a real Buffer (73,822 bytes on
 * a real page), and a single element can be captured too.
 *
 * ⛔ IT IS NEVER THE PRIMARY RECORD. Role + accessible name is the audit vocabulary
 * (`DESIGN-VISUAL-OPERATION` §2), and a picture is a thing a person must look at to check —
 * which is the opposite of a record you can grep, diff, or assert on. This returns a
 * reference and a size; the meaning stays in the text.
 */
function buildScreenshot ({ page, maxBytes = 2 * 1024 * 1024 }) {
  return async function screenshot (req = {}) {
    const t0 = Date.now()
    const buf = req.ref
      ? await page.locator('[' + TAG + '=' + JSON.stringify(req.ref) + ']').screenshot({ type: 'png' })
      : await page.screenshot({ type: 'png' })
    const bytes = buf.length
    // Stated, not silently accepted: a bound that is hit without saying so is the truncation
    // defect in a new medium.
    const overBound = bytes > maxBytes
    return {
      outcome: 'CAPTURED',
      bytes,
      overBound,
      maxBytes,
      scope: req.ref ? 'element' : 'page',
      note: overBound ? 'the image exceeds the bound and must not be stored whole' : '',
      isPrimaryRecord: false,
      tookMs: Date.now() - t0,
      buffer: buf
    }
  }
}

module.exports = { buildWaitFor, buildScreenshot, WAIT, MAX_WAIT_MS }
