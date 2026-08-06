'use strict'

/**
 * enquiryStore.js — the turns, kept but not surfaced.
 *
 * > **Owner: 「The report is what I read normally; the turns are what I check when the report
 * > surprises me.」**
 *
 * So the contract is deliberately asymmetric:
 *
 *   save()  always — a turn that was never recorded cannot be checked later
 *   list()  REPORTS ONLY — listing turns by default would recreate the relay this removes
 *   get()   the whole thing, by id, as a second and deliberate step
 *
 * ── AND AN UNKNOWN ID RETURNS null, NOT AN EMPTY ENQUIRY ─────────────────────
 * An empty object would render as 「it ran and found nothing」, which is the failure this
 * project keeps removing in other places. Absent and empty are different answers.
 */

const fs = require('node:fs')
const path = require('node:path')
const { resolveDataDir } = require('../store/dataDir')

/** An id becomes a FILE NAME, so anything that is not a plain id is refused outright. */
const ID_RE = /^enq_[A-Za-z0-9]{4,32}$/

function createEnquiryStore (options = {}) {
  const dir = options.dir || path.join(resolveDataDir(), 'enquiries')

  function ensure () { fs.mkdirSync(dir, { recursive: true }); return dir }
  function fileFor (id) { return path.join(dir, id + '.json') }

  return {
    dir,

    save (enquiry) {
      const id = enquiry && enquiry.enquiryId
      if (!ID_RE.test(String(id || ''))) throw new Error('enquiryStore: bad enquiry id')
      ensure()
      const record = { ...enquiry, savedAt: enquiry.savedAt || new Date().toISOString() }
      // Deliberately no approval/authorisation field. A record of what was investigated is
      // history; the only live authorisation is a sealed order with an unconsumed nonce.
      delete record.approved
      delete record.authorised
      delete record.authorized
      const tmp = fileFor(id) + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(record, null, 2))
      fs.renameSync(tmp, fileFor(id))
      return record
    },

    /** The whole enquiry, turns included. Null when it does not exist. */
    get (id) {
      if (!ID_RE.test(String(id || ''))) return null
      try { return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')) } catch (_) { return null }
    },

    /**
     * REPORTS ONLY, newest first. The turns are omitted on purpose — see the header. The
     * one he just ran is the one he is most likely to open, so it leads.
     */
    list () {
      let names = []
      try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')) } catch (_) { return [] }
      const out = []
      for (const n of names) {
        try {
          const r = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
          out.push({ enquiryId: r.enquiryId, question: r.question, report: r.report, savedAt: r.savedAt })
        } catch (_) { /* a corrupt file is skipped, not fatal */ }
      }
      return out.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))
    }
  }
}

module.exports = { createEnquiryStore }
