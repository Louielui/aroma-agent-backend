'use strict'

// demoRouter — B2-2 Conversation Demo v1 (LOCAL, same-origin, fail-closed).
//
//   GET  /demo                → single same-origin HTML page (DEMO_HTML)
//   POST /api/v1/demo/intake  → deterministic-mode intake for the demo UI
//
// Both routes are ALWAYS mounted but GUARD-FIRST: when
// req.app.locals.conversationDemo !== true they return 403 {error:'demo_disabled'}
// before any adapter lookup, model call, processIntake, persistence, or render.
//
// Safety contract:
//   * ALWAYS 4-arg processIntake with explicit opts — never the legacy 3-arg path
//     (so a demo request can never reach the auto-dispatch tail).
//   * interactionMode whitelist {chat, email_draft, proposal}; anything else → 400
//     BEFORE getAdapter()/any model call.
//   * requestId is server-owned; a browser-supplied requestId is never authoritative.
//   * email_draft → U1 SHADOW_ONLY (no demo, no promoteToProposal).
//   * chat/proposal → the deterministic interactionMode gate in intakeService.
//
// Dependency injection (tests only): createDemoRouter({ getAdapterFn, processIntakeFn }).
// No test-only request field / header / env flag selects fixtures.

const express = require('express')
const { body, validationResult } = require('express-validator')
const { v4: uuidv4 } = require('uuid')
const { getAdapter } = require('../adapters/adapterFactory')
const { processIntake } = require('../intake/intakeService')
const { handleIntakeError } = require('../utils/intakeDiagnostics')
const { logIntakeOutcome } = require('../utils/intakeOutcomeLog') // observability v1: one line per request
const { DEMO_HTML } = require('../demo/demoHtml')
const { inferWorkRequest } = require('../agent/requestInference') // read the request out of the Owner's own words
const { MANIFEST_JSON } = require('../demo/appManifest') // installable-app metadata (same-origin, generated from the mark)
const { normalizeProviderHint } = require('../routing/modelRouter') // closed provider allowlist
const { routeLane } = require('../intake/laneRouter') // Unified Conversation v1: zero-context lane routing

const INTERACTION_MODES = ['chat', 'email_draft', 'proposal']

// Fail-closed guard: the demo surface exists only when the demo flag is ON.
function demoGuard (req, res, next) {
  if (req.app.locals && req.app.locals.conversationDemo === true) return next()
  return res.status(403).json({ error: 'demo_disabled' })
}

// Map a whitelisted interactionMode to the EXACT engine opts (locked).
//
// `providerHint` is the Owner's pick from the composer. It is VALIDATED HERE against the
// router's closed allowlist before it can travel any further, and it is attached to the
// CHAT opts only — the email_draft and proposal shapes below are literally unable to
// carry it, so no hint can influence a lane that is not chat. An unrecognised value
// becomes null and the engine falls back to its flag-driven default.
function optsForMode (interactionMode, { requestId, contextCard, promoteToProposal, providerHint }) {
  if (interactionMode === 'email_draft') {
    // U1 early-return path: SHADOW_ONLY. No demo, no promoteToProposal.
    return { requestId, u1DraftShadow: true, contextCard }
  }
  if (interactionMode === 'chat') {
    // Keep demo:true → persona + ACTION_HONESTY_GUARD + sanitized contextCard.
    return { requestId, interactionMode: 'chat', demo: true, contextCard, providerHint: normalizeProviderHint(providerHint) }
  }
  // proposal — proposal-only via the existing demo path + injected domain seam.
  return { requestId, interactionMode: 'proposal', demo: true, contextCard, promoteToProposal }
}

/** The conversation as plain text, for path extraction only. */
function historyTextOf (history) {
  if (!Array.isArray(history)) return ''
  const parts = history.map((h) => {
    if (h && typeof h.content === 'string') return h.content
    return typeof h === 'string' ? h : ''
  })
  return parts.join('\n')
}

