'use strict'

/**
 * settingsRouter.js — 香香's settings page and its two calls.
 *
 *   GET  /settings                  → the single-file page (owner session)
 *   GET  /api/v1/settings           → current values + effective switch states
 *   POST /api/v1/settings           → validate and save; refuses with a readable reason
 *
 * Gated by the SAME owner session as /demo and /briefing, so the Owner is never asked to
 * authenticate twice. Read and write are on one fixed route each — there is no field name,
 * file path or flag name the browser can invent, because the shape is checked against a
 * closed list in ownerSettings.
 */

const express = require('express')
const {
  load, save, effectiveFlags, CAPS, FLAGS, sourceFlagLabels
} = require('../persona/ownerSettings')
const { SETTINGS_HTML } = require('../demo/settingsHtml')

function createSettingsRouter (deps = {}) {
  const router = express.Router()
  const loadFn = deps.load || load
  const saveFn = deps.save || save
  const flagsFn = deps.effectiveFlags || effectiveFlags

  router.get('/settings', (req, res) => { res.type('html').send(SETTINGS_HTML) })

  router.get('/api/v1/settings', (req, res) => {
    try {
      const s = loadFn()
      res.json({
        ok: true,
        style: s.style,
        preferences: s.preferences,
        updatedAt: s.updatedAt,
        caps: CAPS,
        flags: flagsFn(process.env),
        // The Owner-facing switch names, DERIVED from the registered source list. The page
        // used to hold its own copy of four, so a fifth source had no row and no name.
        flagLabels: sourceFlagLabels()
      })
    } catch (_) {
      res.status(500).json({ ok: false, error: 'settings_read_failed' })
    }
  })

  router.post('/api/v1/settings', (req, res) => {
    const body = req.body || {}
    // A CLOSED SHAPE. Only these three keys are read from the request; anything else the
    // browser sends is ignored rather than merged, so a stray field cannot become a setting.
    const input = {}
    if (typeof body.style === 'string') input.style = body.style
    if (typeof body.preferences === 'string') input.preferences = body.preferences
    if (body.flags && typeof body.flags === 'object' && !Array.isArray(body.flags)) {
      input.flags = {}
      for (const k of FLAGS) {
        if (body.flags[k] === 'on' || body.flags[k] === 'off') input.flags[k] = body.flags[k]
      }
    }

    let out
    try { out = saveFn(input) } catch (_) { return res.status(500).json({ ok: false, error: 'settings_write_failed' }) }

    if (!out.ok) {
      // 422, not 500: the Owner's input was understood and declined. `detail` is written to
      // be read on the page — it names what was rejected and why, and says nothing was saved.
      return res.status(422).json({ ok: false, field: out.field, reason: out.reason, detail: out.detail })
    }
    res.json({ ok: true, updatedAt: out.settings.updatedAt, flags: flagsFn(process.env) })
  })

  return router
}

module.exports = { createSettingsRouter }
