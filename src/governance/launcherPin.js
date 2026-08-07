'use strict'

/**
 * launcherPin.js — L-1 ②. The launcher's shim is pinned, and the pin lives here. GOVERNANCE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * `C:\Aroma\xiangxiang.ps1` holds the handoff to the real launcher, and it sits OUTSIDE the
 * repository — no git history, and out of reach of `FORBIDDEN_FILE_PATTERNS`.
 *
 * ⛔ WHY A HASH AND NOT A TIGHTER ACL.
 *
 * Measured 2026-08-07: she runs as `AROMABRAIN\louis`. So does the Owner.
 *
 *   > **冇一條 ACE 講得出「louis 用鍵盤打字得，louis 個 node process 唔得」。**
 *
 * A Windows ACL discriminates by PRINCIPAL, and they are the same principal. Tightening
 * permissions is worth doing against OTHER accounts — `AromaOperator` is already denied — and
 * does nothing at all about this case. The reflex is to harden the ACL; that would have been
 * motion without effect.
 *
 * ⛔ AND THE CIRCULARITY THIS FILE'S LOCATION CLOSES.
 *
 * A check she performs on a file she can edit is worth nothing if she can also edit the check.
 * `src/governance/` is forbidden BY LOCATION as of `d54c3ed`, so there is finally somewhere to
 * put a checker that the thing being checked cannot rewrite. **This is the first thing the
 * governance migration paid for.**
 *
 * ── WHAT IT IS AND IS NOT ───────────────────────────────────────────────────
 * This DETECTS. **佢唔係防止 — it is not prevention.** Anything running as the Owner, including
 * her, can change the shim, then the body, then this pin, then this checker. What changes is
 * that doing so leaves marks: a diff on the body, a mismatch on the shim, a commit on the pin.
 *
 * Pinning also gives the launcher the one thing it never had: **a history.** The file has no
 * commits; the pin does, so every legitimate change becomes reviewable.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── RE-DERIVE THE PIN YOURSELF, WITHOUT TRUSTING THIS CODE ─────────────────
 *   powershell -NoProfile -Command "(Get-FileHash 'C:\Aroma\xiangxiang.ps1' -Algorithm SHA256).Hash.ToLower()"
 */

const fs = require('node:fs')
const crypto = require('node:crypto')

const SHIM_PATH = 'C:\\Aroma\\xiangxiang.ps1'
const BODY_REL = 'scripts/launcher/xiangxiang-body.ps1'

const LAUNCHER = Object.freeze({
  shim: SHIM_PATH,
  body: BODY_REL
})

/**
 * ⛔ THE PIN. sha256 of the shim, full length — a truncated hash is a weaker claim wearing the
 * same word.
 *
 * Updating this line is how a LEGITIMATE change to the shim is declared. It should be rare:
 * the shim is a handoff and has no reason to change. If this line changes often, something is
 * wrong with the design rather than with the file.
 */
const PIN = '04ba8a03abbf81db287c5b5cb58cfc5a19003601c886e19e4ab918b0d172cd7b'

const STATE = Object.freeze({
  MATCH: 'MATCH',
  CHANGED: 'CHANGED',
  UNREADABLE: 'UNREADABLE'
})

/**
 * ⛔ IT REPORTS. IT NEVER THROWS AND NEVER EXITS.
 *
 * A legitimate flag edit must not brick her, and **the thing that would repair a refused start
 * is the thing that refused to start** — L2-1's shape, same answer: start anyway, say so loudly.
 *
 * @param {{shimPath?: string}=} opts
 * @returns {{state, expected, actual, saying}}
 */
function checkLauncher (opts) {
  const p = (opts && opts.shimPath) || SHIM_PATH
  let buf
  try {
    buf = fs.readFileSync(p)
  } catch (e) {
    // ⛔ 「I could not look」 is its own state (HR-23). Reporting a missing launcher as unchanged
    // would be the calmest possible lie.
    return {
      state: STATE.UNREADABLE,
      expected: PIN,
      actual: null,
      saying: '我讀唔到個 launcher(' + p + '):' + String(e && e.code) + '。唔知佢有冇被改過。'
    }
  }
  const actual = crypto.createHash('sha256').update(buf).digest('hex')
  if (actual === PIN) {
    return { state: STATE.MATCH, expected: PIN, actual, saying: 'Launcher 同釘住嗰個 hash 一樣。' }
  }
  return {
    state: STATE.CHANGED,
    expected: PIN,
    actual,
    saying: '⛔ Launcher 俾人改過 —— 而家嘅 hash 同 repo 釘住嗰個唔同。' +
      '如果係你自己改嘅,更新 src/governance/launcherPin.js 入面條 PIN;如果唔係,即刻睇返 ' + p + '。'
  }
}

module.exports = { checkLauncher, PIN, SHIM_PATH, BODY_REL, LAUNCHER, STATE }
