'use strict'

/**
 * bindConfig — PURE resolver for the production backend's listen host.
 *
 * Owner policy (Runtime Foundation A1): the primary must bind ONLY the exact IPv4
 * loopback `127.0.0.1`. `AROMA_BIND_HOST` unset/empty -> `127.0.0.1`. ANY other value
 * (`0.0.0.0`, `::`, `::1`, a hostname, a LAN IP, a malformed string) FAILS CLOSED —
 * there is deliberately NO override that could accidentally expose the service on an
 * external interface.
 *
 * Pure: reads only the passed env object; no Memory, no listener, no process.exit, no
 * env mutation. Returns a structured result — the caller (index.js) decides how to
 * fail closed. The invalid value is NEVER echoed back (no env/secret leakage).
 */

const LOOPBACK = '127.0.0.1'
const CODE = Object.freeze({ OK: 'BIND_HOST_OK', INVALID: 'BIND_HOST_INVALID' })

/**
 * @param {object} env  e.g. process.env
 * @returns {{ok:boolean, host:(string|null), code:string, source?:string, reason?:string}}
 */
function resolveBindHost (env) {
  const raw = env && env.AROMA_BIND_HOST
  if (raw == null || raw === '') return { ok: true, host: LOOPBACK, code: CODE.OK, source: 'default' }
  if (raw === LOOPBACK) return { ok: true, host: LOOPBACK, code: CODE.OK, source: 'explicit' }
  // Fail closed on everything else — never bind a non-loopback interface. The raw
  // value is intentionally NOT included in the reason (no env echo).
  return { ok: false, host: null, code: CODE.INVALID, reason: 'only 127.0.0.1 is permitted' }
}

module.exports = { resolveBindHost, LOOPBACK, CODE }
