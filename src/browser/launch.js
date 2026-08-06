'use strict'

/**
 * launch.js — how the browser is started, and the one setting that is NOT a preference.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ HEADED ONLY. `headless: true` IS A DESIGN VIOLATION, NOT AN OPTIMISATION.
 *
 * If you are here to flip this to headless for CI, for speed, or because a window on the
 * Owner's screen is inconvenient — read the evidence first. It is not a style preference and
 * it was not chosen for realism.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── THE MEASUREMENT (2026-08-06, DEFECT-009) ─────────────────────────────────
 * Same machine, same Chrome 150.0.7871.188, same code, seconds apart:
 *
 *                      wikipedia   google   costco.ca
 *   headless: true        200        200    ERR_HTTP2_PROTOCOL_ERROR
 *   headless: false       200        200    200
 *
 * `23.53.170.213` is Akamai. Connection accepted, then broken at the HTTP/2 layer;
 * `--disable-http2` turns it into a hang rather than fixing it. That is BOT MITIGATION
 * REFUSING A HEADLESS CLIENT, and it was confirmed by ruling out every alternative by
 * measurement: no proxy, no Chrome policy, no firewall rule, no TLS interception, not the
 * Claude Code sandbox, and plainly not "no network" — headless Chrome reached both other
 * sites and her own server on 127.0.0.1:8090.
 *
 * ── WHY IT IS A CONSTRAINT AND NOT A NOTE ────────────────────────────────────
 * **The sites the Owner would actually send her to are exactly the sites that refuse a
 * headless client** — retail and supplier portals sit behind the same mitigation Costco
 * does. Wikipedia and Google work headless; the ones that matter do not.
 *
 * And the second-order failure is the dangerous one:
 *
 *   > A headless corpus capture SILENTLY produces a corpus of the easy half of the web.
 *   > Every protected site fails to capture, the benchmark scores well on what remains,
 *   > and the absence does not announce itself. (HR-13.)
 *
 * That already happened once here: five of six corpus fixtures are authored, and the reason
 * recorded for it — 「Chrome cannot resolve DNS」 — was FALSE.
 *
 * ── THE CONSEQUENCE NOTHING HAS ASSUMED UNTIL NOW ────────────────────────────
 * **Headed means a window visibly moving on the Owner's machine, while he is using it.**
 * `DESIGN-VISUAL-OPERATION.md` §3 assumed a browser we construct; it did not assume one he
 * can see. Open questions that belong to the fence, not to this file:
 *   - whose profile, and can he tell it apart from his own Chrome;
 *   - what happens if he clicks in the window mid-action;
 *   - whether it may run while he is at the machine at all.
 * These are unanswered. They are not a reason to go headless — going headless answers them
 * by making the whole capability not work on the sites that matter.
 */

/** The only launch options this project permits. `headless` is absent BY CONSTRUCTION —
 *  a fence made of absence, same as `buildAllowedTools()`. There is no flag to flip. */
function launchOptions (extra = {}) {
  const opts = { ...extra, channel: 'chrome', headless: false }
  if ('headless' in extra && extra.headless !== false) {
    throw new Error('headless is refused — see the block comment above and DEFECT-009: ' +
      'bot mitigation rejects headless Chrome on exactly the sites this exists to reach')
  }
  return opts
}

module.exports = { launchOptions }
