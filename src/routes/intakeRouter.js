'use strict'

const express = require('express')
const { body, validationResult } = require('express-validator')
const { v4: uuidv4 } = require('uuid')
const { processIntake } = require('../intake/intakeService')
const { getAdapter } = require('../adapters/adapterFactory')
const { handleIntakeError } = require('../utils/intakeDiagnostics')

const router = express.Router()

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
      const adapter = getAdapter()

      // B2-2 Conversation Demo — flag-gated. OFF (default): identical 3-arg call.
      const demoOn = req.app.locals && req.app.locals.conversationDemo === true
      const result = demoOn
        ? await processIntake(message, adapter, history || [], { requestId: correlationId, demo: true, contextCard, promoteToProposal: req.app.locals.promoteToProposal })
        : await processIntake(message, adapter, history || [])
      return res.status(200).json(result)
    } catch (err) {
      // Slice B: single safe-disclosure boundary. Metadata-only server diagnostic
      // (log-only, no raw/message/stack) + stable client contract. Never leak.
      let mapped
      try {
        mapped = handleIntakeError(err, { correlationId, endpoint: '/api/v1/intake' })
      } catch (_) {
        mapped = { status: 500, body: { error: { code: 'internal_error', message: '系統暫時無法處理這個請求。', correlationId, retryable: false } } }
      }
      return res.status(mapped.status).json(mapped.body)
    }
  }
)

module.exports = router
