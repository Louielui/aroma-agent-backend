'use strict'

/**
 * enquiryRoutes.js — read one investigation, when he asks.
 *
 * > **Owner: 「The report is what I read normally; the turns are what I check when the report
 * > surprises me.」**
 *
 *   GET /api/v1/demo/enquiries        → REPORTS only, newest first
 *   GET /api/v1/demo/enquiries/:id    → the whole enquiry, turns included
 *
 * The asymmetry is the design. Putting turns in the list would recreate exactly the relay
 * the dispatch path removes — he would be reading every intermediate result again, just in a
 * different window.
 *
 * UNDER /api/v1/demo ON PURPOSE. The owner gate in app.js is an ENUMERATED path list, so a
 * route on a new prefix is unauthenticated until someone remembers to add it — that has
 * already happened once with /api/v1/greeting.
 */

const express = require('express')

function demoGuard (req, res, next) {
  if (req.app.locals && req.app.locals.conversationDemo === true) return next()
  return res.status(403).json({ error: 'demo_disabled' })
}

function createEnquiryRouter ({ enquiryStore } = {}) {
  const router = express.Router()

  router.get('/api/v1/demo/enquiries', demoGuard, (req, res) => {
    try {
      // Reports only. The store enforces this too; both layers state it so neither can be
      // relaxed quietly.
      res.json({ ok: true, enquiries: enquiryStore ? enquiryStore.list() : [] })
    } catch (_) {
      res.status(500).json({ ok: false, error: 'enquiry_list_failed' })
    }
  })

  router.get('/api/v1/demo/enquiries/:id', demoGuard, (req, res) => {
    const rec = enquiryStore ? enquiryStore.get(req.params.id) : null
    // 404, never an empty enquiry object — an empty one renders as 「it ran and found
    // nothing」, which is the confusion this whole project keeps removing.
    if (!rec) return res.status(404).json({ ok: false, error: 'enquiry_not_found' })
    res.json({ ok: true, enquiry: rec })
  })

  return router
}

module.exports = { createEnquiryRouter }
