'use strict'

const express = require('express')
const { t } = require('../i18n/t')
const { body, validationResult } = require('express-validator')
const { v4: uuidv4 } = require('uuid')
const { processIntake } = require('../intake/intakeService')
const { getAdapter } = require('../adapters/adapterFactory')
const { handleIntakeError } = require('../utils/intakeDiagnostics')
const { createA4RuntimeDependencies, logA4Composition } = require('../intake/a4Runtime')

const router = express.Router()

/**
 * ⛔ THE PRODUCTION A4 COMPOSITION, ON THE REAL ROUTE.
 *
 * This route used to call processIntake with no read dependencies at all, so every A4
 * dependency was `null` in production and A4 could not route even with its flag on. The bundle
 * is built here, per request, from the same adapter that answers the Owner.
 *
 * ⛔ WITH A4 OFF THIS RETURNS null AND THE CALL SHAPE IS UNCHANGED. `readContextDeps` is only
 * attached when there is something in it, so the OFF path passes exactly what it passed before
 * — no connector override, no source list override, nothing for the service to resolve
 * differently.
 */
function a4DepsFor (locals) {
  if (locals && locals.a4RuntimeDependencies) return locals.a4RuntimeDependencies // test seam
  // ⛔ THE MAIN ADAPTER IS NOT PASSED. A4 verifiers are role-pinned; see a4Runtime.
  const composed = createA4RuntimeDependencies({
    env: process.env,
    // Test seam only — production sets nothing and gets the pinned role adapters.
    verifierAdapterFactory: locals && locals.a4VerifierAdapterFactory
  })
  if (!composed.deps) return null
  logA4Composition(composed, locals && locals.a4CompositionSink)
  return composed.deps
}

/**
 * POST /api/v1/intake
 *
 * Body: { message: string }
 *
 * Success (clean message):
 *   200 { blocked: false, understanding, decision: { statement, rationale }, tasks: [{ title, note }], requestId }
 *
 * Blocked (red-line matched):
 *   200 { blocked: true, blocked_reason, understanding: "含敏感資訊...", requestId }
 *
 * Validation error:
 *   400 { error: "Validation failed", details: [...] }
 *
 * Server error:
 *   500 { error: "Internal server error", message }
 */
router.post(
  '/',
  [
    body('message')
      .isString().withMessage('message must be a string')
      .trim()
      .notEmpty().withMessage('message must not be empty')
      .isLength({ max: 2000 }).withMessage('message must be ≤ 2000 characters')
  ],
  async (req, res) => {
    // One correlation id per request. Used as the intake requestId on the demo path
    // and as the fallback id for the error boundary (covers errors thrown before the
    // service tags one, e.g. getAdapter()).
    const correlationId = uuidv4()

    // Input validation
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      })
    }

    const { message, history, contextCard } = req.body // contextCard untrusted; sanitized downstream; ignored when demo OFF

    try {
      // Get the active adapter (swappable via LLM_PROVIDER env var)
      const locals = req.app.locals || {}
      // ⛔ THE ADAPTER SEAM IS `app.locals`, the same channel `promoteToProposal` already uses.
      // Production sets nothing, so this is `getAdapter()` exactly as before.
      const adapter = typeof locals.adapterFactory === 'function' ? locals.adapterFactory() : getAdapter()

      const a4Deps = a4DepsFor(locals)

      // B2-2 Conversation Demo — flag-gated. OFF (default): identical 3-arg call.
      const demoOn = locals.conversationDemo === true
      // ⛔ ONE OPTIONS BAG, AND IT STAYS ABSENT WHEN THERE IS NOTHING TO PUT IN IT. A4 off and
      // demo off must remain the original 3-argument call, byte for byte.
      const opts = demoOn
        ? { requestId: correlationId, demo: true, contextCard, promoteToProposal: locals.promoteToProposal, viaRoute: 'intake' }
        : (a4Deps ? {} : null)
      if (opts && a4Deps) opts.readContextDeps = a4Deps

      const result = opts
        ? await processIntake(message, adapter, history || [], opts)
        : await processIntake(message, adapter, history || [])
      return res.status(200).json(result)
    } catch (err) {
      // Slice B: single safe-disclosure boundary. Metadata-only server diagnostic
      // (log-only, no raw/message/stack) + stable client contract. Never leak.
      let mapped
      try {
        mapped = handleIntakeError(err, { correlationId, endpoint: '/api/v1/intake' })
      } catch (_) {
        mapped = { status: 500, body: { error: { code: 'internal_error', message: t('diag.internal'), correlationId, retryable: false } } }
      }
      return res.status(mapped.status).json(mapped.body)
    }
  }
)

module.exports = router
