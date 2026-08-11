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
const { t } = require('../i18n/t')
const { body, validationResult } = require('express-validator')
const { v4: uuidv4 } = require('uuid')
const { getAdapter } = require('../adapters/adapterFactory')
const { processIntake } = require('../intake/intakeService')
const a4Runtime = require('../intake/a4Runtime')
const { handleIntakeError } = require('../utils/intakeDiagnostics')
const { logIntakeOutcome } = require('../utils/intakeOutcomeLog') // observability v1: one line per request
const { DEMO_HTML, BUILD_STAMP } = require('../demo/demoHtml')
const { inferWorkRequest } = require('../agent/requestInference') // read the request out of the Owner's own words
const { explainOffer } = require('./workRequestOffer')
// ⛔ The SETTINGS entrance — same shape, same guarantee: an offer, never a change.
const { explainSettingsOffer } = require('./settingsOffer') // the DETERMINISTIC entrance: the model is not the only way to a card
const { MANIFEST_JSON } = require('../demo/appManifest') // installable-app metadata (same-origin, generated from the mark)
const { normalizeProviderHint } = require('../routing/modelRouter') // closed provider allowlist
const { routeLane } = require('../intake/laneRouter') // Unified Conversation v1: zero-context lane routing
// Conversation History v1 — the durable sidebar. READ+APPEND+DELETE, UI path only.
//
// THE DEFAULT IS INERT, AND THAT IS THE WHOLE POINT. This used to default to the real
// process-wide store, so the six existing test files that drive this route inherited a
// writer they never asked for — and one of them posts a conversationId, so every full
// suite run wrote fixture conversations into the Owner's real data directory and
// 「MAIL_TITLE_SENTINEL」 turned up in his sidebar as a Gmail subject. Nothing real was
// overwritten, but only because the fixture ids happened not to collide.
//
// Persistence is now something a caller must ASK for by name. app.js passes the real store;
// anyone who does not gets a store that holds nothing and writes nothing.
const { INERT_CONVERSATION_STORE, isValidId: isValidConversationId } = require('../store/conversationStore')
const { greetingFor } = require('../demo/greeting') // the empty screen's line — the Owner's clock, not the browser's
const { sentenceFor } = require('../context/invoiceBacklog') // the waiting-invoices line; null when there is nothing to say

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

/**
 * The conversation as plain text, for path extraction only.
 *
 * SAME FAMILY AS THE ATTRIBUTION BUG. This read `h.content` while the client pushes
 * `{ role, text }`, so every entry mapped to '' and inferWorkRequest was handed an empty
 * conversation on every turn — a feature that has been reading nothing since it shipped.
 * Both shapes are accepted now: `text` is what the wire carries, `content` is what the
 * stored transcript shape uses, and neither should be able to silently win.
 */
function historyTextOf (history) {
  if (!Array.isArray(history)) return ''
  const parts = history.map((h) => {
    if (typeof h === 'string') return h
    if (!h) return ''
    return [h.text, h.content].filter((v) => typeof v === 'string' && v).join('\n')
  })
  return parts.filter(Boolean).join('\n')
}

/** Sentinel for the greeting's backlog budget — distinguishable from any real result. */
const TIMED_OUT = Symbol('backlog_timed_out')

