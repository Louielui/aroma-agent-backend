'use strict'

/**
 * startupSmoke.js — ONE real chat turn after start, before the system is handed back.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS EXISTS, IN ONE MEASUREMENT.
 *
 *   running process started   2026-08-10 10:34:28
 *   A4_KNOWLEDGE_ROUTING=on committed to the launcher   10:35:13
 *
 * Forty-five seconds. The flag was never exercised, and it turned out to make every Claude
 * chat turn return HTTP 400 — a schema the provider refuses, with no fallback behind the
 * picker's default provider, so the turn died rather than degraded. Nobody would have found
 * out until the Owner typed something into a dead system.
 *
 * A setting that only takes effect on next start, and is never exercised before that start,
 * is a change nobody tested. This is the exercise.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ IT DOES NOT REFUSE TO HAND BACK. IT HANDS BACK LOUDLY. ────────────────
 *
 * > **Owner: 「A launcher that refuses to finish is the L2-1 shape again, where the thing
 * > that repairs it is the thing that will not start.」**
 *
 * A gate that can stop the system from starting can also stop it from starting for a reason
 * that is not real — a transient provider error, a network blink, a rate limit. The recorded
 * history of that class here is one false positive and zero true positives.
 *
 * So this NEVER blocks startup. It reports. A working system with a visible warning loses
 * nothing; a healthy system refused by its own smoke test loses everything, and the tool that
 * would fix it is the one that will not run.
 *
 * ── IN-PROCESS, NOT OVER HTTP, AND THAT IS A CONSTRAINT NOT A SHORTCUT ──────
 *
 * `app.js` states twice that the server NEVER self-HTTPs with HUB_TOKEN and that the token
 * never leaves it. A smoke test that authenticated to the running server would break that,
 * so this exercises the same composition the route builds — `processIntake` with the real A4
 * dependencies — which is exactly the layer a launcher flag change lands in.
 *
 * What it therefore does NOT prove: Express routing, the owner gate, the browser. Those do not
 * change when a flag changes, and today's defect was not in them.
 *
 * ── IT WRITES NOTHING ───────────────────────────────────────────────────────
 * `AROMA_DATA_DIR` is redirected to a temp path before anything is required, so a smoke turn
 * can never land in the Owner's conversation history. That is not hypothetical: a full test
 * run once wrote fixture conversations into his real sidebar.
 *
 * Exit code is ALWAYS 0. The verdict is the line it prints.
 */

const os = require('os')
const path = require('path')
const fs = require('fs')

// Redirect the data directory BEFORE any module reads it.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-startup-smoke-'))
process.env.AROMA_DATA_DIR = scratch

const ROOT = path.resolve(__dirname, '..', '..')
const { getAdapter } = require(path.join(ROOT, 'src/adapters/adapterFactory'))
const { processIntake } = require(path.join(ROOT, 'src/intake/intakeService'))
const a4Runtime = require(path.join(ROOT, 'src/intake/a4Runtime'))

/** Plain, cheap, and answerable without reading anything. A greeting is enough to prove alive. */
const PROBE = '你好'

function line (obj) { try { console.log('[AROMA-STARTUP-SMOKE]', JSON.stringify(obj)) } catch (_) {} }

/**
 * ⛔ BOTH PROVIDERS, EXPLICITLY. THE FIRST VERSION OF THIS FILE PROVED THE WRONG ONE.
 *
 * It sent no `providerHint`, so the router did what it does with no hint: MULTI_AI_ROUTER='on'
 * and mode 'chat' sent it to OpenAI. It printed PASS on gpt-5.6-terra — and the defect it was
 * written to catch was Claude-only. It would have waved the dead system through.
 *
 * The browser's picker defaults to `claude` and sends that hint on every turn, so the provider
 * the Owner actually uses is the one an unhinted probe never touches. Both are probed by name,
 * both are reported, and either failing is a FAIL: a chat lane where half the picker is dead
 * is not a working chat lane.
 */
const PROVIDERS = ['claude', 'openai']

async function probe (providerHint) {
  const started = Date.now()
  const telemetry = {}
  try {
    // The SAME composition the route performs. If a flag makes this throw, that is the point.
    const composed = a4Runtime.createA4RuntimeDependencies({ env: process.env })
    const opts = { requestId: 'startup_smoke_' + providerHint, interactionMode: 'chat', demo: true, telemetry, providerHint }
    if (composed && composed.deps) opts.readContextDeps = composed.deps

    const result = await processIntake(PROBE, getAdapter(), [], opts)
    const reply = (result && typeof result.reply === 'string') ? result.reply : ''

    // ⛔ A REPLY, NOT AN ABSENCE OF THROW. The fail-closed gates here deliberately return no
    // text rather than a wrong one, so a check that accepted 「it did not throw」 would pass
    // on exactly the state those gates produce.
    return {
      asked: providerHint,
      outcome: reply.length > 0 ? 'PASS' : 'FAIL',
      elapsedMs: Date.now() - started,
      servedBy: telemetry.model || null,
      provider: telemetry.provider || null,
      stopReason: telemetry.stopReason || null,
      parseResult: telemetry.parseResult || null,
      replyLength: reply.length,
      detail: reply.length > 0 ? null : 'the turn completed and produced no reply text'
    }
  } catch (e) {
    // The cause carries the provider's own diagnosis — an HTTP 400 on a schema, for example.
    // Never the prompt, never a body, never a credential.
    const cause = e && e.cause && e.cause.message ? String(e.cause.message).slice(0, 300) : null
    return {
      asked: providerHint,
      outcome: 'FAIL',
      elapsedMs: Date.now() - started,
      servedBy: telemetry.model || null,
      provider: telemetry.provider || null,
      stopReason: telemetry.stopReason || null,
      parseResult: telemetry.parseResult || null,
      replyLength: 0,
      detail: (e && e.message ? e.message : String(e)) + (cause ? ' | cause: ' + cause : '')
    }
  }
}

;(async () => {
  const results = []
  for (const p of PROVIDERS) results.push(await probe(p)) // sequential: two calls, not a load test
  for (const r of results) line(Object.assign({ event: 'STARTUP_SMOKE' }, r))

  const failed = results.filter((r) => r.outcome === 'FAIL')
  line({
    event: 'STARTUP_SMOKE_VERDICT',
    outcome: failed.length ? 'FAIL' : 'PASS',
    failedProviders: failed.map((r) => r.asked),
    // ⛔ SAID OUT LOUD, because a verdict that only a log reader sees is not a verdict.
    saying: failed.length
      ? '香香啟動咗，但' + failed.map((r) => r.asked).join('／') + '嗰邊答唔到。系統照樣交返畀你，但呢半邊唔可信。'
      : '香香啟動咗，兩邊都答到。'
  })

  try { fs.rmSync(scratch, { recursive: true, force: true }) } catch (_) {}
  // ⛔ ALWAYS 0. This reports; it never withholds the system. See the L2-1 note above.
  process.exit(0)
})()
