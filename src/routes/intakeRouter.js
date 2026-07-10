'use strict'

const express = require('express')
const { body, validationResult } = require('express-validator')
const { processIntake } = require('../intake/intakeService')
const { getAdapter } = require('../adapters/adapterFactory')

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
    // Input validation
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      })
    }

    const { message, history } = req.body

    try {
      // Get the active adapter (swappable via LLM_PROVIDER env var)
      const adapter = getAdapter()

      const result = await processIntake(message, adapter, history || [])
      return res.status(200).json(result)
    } catch (err) {
      // Log the error type/message — never log message content or API key
      console.error('[AROMA-INTAKE] Error processing intake:', err.message)
      return res.status(500).json({
        error: 'Internal server error',
        detail: err.message
      })
    }
  }
)

module.exports = router
