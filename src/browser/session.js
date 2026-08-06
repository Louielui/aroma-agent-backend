'use strict'

/**
 * session.js — `read → act → read → act`, as a fence rather than a sentence.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS. Measured live on en.wikipedia.org, 2026-08-06:
 *
 *   link "Jump to content"   backendDOMNodeId BEFORE clicking Search   8001
 *                            backendDOMNodeId AFTER                   20437
 *   the link is still on the page. The skin re-rendered its header.
 *
 * **`backendDOMNodeId` is stable for a NODE. A node is not stable for a PAGE.** React, Vue and
 * Wikipedia's Vector all replace element objects on re-render, so a ref is valid for the READ
 * THAT PRODUCED IT and not for the session.
 *
 * > **Owner: 「a rule that lives in a document will be broken by whoever writes the first real
 * > errand — probably you, probably next week. If the runner can refuse a plan that acts twice
 * > on refs from one read, it should.」**
 *
 * So it is not documentation. `read → act → act` is REFUSED, before the second act reaches
 * the browser, by name, saying which read the ref came from and what to do instead.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT SPENDS A READ ──────────────────────────────────────────────────────
 * Anything that acts or waits: `click`, `type`, `navigate`, `wait_for`. Waiting for a change
 * means the DOM changed — that is the whole point of waiting — so a wait invalidates exactly
 * as an action does. **`screenshot` does not**: it changes nothing and targets nothing.
 *
 * ── AND A REFUSED ACT DOES NOT SPEND IT ─────────────────────────────────────
 * Nothing happened, so nothing changed. Charging the caller a re-read for an action that was
 * refused would punish the safe path and quietly push whoever hits it toward batching.
 *
 * ── ⛔ THE FIX THAT IS NOT HERE, REJECTED TWICE FOR THE SAME REASON ─────────
 * When a ref goes stale, re-find the element by role + accessible name. **No.** That is 「the
 * element that looks like the one you meant」 — the same defect as `REF 250`, which was
 * present, printed and wrong. It would work on the page in front of you and click the wrong
 * thing wherever two nodes share a name. **The refusal is correct; the caller re-reads.**
 */

const SESSION_REFUSAL = Object.freeze({
  NO_READ: 'NO_READ_YET',
  STALE_READ: 'REF_FROM_A_SPENT_READ',
  UNKNOWN_REF: 'REF_NOT_FROM_ANY_READ'
})

/** Verbs that make the page different from what the last read described. */
const SPENDS_READ = new Set(['click', 'type', 'navigate', 'wait_for'])

function buildSession (deps) {
  let generation = 0          // which read we are on; 0 means none yet
  let live = new Set()        // refs from the CURRENT read
  let spent = false           // has an act happened since that read
  let actsSince = 0

  const guard = (target) => {
    if (generation === 0) {
      return { outcome: 'REFUSED', reason: SESSION_REFUSAL.NO_READ, detail: 'no read_page has happened yet; a ref can only come from a read' }
    }
    if (!live.has(target.ref)) {
      return { outcome: 'REFUSED', reason: SESSION_REFUSAL.UNKNOWN_REF, detail: 'this ref did not come from read #' + generation }
    }
    if (spent) {
      return {
        outcome: 'REFUSED',
        reason: SESSION_REFUSAL.STALE_READ,
        detail: 'this ref is from read #' + generation + ', and ' + actsSince +
          ' action' + (actsSince === 1 ? '' : 's') + ' have happened since. ' +
          'Elements are replaced on re-render — re-read the page and use a fresh ref.'
      }
    }
    return null
  }

  const act = (name, fn) => async (target, ...rest) => {
    const stop = guard(target)
    if (stop) return stop                       // BEFORE the browser is touched
    const r = await fn(target, ...rest)
    // A refusal changed nothing, so it does not cost the caller its read.
    if (r && r.outcome !== 'REFUSED' && r.outcome !== 'BLOCKED') { spent = true; actsSince++ }
    return r
  }

  return {
    async read (...a) {
      const view = await deps.read(...a)
      generation++
      live = new Set((view.nodes || []).map((n) => n.ref))
      spent = false
      actsSince = 0
      return { ...view, generation }
    },
    click: act('click', (t) => deps.click(t)),
    type: act('type', (t) => deps.type(t)),
    async waitFor (req) {
      const r = await deps.waitFor(req)
      if (r && r.outcome === 'HAPPENED') { spent = true; actsSince++ }
      return r
    },
    // Changes nothing, targets nothing, so it does not spend the read.
    screenshot: (req) => deps.screenshot(req),

    /**
     * Refuse a whole errand before it starts. This is the part that catches the mistake at
     * the time it is being written rather than at the time it is being run.
     */
    async checkPlan (steps) {
      let read = false
      let acted = false
      for (let i = 0; i < steps.length; i++) {
        const v = steps[i].verb
        if (v === 'read_page') { read = true; acted = false; continue }
        if (!SPENDS_READ.has(v)) continue         // screenshot, and anything else inert
        if (v === 'navigate') { read = false; acted = false; continue }
        // `wait_for` SPENDS a read but does not REQUIRE a fresh one: 「click, then wait for
        // the result」 is the natural and correct pattern. Rejecting it would have pushed the
        // caller toward not waiting, which is worse than the thing this rule protects.
        if (v === 'wait_for') { acted = true; continue }
        if (!read) {
          return { ok: false, reason: SESSION_REFUSAL.NO_READ, detail: 'step ' + (i + 1) + ' (' + v + ') acts without a read before it' }
        }
        if (acted) {
          return {
            ok: false,
            reason: SESSION_REFUSAL.STALE_READ,
            detail: 'step ' + (i + 1) + ' (' + v + ') uses refs from a read that step ' + i +
              ' already spent. Insert a read_page between them.'
          }
        }
        acted = true
      }
      return { ok: true }
    }
  }
}

module.exports = { buildSession, SESSION_REFUSAL, SPENDS_READ }
