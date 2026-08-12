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

/**
 * ⛔ .env, THE SAME FILE THE SERVER READS — AND THE LAUNCHER RUN IS HOW THIS WAS FOUND.
 *
 * `src/app.js:18` calls `require('dotenv').config()`. This script never loads app.js, so the
 * first launcher-run smoke had no `OPENAI_API_KEY` at all: the router logged
 * `openai_unavailable`, A4's verifier could not be built, the final gate reported unavailable,
 * and BOTH probes came back with an empty reply. Two green PASSes when run through a wrapper
 * that happened to load `.env`, two FAILs when run the way it actually ships.
 *
 * A smoke test whose environment differs from the server's is testing a system nobody runs.
 * The path is explicit rather than cwd-relative, because the launcher's working directory is
 * not this repository and dotenv's default would have quietly found nothing here too.
 */
require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env') })

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

/**
 * ⛔ A GREETING PROVES ALMOST NOTHING, AND THAT IS WHY THIS EXISTS.
 *
 * 「你好」 reads nothing, routes to CONVERSATION, touches no endpoint and engages no plan. Every
 * defect that cost this fortnight was SILENT BREAKAGE OF A PATH THE OWNER USES, waiting for him
 * to walk into it — and a greeting walks into none of it. If the Aroma System key expires or an
 * endpoint changes shape, the greeting still passes and he finds out at 7am.
 *
 * This one question exercises the real chain: routeTurn -> BUSINESS_QUERY -> an aroma_system
 * read -> the descriptor -> the answer.
 */
const BUSINESS_PROBE = '今日有咩貨要落單？'

/**
 * ⛔ THE SHAPE, NEVER THE CONTENT. (Owner ruling.)
 *
 * Pinning business data would make this fail every time the inventory changes, and a check that
 * cries wolf gets stepped over — which is HR-63, and it would take this whole mechanism down
 * with it.
 *
 * ⛔ AND 「今日冇嘢要落單」 IS A CORRECT ANSWER. A read that succeeds and returns nothing is the
 * system working. The signal is therefore not 「rows came back」 but 「a read was PERFORMED and
 * the source answered」: the reasoning loop's own read step, reporting ok.
 *
 * `telemetry.readContextUsed` was the obvious candidate and is WRONG — measured false on a
 * BUSINESS_QUERY turn that read and answered correctly, because it describes what went into the
 * first prompt, not what the loop did afterwards.
 */
function sawSuccessfulRead (logs) {
  /**
   * ⛔ THE FIRST VERSION OF THIS FUNCTION REPORTED SUCCESS ON A FAILURE, AND SEEN-TO-FAIL
   * CAUGHT IT.
   *
   * It looked for `REASONING_STEP { decisionType: 'read', ok: true }`. Run with a deliberately
   * wrong `AROMA_SYSTEM_KEY`, the business probe still returned PASS with readPerformed:true —
   * because that `ok` means 「the loop performed a read STEP」, not 「the source answered」. A
   * check that cannot tell a dead endpoint from a live one is the exact defect this whole
   * fortnight was spent removing, rebuilt inside the detector for it.
   *
   * ⛔ AND THE SECOND GUESS WAS ALSO WRONG. `sourcesRead` on the TURN_ROUTE line looked right —
   * it filters `trust === 'live'` — but TURN_ROUTE is emitted BEFORE the reads run, so it is
   * `[]` on a perfectly healthy turn. That version failed with the real key: a false alarm,
   * which is the failure mode that gets a check ignored (HR-63).
   *
   * MEASURED, not guessed, on the third attempt:
   *
   *   [AROMA-READ-SOURCE] {"source":"aroma_system","trust":"live","count":4,"error":null}
   *
   * That line is emitted per source, after the read, and carries the two facts that matter.
   * `makeUnavailable` stamps `trust: 'unavailable'`, so a source that refused, 401'd or was
   * never configured cannot produce a live line.
   */
  for (const line of logs) {
    const i = line.indexOf('{')
    if (i < 0 || !line.includes('READ_SOURCE')) continue
    try {
      const j = JSON.parse(line.slice(i))
      if (j.event !== 'READ_SOURCE') continue
      // ⛔ NOT `count > 0`. 「今日冇嘢要落單」 is a correct answer from a healthy system, and a
      // smoke test that demanded rows would cry wolf on a good day with nothing to order.
      // The question is whether the SOURCE ANSWERED, not what it said.
      if (j.trust === 'live' && !j.error) return true
    } catch (_) {}
  }
  return false
}

