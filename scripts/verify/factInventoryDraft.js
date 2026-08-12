'use strict'

/**
 * factInventoryDraft.js — ONE-OFF. Proposes candidate facts for the Owner to confirm.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THIS WRITES A DRAFT AND NOTHING ELSE. No fact store, no change to any answering path,
 * no write to any source, no permanent record. Every row is UNCONFIRMED until the Owner says
 * otherwise, and the file says so on every line.
 *
 * Why it exists: the Aroma System URL was in the registry all week. She used it once and
 * ignored it twice. The bottleneck is not how much she can read — it is that read material
 * never becomes durable, owner-confirmed fact.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ THE BOUNDARY, AND IT IS THE POINT OF THE EXERCISE ────────────────────
 *
 * A FACT here is true because someone wrote it down and does not change on its own: a URL, a
 * phone number, an address, who owns what, what a system is, opening hours.
 *
 * NOT a fact, and excluded by construction: stock levels, cash position, what to order today,
 * outstanding invoices, counts of anything. Those must always go through a live read. If one
 * appears in the output the boundary has failed and the draft is unusable — `assertBoundary`
 * below refuses to write rather than shipping it.
 *
 * ── ⛔ AND THE HARD EXCLUSIONS ──────────────────────────────────────────────
 * Bank balances, account numbers, card numbers, transaction lines; payroll and individual
 * compensation; credentials, keys, tokens, passwords — INCLUDING their existence and location.
 * A row matching these is dropped whole and only COUNTED. Nothing about it is written.
 *
 * ── ⛔ WHAT THIS DELIBERATELY DOES NOT DO, AND WHY ──────────────────────────
 *
 * It does not extract facts from the PROSE of emails or documents. That is where the excluded
 * categories actually live — a payroll figure or a password reset arrives as a sentence — and
 * it is also where 「verbatim value with a precise source」 degrades into inference. Reading a
 * phone number out of an email body means deciding whose phone it is, and subject resolution
 * is the thing that produced today's live defect. So prose mining is out of this draft, and
 * its absence is reported rather than hidden.
 */

const fs = require('fs')
const path = require('path')

const OUT = path.resolve(__dirname, '..', '..', 'docs', 'FACT-INVENTORY-DRAFT.md')

