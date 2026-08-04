'use strict'

/**
 * localTime.js — the ONLY place that resolves "now" in the Owner's timezone.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * Two places needed local time and each invented its own answer:
 *
 *   src/lab/conversationRecall.js   timeZone: 'America/Winnipeg'   a hardcoded literal
 *   src/context/readContext.js      local.setHours(0, 0, 0, 0)     the PROCESS's OS zone
 *
 * They agreed only because the machine is set to America/Winnipeg. Move the process and the
 * archive would render one clock while 「今日有咩安排」 asked about a different day — with
 * nothing failing and nothing to see. A hardcoded literal plus an OS-dependent behaviour
 * that happen to match is not a design; it is a coincidence waiting to be moved.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 * NEVER FALL BACK TO THE OS TIMEZONE IMPLICITLY. Owner instruction, 2026-08-04. A wrong
 * clock that keeps working is worse than one that stops, because only one of them is
 * visible. So:
 *
 *   no settings file / no timezone field  → DEFAULT_TIMEZONE. Ordinary first-run state.
 *   present, valid IANA name              → used exactly as written.
 *   present but not a non-empty string    → THROWS.
 *   present but not a real IANA zone      → THROWS, naming the value.
 *   settings file exists but is unreadable → THROWS.
 *
 * That last line is the distinction this codebase has now drawn three times — in store.js,
 * in conversationStore.js and here. `ownerSettings.load()` deliberately treats a corrupt
 * file as "no settings yet", which is right for style and preferences and wrong for a
 * clock: it would silently answer with the default while the Owner's real setting sat
 * unread on disk. ENOENT is an absence. A parse failure is a failure.
 *
 * ── WHERE THE LOUDNESS LANDS ─────────────────────────────────────────────────
 * Both callers sit inside the existing fail-soft-but-never-silent wrappers in
 * intakeService: a throw here degrades that source to `trust:'unavailable'` WITH the error
 * message on the record, and the Owner still gets his turn. It is loud in the log and in
 * the read state, not loud as a dead reply.
 *
 * ── NO CACHE, DELIBERATELY ───────────────────────────────────────────────────
 * The file is read per call. A few reads per turn cost nothing measurable, and a cache
 * would mean a corrected timezone did not take effect until a restart — the same
 * next-turn-not-next-restart contract the flags already follow.
 */

const fs = require('node:fs')
const path = require('node:path')

const { settingsPath } = require('../persona/ownerSettings')

/** The Owner's zone. The default, never a silent fallback for a value that was set wrong. */
const DEFAULT_TIMEZONE = 'America/Winnipeg'

class TimezoneError extends Error {
  constructor (message) { super(message); this.name = 'TimezoneError' }
}

/**
 * Is this a real IANA zone NAME?
 *
 * Intl is the authority on whether a string resolves, but it is more permissive than this
 * needs to be: it accepts legacy abbreviations, and `PST` resolves happily to
 * America/Los_Angeles. For a restaurant in Winnipeg that is a two-hour error that WORKS —
 * no throw, no warning, every timestamp quietly wrong. It is the precise failure this
 * module exists to prevent, so an abbreviation is rejected even though it would resolve.
 *
 * The shape test is `Region/City`, with UTC as the one legitimate name that has no slash.
 */
function isValidZone (tz) {
  if (typeof tz !== 'string') return false
  if (tz !== 'UTC' && !tz.includes('/')) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch (_) { return false }
}

/**
 * The Owner's timezone, or a thrown error explaining exactly what is wrong with it.
 *
 * @param {{root?: string, env?: object}} opts  same shape ownerSettings takes
 */
