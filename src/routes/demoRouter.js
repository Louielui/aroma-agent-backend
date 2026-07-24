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
const { DEMO_HTML } = require('../demo/demoHtml')

const INTERACTION_MODES = ['chat', 'email_draft', 'proposal']

// Fail-closed guard: the demo surface exists only when the demo flag is ON.
function demoGuard (req, res, next) {
  if (req.app.locals && req.app.locals.conversationDemo === true) return next()
  return res.status(403).json({ error: 'demo_disabled' })
}

// Map a whitelisted interactionMode to the EXACT engine opts (locked).
function optsForMode (interactionMode, { requestId, contextCard, promoteToProposal }) {
  if (interactionMode === 'email_draft') {
    // U1 early-return path: SHADOW_ONLY. No demo, no promoteToProposal.
    return { requestId, u1DraftShadow: true, contextCard }
  }
  if (interactionMode === 'chat') {
    // Keep demo:true → persona + ACTION_HONESTY_GUARD + sanitized contextCard.
    return { requestId, interactionMode: 'chat', demo: true, contextCard }
  }
  // proposal — proposal-only via the existing demo path + injected domain seam.
  return { requestId, interactionMode: 'proposal', demo: true, contextCard, promoteToProposal }
}

function createDemoRouter ({ getAdapterFn = getAdapter, processIntakeFn = processIntake } = {}) {
  const router = express.Router()

  // GET /demo — serve the single-file UI (guarded).
  router.get('/demo', demoGuard, (req, res) => {
    res.type('html').send(DEMO_HTML)
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
      body('interactionMode')
        .isString().withMessage('interactionMode must be a string')
        .bail()
        .isIn(INTERACTION_MODES).withMessage('interactionMode must be one of chat|email_draft|proposal')
    ],
    async (req, res) => {
      // Server-owned correlation id. A browser-supplied requestId is IGNORED.
      const correlationId = uuidv4()

      // Validate BEFORE any adapter acquisition / model call.
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() })
      }

      const { message, history, contextCard, interactionMode } = req.body

      try {
        const adapter = getAdapterFn()
        const opts = optsForMode(interactionMode, {
          requestId: correlationId,
          contextCard,
          promoteToProposal: req.app.locals && req.app.locals.promoteToProposal
        })
        // ALWAYS 4-arg — never the legacy 3-arg processIntake.
        const result = await processIntakeFn(message, adapter, history || [], opts)
        return res.status(200).json(result)
      } catch (err) {
        // Reuse the existing safe-disclosure boundary. Never leak provider body/stack/key/prompt.
        let mapped
        try {
          mapped = handleIntakeError(err, { correlationId, endpoint: '/api/v1/demo/intake' })
        } catch (_) {
          mapped = { status: 500, body: { error: { code: 'internal_error', message: '系統暫時無法處理這個請求。', correlationId, retryable: false } } }
        }
        return res.status(mapped.status).json(mapped.body)
      }
    }
  )

  return router
}

module.exports = { createDemoRouter, INTERACTION_MODES }
