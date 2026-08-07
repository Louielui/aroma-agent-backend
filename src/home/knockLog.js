'use strict'

/**
 * knockLog.js — who knocked on the scheduled door, and when. Server side.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「The knock log matters more than the interval — an endpoint that cannot say who
 * > called it is one I cannot audit, and today three of six calls left no trace anywhere except
 * > a field on a row.」**
 *
 * On 2026-08-07 the errand endpoint was invoked six times in 45 minutes. Only three appeared in
 * any log, because the only log was the PowerShell wrapper's — **client side**. The other three
 * were direct calls and left nothing; their existence had to be reconstructed from a `trigger`
 * field on stored rows.
 *
 * ⛔ A door that records nothing cannot tell 「nobody called」 from 「I did not look」. Every other
 * finding this week is that same sentence about something else.
 *
 * ── AND THE INTERVAL IS ANSWERED FROM THIS LOG, NOT FROM MEMORY ─────────────
 * An in-process timestamp resets when 8090 restarts — and 8090 was restarted repeatedly this
 * morning, which is exactly when the hammering happened. The log survives the process.
 */

const fs = require('node:fs')
const path = require('node:path')

const MAX_ROWS = 500
/** Never persisted, whatever a caller passes. A knock log is not a place for credentials. */
const NEVER_STORE = ['authorization', 'token', 'password', 'cookie', 'apiKey', 'api_key']

function openKnockLog (dir) {
  const file = path.join(dir, 'knocks.json')

  /** Throws on unreadable — the caller decides, and the decision is to REFUSE. */
  function rowsOrThrow () {
    if (!fs.existsSync(file)) return []
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('the knock log is not an array')
    return parsed
  }

  return {
    record (k) {
      let rows = []
      try { rows = rowsOrThrow() } catch (_) { rows = [] } // a corrupt log must not block a run's RECORD
      const clean = {}
      for (const [key, v] of Object.entries(k || {})) {
        if (NEVER_STORE.includes(key)) continue
        clean[key] = v
      }
      clean.at = Number(k && k.at) || Date.now()
      rows.push(clean)
      // Keep the NEWEST. An old knock is history; the recent ones are the audit.
      if (rows.length > MAX_ROWS) rows = rows.slice(rows.length - MAX_ROWS)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, JSON.stringify(rows, null, 1))
      return clean
    },

    list () {
      try { return rowsOrThrow() } catch (_) { return [] }
    },

    /**
     * ⛔ FAIL CLOSED. 「I cannot tell when it last ran」 must never become 「therefore run it」 —
     * that is precisely the failure being fixed.
     *
     * ⛔ AND ONLY ACCEPTED KNOCKS START THE CLOCK. If refusals extended the window, a caller
     * retrying every minute would keep itself banned forever and the window would be measuring
     * the retry loop instead of the last real run.
     */
    mayRun (now, minIntervalMs) {
      let rows
      try { rows = rowsOrThrow() } catch (e) {
        return { ok: false, reason: 'LOG_UNREADABLE', saying: '我讀唔到敲門紀錄,所以我唔知上次幾時行過。唔知就唔行。' }
      }
      const accepted = rows.filter((r) => r && r.verdict === 'ACCEPTED' && Number(r.at) > 0)
      if (!accepted.length) return { ok: true, reason: 'FIRST_RUN' }
      const last = Math.max(...accepted.map((r) => Number(r.at)))
      const since = Number(now) - last
      if (since >= minIntervalMs) return { ok: true, reason: 'INTERVAL_ELAPSED', lastRunAt: last }
      const mins = Math.max(1, Math.round((minIntervalMs - since) / 60000))
      return {
        ok: false,
        reason: 'TOO_SOON',
        lastRunAt: last,
        saying: '上次 ' + Math.round(since / 60000) + ' 分鐘之前行過,重複行會撞爆個站。' +
          '仲要等 ' + mins + ' 分鐘。'
      }
    }
  }
}

module.exports = { openKnockLog, MAX_ROWS }
