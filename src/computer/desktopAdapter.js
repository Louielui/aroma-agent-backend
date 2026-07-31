'use strict'

/**
 * desktopAdapter.js — the ONLY thing in this system that can move something on a screen.
 *
 * ── READ THIS BEFORE CHANGING A LINE ───────────────────────────────────────
 * Everything else in src/computer decides, records, refuses and compares. This file acts. It
 * is therefore the file where the three prohibitions are actually cashed in, and where a
 * careless "just make it work" edit does real damage:
 *
 *   NO CLIPBOARD            — the clipboard is shared with the Owner's own session. Typing
 *                             through it would silently destroy whatever he had copied, and
 *                             would leave our text readable by every process on the desktop.
 *   NO GLOBAL SendKeys      — SendKeys goes to whatever has focus AT THE MOMENT IT LANDS. If
 *                             focus moves between the check and the send — and focus is not
 *                             ours to control — the text is typed into someone else's window.
 *                             There is no version of that which is recoverable.
 *   NO FOCUS-BASED FALLBACK — the tempting shape is "try the control, and if that fails, type
 *                             into the foreground window". That fallback is the bug: the case
 *                             where the control lookup failed is exactly the case where we do
 *                             not know what we are typing into.
 *
 * So: every input goes through a UIA ValuePattern on a control resolved from the binding, and
 * a lookup failure is a refusal. There is no second path. If ValuePattern is unavailable on
 * the target the run fails closed — it does not degrade to keystrokes.
 *
 * ── HOW IT REACHES THE DESKTOP ─────────────────────────────────────────────
 * By running a PowerShell script that this repo owns, with UIAutomationClient. The script path
 * is fixed at construction, arguments are passed as a JSON payload, and there is no shape where
 * a work-order value becomes part of a command line. This module builds no command strings.
 *
 * The process runner is INJECTED. This file spawns nothing by itself, which is what lets the
 * whole adapter be tested without a desktop and what keeps the source scan honest: the tokens
 * that would let it spawn something are not in here.
 *
 * ── WHAT IT IS NOT ─────────────────────────────────────────────────────────
 * Not a general automation layer. Four methods, each shaped to one canary step, each refusing
 * anything it was not built for. Growing it is a capability change and an Owner GO.
 */

const DEFAULT_SCRIPT = 'scripts/computer/uiaCanary.ps1'

/** The verbs the helper script accepts. It rejects anything else; so does this. */
const OPS = Object.freeze(['open_app', 'type_text', 'save_as', 'verify_binding', 'cleanup'])

/** appId -> the ONLY thing the helper is allowed to launch for it. No paths, no arguments. */
const APP_LAUNCH = Object.freeze({ notepad: 'notepad' })

function fail (reason, detail) {
  const e = new Error(reason)
  e.reason = reason
  e.detail = detail || null
  return e
}

/**
 * @param {object} deps
 * @param {{run:Function}} deps.runner  the injected process runner: run(scriptPath, payload) -> result
 * @param {string} [deps.scriptPath]
 * @param {number} [deps.timeoutSec]
 */
