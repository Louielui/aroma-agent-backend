'use strict'

/**
 * homeRoutes.js — 首頁's two endpoints.
 *
 *   GET  /api/v1/home/briefing              what she ran, what waits, the Drive line
 *   POST /api/v1/home/errand/:id/open       open the page she stopped on, in HER profile
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY OPENING IS A POST TO A LOCAL ENDPOINT AND NOT AN `<a href>`.
 *
 * **A cart lives in the session that built it.** His everyday Chrome is a different session
 * and would show an empty cart — measured on Costco. The page must open in HER profile, and
 * only a local process can launch a local browser.
 *
 * ── AND THE LOCK BEHAVIOUR IS MEASURED, NOT ASSUMED ─────────────────────────
 * A second `launchPersistentContext` against a live profile is **REFUSED in 0.3s**:
 * 「Opening in existing browser session.」 It does not attach a tab and does not corrupt.
 * So: **refuse cleanly if she is using it, and NEVER auto-clear a stale lock** — two Chromes
 * writing one profile is corruption that surfaces days later as something else entirely.
 */

const { spawn } = require('node:child_process')
const { probeProfileLock } = require('../browser/profileProbe')

const OPEN = Object.freeze({
  OPENED: 'OPENED',
  IN_USE: 'PROFILE_IN_USE',
  STALE_LOCK: 'STALE_LOCK',
  NOT_FOUND: 'ERRAND_NOT_FOUND',
  NO_TARGET: 'NO_PAGE_RECORDED'
})

