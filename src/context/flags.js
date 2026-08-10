'use strict'

/**
 * flags.js — Unified Read Access flag gate. Master READ_ACCESS + per-source
 * CONTEXT_GITHUB / CONTEXT_DRIVE / CONTEXT_GMAIL / CONTEXT_CALENDAR /
 * CONTEXT_AROMA_SYSTEM. Fail-closed,
 * default OFF: unset/empty/invalid → 'off' (mirrors resolveWorkerInvocation).
 *
 * A source is readable ONLY when BOTH the master flag AND that source's flag are
 * exactly 'on'. With any flag off the connector is inert.
 */

const SOURCE_FLAG = Object.freeze({
  github: 'CONTEXT_GITHUB',
  drive: 'CONTEXT_DRIVE',
  gmail: 'CONTEXT_GMAIL',
  calendar: 'CONTEXT_CALENDAR',
  aroma_system: 'CONTEXT_AROMA_SYSTEM',
  // Local: derived from this build's own docs/. It still gets a flag and still defaults OFF,
  // because "needs no credential" is not a reason to be exempt from the switch — the repo
  // default for every source is off, and the launcher is where activation lives.
  development_record: 'CONTEXT_DEVELOPMENT_RECORD',
  // ⛔ THE ONLY SOURCE THAT READS OUTSIDE THE BUILDING. It obeys the same two-flag rule as every
  // other source and defaults OFF like every other source; liveClients adds two further
  // conditions on top (an API key, and A4 itself) because a public read has an egress side that
  // the other sources do not.
  public_knowledge: 'CONTEXT_PUBLIC_KNOWLEDGE'
})

function resolveFlag (env, name) {
  const raw = env[name]
  if (raw === undefined || raw === null || raw === '') return 'off'
  if (raw === 'on' || raw === 'off') return raw
  console.warn(`[AROMA-HUB] Invalid ${name}="${raw}" — falling back to 'off'.`)
  return 'off'
}

function readAccessEnabled (env, source) {
  const e = env || process.env
  if (resolveFlag(e, 'READ_ACCESS') !== 'on') return false
  const f = SOURCE_FLAG[source]
  if (!f) return false
  return resolveFlag(e, f) === 'on'
}

module.exports = { SOURCE_FLAG, resolveFlag, readAccessEnabled }