async function probe (providerHint, opts0 = {}) {
  const started = Date.now()
  const telemetry = {}
  const question = opts0.question || PROBE
  const kind = opts0.kind || 'greeting'
  const needsRead = opts0.needsRead === true

  // Capture the pipeline's own log lines for the duration of this probe. The read evidence is
  // in them; nothing else exposes it.
  const logs = []
  const realLog = console.log
  console.log = (...a) => { try { logs.push(a.map(String).join(' ')) } catch (_) {} }
  const restore = () => { console.log = realLog }

  try {
    // The SAME composition the route performs. If a flag makes this throw, that is the point.
    const composed = a4Runtime.createA4RuntimeDependencies({ env: process.env })
    const opts = { requestId: 'startup_smoke_' + kind + '_' + providerHint, interactionMode: 'chat', demo: true, telemetry, providerHint }
    if (composed && composed.deps) opts.readContextDeps = composed.deps

    const result = await processIntake(question, getAdapter(), [], opts)
    const reply = (result && typeof result.reply === 'string') ? result.reply : ''
    restore()

    const readOk = needsRead ? sawSuccessfulRead(logs) : null

    // ⛔ A REPLY, NOT AN ABSENCE OF THROW. The fail-closed gates here deliberately return no
    // text rather than a wrong one, so a check that accepted 「it did not throw」 would pass
    // on exactly the state those gates produce.
    //
    // ⛔ AND FOR THE BUSINESS PROBE, A REPLY IS NOT ENOUGH EITHER. She can answer fluently
    // about an endpoint she never reached. The read must have happened and the source must
    // have answered — whether it answered with rows or with nothing.
    const failed = reply.length === 0 || (needsRead && readOk !== true)
    return {
      asked: providerHint,
      kind,
      outcome: failed ? 'FAIL' : 'PASS',
      elapsedMs: Date.now() - started,
      servedBy: telemetry.model || null,
      provider: telemetry.provider || null,
      stopReason: telemetry.stopReason || null,
      parseResult: telemetry.parseResult || null,
      replyLength: reply.length,
      readPerformed: readOk,
      /**
       * ⛔ WHICH FAILURE, BECAUSE THEY MEAN OPPOSITE THINGS TO THE OWNER.
       *
       * 2026-08-12, first real firing: Anthropic returned 529 overloaded, the call never came
       * back, and this probe told him 「佢讀唔到 Aroma System 嘅資料。問佢倉存／落單嗰啲嘢，
       * 答案唔可信。」 — while the six endpoints were healthy and she reads them correctly.
       *
       * > **Owner: 「A false alarm that teaches me to distrust a correct answer is the most
       * > expensive kind, and I would have spent tomorrow doubting her inventory numbers over
       * > an Anthropic outage.」**
       *
       * `model_call` — the provider failed (529, timeout, schema 400). Says NOTHING about reads.
       * `read`       — she answered fluently and never reached the source. THAT is untrustworthy.
       */
      failureKind: !failed ? null : (reply.length === 0 ? 'model_call' : 'read'),
      detail: reply.length === 0
        ? 'the turn completed and produced no reply text'
        : (failed ? 'the turn answered without a successful read — the source was never reached' : null)
    }
  } catch (e) {
    restore()
    // The cause carries the provider's own diagnosis — an HTTP 400 on a schema, for example.
    // Never the prompt, never a body, never a credential.
    const cause = e && e.cause && e.cause.message ? String(e.cause.message).slice(0, 300) : null
    return {
      asked: providerHint,
      kind,
      outcome: 'FAIL',
      elapsedMs: Date.now() - started,
      servedBy: telemetry.model || null,
      provider: telemetry.provider || null,
      stopReason: telemetry.stopReason || null,
      parseResult: telemetry.parseResult || null,
      replyLength: 0,
      // A throw means the read never got to report anything, which is a different fact from
      // 「it reported and said no」 — so this is false, not null.
      readPerformed: needsRead ? false : null,
      // ⛔ A THROW IS ALWAYS THE MODEL CALL, NEVER THE READ. The read is downstream of it and
      // never ran. This is the branch the 529 took, and the branch that produced the wrong
      // sentence on 2026-08-12.
      failureKind: 'model_call',
      detail: (e && e.message ? e.message : String(e)) + (cause ? ' | cause: ' + cause : '')
    }
  }
}