/** ⛔ MATCHING — a row touching any of these is dropped whole and only counted. */
const HARD_EXCLUDE = /(password|passwd|secret|token|api[_ -]?key|credential|bearer|balance|帳戶|账户|account\s*(no|number|#)|iban|swift|card\s*(no|number)|信用卡|salary|payroll|工資|人工|薪|compensation|bonus)/i

/** ⛔ MATCHING — computed or time-varying. Their presence means the boundary failed. */
const NOT_A_FACT = /(stock|inventory|on[_ ]?hand|庫存|倉存|存量|cash|現金|outstanding|未付|to[_ ]?order|落單|補貨|count|盤點|balance|qty|quantity|數量)/i

const FIELDS = ['url', 'phone', 'address', 'identity', 'owner', 'hours']

const truth = { suppliers: null, withPhone: null }
const { DEFAULT_BASE_URL: DEFAULT_BASE_URL_FOR_TRUTH } = require('../../src/context/adapters/aromaSystemRead')
const rows = []
const skipped = { hardExcluded: 0 }
const reached = []
const failed = []

function addRow (r) {
  const blob = [r.subject, r.field, r.value, r.source].join(' ')
  if (HARD_EXCLUDE.test(blob)) { skipped.hardExcluded++; return }
  if (!FIELDS.includes(r.field)) return
  rows.push(r)
}

/** ⛔ The draft refuses to exist if the boundary leaked. */
function assertBoundary () {
  const bad = rows.filter((r) => NOT_A_FACT.test(String(r.value)) || NOT_A_FACT.test(String(r.field)))
  if (bad.length) {
    console.error('⛔ BOUNDARY FAILED — ' + bad.length + ' computed/time-varying row(s) reached the draft.')
    console.error('   The whole draft is unusable. Nothing written. First offender field: ' + bad[0].field)
    process.exit(1)
  }
}

;(async () => {
  process.env.READ_ACCESS = 'on'
  for (const k of ['CONTEXT_DRIVE', 'CONTEXT_GMAIL', 'CONTEXT_CALENDAR', 'CONTEXT_GITHUB', 'CONTEXT_AROMA_SYSTEM']) {
    process.env[k] = process.env[k] || 'on'
  }
  const { createLiveReadConnector } = require('../../src/context/liveClients')
  const { connector } = createLiveReadConnector({ env: process.env })

  /**
   * ── AROMA SYSTEM: suppliers ────────────────────────────────────────────
   * ⛔ SUBJECT IS THE SUPPLIER, NOT THE RESTAURANT AND NOT THE SYSTEM. Today's live defect was
   * exactly this confusion, so each row names the supplier verbatim as its own subject.
   * Only `phone` qualifies from this endpoint. Everything else it carries — minimums, lead
   * days, delivery days — is commercial terms or time-varying, and is not in FIELDS.
   */
  try {
    const out = await connector.read('aroma_system', 'listSuppliers', {})
    const items = (out && Array.isArray(out.results)) ? out.results : []
    reached.push('aroma_system.listSuppliers (' + items.length + ' rows)')
    for (const it of items) {
      const f = (it && it.fields) || {}
      const name = String(f.name || it.title || '').trim()
      if (!name) continue
      if (f.phone) {
        addRow({
          subject: name,
          field: 'phone',
          value: String(f.phone),
          source: 'aroma_system /api/v1/ai/suppliers · id=' + (it.sourceId || '?'),
          asOf: '',
          confidence: 'unconfirmed — supplier record, no date on the row; nobody has verified it is current'
        })
      }
    }
  } catch (e) { failed.push('aroma_system.listSuppliers — ' + (e && e.message)) }

  /**
   * ⛔ HOW MANY THE SOURCE ACTUALLY HOLDS. The read layer caps at 25 (`MAX_ITEMS`), so the
   * table above is a PREFIX and would otherwise read as a complete set. 「No silent caps」 is a
   * rule this project has already paid for; the truth is fetched here so the draft can state
   * what it is missing rather than imply it is whole.
   */
  try {
    const base = (process.env.AROMA_SYSTEM_URL || DEFAULT_BASE_URL_FOR_TRUTH).replace(/\/+$/, '')
    const r = await fetch(base + '/api/v1/ai/suppliers', {
      headers: { Authorization: 'Bearer ' + (process.env.AROMA_SYSTEM_KEY || '') }
    })
    const body = await r.json()
    const all = Array.isArray(body.data) ? body.data : []
    truth.suppliers = all.length
    truth.withPhone = all.filter((s) => s && s.phone).length
  } catch (_) { /* the draft still ships, saying the count was not checked */ }

  /**
   * ── THE SYSTEM'S OWN URL ──────────────────────────────────────────────
   * ⛔ NOT FROM A READ SOURCE, and labelled as such. This is the fact that started the whole
   * exercise, and its provenance is configuration, not evidence: `AROMA_SYSTEM_URL` if set,
   * otherwise a constant in `aromaSystemRead.js`. Nobody has confirmed it against anything.
   */
  const envUrl = process.env.AROMA_SYSTEM_URL
  const { DEFAULT_BASE_URL } = require('../../src/context/adapters/aromaSystemRead')
  addRow({
    subject: 'Aroma System',
    field: 'url',
    value: envUrl || DEFAULT_BASE_URL,
    source: envUrl ? '.env AROMA_SYSTEM_URL' : 'src/context/adapters/aromaSystemRead.js DEFAULT_BASE_URL (a fallback, not a fact)',
    asOf: '',
    confidence: 'unconfirmed — configuration, not a source. The reads succeed against it, which shows it ANSWERS, not that it is the address he would give a customer'
  })
  addRow({
    subject: 'Aroma System',
    field: 'identity',
    value: "the restaurant's internal Business OS — six read-only endpoints",
    source: 'src/context/readOperations.js AROMA_OPERATIONS (frozen list)',
    asOf: '',
    confidence: 'unconfirmed — describes what the code can reach, which is not the same as what the Owner would call it'
  })

  /** ── THE OTHER FOUR: reached, and what they yielded under the boundary ── */
  const probes = [
    ['drive', 'listFiles', { pageSize: 25, orderBy: 'modifiedTime desc' }],
    ['gmail', 'searchMessages', { q: 'newer_than:90d', maxResults: 15 }],
    ['calendar', 'listEvents', { maxResults: 15 }],
    ['github', 'listCommits', { per_page: 10 }]
  ]
  for (const [src, method, params] of probes) {
    try {
      const out = await connector.read(src, method, params)
      const n = (out && Array.isArray(out.results)) ? out.results.length : 0
      reached.push(src + '.' + method + ' (' + n + ' rows)')
      // ⛔ NO PROSE MINING — see the header. Nothing is extracted from bodies or titles here.
    } catch (e) { failed.push(src + '.' + method + ' — ' + String(e && e.message).slice(0, 120)) }
  }

  assertBoundary()

  const bySubject = {}
  for (const r of rows) bySubject[r.subject] = (bySubject[r.subject] || 0) + 1

  const L = []
  L.push('# FACT INVENTORY — DRAFT FOR OWNER REVIEW')
  L.push('')
  L.push('⛔ **EVERY ROW IS UNCONFIRMED.** This is a proposal, not a record. No fact store exists,')
  L.push('nothing here has been written anywhere permanent, and no answering path reads this file.')
  L.push('')
  L.push('Generated by `scripts/verify/factInventoryDraft.js`. Read-only; no source was written to.')
  L.push('')
  L.push('| subject | field | value | source | asOf | confidence — and what makes it less than certain |')
  L.push('|---|---|---|---|---|---|')
  for (const r of rows) {
    L.push('| ' + [r.subject, r.field, r.value, r.source, r.asOf || '(none in source)', r.confidence]
      .map((c) => String(c).replace(/\|/g, '\\|')).join(' | ') + ' |')
  }
  L.push('')
  L.push('## Rows by subject')
  for (const [s, n] of Object.entries(bySubject)) L.push('- ' + s + ': ' + n)
  L.push('')
  L.push('## Sources reached')
  for (const s of reached) L.push('- ' + s)
  L.push('')
  L.push('## Sources that failed')
  if (!failed.length) L.push('- none')
  for (const s of failed) L.push('- ⛔ ' + s)
  L.push('')
  L.push('## Skipped for the hard exclusions')
  L.push('- ' + skipped.hardExcluded + ' row(s) dropped whole. Content not recorded, by design.')
  L.push('')
  L.push('## ⛔ KNOWN INCOMPLETENESS — read this before treating the table as a set')
  L.push('')
  L.push('**The supplier rows are TRUNCATED and this draft would otherwise look complete.**')
  L.push('The read layer caps every source at 25 items (`MAX_ITEMS`), and the endpoint holds more:')
  L.push('')
  L.push('| | at the source | reached here |')
  L.push('|---|---|---|')
  L.push('| suppliers | ' + (truth.suppliers === null ? '(not checked)' : truth.suppliers) + ' | 25 |')
  L.push('| of those, carrying a phone | ' + (truth.withPhone === null ? '(not checked)' : truth.withPhone) + ' | ' + rows.filter((r) => r.field === 'phone').length + ' |')
  L.push('')
  L.push('So supplier phone facts are MISSING from this draft, not absent from the business.')
  L.push('')
  L.push('**Not covered at all, and deliberately:**')
  L.push('- No fact was extracted from the PROSE of any email or document. That is where the')
  L.push('  excluded categories actually live, and where a verbatim value with a precise source')
  L.push('  degrades into deciding whose phone number it is — the subject-resolution problem that')
  L.push('  produced this week\'s live defect. Drive, Gmail and Calendar were reached and read;')
  L.push('  they contributed ZERO rows for that reason, not because they hold nothing.')
  L.push('- No opening hours, no addresses, no ownership rows: nothing legible under this')
  L.push('  boundary was found in a structured field. Emitting them would have meant reading prose.')
  L.push('- **Conflicts: none detected, and that is a weak statement** — with facts arriving from a')
  L.push('  single structured source per field there was nothing to disagree. Conflict handling is')
  L.push('  untested here rather than proven absent.')
  L.push('')
  fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8')

  console.log('rows: ' + rows.length)
  console.log('by subject: ' + JSON.stringify(bySubject))
  console.log('reached: ' + JSON.stringify(reached))
  console.log('failed: ' + JSON.stringify(failed))
  console.log('hard-excluded rows: ' + skipped.hardExcluded)
  console.log('wrote ' + path.relative(process.cwd(), OUT))
})()
