'use strict'

/**
 * liveEgressFence.js — A TEST MAY NOT SPEND THE OWNER'S MONEY BECAUSE A KEY HAPPENED TO BE IN
 * THE SHELL.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DEFECT, MEASURED. Running the canonical `node --test` from a developer shell carrying
 * ANTHROPIC_API_KEY originated ~41 live `claude-haiku-4-5-20251001` calls per run and CHANGED
 * 7–8 A4 outcomes. Removing the key restored the expected result. The credential was a
 * BEHAVIOURAL INPUT TO THE TEST SUITE.
 *
 * The path was one `||` in `intake/intakeService.js`:
 *
 *     decide: (readDeps && readDeps.recoveryWorker) || defaultRecoveryWorker
 *          -> new ClaudeAdapter({ model: RECOVERY_WORKER_MODEL })   // model PINNED, not env
 *          -> axios.post(the Anthropic messages endpoint)
 *
 * 57 call sites inject a `finalVerifier` and no `recoveryWorker`. Nothing between the shell
 * and the socket ever asked whether this was a test.
 *
 * ⛔ AND THE DIFFERENCE WAS SILENT. `runRecoveryWorker` catches the no-key throw and returns
 * `failed` — deliberately, so an upstream error cannot carry the prompt back. So the two runs
 * differed in behaviour and agreed in appearance. That is why the marker below is not
 * optional: a withheld call must be VISIBLE, never silent.
 *
 * ── STRUCTURAL, NOT DECLARED ────────────────────────────────────────────────
 * 「Tests do not spend money」was true, written down, and believed. It was an INTENTION: no
 * environment enforced it, and a path to consequence ran straight from an ambient credential
 * to a socket. This file is the environment. (CLAUDE.md §4.)
 *
 * ── WHY THE DEFAULT TRANSPORT, AND NOWHERE ELSE ─────────────────────────────
 * · NOT a test bootstrap — node offers no preload hook for a bare `node --test`, and the bare
 *   command IS the defect. A guard that needs NODE_OPTIONS is another ambient variable.
 * · NOT `adapterFactory` — `defaultRecoveryWorker` and `a4Runtime` construct adapters
 *   directly, so fencing the factory would not have stopped the call that was measured.
 * · NOT A CONSTRUCTOR — `context/connectionState.projectConnections` CONSTRUCTS adapters on
 *   every real turn to check credential presence. Construction is legal; EGRESS is not.
 * · THE DEFAULT TRANSPORT is the last line before the socket, it is already the designated
 *   test seam in all three provider files, and an INJECTED transport bypasses it by
 *   construction — which is what leaves every existing scripted test byte-identical.
 *
 * ── PRODUCTION IS NOT FENCED, AND THAT IS THE FIRST CONDITION ───────────────
 * The resident service matches none of the three test signals: no NODE_TEST_CONTEXT, no
 * `--test` in argv, and `require.main` is `src/index.js`. `liveEgressAllowed` therefore
 * returns on its FIRST branch and never reads the opt-in. Same URL, same headers, same body,
 * same timeout, same axios.
 *
 * ⛔ OPT-IN, NEVER OPT-OUT. `RUN_PAID_E2E === '1'` — the switch the three paid E2E suites
 * already set, reused rather than reinvented so those suites keep working unchanged. An
 * opt-OUT would put the cost on whoever remembers to pass it, and
 * `governance/startupSmokeOptIn.test.js` already settled that ruling: **paid work fails
 * toward OFF: no flag, no calls.**
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { isTestProcess } = require('../testProcess')

/**
 * ⛔ THE LITERAL, AND NOTHING TRUTHY. `'0'`, `'true'`, `'yes'` and `' 1'` are all NOT an
 * opt-in. A guard that accepts anything truthy would be opened by a stray value nobody meant
 * as consent, and consent to spend money is exactly the thing that must not be inferred.
 */
const PAID_OPT_IN = 'RUN_PAID_E2E'
const OPT_IN_VALUE = '1'