function createDemoRouter ({ getAdapterFn = getAdapter, processIntakeFn = processIntake } = {}) {
  const router = express.Router()

  // GET /demo — serve the single-file UI (guarded).
  router.get('/demo', demoGuard, (req, res) => {
    res.type('html').send(DEMO_HTML)
  })

  // GET /manifest.webmanifest — makes the page installable as a desktop app (guarded the
  // same way as the page it describes). Static, same-origin, generated at load time from
  // the dot already in assets/; it references no other host and no other file.
  router.get('/manifest.webmanifest', demoGuard, (req, res) => {
    // MUST REVALIDATE. The manifest carries the app's icon, and the icon changes: the
    // lantern became a dot and the installed app kept showing the lantern. Chrome captures
    // the icon at install time, so an installed app needs a reinstall either way — but
    // without this header Chrome may not even re-FETCH the manifest to notice, which makes
    // the stale icon look permanent. `no-cache` means revalidate every time, not "never
    // cache": the ETag still makes it a cheap 304 when nothing changed.
    res.setHeader('Cache-Control', 'no-cache')
    res.type('application/manifest+json').send(MANIFEST_JSON)
  })

  // POST /api/v1/demo/intake — deterministic-mode intake (guarded).
  router.post(
    '/api/v1/demo/intake',
    demoGuard,
    [
      body('message')
        .isString().withMessage('message must be a string')
        .trim()
        .notEmpty().withMessage('message must not be empty')
        .isLength({ max: 2000 }).withMessage('message must be ≤ 2000 characters'),
      // Unified Conversation v1: the page no longer asks the Owner to pick a lane, so
      // interactionMode is now OPTIONAL. When absent, the server routes from the message
      // itself. When present it is still honoured and still strictly whitelisted, so the
      // "+" shortcuts, existing scripts and every existing test keep working unchanged.
      body('interactionMode')
        .optional()
        .isString().withMessage('interactionMode must be a string')
        .bail()
        .isIn(INTERACTION_MODES).withMessage('interactionMode must be one of chat|email_draft|proposal')
    ],
    async (req, res) => {
      // Server-owned correlation id. A browser-supplied requestId is IGNORED.
      const correlationId = uuidv4()
      // OBSERVABILITY v1: exactly ONE outcome line per request — success, handled
      // failure, or a failure BEFORE the model call (which used to be invisible).
      // `telemetry` is filled by the pipeline with numbers/short enums only; it is
      // never part of the HTTP response.
      const t0 = Date.now()
      const telemetry = {}
      const emit = (outcome, httpStatus, errorCode) => logIntakeOutcome(Object.assign({
        correlationId, endpoint: '/api/v1/demo/intake', outcome, httpStatus, latencyMs: Date.now() - t0, errorCode: errorCode || null
      }, telemetry))

      // Validate BEFORE any adapter acquisition / model call.
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        emit('validation_rejected', 400, 'validation_failed')
        return res.status(400).json({ error: 'Validation failed', details: errors.array() })
      }

      const { message, history, contextCard, providerHint } = req.body

      // ── ROUTE FIRST, FETCH SECOND (Owner's order, do not invert) ────────────
      // The lane is decided here, from the user's words alone, BEFORE any context is
      // fetched — so an email costs no Drive/Gmail round-trip and a question costs no
      // proposal machinery. An explicit interactionMode (the "+" shortcuts, scripts,
      // tests) still wins; routing is what happens when nobody chose.
      //
      // THE LANE GUARANTEE MOVED, AND THIS IS WHERE IT NOW LIVES. It used to be
      // structural — the chat opts simply had no promoteToProposal to hand over. It is
      // still structural, one step earlier: optsForMode below builds the SAME three
      // locked shapes it always did, and only the 'proposal' shape carries
      // promoteToProposal. The router chooses among those shapes and can do nothing else.
      // It reads no retrieved content, so no Drive document or Decision record can steer
      // a turn into the proposal lane; and a proposal is inert anyway.
      // previousLane is a LANE NAME the page reports from the turn it just rendered. It
      // is validated against the same closed list as everything else and can only ever
      // continue a SHORT reply — it cannot select a lane for real input, and the router
      // refuses to continue into the proposal lane at all.
      const prevLane = INTERACTION_MODES.includes(req.body.previousLane) ? req.body.previousLane : null
      const routed = routeLane(message, { previousLane: prevLane })
      const interactionMode = (typeof req.body.interactionMode === 'string' && req.body.interactionMode)
        ? req.body.interactionMode
        : routed.lane
      telemetry.lane = interactionMode
      telemetry.laneReason = (typeof req.body.interactionMode === 'string' && req.body.interactionMode) ? 'explicit' : routed.reason

      try {
        const adapter = getAdapterFn()
        const opts = optsForMode(interactionMode, {
          requestId: correlationId,
          contextCard,
          promoteToProposal: req.app.locals && req.app.locals.promoteToProposal,
          providerHint
        })
        opts.telemetry = telemetry
        // ALWAYS 4-arg — never the legacy 3-arg processIntake.
        const result = await processIntakeFn(message, adapter, history || [], opts)
        emit('success', 200, null)
        // WHO ACTUALLY ANSWERED. The Owner can pick a provider, but a failed attempt
        // falls back, so the pick is not a promise. `servedBy` is read from the
        // pipeline's own telemetry — the provider that really produced this reply — and
        // is a short enum only ('claude' | 'openai'), never a model id, never a body.
        //
        // CHAT LANE ONLY. It is the only lane whose provider can vary and the only one
        // with a picker; email_draft and proposal keep a byte-identical passthrough
        // envelope, so nothing downstream of them sees a new field.
        const isChat = interactionMode === 'chat'
        const answered = (isChat && result && typeof result === 'object' && !Array.isArray(result))
          ? Object.assign({}, result, {
              lane: interactionMode,
              servedBy: (telemetry && typeof telemetry.provider === 'string') ? telemetry.provider : null,
              fallbackUsed: telemetry.fallbackUsed === true
            })
          : result

        // ── XIANGXIANG LAB — Conversation Persistence v0.1, WRITE ONLY ────────
        // The only line the Lab adds to the live path. With XIANGXIANG_ARCHIVE off it returns
        // immediately without loading the archive module at all, so the flag-off behaviour is
        // structural rather than a promise.
        //
        // FAIL-OPEN, deliberately and unlike the Computer Operator's audit: the reply has
        // already been produced, and a Lab write is not permitted to take it away. The outcome
        // is attached so a failure is VISIBLE rather than silent — the whole point of the
        // archive is defeated if nobody notices it stopped recording.
        let labArchive = null
        try {
          const { recordExchange } = require('../lab/labArchiveHook')
          labArchive = recordExchange({
            conversationId: typeof req.body.conversationId === 'string' ? req.body.conversationId : null,
            message,
            // WHAT SHE SAID, NOT WHAT WAS RENDERED AROUND IT. The Owner-facing view
            // appends deterministic per-item sections built from retrieved rows, so the
            // displayed reply now contains third-party titles and amounts BY
            // CONSTRUCTION — archiving that would put other people's business into
            // permanent storage on every read turn, which is exactly what A′ exists to
            // prevent. `replyForArchive` is her own words, the same text A′ has always
            // judged; the sections are presentation and are regenerable from the source.
            reply: answered && typeof answered.replyForArchive === 'string'
              ? answered.replyForArchive
              : (answered && typeof answered.reply === 'string' ? answered.reply : null),
            turnIndex: Array.isArray(history) ? history.length : 0,
            // PROVENANCE FROM THE CALL THAT HAPPENED. Both are set by noteProvider() in the
            // intake pipeline, from the adapter's own result, for the provider that actually
            // produced this reply. Neither is inferred here and neither has a default.
            model: telemetry && telemetry.model ? telemetry.model : null,
            provider: telemetry && telemetry.provider ? telemetry.provider : null,
            // A′ third-party scope. Passed through UNTOUCHED — no `|| false`, because
            // coercing an absent value to false would silently convert "we do not know"
            // into "it is safe to keep", which is the one direction that must never be
            // guessed. The hook omits on anything that is not an explicit false.
            readContextUsed: telemetry ? telemetry.readContextUsed : undefined,
            // A′ NARROWED — same passthrough discipline, same fail-safe. Only an explicit
            // `false` (this reply drew on nothing) keeps the body; absent stays undefined
            // and the hook omits.
            replyCitesContext: telemetry ? telemetry.replyCitesContext : undefined,
            readContextSources: (telemetry && Array.isArray(telemetry.readContextSources)) ? telemetry.readContextSources : [],
            lane: interactionMode,
            requestId: correlationId
          })
        } catch (_) {
          labArchive = { recorded: false, reason: 'hook_threw' }
        }
        const withLab = (labArchive && labArchive.reason !== 'flag_off' && answered && typeof answered === 'object' && !Array.isArray(answered))
          ? Object.assign({}, answered, { labArchive })
          : answered

        // WHAT SHE READ OUT OF THE OWNER'S OWN WORDS. Computed HERE, server-side, from the
        // same path extractor the Work Order producer validates with — so the thing that
        // guesses and the thing that checks can never drift into two implementations.
        // It changes only what she ASKS; the Work Order, its hash and the typed EXECUTE are
        // untouched, and every inference is printed on the card before approval.
        // ONLY WHERE IT IS USED. The inference exists so the work-order affordance can stop
        // asking for the path the Owner just typed — so it rides only on a response that
        // actually carries a proposal. Chat and email_draft envelopes stay byte-identical,
        // because a consumer of those must not gain a field for a reason that has nothing
        // to do with them.
        const carriesProposal = withLab && typeof withLab === 'object' && !Array.isArray(withLab) &&
          Array.isArray(withLab.proposals) && withLab.proposals.length > 0
        const withInference = carriesProposal
          ? Object.assign({}, withLab, {
              inferred: inferWorkRequest({ message, conversation: historyTextOf(history) })
            })
          : withLab

        return res.status(200).json(withInference)
      } catch (err) {
        // Reuse the existing safe-disclosure boundary. Never leak provider body/stack/key/prompt.
        let mapped
        try {
          mapped = handleIntakeError(err, { correlationId, endpoint: '/api/v1/demo/intake' })
        } catch (_) {
          mapped = { status: 500, body: { error: { code: 'internal_error', message: '系統暫時無法處理這個請求。', correlationId, retryable: false } } }
        }
        // 'early_error' when the pipeline never reached a provider (adapter acquisition,
        // guard, unexpected throw); 'handled_error' once a provider had been contacted.
        emit(telemetry.provider ? 'handled_error' : 'early_error', mapped.status, mapped.body && mapped.body.error && mapped.body.error.code)
        return res.status(mapped.status).json(mapped.body)
      }
    }
  )

  return router
}

module.exports = { createDemoRouter, INTERACTION_MODES }