function createDesktopAdapter (deps = {}) {
  const runner = deps.runner
  if (!runner || typeof runner.run !== 'function') throw fail('no_runner', 'the adapter cannot reach a desktop without an injected runner')
  const scriptPath = typeof deps.scriptPath === 'string' ? deps.scriptPath : DEFAULT_SCRIPT
  const timeoutSec = Number.isInteger(deps.timeoutSec) ? deps.timeoutSec : 300

  /** One call into the helper. Every op goes through here, so every op is bounded the same way. */
  function call (op, payload) {
    if (!OPS.includes(op)) throw fail('unknown_op', op)
    const res = runner.run(scriptPath, Object.assign({ op, timeoutSec }, payload))
    if (!res || typeof res !== 'object') throw fail('adapter_no_result', 'the helper returned nothing')
    if (res.ok !== true) throw fail(res.reason || 'adapter_failed', res.detail || null)
    return res
  }

  /** Every field must come back, or we do not have a binding — we have a guess. */
  function bindingFrom (res) {
    const bind = {
      processId: res.processId,
      sessionId: res.sessionId,
      windowHandle: res.windowHandle,
      uiaControlId: res.uiaControlId
    }
    for (const k of Object.keys(bind)) {
      if (bind[k] === undefined || bind[k] === null || bind[k] === '') {
        throw fail('incomplete_binding', 'the helper did not return ' + k)
      }
    }
    return bind
  }

  return {
    /**
     * Launch the one allowed app and return the identity of what came up.
     *
     * ── THE UNVERIFIED ASSUMPTION LIVES HERE ─────────────────────────────
     * This machine's Notepad is the newer Windows App. Whether this yields a NEW process with
     * a NEW window, or a NEW TAB inside an already-running one, is NOT KNOWN — PREPARE forbids
     * touching Notepad, so it could not be measured. Every later step binds to what this
     * returns, so if that guess is wrong, everything after it is wrong.
     *
     * The helper is therefore required to report the process it actually attached to, and to
     * refuse if more than one candidate window matches. Fail closed, do not pick.
     */
    openApp ({ appId }) {
      const launch = APP_LAUNCH[appId]
      if (!launch) throw fail('app_not_allowed', String(appId))
      const res = call('open_app', { appId: launch })
      return { bind: bindingFrom(res), detail: 'opened ' + appId }
    },

    /**
     * Set text on the bound control via UIA ValuePattern. Directed, not broadcast.
     *
     * The helper is required to re-resolve the control FROM THE BINDING and confirm the
     * process, session and window still match before it sets anything. If ValuePattern is not
     * supported on that control it refuses — it does not fall back to keystrokes, and there is
     * no parameter here that could ask it to.
     */
    typeTextIntoControl ({ bind, text }) {
      if (!bind) throw fail('missing_binding', 'no binding supplied')
      if (typeof text !== 'string' || text === '') throw fail('bad_text', 'text must be a non-empty string')
      const res = call('type_text', { bind, text })
      if (res.method !== 'ValuePattern') throw fail('wrong_input_method', 'expected ValuePattern, got ' + String(res.method))
      return { detail: text.length + ' chars via ValuePattern' }
    },

    /**
     * Save through Notepad's own Save As dialog.
     *
     * The directory is NOT created. If it does not exist the helper refuses, because creating
     * it would mean this system deciding where its own output may go, and the whole point of a
     * single approved path is that the decision was made in advance by someone else.
     * Overwriting is refused for the same reason: a canary that can overwrite is not a canary.
     */
    saveAsViaUi ({ bind, dir, fileName }) {
      if (!bind) throw fail('missing_binding', 'no binding supplied')
      if (typeof dir !== 'string' || typeof fileName !== 'string') throw fail('bad_save_target', 'dir and fileName are required')
      const res = call('save_as', { bind, dir, fileName })
      if (res.method !== 'SaveAsDialog') throw fail('wrong_save_method', 'expected SaveAsDialog, got ' + String(res.method))
      if (res.created !== true) throw fail('save_not_confirmed', 'the helper did not confirm a new file')
      return { detail: res.path || (dir + fileName) }
    },

    /**
     * Is the binding still the same thing it was? Asked before every bound step.
     * Any doubt answers no — a stale handle is refused, never re-resolved to something similar.
     */
    verifyBinding (bind) {
      if (!bind) return { ok: false, reason: 'missing_binding' }
      try {
        const res = call('verify_binding', { bind })
        if (res.processId !== bind.processId) return { ok: false, reason: 'process_identity_changed' }
        if (res.sessionId !== bind.sessionId) return { ok: false, reason: 'session_changed' }
        if (res.windowHandle !== bind.windowHandle) return { ok: false, reason: 'window_changed' }
        if (res.uiaControlPresent !== true) return { ok: false, reason: 'uia_control_missing' }
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: err.reason || 'verify_failed' }
      }
    },

    /**
     * Close what we opened, and only that. Bounded to the recorded process identity, so a
     * failing run cannot take down a window it did not create. Never throws — cleanup running
     * during a failure must not replace the original reason with its own.
     */
    cleanup ({ bind }) {
      if (!bind) return { ok: false, reason: 'nothing_to_clean' }
      try {
        call('cleanup', { bind })
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: err.reason || 'cleanup_failed' }
      }
    }
  }
}

module.exports = { createDesktopAdapter, OPS, APP_LAUNCH, DEFAULT_SCRIPT }