/**
 * The sentence the Owner reads. ⛔ THE CAUSE DECIDES THE WORDS.
 *
 * Before 2026-08-12 there was ONE business-failure sentence and it named the read every time.
 * An Anthropic 529 therefore told him her inventory answers were untrustworthy, on a morning
 * when the six endpoints were healthy and she read them correctly. A false alarm that teaches
 * him to distrust a CORRECT answer costs more than silence would have.
 *
 * ⛔ AND THE PROBE WAS STILL RIGHT TO FIRE. The business lane genuinely did not work. It was
 * right about THAT and wrong about WHY — a failure described in another failure's vocabulary,
 * which is the shape this whole week has been about, appearing for the first time inside
 * something built to prevent it.
 */
function sayingFor (failed) {
  if (!failed.length) return '香香啟動咗：傾偈同讀 Aroma System 都試過，兩樣都掂。'

  const biz = failed.filter((r) => r.kind === 'business')
  const greetingFailed = failed.some((r) => r.kind === 'greeting')

  if (biz.length && !greetingFailed) {
    // ⛔ THE PROVIDER FAILED — this says NOTHING about whether she can read.
    if (biz.every((r) => r.failureKind === 'model_call')) {
      return '香香啟動咗，傾偈冇問題。業務嗰條問題今次係模型嗰邊冇答到（供應商過載／逾時／schema），' +
             '未去到讀取嗰步，所以呢個唔代表佢讀唔到你盤數。等陣再問一次，或者睇 detail。'
    }
    // ⛔ THE READ FAILED — she answered fluently without reaching the source. This one IS the
    // dangerous morning, and it keeps the original wording.
    if (biz.every((r) => r.failureKind === 'read')) {
      return '香香啟動咗，傾偈冇問題，但佢答咗業務問題而完全冇讀到 Aroma System。' +
             '問佢倉存／落單嗰啲嘢，答案唔可信。'
    }
    return '香香啟動咗，傾偈冇問題，但業務嗰條問題有問題（一部分係模型冇答到，一部分係讀唔到）。睇 detail。'
  }

  return '香香啟動咗，但' + failed.map((r) => r.asked + '（' + r.kind + '）').join('／') +
         '答唔到。系統照樣交返畀你，但嗰部分唔可信。'
}

;(async () => {
  const results = []
  for (const p of PROVIDERS) results.push(await probe(p)) // sequential: not a load test
  // ⛔ ONE business probe, on the provider the picker actually defaults to. Two would double
  // the cost to re-prove the same chain.
  results.push(await probe('claude', { question: BUSINESS_PROBE, kind: 'business', needsRead: true }))
  for (const r of results) line(Object.assign({ event: 'STARTUP_SMOKE' }, r))

  const failed = results.filter((r) => r.outcome === 'FAIL')
  line({
    event: 'STARTUP_SMOKE_VERDICT',
    outcome: failed.length ? 'FAIL' : 'PASS',
    // ⛔ NAMED BY WHAT BROKE, not only by provider. 「claude」 appearing twice told a reader
    // nothing; 「claude/business」 says the chat lane answers and the read path does not, which
    // are different mornings.
    failed: failed.map((r) => r.asked + '/' + r.kind),
    // ⛔ SAID OUT LOUD, because a verdict that only a log reader sees is not a verdict.
    saying: sayingFor(failed)
  })

  try { fs.rmSync(scratch, { recursive: true, force: true }) } catch (_) {}
  // ⛔ ALWAYS 0. This reports; it never withholds the system. See the L2-1 note above.
  process.exit(0)
})()
