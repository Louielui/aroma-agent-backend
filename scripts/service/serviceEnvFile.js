'use strict'
/**
 * serviceEnvFile.js — service.env IS A CREDENTIAL DROP, NOT AN ENVIRONMENT OVERRIDE FILE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY IT IS AN ALLOWLIST AND NOT A PARSER.
 *
 * The first version applied every `KEY=value` it found. That quietly made an
 * Administrator-written file at a ProgramData path into a general runtime override channel:
 * a line reading `READ_ACCESS=off`, `AROMA_DATA_DIR=…` or `PERSONA_SOURCE=…` would have been
 * obeyed. The whole point of `runtimeContract.js` is that ONE file decides what the assistant
 * is; a second file that can silently disagree is the same defect the superseded service had,
 * wearing a different name.
 *
 * ⛔ SO EXACTLY THREE KEYS ARE ACCEPTED, and anything else FAILS THE FILE — not just that line.
 * A typo'd key is not a harmless no-op: it means the installer believed they were configuring
 * something, and starting anyway would hide that. Unknown key, duplicate key, or a malformed
 * non-comment line all refuse.
 *
 * ⛔ AND THE DIAGNOSTICS ARE STRUCTURAL. Key NAMES and COUNTS leave this module; values never
 * do, not even a length or a prefix.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('node:fs')
const { INSTALL_TIME_REQUIRED } = require('./runtimeContract')

/** The complete set of keys this file may carry. Nothing else is a runtime switch. */
const ALLOWED_KEYS = Object.freeze([...INSTALL_TIME_REQUIRED])

/**
 * Parse text into a verdict. Never throws, never logs, never returns a value it read.
 *
 * ⛔ `values` IS RETURNED FOR THE CALLER TO APPLY, AND IS NEVER PART OF A DIAGNOSTIC. Callers
 * put it into the environment; nothing renders it.
 */
function parseServiceEnv (text, allowed = ALLOWED_KEYS) {
  const unexpectedKeys = []
  const duplicateKeys = []
  const values = {}
  let malformedLineCount = 0
  let lineCount = 0

  for (const line of String(text == null ? '' : text).split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue // blank lines and comments stay legal
    lineCount++
    const i = t.indexOf('=')
    // ⛔ A LINE WITHOUT `=`, OR STARTING WITH `=`, IS NOT A COMMENT — it is a mistake, and a
    // mistake in a credential file is exactly the thing not to shrug at.
    if (i <= 0) { malformedLineCount++; continue }
    const key = t.slice(0, i).trim()
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) { malformedLineCount++; continue }
    if (!allowed.includes(key)) { if (!unexpectedKeys.includes(key)) unexpectedKeys.push(key); continue }
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      if (!duplicateKeys.includes(key)) duplicateKeys.push(key)
      continue
    }
    values[key] = t.slice(i + 1).trim()
  }

  const ok = unexpectedKeys.length === 0 && duplicateKeys.length === 0 && malformedLineCount === 0
  return { ok, unexpectedKeys, duplicateKeys, malformedLineCount, lineCount, values }
}

/**
 * Read and parse the configured file.
 *
 * ⛔ CONFIGURED-BUT-UNREADABLE IS A FAILURE, NOT AN ABSENCE.
 *
 * This used to return `ok:true, loaded:false` whenever the read threw, which meant a service
 * pointed at a file it could not open would carry on and start — and if the three credentials
 * also happened to sit in the machine environment, it would start SUCCESSFULLY, from ambient
 * values, having silently ignored the file the installer wrote and ACL’d. The ACL being wrong
 * is exactly the condition this file exists to surface; passing it over is the worst possible
 * response to it.
 *
 * ⛔ SO THE TWO CASES ARE DIFFERENT FACTS AND ARE REPORTED DIFFERENTLY. No path configured
 * means the values may legitimately come from the environment. A path configured means that
 * file is the source of truth and must be readable; ambient credentials may not stand in for
 * it, however complete they are.
 */
function readServiceEnvFile (filePath, readFile = fs.readFileSync) {
  if (!filePath) {
    // Not configured: ambient install-time credentials remain supported, and the preflight is
    // still the one place that decides whether they are actually present.
    return { configured: false, loaded: false, readable: null, ok: true, unexpectedKeys: [], duplicateKeys: [], malformedLineCount: 0, values: {} }
  }
  let text
  try { text = readFile(filePath, 'utf8') } catch (_) {
    // ⛔ THE EXCEPTION IS DISCARDED. It carries a full path and sometimes an account name;
    // `readable: false` is the whole of what a log needs, and it cannot leak anything.
    return { configured: true, loaded: false, readable: false, ok: false, unexpectedKeys: [], duplicateKeys: [], malformedLineCount: 0, values: {} }
  }
  return Object.assign({ configured: true, loaded: true, readable: true }, parseServiceEnv(text))
}

/** Names and counts only. This string is safe to put in a log. */
function serviceEnvReport (r) {
  const status = !r.configured ? 'not-configured'
    : r.readable === false ? 'UNREADABLE'
    : r.ok ? 'OK' : 'REJECTED'
  return '[AROMA-SERVICE] service.env ' + status + ' configured=' + (r.configured === true) +
    ' unexpectedKeys=' + (r.unexpectedKeys.join(',') || 'none') +
    ' duplicateKeys=' + (r.duplicateKeys.join(',') || 'none') +
    ' malformedLineCount=' + r.malformedLineCount
}

module.exports = { ALLOWED_KEYS, parseServiceEnv, readServiceEnvFile, serviceEnvReport }