function resolveTimeZone (opts = {}) {
  const p = settingsPath(opts)

  let raw
  try {
    raw = fs.readFileSync(p, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return DEFAULT_TIMEZONE // no settings yet — ordinary
    throw new TimezoneError('owner settings could not be read (' + ((err && err.code) || 'unknown') + '): ' + p)
  }

  let data
  try {
    data = JSON.parse(raw)
  } catch (_) {
    throw new TimezoneError('owner settings file is not valid JSON, so the timezone cannot be read: ' + p)
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TimezoneError('owner settings file does not contain an object, so the timezone cannot be read: ' + p)
  }

  // NOT SET is not MALFORMED. `null` is how this schema spells "cleared" — emptySettings()
  // returns `timezone: null`, and saving null is how the Owner goes back to the default — so
  // an absent key, undefined and null all mean the same ordinary thing. Only a value that is
  // PRESENT and WRONG is a mistake worth stopping the clock for.
  const has = Object.prototype.hasOwnProperty.call(data, 'timezone')
  if (!has || data.timezone === undefined || data.timezone === null) return DEFAULT_TIMEZONE

  const tz = data.timezone
  if (typeof tz !== 'string' || tz.trim() === '') {
    throw new TimezoneError('owner settings timezone must be a non-empty IANA name (e.g. "America/Winnipeg"); got ' + JSON.stringify(tz))
  }
  if (!isValidZone(tz)) {
    throw new TimezoneError('owner settings timezone is not a recognised IANA zone: ' + JSON.stringify(tz) +
      '. It must be a name like "America/Winnipeg" — abbreviations such as "CST" and offsets such as "GMT-6" are not zones.')
  }
  return tz
}

/** The wall-clock parts of an instant, in a zone. Numbers, not strings. */
function partsIn (date, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23', // '24' for midnight in some ICU builds is exactly the bug this avoids
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const out = {}
  for (const p of f.formatToParts(date)) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return out
}

/**
 * How far ahead of UTC the zone is at that instant, in ms. Carries DST by construction.
 *
 * MILLISECONDS ARE STRIPPED FROM BOTH SIDES. `partsIn` resolves only to the second, so
 * subtracting a timestamp that still carries milliseconds folds them into the "offset" —
 * and `startOfLocalDay(new Date())` came back as 05:00:00.748Z instead of 05:00:00.000Z.
 * Harmless in a calendar timeMin, wrong everywhere it is compared for equality.
 */
function offsetMsAt (date, tz) {
  const p = partsIn(date, tz)
  const wholeSeconds = date.getTime() - date.getMilliseconds()
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - wholeSeconds
}

function toDate (isoOrDate) {
  const d = isoOrDate instanceof Date ? new Date(isoOrDate.getTime()) : new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) throw new TimezoneError('not a valid date: ' + String(isoOrDate))
  return d
}

/**
 * Midnight of the Owner's day containing this instant — the Owner's 「今日」, not a UTC
 * boundary and not the machine's.
 *
 * Two passes on purpose: the offset that applies AT midnight is not always the offset that
 * applied at the instant we started from, and on a DST changeover day a single pass lands an
 * hour out.
 */
function startOfLocalDay (isoOrDate, opts = {}) {
  const tz = resolveTimeZone(opts)
  const d = toDate(isoOrDate)
  const p = partsIn(d, tz)
  const wallMidnightUTC = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0)

  let t = wallMidnightUTC - offsetMsAt(d, tz)
  const off2 = offsetMsAt(new Date(t), tz)
  const t2 = wallMidnightUTC - off2
  if (t2 !== t) t = t2
  return new Date(t)
}

/** 'YYYY-MM-DD HH:MM' in the Owner's zone. The archive's format, now from one place. */
function formatLocal (isoOrDate, opts = {}) {
  const tz = resolveTimeZone(opts)
  const p = partsIn(toDate(isoOrDate), tz)
  const pad = (n) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`
}

/** "Now", in one place, so a future test clock has a single seam to replace. */
function now () { return new Date() }

module.exports = { resolveTimeZone, startOfLocalDay, formatLocal, now, isValidZone, DEFAULT_TIMEZONE, TimezoneError }