function createDemoRouter ({ getAdapterFn = getAdapter, processIntakeFn = processIntake, conversationStore = INERT_CONVERSATION_STORE, readBacklogFn = null, backlogTimeoutMs = 2500, errandStoreFn = null } = {}) {
  const router = express.Router()

  // ── CONVERSATION HISTORY v1 — read, load, delete ─────────────────────────
  // Behind the SAME demo guard and the same owner session as the page that calls them.
  // Three routes, no update and no rename: the store is deliberately small because it
  // holds verbatim conversation text.
  //
  // The id is minted by the browser and becomes a FILE NAME, so the store refuses
  // anything that is not a plain id — 400 here rather than a sanitised path there.

  /**
   * THE EMPTY-SCREEN GREETING, decided here rather than in the browser.
   *
   * 早晨 / 午安 / 晚安 depends on the hour, and the hour depends on the OWNER'S timezone —
   * the Owner Settings field, never the clock of whatever device the page is open on. It is
   * fetched per empty screen rather than baked into the page, so a tab left open across noon
   * greets him correctly when he starts a new conversation.
   *
   * UNDER /api/v1/demo ON PURPOSE. The owner gate in app.js is an ENUMERATED path list, so a
   * route on a new prefix is unauthenticated until someone remembers to add it — my first
   * version sat at /api/v1/greeting and answered 200 to an unauthenticated request while every
   * sibling answered 401. Mounted here it inherits the existing gate and cannot be forgotten.
   *
   * It carries no data of any kind: a band word and a proper noun.
   */
  /**
   * ── THE BACKLOG LINE RIDES HERE, AND NEVER BREAKS THE GREETING ─────────────
   * Owner's constraint, verbatim: 「greeting must render even when Drive does not answer」.
   *
   * The greeting is a pure function of the clock. Attaching a network read to it would
   * trade a screen that always works for a feature that usually does — so the greeting is
   * computed FIRST and returned regardless, and the line is attached only if the read
   * resolves inside its budget. A Drive outage costs the line, never the greeting.
   *
   * It surfaces by itself because the failure mode is the Owner FORGETTING: an answer he
   * has to ask for inherits the same defect, and would route through a classifier measured
   * as non-deterministic (M-5).
   *
   * SILENCE IS ONLY FOR 「nothing waiting」. A read failure SPEAKS — see sentenceFor().
   */
  router.get('/api/v1/demo/greeting', demoGuard, async (req, res) => {
    let payload
    try {
      payload = { ok: true, ...greetingFor(new Date()), backlog: null }
    } catch (_) {
      // Never load-bearing: the empty screen simply shows nothing rather than failing.
      return res.status(500).json({ ok: false, error: 'greeting_failed' })
    }

    if (typeof readBacklogFn === 'function') {
      try {
        const budget = new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), backlogTimeoutMs))
        const r = await Promise.race([Promise.resolve().then(readBacklogFn), budget])
        payload.backlog = r === TIMED_OUT
          // A TIMEOUT MUST NOT BE SILENT. It used to set null, which renders identically to
          // 「nothing waiting」 — and that is exactly what happened: the read took 3.2-5.6s
          // against a 2.5s budget, so every cold render showed nothing while 64 files sat
          // in Drive. Silence is reserved for「the feature is off」and nothing else.
          ? t('route.driveStillReading')
          : sentenceFor(r)
      } catch (_) {
        // A thrown read still SAYS so. No sentence at all would be read as 「nothing
        // waiting」, which is the one meaning it must never carry.
        payload.backlog = t('route.driveError')
      }
    }
    res.json(payload)
  })

  /**
   * THE STALE-TAB GUARD. The page embeds the fingerprint of the assets it was built from;
   * this says what the process is serving NOW. A page that finds them different tells the
   * Owner to hard-reload instead of silently running old code against a new server.
   *
   * Deliberately cheap: no store read, no Drive read, no work. The page polls it.
   */
  router.get('/api/v1/demo/version', demoGuard, (req, res) => {
    res.json({ ok: true, build: BUILD_STAMP })
  })

  router.get('/api/v1/conversations', demoGuard, (req, res) => {
    try {
      res.json({ ok: true, conversations: conversationStore.list() })
    } catch (_) {
      res.status(500).json({ ok: false, error: 'conversation_list_failed' })
    }
  })

  router.get('/api/v1/conversations/:id', demoGuard, (req, res) => {
    if (!isValidConversationId(req.params.id)) return res.status(400).json({ ok: false, error: 'invalid_conversation_id' })
    let conversation
    try { conversation = conversationStore.get(req.params.id) } catch (_) {
      return res.status(500).json({ ok: false, error: 'conversation_read_failed' })
    }
    if (!conversation) return res.status(404).json({ ok: false, error: 'not_found' })
    res.json({ ok: true, conversation })
  })

  router.delete('/api/v1/conversations/:id', demoGuard, (req, res) => {
    if (!isValidConversationId(req.params.id)) return res.status(400).json({ ok: false, error: 'invalid_conversation_id' })
    let removed
    try { removed = conversationStore.remove(req.params.id) } catch (_) {
      return res.status(500).json({ ok: false, error: 'conversation_delete_failed' })
    }
    if (!removed) return res.status(404).json({ ok: false, error: 'not_found' })
    // COUNTS AND IDS ONLY, like every other log here. A conversation title is content.
    try { console.log('[AROMA-CONVERSATION]', JSON.stringify({ event: 'CONVERSATION_DELETED', timestamp: new Date().toISOString(), conversationId: req.params.id })) } catch (_) {}
    res.json({ ok: true })
  })

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

        /**
         * ⛔ A4'S RUNTIME DEPENDENCIES — ATTACHED HERE BECAUSE THIS IS WHERE CHAT LIVES.
         *
         * Every A4 gate in intakeService is `interactionMode === 'chat'`, and this router is
         * the only production caller that sets it. So wiring the composer into /api/v1/intake
         * alone would have been a bundle nothing could reach: that route has no chat lane, and
         * A4 would have stayed inert with its flag on.
         *
         * ⛔ CHAT ONLY, on the same terms as `providerHint`. The email_draft and proposal
         * shapes are literally unable to carry this, so no A4 dependency can influence a lane
         * that is not chat. With A4 off the composer returns null and nothing is attached at
         * all — the opts bag is byte-identical to what it has always been.
         */
        if (interactionMode === 'chat') {
          const composed = a4Runtime.createA4RuntimeDependencies({
            env: process.env,
            // Test seam only — production sets nothing and gets the pinned role adapters.
            verifierAdapterFactory: req.app.locals && req.app.locals.a4VerifierAdapterFactory
          })
          if (composed.deps) {
            a4Runtime.logA4Composition(composed, req.app.locals && req.app.locals.a4CompositionSink)
            opts.readContextDeps = Object.assign(
              {},
              // Test seam, on the same terms as this router's other injected dependencies:
              // production sets nothing, so this contributes nothing.
              (req.app.locals && req.app.locals.a4ReadDepsOverride) || null,
              composed.deps
            )
            const over = req.app.locals && req.app.locals.a4ReadDepsOverride
            if (over && over.connector) opts.readContextDeps.connector = over.connector
          }
        }

        /**
         * ⛔ ROUND B — THE SECTION ATTACHMENT. The browser sends a section ID and NOTHING ELSE.
         *
         * The lines are RE-DERIVED here from the server's own store, exactly as the preview
         * endpoint derives them, by the same function. So 「what he was shown」 and 「what
         * travels」 are the same value rather than two renderings that agree today.
         *
         * A browser-supplied set of lines would be a way to put arbitrary text into the prompt
         * wearing the section's name — the same reason `workRequestRoute.js` re-derives the file
         * from the Owner's words instead of honouring a body-supplied path.
         */
        const attachKind = typeof req.body.attachSection === 'string' ? req.body.attachSection : null
        if (attachKind && errandStoreFn) {
          try {
            const { KINDS } = require('../home/errandKinds')
            const { attachmentFor, buildSectionPreamble } = require('../home/sectionAttachment')
            const kind = KINDS.find((k) => k.id === attachKind)
            if (kind) {
              const attachment = attachmentFor(kind, errandStoreFn().list(), Date.now())
              const built = buildSectionPreamble(attachment)
              opts.sectionPreamble = built.preamble
              telemetry.attachedSection = kind.id
              telemetry.attachedLines = attachment.lines.length
              // Transformations are never silent — the same rule contextCard follows.
              if (built.warnings.length) telemetry.attachWarnings = built.warnings.length
            } else {
              telemetry.attachedSection = 'unknown'
            }
          } catch (_) {
            // ⛔ A failure to attach must not silently send an unattached turn: he would be
            // answered from a context he believes was carried. Say so in the outcome record.
            telemetry.attachedSection = 'failed'
          }
        }

        // ALWAYS 4-arg — never the legacy 3-arg processIntake.
        const result = await processIntakeFn(message, adapter, history || [], opts)

        // ── THE OFFER DECISION, COMPUTED BEFORE THE LINE IS WRITTEN ───────────
        // It used to be computed a hundred lines below, AFTER emit() had already written
        // the outcome record — so the two fields were correct, allowlisted, and could
        // never appear. Correct instrumentation written after the thing that reads it is
        // not instrumentation; it is a variable. (HR-8, second instance.)
        const hasProposalAlready = !!(result && typeof result === 'object' && !Array.isArray(result) &&
          Array.isArray(result.proposals) && result.proposals.length > 0)
        const offerDecision = explainOffer({ message, hasProposal: hasProposalAlready })
        /**
         * ⛔ THE SETTINGS OFFER, computed from HIS WORDS. Nothing is written by computing it —
         * it carries before → after so he approves what he can see, and the button is what
         * changes anything.
         */
        let settingsOffer = null
        try {
          const sv = require('../home/settingsValues')
          settingsOffer = explainSettingsOffer({ message, currentValue: (id) => sv.get(id) }).offer
        } catch (_) { settingsOffer = null }
        telemetry.settingsOffer = settingsOffer !== null
        telemetry.workRequestOffer = offerDecision.offer !== null
        telemetry.offerDeclined = offerDecision.reason

        emit('success', 200, null)
        // WHO ACTUALLY ANSWERED. The Owner can pick a provider, but a failed attempt
        // falls back, so the pick is not a promise. `servedBy` is read from the
        // pipeline's own telemetry — what really produced this reply.
        //
        // ⛔ THE MODEL ID, NOT THE PROVIDER NAME. This field used to carry a two-value enum
        // and the comment here used to say 「never a model id」 on purpose. That decision cost
        // a fortnight: the launcher set MULTI_AI_ROUTER='on', the picker defaulted to
        // 'claude' and won the precedence, and every turn came back labelled 「Claude」 — true,
        // and silent about the fact that Claude meant `claude-haiku-4-5-20251001`, the
        // smallest model available. The Owner judged the system on that and had no way to
        // see it. (HR-62.)
        //
        // ⛔ AND ABSENT STAYS ABSENT. `telemetry.model` is the id the ADAPTER returned for the
        // call that happened. If it is missing, this is null — it is NOT backfilled with the
        // provider name, because 「claude」 in a field that now means 「which model」 is exactly
        // the plausible substitute this change exists to remove.
        //
        // CHAT LANE ONLY. It is the only lane whose provider can vary and the only one
        // with a picker; email_draft and proposal keep a byte-identical passthrough
        // envelope, so nothing downstream of them sees a new field.
        const isChat = interactionMode === 'chat'
        const answered = (isChat && result && typeof result === 'object' && !Array.isArray(result))
          ? Object.assign({}, result, {
              lane: interactionMode,
              servedBy: (telemetry && typeof telemetry.model === 'string' && telemetry.model) ? telemetry.model : null,
              /**
               * ⛔ PER CALL, BECAUSE ONE TURN CAN INVOLVE MORE THAN ONE MODEL.
               *
               * `servedBy` above names the model that produced the ANSWER. Once routing is
               * deterministic and authoring runs a different model, one label describes
               * neither — HR-62 rebuilt deliberately, which is why the Owner made this a
               * precondition rather than a nicety.
               *
               * The routing entry appears with `deterministic: true` and `model: null`. That
               * null means 「no model was asked」; an answer entry's null means 「a model was
               * asked and we cannot say which」. They are told apart by `deterministic`, never
               * by absence — a list that omitted the routing step would read as the second
               * when it was the first.
               */
              calls: (telemetry && Array.isArray(telemetry.calls)) ? telemetry.calls : [],
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

        // ── THE DETERMINISTIC ENTRANCE (2026-08-05, Owner ruling) ───────────────
        // The card used to be reachable ONLY through the model classifying the turn as
        // commit with exactly one task. Measured: an explicit change request returned
        // ask, and one character of difference produced a proposal. The Owner: 「I am not
        // going to learn a magic sentence.」
        //
        // THIS CREATES NOTHING. It attaches the makings of one sentence and a button;
        // only pressing it reaches /api/v1/owner/work-requests, which is the first thing
        // in the chain that creates a Task or a Proposal.
        //
        // THE FIELD APPEARS ONLY WHEN IT FIRES, so a turn that is not a change request is
        // byte-identical to before — the rule that a consumer must not gain a field for a
        // reason unrelated to it is narrowed here, not abandoned.
        // Decided and recorded above, before emit(). carriesProposal is recomputed there
        // from the same result, so the two cannot disagree.
        const offer = offerDecision.offer
        const withOffer0 = offer ? Object.assign({}, withInference, { workRequestOffer: offer }) : withInference
        const withOffer = settingsOffer ? Object.assign({}, withOffer0, { settingsOffer }) : withOffer0

        // ── CONVERSATION HISTORY v1 — APPEND ─────────────────────────────────
        // One completed turn, written after the reply exists, so a failed turn leaves no
        // half-conversation behind. FAIL-OPEN for the same reason the Lab hook beside it
        // is: the answer has already been produced and a write must not be able to take
        // it away. Nothing is added to the response — a consumer of this envelope must not
        // gain a field because the sidebar learned to remember.
        //
        // WHAT IS STORED IS WHAT WAS SHOWN. Unlike the Lab archive, which keeps only her
        // own words under A′, this is the transcript the Owner clicks back into, so it
        // holds the rendered reply — retrieved rows and all. That is a deliberate
        // widening of what sits on disk and is reported to the Owner as such.
        const conversationId = typeof req.body.conversationId === 'string' ? req.body.conversationId : null
        if (conversationId && isValidConversationId(conversationId)) {
          try {
            const shown = (withOffer && typeof withOffer === 'object' && typeof withOffer.reply === 'string')
              ? withOffer.reply
              : null
            if (shown !== null) {
              conversationStore.appendTurn({
                id: conversationId,
                userText: message,
                replyText: shown,
                servedBy: (telemetry && typeof telemetry.model === 'string' && telemetry.model) ? telemetry.model : null
              })
            }
          } catch (err) {
            // FAIL-OPEN FOR THE REPLY, BUT NEVER SILENT.
            //
            // The fail-open half is right and stays: the answer already exists and a disk
            // problem must not take it away. The SILENT half was the defect — this was a
            // bare `catch (_) {}`, so an unwired store, a full disk and a perfect save all
            // looked identical from outside. The inert store's appendTurn now throws
            // precisely so a wiring regression is detectable; swallowing it here would
            // discard that one line later.
            //
            // ENUM, NOT THE ERROR TEXT. An error message is not a closed vocabulary — it
            // carries whatever it was handed, including a path or a value. Counts, enums
            // and ids only, like every other log in this pipeline.
            const m = (err && err.message) || ''
            const reason = m === 'conversation_store_not_wired'
              ? 'store_not_wired'
              : (m === 'invalid_conversation_id' ? 'invalid_id' : 'write_failed')
            try {
              console.log('[AROMA-CONVERSATION]', JSON.stringify({
                event: 'CONVERSATION_APPEND_FAILED',
                timestamp: new Date().toISOString(),
                conversationId,
                reason
              }))
            } catch (_) {}
          }
        }

        return res.status(200).json(withOffer)
      } catch (err) {
        // Reuse the existing safe-disclosure boundary. Never leak provider body/stack/key/prompt.
        let mapped
        try {
          mapped = handleIntakeError(err, { correlationId, endpoint: '/api/v1/demo/intake' })
        } catch (_) {
          mapped = { status: 500, body: { error: { code: 'internal_error', message: t('diag.internal'), correlationId, retryable: false } } }
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

module.exports = { createDemoRouter, INTERACTION_MODES, historyTextOf }