function mountHomeRoutes (router, { store, backlogReader, profileDir, chromePath, guard, launcher, serviceGuard, scheduledRunners, witnessReader, knockLog, minRunIntervalMs }) {
  // Default: one hour. A daily errand never needs to run twice in an hour, and the morning
  // that produced this rule had six runs in forty-five minutes.
  minRunIntervalMs = Number(minRunIntervalMs) > 0 ? Number(minRunIntervalMs) : 60 * 60 * 1000
  const pass = guard || ((req, res, next) => next())
  const { buildBriefing } = require('./briefing')

  /**
   * ⛔ THE TIMER'S DOOR. Guarded by the SERVICE token, not the Owner session.
   *
   * `serviceGuard` is `requireServiceToken`, which fails CLOSED (401) when HUB_TOKEN is unset.
   * Omitting it here would leave the route open, so its absence is a 501 rather than a default:
   * a scheduled-run endpoint that is reachable without a token is worse than one that is missing.
   *
   * ⛔ AND IT TAKES NO PARAMETERS. The body is never read. See scheduledRun.js — the read-only
   * gate is the absence of any field in which to name an action.
   */
  if (serviceGuard) {
    router.post('/api/v1/home/errand/scheduled-run', serviceGuard, async (req, res) => {
      const { runScheduledErrands } = require('./scheduledRun')
      const now = Date.now()

      // ⛔ EVERY KNOCK IS RECORDED, ACCEPTED OR NOT — and the refusals are the interesting ones.
      // On 2026-08-07 this endpoint was hit six times in 45 minutes and three of those calls
      // left no trace anywhere on the server. A door that records nothing cannot tell
      // 「nobody called」 from 「I did not look」.
      const caller = (req.ip || (req.socket && req.socket.remoteAddress) || 'unknown')
      const agent = String(req.headers['user-agent'] || '').slice(0, 60)

      // ⛔ HR-34, ONE LEVEL UP. The pacing rule spaced the searches WITHIN a run and nothing
      // governed how often the run itself happened — so ~95 searches went at a public register
      // in one morning. The interval is answered from the LOG, not from an in-process
      // timestamp, because 8090 was restarted repeatedly during exactly that hammering.
      const gate = knockLog ? knockLog.mayRun(now, minRunIntervalMs) : { ok: true, reason: 'NO_KNOCK_LOG' }
      if (!gate.ok) {
        if (knockLog) knockLog.record({ at: now, verdict: gate.reason, caller, agent })
        return res.status(429).json({ ok: false, ran: 0, recorded: false, reason: gate.reason, saying: gate.saying })
      }
      if (knockLog) knockLog.record({ at: now, verdict: 'ACCEPTED', caller, agent })

      let r
      try {
        r = await runScheduledErrands({ store, runners: scheduledRunners || {} })
      } catch (e) {
        return res.status(500).json({ ok: false, ran: 0, recorded: false, saying: String(e.message).split('\n')[0] })
      }
      // ⛔ NON-2xx ON FAILURE, AND THAT IS WITNESS #1.
      // The PowerShell exits non-zero, Task Scheduler records a failed run, and 「the task is
      // failing」 becomes visible from the Windows side without her having to say anything.
      res.status(r.ok ? 200 : 500).json(r)
    })
  } else {
    router.post('/api/v1/home/errand/scheduled-run', (req, res) => {
      res.status(501).json({ ok: false, saying: '排程入口未接上服務憑證守衛,所以佢係關住嘅。呢個係一個缺陷,唔係一個狀態。' })
    })
  }

  router.get('/api/v1/home/briefing', pass, async (req, res) => {
    // ⛔ `undefined` means NO READER WAS WIRED — a defect. `null` means a reader exists and
    // was deliberately switched off. They are different facts, buildBriefing states them
    // differently, and collapsing them is how DEFECT-011 read as an operational message.
    let backlog
    if (backlogReader === undefined) backlog = undefined
    else if (backlogReader === null) backlog = null
    else {
      try { backlog = await backlogReader() } catch (e) { backlog = { error: String(e.message).split('\n')[0].slice(0, 60) } }
    }
    // buildBriefing never throws on an unreadable store — it reports CANNOT_READ, which is
    // the whole point. A 500 here would render as a blank screen, and blank is the one thing
    // this surface may never be.
    // ⛔ WITNESS #1 IS READ HERE, NOT INSIDE buildBriefing.
    // Asking Windows costs a subprocess; buildBriefing stays synchronous and pure so it remains
    // testable without a shell. `undefined` means nobody looked — and freshnessOf then falls
    // back to the kind's declaration rather than claiming the witness said anything.
    let witness
    if (typeof witnessReader === 'function') {
      try { witness = await witnessReader() } catch (_) { witness = { state: 'UNREADABLE', scheduled: null, healthy: null, saying: '問唔到 Windows 排程。' } }
    }
    res.json(buildBriefing({ store, backlog, witness, now: Date.now() }))
  })

  router.post('/api/v1/home/errand/:id/open', pass, (req, res) => {
    let row = null
    try { row = store.list().find((e) => e.id === req.params.id) } catch (_) {
      return res.status(503).json({ outcome: 'CANNOT_READ', saying: '我睇唔到差事紀錄,所以搵唔到嗰單。' })
    }
    if (!row) return res.status(404).json({ outcome: OPEN.NOT_FOUND, saying: '搵唔到嗰單差事。' })
    const url = row.stop && row.stop.where
    if (!url) return res.status(400).json({ outcome: OPEN.NO_TARGET, saying: '嗰單冇記低停喺邊一版。' })

    // ⛔ THE LOCK IS CHECKED, AND NEVER CLEARED.
    const lock = probeProfileLock(profileDir)
    if (lock.held) {
      return res.status(409).json({
        outcome: OPEN.IN_USE,
        saying: '香香而家用緊個 profile,所以開唔到。停咗佢先,或者等佢做完。' +
          '⛔ 我唔會自動清個鎖 —— 兩個 Chrome 一齊寫一個 profile 嘅損壞,會喺幾日之後以另一件事嘅樣出現。',
        lock: lock.files.map((f) => f.file)
      })
    }

    const exe = chromePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    const args = ['--user-data-dir=' + profileDir, url]
    try {
      const child = (launcher || spawn)(exe, args, { detached: true, stdio: 'ignore' })
      if (child && child.unref) child.unref()
    } catch (e) {
      return res.status(500).json({ outcome: 'LAUNCH_FAILED', saying: '開唔到 Chrome:' + String(e.message).split('\n')[0] })
    }
    res.json({ outcome: OPEN.OPENED, url, saying: '開咗喺香香個 profile 度 —— 即係你會見返佢嗰個購物車。' })
  })

  return router
}

module.exports = { mountHomeRoutes, OPEN }