/** One marker, greppable, and it is what makes a withheld call visible instead of silent. */
const BLOCKED_MARKER = '[AROMA-LIVE-EGRESS-BLOCKED]'

/**
 * May this process open a live provider socket?
 *
 * @param {object} [env]
 * @param {string[]} [argv]
 * @param {string|null} [mainFile]
 * @returns {boolean}
 */
function liveEgressAllowed (env = process.env, argv = process.argv, mainFile) {
  const main = mainFile === undefined ? ((require.main && require.main.filename) || null) : mainFile
  // ⛔ ORDINARY RUNTIME FIRST, AND IT RETURNS BEFORE THE OPT-IN IS EVEN READ.
  if (!isTestProcess(env, argv, main)) return true
  // A test process. Fail closed unless someone deliberately asked to spend money.
  return env && env[PAID_OPT_IN] === OPT_IN_VALUE
}

/**
 * ⛔ THE HOST, AND ONLY THE HOST.
 *
 * Never the path, never the query, never the body. A URL can carry a key in a query string and
 * a path can name an operation; the one thing the Owner needs from a blocked call is WHICH
 * VENDOR it was about to reach. An unparseable URL yields null rather than a fallback that
 * prints the raw string — the same rule `ClaudeAdapter` keeps when it refuses to echo a key.
 */
function hostOf (url) {
  try { return new URL(String(url)).host || null } catch (_) { return null }
}

/**
 * Refuse a live provider call from a test process — loudly, and before the network.
 *
 * @param {string} provider  a short vendor label, e.g. 'anthropic'. NEVER a key or a body.
 * @param {string} [url]     used for its HOST only
 * @throws {Error} with `liveEgressBlocked === true`
 */
function assertLiveEgressAllowed (provider, url) {
  if (liveEgressAllowed()) return

  /**
   * ⛔ THIS LINE IS LOAD-BEARING AND MUST NOT BE REMOVED TO REDUCE NOISE.
   *
   * Both callers of a blocked transport swallow the throw by design — `runRecoveryWorker`
   * returns `failed`, and `openaiWebSearchProvider` returns `unavailable(NETWORK)`. Without
   * this marker the fence would be a silent drop, which is the standing defect class in this
   * repository. Identifiers only: a provider label and a host.
   */
  try {
    console.error(BLOCKED_MARKER, JSON.stringify({
      provider: typeof provider === 'string' ? provider : null,
      host: hostOf(url),
      optIn: PAID_OPT_IN
    }))
  } catch (_) { /* a diagnostic may never be the reason a refusal fails */ }

  // ⛔ THE MESSAGE NAMES THE VARIABLE AND THE FIX, NEVER A VALUE, A URL OR A BODY.
  const e = new Error(
    'liveEgressFence: a test process attempted a live ' + (provider || 'provider') + ' call. ' +
    'Inject a transport, or set ' + PAID_OPT_IN + '=' + OPT_IN_VALUE + ' to opt in to paid calls.')
  e.liveEgressBlocked = true
  e.provider = typeof provider === 'string' ? provider : null
  throw e
}

/**
 * The DEFAULT axios transport, fenced. Preserves axios semantics exactly — returns `{ data }`,
 * throws with `.response` — because `ClaudeAdapter` and `OpenAIAdapter` both read those.
 *
 * ⛔ `axios` IS REQUIRED HERE RATHER THAN IN THE ADAPTERS so that the survey test can assert
 * NO provider file names a transport at all. One door, and the fence is on it.
 */
function fencedAxiosPost (provider) {
  return (url, data, cfg) => {
    assertLiveEgressAllowed(provider, url)
    return require('axios').post(url, data, cfg)
  }
}

/** The DEFAULT global-fetch transport, fenced. Same contract, same rule. */
function fencedFetch (provider) {
  return (url, init) => {
    assertLiveEgressAllowed(provider, url)
    return fetch(url, init)
  }
}

module.exports = {
  liveEgressAllowed,
  assertLiveEgressAllowed,
  fencedAxiosPost,
  fencedFetch,
  PAID_OPT_IN,
  OPT_IN_VALUE,
  BLOCKED_MARKER
}
