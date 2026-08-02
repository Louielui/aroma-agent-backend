'use strict'

/**
 * briefingRouter.js — the Owner's Morning Briefing page and its one generate call.
 *
 *   GET  /briefing                    → the single-file page (owner session)
 *   POST /api/v1/briefing/generate    → build one brief, return it, store metadata only
 *
 * ── WHY THE BROWSER NEVER TOUCHES THE CONTEXT ROUTES ──────────────────────
 * The read happens HERE, in process, by calling buildReadContext directly. The page is
 * given a finished brief. It cannot name a source, a method or a query, so there is no
 * parameter through which a browser — or anything that reaches one — could steer a read.
 * `/api/v1/context/*` stays exactly as private as it was; nothing here widens it.
 *
 * GENERATE IS A POST WITH NO BODY. It is not a mutation of anything external — every
 * source is read-only — but it costs real API calls, and a GET would be prefetched by a
 * browser, retried on refresh, and followed by a link scanner.
 */

const express = require('express')
const { buildReadContext } = require('../context/readContext')
const { createLiveReadConnector, enabledSources } = require('../context/liveClients')
const { buildMorningBriefing } = require('../coo/morningBriefing')
const { createBriefStore, hashBrief } = require('../coo/briefStore')
const { BRIEFING_HTML } = require('../demo/briefingHtml')

function createBriefingRouter (deps = {}) {
  const router = express.Router()
  const buildConnector = deps.buildConnector || ((env) => createLiveReadConnector({ env }))
  const buildBrief = deps.buildMorningBriefingFn || buildMorningBriefing
  const store = deps.briefStore || createBriefStore()
  const listProposals = deps.listPendingProposals || defaultListProposals
  const recall = deps.buildDecisionRecall || defaultDecisionRecall

  // ONE AT A TIME. The Owner pressing the button twice must produce one brief, not two
  // concurrent fans of API reads against four external services.
  let inFlight = null

  router.get('/briefing', (req, res) => { res.type('html').send(BRIEFING_HTML) })

  router.post('/api/v1/briefing/generate', async (req, res) => {
    if (inFlight) {
      try { const prev = await inFlight; return res.json(Object.assign({}, prev, { coalesced: true })) } catch (_) { /* fall through and try afresh */ }
    }
    inFlight = (async () => {
      const { connector } = buildConnector(process.env)
      const { brief, audit } = await buildBrief({
        buildReadContextFn: buildReadContext,
        connector,
        sources: enabledSources(process.env),
        listPendingProposals: listProposals,
        buildDecisionRecall: recall,
        env: process.env
      })

      // METADATA ONLY. The brief body is represented by its hash and nothing else; if this
      // record is ever rejected the brief is still returned, because a storage rule must
      // not cost the Owner the answer he asked for.
      const stored = store.write({
        briefId: audit.briefId,
        generatedAt: audit.generatedAt,
        schemaVersion: audit.schemaVersion,
        provider: 'none',
        model: 'none',
        sourceStatuses: audit.sourceStatuses,
        itemCounts: audit.itemCounts,
        durationMs: audit.durationMs,
        contentHash: hashBrief(brief),
        outcome: audit.outcome
      })

      return { ok: true, brief, stored: stored.ok === true, storeRefusal: stored.ok ? null : stored.reason }
    })()

    try {
      const out = await inFlight
      res.json(out)
    } catch (err) {
      res.status(500).json({ ok: false, error: 'briefing_failed', detail: (err && err.message) || 'unknown' })
    } finally {
      inFlight = null
    }
  })

  return router
}

/** Pending proposals, read straight from the persisted store. Read-only. */
function defaultListProposals () {
  const { load } = require('../coo/proposalPersistence')
  const db = load()
  const all = db && db.proposals ? Object.values(db.proposals) : []
  return all.filter((p) => p && p.status === 'pending')
}

/**
 * Decision Recall as its OWN source. It reports how many active decisions are on record;
 * an empty store is `live` with count 0 — read successfully, nothing there — which is a
 * different statement from "could not be read", and the brief keeps them apart.
 */
function defaultDecisionRecall () {
  const store = require('../store/store')
  const decisions = store.listDecisions() || []
  return { count: decisions.filter((d) => d && d.status === 'active').length }
}

module.exports = { createBriefingRouter }
