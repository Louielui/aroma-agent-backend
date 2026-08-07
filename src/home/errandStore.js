'use strict'

/**
 * errandStore.js — what she ran, and what is waiting.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY IT EXISTS. Every errand this week ran as a script started by hand and **nothing
 * recorded it**. The design audit found `errandStore` at 0 hits, which is why 首頁's list
 * would have been empty forever — and an empty list is indistinguishable from a broken
 * feature to a tired reader.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── THE THREE OUTCOMES NEVER MERGE ──────────────────────────────────────────
 * 「answered」, 「stopped for you」 and 「blocked by the site」 are different facts about
 * different situations. Collapsing them into 「didn't work」 is the same loss as the invoice
 * line's five states, and the middle one is the only one that needs him.
 */

const fs = require('node:fs')
const path = require('node:path')

const OUTCOME = Object.freeze({
  ANSWERED: 'ANSWERED',
  STOPPED_FOR_YOU: 'STOPPED_FOR_YOU',
  BLOCKED_BY_SITE: 'BLOCKED_BY_SITE'
})

const READ = Object.freeze({ EMPTY: 'EMPTY', OK: 'OK', UNREADABLE: 'UNREADABLE' })

/** Keys that would put a typed VALUE in a durable record. `type` never records what was
 *  typed; neither does this. A redaction applied on the way out can be forgotten on one path. */
const FORBIDDEN_IN_STOP = ['typed', 'value', 'password', 'card', 'text']

function openErrandStore (dir) {
  const file = path.join(dir, 'errands.json')

  const read = () => {
    if (!fs.existsSync(file)) return { state: READ.EMPTY, rows: [] }
    let raw
    try { raw = fs.readFileSync(file, 'utf8') } catch (e) {
      return { state: READ.UNREADABLE, rows: [], why: String(e.message).split('\n')[0] }
    }
    try {
      const j = JSON.parse(raw)
      if (!Array.isArray(j)) return { state: READ.UNREADABLE, rows: [], why: 'not an array' }
      return { state: j.length ? READ.OK : READ.EMPTY, rows: j }
    } catch (e) {
      // ⛔ NOT an empty list. 「我睇唔到差事紀錄」 and 「冇嘢等你」 look identical to a tired
      // reader and mean opposite things — the `count: 43` shape, in the surface he acts on.
      return { state: READ.UNREADABLE, rows: [], why: String(e.message).split('\n')[0] }
    }
  }

  const rowsOrThrow = () => {
    const r = read()
    if (r.state === READ.UNREADABLE) {
      const e = new Error('the errand record is unreadable (' + (r.why || '') + ')')
      e.code = 'UNREADABLE'
      throw e
    }
    return r.rows
  }

  return {
    /** Structured state, for a surface that must never render a blank. */
    readState () {
      const r = read()
      return { state: r.state, count: r.rows.length, why: r.why || '', checkedAt: Date.now() }
    },

    record (e) {
      if (!e || !e.id || !e.title) throw new Error('an errand needs an id and a title')
      if (!Object.values(OUTCOME).includes(e.outcome)) {
        // Refused, not defaulted: a typo must not become a fourth outcome nobody named.
        throw new Error('unknown outcome ' + JSON.stringify(e.outcome))
      }
      if (e.outcome === OUTCOME.STOPPED_FOR_YOU) {
        // The stop report IS the state. A stop with nothing to act on is a stop he cannot act on.
        if (!e.stop || !e.stop.where || !e.stop.notPressed) {
          throw new Error('a stopped errand needs a stop report: where, and what was not pressed')
        }
        for (const k of FORBIDDEN_IN_STOP) {
          if (k in e.stop) throw new Error('a typed value is never stored: remove `' + k + '`')
        }
      }
      const rows = rowsOrThrow()
      rows.push({ ...e, at: Number(e.at) || Date.now() })
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, JSON.stringify(rows, null, 1))
      return e.id
    },

    /** Newest first. Throws rather than returning [] when it cannot read — see readState(). */
    list () {
      return rowsOrThrow().slice().sort((a, b) => b.at - a.at)
    },

    /** Waiting is a QUERY, so no caller has to remember what waiting means. */
    waiting () {
      return this.list().filter((e) => e.outcome === OUTCOME.STOPPED_FOR_YOU && !e.resolvedAt)
    },

    /** He acted on it. It leaves `waiting` and STAYS in history — the record is not rewritten. */
    resolve (id, when) {
      const rows = rowsOrThrow()
      const row = rows.find((r) => r.id === id)
      if (!row) return false
      row.resolvedAt = Number(when) || Date.now()
      fs.writeFileSync(file, JSON.stringify(rows, null, 1))
      return true
    }
  }
}

module.exports = { openErrandStore, OUTCOME, READ }
