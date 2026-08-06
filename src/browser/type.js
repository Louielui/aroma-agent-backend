'use strict'

/**
 * type.js — the third verb. An adapter, like `click`, plus the one governance gap in the set.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * HR-18, THIRD ROUND. Measured before designing — see docs/BASELINE-TYPE-WAIT.md.
 *
 * The library already replaces existing content, fires `focus` + `input`, sends per-keystroke
 * events that frameworks see, handles `contenteditable`, and REFUSES readonly, disabled and
 * text-into-a-number-field. **None of that is re-implemented here.**
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT MAKES `type` DIFFERENT FROM `click` ────────────────────────────────
 * `click` moves a mouse. **`type` puts CONTENT into a page**, and content can be a password,
 * a card number, or a customer's details. That is the only place in this round where we add
 * behaviour rather than adapt it, and it is two rules:
 *
 *   1. **A credential field is REFUSED, not redacted.** A verb that *can* type into a password
 *      box is a verb that will, on the day a login page appears mid-errand and the model
 *      reasons that signing in is the next step.
 *   2. **The typed value NEVER reaches the record.** Length and a shape class only. The record
 *      is durable and reviewable; a value in it is a secret in a log, and 「it was only a
 *      search box that time」 is not a property anyone can assert about future runs.
 *
 * ── AND `force` LIES HERE TOO — HR-19 ───────────────────────────────────────
 * Measured: `fill(readonly, { force: true })` **returns success and changes nothing.** Same
 * flag, same shape, second verb, same afternoon. Structurally absent.
 *
 * ── NO SUBMIT. NOT EVEN Enter. ──────────────────────────────────────────────
 * Typing and submitting are different acts and only one of them is built. This file has no
 * key-press path at all — `submit` and `pressEnter` in a target are ignored, not honoured,
 * and a test asserts no key is ever pressed.
 */

const { checkNavigation, NAV } = require('./navigate')

const TYPE_REFUSAL = Object.freeze({
  ORIGIN: 'ORIGIN_NOT_IN_ORDER',
  CREDENTIAL: 'CREDENTIAL_FIELD_REFUSED',
  GONE: 'ELEMENT_GONE',
  AMBIGUOUS: 'REF_MATCHED_MORE_THAN_ONE',
  READONLY: 'READONLY',
  DISABLED: 'DISABLED',
  WRONG_TYPE: 'FIELD_REJECTS_THIS_KIND_OF_TEXT',
  UNKNOWN: 'REFUSED_REASON_UNKNOWN'
})

const TAG = 'data-aroma-ref'

/** Names that mean 「this is a secret」. Matched on the accessible name read_page gave us,
 *  because the field's `type` attribute is not the only way a credential box appears. */
const CREDENTIAL_NAME = /pass\s*word|passcode|\bpin\b|\bcvv\b|\bcvc\b|security code|card\s*number|credit\s*card|social insurance|\bsin\b|\bssn\b|sort code|account number|routing/i

/** The record carries a CLASS, never the value. */
function shapeOf (text) {
  if (/^\d+$/.test(text)) return 'digits'
  if (/^\S+@\S+$/.test(text)) return 'email'
  if (/^\s*$/.test(text)) return 'blank'
  return 'text'
}

const STATE_PROBE = (sel) => {
  const el = document.querySelector(sel)
  if (!el) return { connected: false }
  return {
    connected: el.isConnected,
    readonly: Boolean(el.readOnly) || el.getAttribute('aria-readonly') === 'true',
    disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true'
  }
}

function refused (reason, detail, record) {
  return { outcome: 'REFUSED', reason, detail: detail || '', record }
}

function buildType ({ page, cdp, order }) {
  return async function type (target) {
    if ('force' in target) {
      throw new Error('force is refused — measured: fill(readonly,{force:true}) returns ' +
        'success and changes nothing. HR-19, docs/BASELINE-TYPE-WAIT.md.')
    }

    const text = String(target.text === undefined ? '' : target.text)
    // ⛔ THE RECORD IS BUILT WITHOUT THE VALUE FROM THE START, so there is no later step that
    // has to remember to strip it. A redaction that happens on the way out is a redaction that
    // can be forgotten on one path.
    const record = {
      ref: target.ref,
      role: target.expectRole,
      name: target.expectName,
      length: text.length,
      shape: shapeOf(text)
    }

    const nav = checkNavigation(page.url(), order)
    if (nav.verdict !== NAV.ALLOWED) {
      return { outcome: 'BLOCKED', reason: TYPE_REFUSAL.ORIGIN, detail: nav.reason, record }
    }

    let tagged = false
    try {
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: target.domId })
      await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: 'function(){ this.setAttribute("' + TAG + '", ' + JSON.stringify(target.ref) + ') }'
      })
      tagged = true
    } catch (e) {
      return refused(TYPE_REFUSAL.GONE, String(e.message).split('\n')[0], record)
    }
    if (!tagged) return refused(TYPE_REFUSAL.GONE, 'could not be tagged', record)

    const sel = '[' + TAG + '=' + JSON.stringify(target.ref) + ']'
    const loc = page.locator(sel)

    // CREDENTIAL CHECK BEFORE ANYTHING ELSE THAT COULD TYPE. Both the input type and the
    // accessible name — a password box is not always `type=password`.
    const fieldType = await loc.getAttribute('type')
    if (String(fieldType).toLowerCase() === 'password' || CREDENTIAL_NAME.test(String(target.expectName || ''))) {
      return refused(TYPE_REFUSAL.CREDENTIAL,
        'credentials are never entered on the Owner\'s behalf — this field must be filled by him',
        record)
    }

    const n = await loc.count()
    if (n === 0) return refused(TYPE_REFUSAL.GONE, 'the tagged element is not in the document', record)
    if (n > 1) return refused(TYPE_REFUSAL.AMBIGUOUS, n + ' elements carry this ref', record)

    try {
      await loc.fill(text, { timeout: 5000 })   // no force, ever; no Enter, ever
      return { outcome: 'TYPED', record }
    } catch (e) {
      const raw = String(e.message).split('\n')[0]
      // The library names this one itself — measured — so it is used rather than re-derived.
      if (/Cannot type text into/i.test(raw)) return refused(TYPE_REFUSAL.WRONG_TYPE, raw, record)
      let s = null
      try { s = await page.evaluate(STATE_PROBE, sel) } catch (_) { s = null }
      if (!s) return refused(TYPE_REFUSAL.UNKNOWN, raw, record)
      if (s.connected === false) return refused(TYPE_REFUSAL.GONE, 'it left the document while we were acting', record)
      if (s.readonly) return refused(TYPE_REFUSAL.READONLY, 'the field is read-only', record)
      if (s.disabled) return refused(TYPE_REFUSAL.DISABLED, 'the field is disabled', record)
      return refused(TYPE_REFUSAL.UNKNOWN, raw, record)
    }
  }
}

module.exports = { buildType, TYPE_REFUSAL, CREDENTIAL_NAME }
