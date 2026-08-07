'use strict'

/**
 * settingsValues.js — what the Owner has actually set. The VALUES; not the definitions.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ READ AT USE TIME. NEVER CAPTURED AT MODULE LOAD.
 *
 * > **Owner: 「a registry where every change needs a restart is barely better than editing
 * > constants.」**
 *
 * That is the whole design. A constant imported at the top of a file is frozen for the life of
 * the process, and THAT is what forces restarts — not the fact that it was a constant. So every
 * consumer calls `get(id)` at the moment it needs the value, and the next run uses the new one.
 *
 * The split, deliberately:
 *   `governance/settingsRegistry.js`  the definitions and the RANGES — fences, protected path
 *   this file                          the values he chose — his, and not governance
 * ══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('node:fs')
const path = require('node:path')
const { defaults, validate, entry } = require('../governance/settingsRegistry')

const FILE = () => path.join(process.env.AROMA_DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'settings-values.json')

/**
 * A very short cache. Long enough that one HTTP request does not re-read the file six times;
 * short enough that 「I changed it」 and 「it took effect」 are the same moment to a human.
 */
const CACHE_MS = 1000
let cache = null
let cacheAt = 0

function readStored (now) {
  const t = Number(now) || Date.now()
  if (cache && (t - cacheAt) < CACHE_MS) return cache
  let stored = {}
  try {
    const raw = fs.readFileSync(FILE(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed
  } catch (_) {
    // ⛔ No file, or unreadable, means DEFAULTS — never an error and never an empty setting.
    // The registry's defaults are the behaviour that existed before this file did, so a missing
    // values file leaves the system byte-identical to before the registry was introduced.
    stored = {}
  }
  cache = stored
  cacheAt = t
  return stored
}

/**
 * The effective value: what he set if it is still valid, otherwise the default.
 *
 * ⛔ A STORED VALUE IS RE-VALIDATED ON EVERY READ. A range is a fence, and a fence that is only
 * checked on the way in stops being a fence the moment the file is edited by hand — which is a
 * thing he can do, and which no write path would see.
 */
function get (id, opts) {
  const e = entry(id)
  if (!e) return undefined
  const stored = (opts && opts.stored) || readStored(opts && opts.now)
  if (!Object.prototype.hasOwnProperty.call(stored, id)) return e.def
  const v = validate(id, stored[id])
  return v.ok ? v.value : e.def
}

/** Every effective value at this moment — for the settings screen and for the verify script. */
function all (opts) {
  const stored = (opts && opts.stored) || readStored(opts && opts.now)
  const out = {}
  for (const id of Object.keys(defaults())) out[id] = get(id, { stored })
  return out
}

/**
 * Write one value. Refused values are NEVER stored, and the refusal carries its reason.
 * @returns {{ok:true, value, appliesOn, howToApply?}|{ok:false, reason, saying}}
 */
function set (id, raw) {
  const v = validate(id, raw)
  if (!v.ok) return v
  const e = entry(id)
  const stored = readStored()
  const next = Object.assign({}, stored, { [id]: v.value })
  const f = FILE()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify(next, null, 1))
  cache = null // the next read is the new value; no restart, no stale window beyond the cache
  return {
    ok: true,
    value: v.value,
    appliesOn: e.appliesOn,
    // ⛔ Carried back so the caller can SAY it. A setting that does not apply live must never
    // be reported as simply saved — he would believe it took.
    howToApply: e.howToApply || null
  }
}

/** Tests only: drop the cache so a file written directly is seen at once. */
function _resetCache () { cache = null; cacheAt = 0 }

module.exports = { get, all, set, FILE, CACHE_MS, _resetCache }
