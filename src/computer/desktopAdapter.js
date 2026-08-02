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

// A SCRIPT ID, not a path. The shared runner owns the frozen id->path map, so nothing here
// can name a file to execute.
const DEFAULT_SCRIPT = 'uia-canary'

/** The verbs the helper script accepts. It rejects anything else; so does this. */
const OPS = Object.freeze(['open_app', 'type_text', 'save_as', 'save_outcome', 'verify_binding', 'cleanup'])

/** appId -> the ONLY thing the helper is allowed to launch for it. No paths, no arguments. */
const APP_LAUNCH = Object.freeze({ notepad: 'notepad' })

function fail (reason, detail, evidence) {
  const e = new Error(reason)
  e.reason = reason
  e.detail = detail || null
  // STRUCTURED EVIDENCE SURVIVES THE THROW. Twice now, measurements have been destroyed by
  // being turned into an exception: cleanup's numbers went into call()'s throw, and the save
  // resolver's evidence went into a string. An Error is allowed to carry more than a sentence.
  e.evidence = evidence || null
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
  // READ-ONLY existence probe. The save adjudication needs a fact from disk, and a fact from
  // disk is the one thing no UIA reading can supply. Injected, so the adapter still spawns
  // nothing and still tests without a desktop.
  const fsProbe = deps.fsProbe || null

  /** One call into the helper. Every op goes through here, so every op is bounded the same way. */
  function call (op, payload) {
    if (!OPS.includes(op)) throw fail('unknown_op', op)
    // The shared runner returns a TRANSPORT envelope: { ok, result } on success, or
    // { ok:false, refusal } when the transport itself failed. Both layers are checked, and
    // separately: a transport failure and a script refusal are different facts, and collapsing
    // them would report 'the helper said no' when the helper never ran.
    const env = runner.run(scriptPath, Object.assign({ op, timeoutSec }, payload))
    if (!env || typeof env !== 'object') throw fail('adapter_no_result', 'the runner returned nothing')
    if (env.ok !== true) throw fail('transport_' + (env.refusal || 'failed'), env.detail || null)
    const res = env.result
    if (!res || typeof res !== 'object') throw fail('adapter_no_result', 'the helper returned nothing')
    if (res.ok !== true) throw fail(res.reason || 'adapter_failed', res.detail || null, res.evidence || null)
    return res
  }

  /**
   * Every REQUIRED field must come back, or we do not have a binding — we have a guess.
   *
   * uiaAutomationId is carried but not required: the packaged Notepad's document has none, and
   * demanding one was demanding something Windows does not supply. It is recorded so that a
   * machine which DOES supply one shows up in the audit rather than going unnoticed.
   */
  function bindingFrom (res) {
    const bind = {
      processId: res.processId,
      sessionId: res.sessionId,
      windowHandle: res.windowHandle,
      uiaRuntimeId: res.uiaRuntimeId,
      uiaControlType: res.uiaControlType,
      uiaClassName: res.uiaClassName,
      uiaAutomationId: res.uiaAutomationId === undefined || res.uiaAutomationId === null ? '' : res.uiaAutomationId
    }
    for (const k of Object.keys(bind)) {
      if (k === 'uiaAutomationId') continue
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
    /**
     * THE SAVE, IN THREE PHASES, WITH THE JUDGEMENT LAST.
     *
     * 1. PREPARE  uiaCanary opens the dialog and sets the destination. It cannot press anything.
     * 2. ACTIVATE nativeSaveActivation verifies twenty things and sends exactly one BM_CLICK.
     *             It cannot choose a target.
     * 3. OBSERVE  uiaCanary reports whether the dialog is gone and whether an error surface
     *             appeared. It decides nothing.
     *
     * Neither helper alone can save a file, and the adjudication belongs to neither of them:
     * this method combines their observations with facts on disk. A call returning is not
     * evidence that a file exists — that is the whole point of DESIGN-001 section 7.
     *
     * THIS IS THE ONLY CALLER of the native activation, and it is the only place the script id
     * appears outside the runner's own map.
     */
    saveAsViaUi ({ bind, dir, fileName }) {
      if (!bind) throw fail('missing_binding', 'no binding supplied')
      if (typeof dir !== 'string' || typeof fileName !== 'string') throw fail('bad_save_target', 'dir and fileName are required')

      // -- 1. PREPARE -------------------------------------------------------
      const prep = call('save_as', { bind, dir, fileName })
      if (prep.method !== 'SaveAsDialogPrepared') throw fail('wrong_save_method', 'expected SaveAsDialogPrepared, got ' + String(prep.method))
      if (prep.prepared !== true) throw fail('save_dialog_not_prepared', 'the dialog was not made ready')
      const target = prep.path || (dir + fileName)

      // -- 2. ACTIVATE ------------------------------------------------------
      // Deliberately NOT through call(): call() throws on ok:false and would discard sendCount,
      // and sendCount is the evidence that a refusal refused BEFORE sending. Same reasoning as
      // cleanup(), and the same mistake if it were routed the easy way.
      //
      // WHEN THE HELPER DOES NOT ANSWER, WE DO NOT KNOW WHAT IT DID.
      //
      // This block used to write `sendCount: 0, activated: false` into the transport-failure and
      // catch paths, and then return `save_refused` with the words "refused before sending". That
      // is not an incomplete answer, it is a WRONG one, in the dangerous direction: it asserts
      // that nothing happened to the machine. The path is reachable exactly when the runner times
      // out — which kills the helper process — and a helper killed after posting BM_CLICK looks
      // identical from here to one killed before. The helper's own catch is careful about this
      // (sendCount = $script:SendCount, activated = SendCount -gt 0); the layer above it threw
      // that care away.
      //
      // So: a structured answer is used, and anything else becomes an explicit unknown.
      let act = null
      let unreachable = null
      try {
        const env = runner.run('native-save-activation', { op: 'activate_bound_save', bind, dir, fileName, timeoutSec })
        if (env && env.ok === true && env.result && typeof env.result === 'object') act = env.result
        else unreachable = 'transport_' + ((env && env.refusal) || 'failed')
      } catch (err) {
        unreachable = (err && err.reason) || 'activation_failed'
      }

      if (unreachable) {
        // No count is claimed. `null` is the honest value and the ONLY honest value.
        return {
          outcome: 'activation_outcome_unknown',
          refusal: null,
          sendCount: null,
          activated: null,
          target,
          verified: null,
          dialogPresent: null,
          errorTextSeen: null,
          detail: 'the activation helper did not answer (' + unreachable + '); whether BM_CLICK was posted is UNKNOWN'
        }
      }

      const sendCount = Number.isFinite(act.sendCount) ? act.sendCount : null
      if (act.ok !== true) {
        // A refusal is only a refusal if the helper MEASURED that it sent nothing. It reports
        // sendCount on every outcome including a throw, so `0` here is an observation. Anything
        // else — a missing count, or a count above zero — means a message may have gone out, and
        // that is an unknown wearing a refusal's clothes.
        if (sendCount !== 0) {
          return {
            outcome: 'activation_outcome_unknown',
            refusal: null,
            sendCount,
            activated: act.activated === true ? true : null,
            target,
            verified: act.verified || null,
            dialogPresent: null,
            errorTextSeen: null,
            detail: 'the helper refused with ' + (act.reason || 'no reason') + ' but reported sendCount=' +
              (sendCount === null ? 'unknown' : sendCount) + '; whether BM_CLICK was posted is UNKNOWN'
          }
        }
        return {
          outcome: 'save_refused',
          refusal: act.reason || 'activation_refused',
          sendCount: 0,
          activated: false,
          target,
          verified: act.verified || null,
          detail: 'refused before sending: ' + (act.reason || 'unknown')
        }
      }

      // -- 3. OBSERVE, then adjudicate from disk ----------------------------
      let obs = null
      try { obs = call('save_outcome', { bind }) } catch (_) { obs = null }
      const fileThere = fsProbe && typeof fsProbe.exists === 'function' ? fsProbe.exists(target) === true : null

      const base = { sendCount, activated: true, target, verified: act.verified || null, dialogPresent: obs ? obs.dialogPresent : null, errorTextSeen: obs ? obs.errorTextSeen : null }

      if (obs && obs.dialogPresent === false && fileThere === true) {
        return Object.assign({ outcome: 'save_verified', detail: target }, base)
      }
      if (obs && obs.dialogPresent === true && obs.errorTextSeen) {
        // POSITIVE evidence, and only that: a named message on a dialog that is still up.
        return Object.assign({ outcome: 'save_rejected', detail: String(obs.errorTextSeen).slice(0, 200) }, base)
      }
      // Everything else. The message was sent and what it did cannot be established. Saying
      // "failed" would be as much a guess as saying "worked".
      return Object.assign({
        outcome: 'activation_outcome_unknown',
        detail: 'dialogPresent=' + (obs ? String(obs.dialogPresent) : 'unreadable') + ' fileExists=' + String(fileThere)
      }, base)
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
    /**
     * Close what this run opened, and REPORT WHAT WAS MEASURED.
     *
     * ── WHY THIS DOES NOT GO THROUGH call() ───────────────────────────────
     * `call()` throws when the helper returns ok:false, which is right for an action — a
     * type_text that did not type is a failure and the detail belongs in the exception. It is
     * wrong here. The cleanup helper returns ok:false precisely WHEN it has something to say:
     * the process did not exit, or windows remain. Routing that through `call()` would turn the
     * measurement into an exception and throw the numbers away, which is the exact shape of the
     * bug being fixed — cleanup reporting a word instead of a fact.
     *
     * So the envelope is unwrapped here, and the measured fields come back on BOTH outcomes.
     */
    cleanup ({ bind }) {
      const empty = { processExited: null, notepadWindowsAfter: null, notepadProcessesAfter: null, forced: null, method: null }
      if (!bind) return Object.assign({ ok: false, measured: false, reason: 'nothing_to_clean' }, empty)
      let res = null
      try {
        const env = runner.run(scriptPath, { op: 'cleanup', timeoutSec, bind })
        if (!env || env.ok !== true) {
          return Object.assign({ ok: false, measured: false, reason: 'transport_' + ((env && env.refusal) || 'failed') }, empty)
        }
        res = env.result
      } catch (err) {
        return Object.assign({ ok: false, measured: false, reason: err.reason || 'cleanup_failed' }, empty)
      }
      if (!res || typeof res !== 'object') {
        return Object.assign({ ok: false, measured: false, reason: 'adapter_no_result' }, empty)
      }
      return {
        // DERIVED, not asserted: the helper computes ok from ($exited -and $winsAfter -eq 0).
        ok: res.ok === true,
        measured: true,
        processExited: res.processExited === undefined ? null : res.processExited,
        notepadWindowsAfter: res.notepadWindowsAfter === undefined ? null : res.notepadWindowsAfter,
        notepadProcessesAfter: res.notepadProcessesAfter === undefined ? null : res.notepadProcessesAfter,
        forced: res.forced === undefined ? null : res.forced,
        method: res.method === undefined ? null : res.method,
        reason: res.ok === true ? null : (res.reason || 'cleanup_incomplete')
      }
    }
  }
}

module.exports = { createDesktopAdapter, OPS, APP_LAUNCH, DEFAULT_SCRIPT }
