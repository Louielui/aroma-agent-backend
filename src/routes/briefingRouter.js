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
const { validateBriefForDelivery, OUTCOME } = require('../coo/briefDelivery')
const { scrubReason } = require('../utils/readContextLog')
const { BRIEFING_HTML } = require('../demo/briefingHtml')

/** Sentinel so a validator crash is distinguishable from a validator refusal. */
const VALIDATOR_THREW = Symbol('validator_threw')

function createBriefingRouter (deps = {}) {
  const router = express.Router()
  const buildConnector = deps.buildConnector || ((env) => createLiveReadConnector({ env }))
  const buildBrief = deps.buildMorningBriefingFn || buildMorningBriefing
  const validate = deps.validateBriefForDeliveryFn || validateBriefForDelivery
  const store = deps.briefStore || createBriefStore({ persist: true })
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
      const { brief: draft, audit } = await buildBrief({
        buildReadContextFn: buildReadContext,
        connector,
        sources: enabledSources(process.env),
        listPendingProposals: listProposals,
        buildDecisionRecall: recall,
        env: process.env
      })

      // ── THE ONE GATE ────────────────────────────────────────────────────
      // Everything the Owner will see passes through here, and what it removes is GONE
      // from the payload. It runs BEFORE the hash, so the hash attests to what was
      // delivered rather than to a draft nobody saw. A throw here is fail-closed: the
      // catch below sends no payload at all.
      const verdict = validate(draft)
      const brief = verdict.brief

      // METADATA ONLY, and the outcome is the VALIDATOR'S, not the builder's.
      const stored = store.write({
        briefId: audit.briefId,
        generatedAt: audit.generatedAt,
        schemaVersion: audit.schemaVersion,
        provider: 'none',
        model: 'none',
        sourceStatuses: audit.sourceStatuses,
        itemCounts: countItems(brief),
        durationMs: audit.durationMs,
        contentHash: hashBrief(brief),
        outcome: verdict.outcome
      })

      return { ok: true, brief, stored: stored.ok === true, storeRefusal: stored.ok ? null : stored.reason }
    })()

    try {
      const out = await inFlight
      res.json(out)
    } catch (err) {
      // FAIL CLOSED, AND SAY NOTHING ABOUT WHY.
      //
      // An adapter's error text is written for developers: it cheerfully includes URLs,
      // ids and sometimes the query. None of that belongs in a browser response, so the
      // browser gets a fixed code and nothing else. The reason is scrubbed before it
      // reaches the log, through the same projector the read layer uses.
      const failed = isValidationFailure(err)
      recordFailure(failed ? OUTCOME.FAILED : 'briefing_failed', err)
      res.status(500).json({ ok: false, error: failed ? 'delivery_validation_failed' : 'briefing_failed' })
    } finally {
      inFlight = null
    }
  })

  /** Item counts taken from the DELIVERED brief, so the audit counts what was sent. */
  function countItems (brief) {
    const out = {}
    for (const [k, v] of Object.entries(brief.sections)) out[k] = Array.isArray(v) ? v.length : 0
    return out
  }

  /** A validator throw is a different failure from a read failure, and is named as such. */
  function isValidationFailure (err) {
    const m = (err && err.message) || ''
    return m === 'not_a_brief' || m.startsWith('missing_section:') || err === VALIDATOR_THREW
  }

  /**
   * One scrubbed line, and only when there is something to say. The raw message never
   * reaches console: scrubReason strips URLs, paths, addresses and opaque ids and caps
   * the length, exactly as the read layer does for adapter errors.
   */
  function recordFailure (outcome, err) {
    try {
      console.log('[AROMA-BRIEFING]', JSON.stringify({
        event: 'BRIEFING_FAILED',
        timestamp: new Date().toISOString(),
        outcome,
        reason: scrubReason((err && err.message) || 'unknown')
      }))
    } catch (_) { /* a diagnostic must never break the response */ }
  }

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
