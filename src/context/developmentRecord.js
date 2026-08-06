'use strict'

/**
 * developmentRecord.js — the development record, indexed so she can read it.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * Every ruling, defect and disproof of this week lives in docs/ and in commit messages.
 * She could not answer 「why was DEFECT-001 not fixed?」 — not for lack of reasoning, and not
 * for lack of workers. Memory.
 *
 * ── GENERATED, NEVER HAND-MAINTAINED (Owner ruling) ──────────────────────────
 * The index is built by READING docs/. There is no list of rules in this file, and adding
 * one would recreate the exact failure that prompted the rule: a standing memory note said
 * 「GitHub OFF, waiting for a PAT」 while the connector was live and answering. **A stale
 * ruling index is worse than none**, because it is quotable.
 *
 * ── AN UNDECLARED DOCUMENT IS A WORKING NOTE ─────────────────────────────────
 * 42 files exist; most predate this design. The default is FAIL-CLOSED: without a
 * declaration a document can be found and quoted as a note, never as a ruling.
 *
 * Getting that wrong costs authority a document should have had. The opposite — defaulting
 * to ACTIVE — invents authority it never had, and hands her a scratch file to cite as a
 * decision. Only one of those two mistakes is recoverable by reading further.
 *
 * ── THE RECORD IS HISTORY, NEVER PERMISSION ──────────────────────────────────
 * An entry carries no approval field and no authorisation field, deliberately. The only live
 * authorisation in this system is a sealed order with an unconsumed nonce; a document that
 * says 「approved」 records that something WAS approved, once, in the past. This is
 * recall-is-not-evidence one layer up, wearing a more convincing costume.
 */

const fs = require('node:fs')
const path = require('node:path')

const DOCS_DIR = path.join(__dirname, '..', '..', 'docs')

const RECORD_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
  DISPROVEN: 'DISPROVEN',
  WORKING_NOTE: 'WORKING_NOTE'
})

/** Owner-facing wording per status. WORKING_NOTE must never read as current. */
const STATUS_LABEL = Object.freeze({
  ACTIVE: '現行',
  SUPERSEDED: '已被取代',
  DISPROVEN: '已推翻',
  WORKING_NOTE: '工作筆記'
})

/**
 * The declaration must sit in the HEADER BLOCK. A status line 400 lines down is a sentence
 * inside the document, not a statement about it — and a retrieval system returning the
 * confident middle of a file would never see it.
 */
const HEADER_LINES = 40
const DECLARATION = /<!--\s*record-status:\s*([A-Z_]+)\s*(\d{4}-\d{2}-\d{2})?\s*-->/

/**
 * @param {string} text the document
 * @returns {{status: string, declaredAt: string|null}}
 */
function parseStatus (text) {
  const head = String(text || '').split(/\r?\n/).slice(0, HEADER_LINES).join('\n')
  const m = DECLARATION.exec(head)
  // An unrecognised word is NOT quietly promoted. A typo must not create a ruling.
  if (!m || !Object.prototype.hasOwnProperty.call(RECORD_STATUS, m[1])) {
    return { status: RECORD_STATUS.WORKING_NOTE, declaredAt: null }
  }
  return { status: RECORD_STATUS[m[1]], declaredAt: m[2] || null }
}

function firstHeading (text) {
  const m = /^#\s+(.+)$/m.exec(String(text || ''))
  return m ? m[1].trim() : null
}

/** Trim to something that fits a shared 6,000-char block four items at a time. */
function short (s, n = 110) {
  const t = String(s || '').replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n - 1) + '…'
}

/**
 * HOUSE-RULES.md holds many rulings in one file, so it is split per rule. Everything else is
 * one entry per document — a defect, a design, a governance record.
 */
function entriesFromRules (text, file, declared) {
  const out = []
  const re = /^##\s+(HR-\d+)\s*[—–-]\s*(.+)$/gm
  let m
  while ((m = re.exec(text))) {
    out.push({
      id: m[1],
      title: short(m[2]),
      // A rule inherits the file's declaration. HOUSE-RULES.md is one document with one
      // status; individual rules are not separately retired today.
      status: declared.status,
      declaredAt: declared.declaredAt,
      sourceFile: file,
      heading: '## ' + m[1]
    })
  }
  return out
}

function idFor (file) {
  const m = /^(DEFECT-\d+)/.exec(file)
  return m ? m[1] : file.replace(/\.md$/, '')
}

/**
 * Walk docs/ and derive the index. Subdirectories are included — governance baselines and
 * persona records are part of the record too, and excluding them would be a hand-maintained
 * decision by another name.
 */
function buildIndex ({ dir = DOCS_DIR } = {}) {
  const out = []
  const walk = (d, rel) => {
    let names
    try { names = fs.readdirSync(d, { withFileTypes: true }) } catch (_) { return }
    for (const ent of names) {
      const abs = path.join(d, ent.name)
      const relName = rel ? rel + '/' + ent.name : ent.name
      if (ent.isDirectory()) { walk(abs, relName); continue }
      if (!ent.name.endsWith('.md')) continue
      let text
      try { text = fs.readFileSync(abs, 'utf8') } catch (_) { continue }
      const declared = parseStatus(text)
      if (ent.name === 'HOUSE-RULES.md') {
        out.push(...entriesFromRules(text, relName, declared))
        continue
      }
      out.push({
        id: idFor(ent.name),
        title: short(firstHeading(text) || ent.name),
        status: declared.status,
        declaredAt: declared.declaredAt,
        sourceFile: relName,
        heading: null
      })
    }
  }
  walk(dir, '')
  return out
}

/**
 * THE ONLY WAY TO RENDER AN ENTRY, and it always carries status and date.
 *
 * Owner ruling: 「HR-6 講…」 is not a citation; 「HR-6（2026-08-05，現行）講…」 is. Enforced
 * here rather than asked for in a prompt — the same discipline as server-supplied metric
 * values, where the model names the field and the server produces the number.
 *
 * There is deliberately no second rendering function. A shorter one would be used.
 */
function citationFor (e) {
  const label = STATUS_LABEL[e.status] || STATUS_LABEL.WORKING_NOTE
  // No date is stated as MISSING rather than filled in. An invented date on a ruling is
  // worse than an unstamped one.
  const when = e.declaredAt || '未標日期'
  return `${e.id}（${when}，${label}）${e.title} ［${e.sourceFile}］`
}

module.exports = { RECORD_STATUS, STATUS_LABEL, parseStatus, buildIndex, citationFor, DOCS_DIR }
