'use strict'

/**
 * durableAuditWriter.js — Phase 2 Gate 1. The durable backend for the append-only
 * audit contract (createAuditSink's `writer`). Truly fsync-or-throw, sealed-segment
 * rotation, torn-tail detection, and seq derived from disk facts (no separate
 * counter). Byte-accurate framing so multi-byte UTF-8 never corrupts offsets.
 *
 * Framing: each record is one line `<json>\t<sha256hex(json)>\n`. JSON.stringify
 * escapes control chars, so the json bytes contain no raw \t or \n — \t safely
 * separates the checksum and \n safely delimits records. On recovery a line is
 * VALID only if it terminates with \n, splits on \t, and the checksum matches; the
 * first invalid/partial line (only the tail can be torn) and everything after it is
 * discarded and truncated away.
 *
 * SECURITY BOUNDARY: readAll() is an UNGATED pure-storage read. It is ONLY for a
 * sink/service caller that has ALREADY passed the #5 auditor identity gate. The
 * connector main flow (projectionEndpoint / the MCP server) MUST NOT import or call
 * durableAuditWriter.readAll — that would bypass the identity gate. (A structural
 * test asserts the main-flow module does not reference it.)
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const SEG_PREFIX = 'seg-'
const SEG_EXT = '.log'
const TAB = 0x09
const NL = 0x0a
const DEFAULT_SEGMENT_MAX = 1 << 20 // 1 MiB
const DEFAULT_RETENTION = Object.freeze({ policy: 'keep-all', maxAgeMs: null })

function sha256hex (s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex') }
function frame (record) { const json = JSON.stringify(record); return Buffer.from(json + '\t' + sha256hex(json) + '\n', 'utf8') }

/** Parse a segment Buffer into valid records; stop at the first torn/invalid line. */
function parseSegmentBuf (buf) {
  const records = []
  let validBytes = 0
  let idx = 0
  while (idx < buf.length) {
    const nl = buf.indexOf(NL, idx)
    if (nl === -1) break // trailing partial with no newline → torn tail
    const line = buf.slice(idx, nl)
    const tab = line.indexOf(TAB)
    if (tab === -1) break
    const json = line.slice(0, tab).toString('utf8')
    const cs = line.slice(tab + 1).toString('utf8')
    if (cs !== sha256hex(json)) break // checksum mismatch → torn/corrupt
    let rec
    try { rec = JSON.parse(json) } catch (_) { break }
    records.push(rec)
    validBytes = nl + 1 // byte offset just past the newline
    idx = nl + 1
  }
  return { records, validBytes }
}

function segNumber (name) { return parseInt(name.slice(SEG_PREFIX.length, name.length - SEG_EXT.length), 10) }
function segName (n) { return SEG_PREFIX + String(n).padStart(4, '0') + SEG_EXT }

function createDurableAuditWriter (options = {}) {
  const baseDir = options.baseDir
  if (typeof baseDir !== 'string' || baseDir === '') throw new TypeError('createDurableAuditWriter requires baseDir')
  const dir = path.join(baseDir, 'audit')
  const segmentMax = Number.isInteger(options.segmentMaxBytes) && options.segmentMaxBytes > 0 ? options.segmentMaxBytes : DEFAULT_SEGMENT_MAX
  const retention = options.retention && typeof options.retention === 'object' ? { ...options.retention } : { ...DEFAULT_RETENTION }
  const fsyncImpl = typeof options.fsyncImpl === 'function' ? options.fsyncImpl : fs.fsyncSync

  fs.mkdirSync(dir, { recursive: true })

  const listSegs = () => fs.readdirSync(dir).filter(f => f.startsWith(SEG_PREFIX) && f.endsWith(SEG_EXT)).sort()

  // Recovery: derive lastSeq from ALL valid records; the LAST segment is active and its
  // torn tail (if any) is truncated on open (seq comes from disk facts, not a counter).
  let segs = listSegs()
  let lastSeq = 0
  let activeValidBytes = 0
  for (const f of segs) {
    const { records, validBytes } = parseSegmentBuf(fs.readFileSync(path.join(dir, f)))
    for (const r of records) if (typeof r.seq === 'number' && r.seq > lastSeq) lastSeq = r.seq
    activeValidBytes = validBytes // ends as the last segment's valid byte length
  }

  let activeName
  if (segs.length === 0) { activeName = segName(1); fs.writeFileSync(path.join(dir, activeName), Buffer.alloc(0)); activeValidBytes = 0 } else activeName = segs[segs.length - 1]
  let activePath = path.join(dir, activeName)

  // Drop any torn tail on the active segment, durably.
  if (fs.statSync(activePath).size !== activeValidBytes) {
    const fd0 = fs.openSync(activePath, 'r+')
    try { fs.ftruncateSync(fd0, activeValidBytes); fsyncImpl(fd0) } finally { fs.closeSync(fd0) }
  }

  let fd = fs.openSync(activePath, 'r+')
  let durableOffset = activeValidBytes

  function rotateIfNeeded () {
    if (durableOffset < segmentMax) return
    fsyncImpl(fd); fs.closeSync(fd)
    activeName = segName(segNumber(activeName) + 1)
    activePath = path.join(dir, activeName)
    fs.writeFileSync(activePath, Buffer.alloc(0))
    fd = fs.openSync(activePath, 'r+')
    durableOffset = 0
  }

  function appendDurable (record) {
    rotateIfNeeded()
    const buf = frame(record)
    const start = durableOffset
    try {
      fs.writeSync(fd, buf, 0, buf.length, start)
      fsyncImpl(fd) // durable ONLY after fsync returns
    } catch (err) {
      // remove the unsynced bytes so recovery can never count a failed append
      try { fs.ftruncateSync(fd, start); fsyncImpl(fd) } catch (_) {}
      throw err
    }
    durableOffset = start + buf.length
    if (typeof record.seq === 'number' && record.seq > lastSeq) lastSeq = record.seq
  }

  function lastDurableSeq () { return lastSeq }

  /** UNGATED pure-storage read — auditor(#5)-gated callers ONLY (see file header). */
  function readAll () {
    const out = []
    for (const f of listSegs()) {
      const { records } = parseSegmentBuf(fs.readFileSync(path.join(dir, f)))
      for (const r of records) out.push(r)
    }
    return out
  }

  function sealedSegments () { return listSegs().filter(f => f !== activeName) }
  function currentRetention () { return { ...retention } } // writer never self-prunes; changing retention is a Governance action
  function close () { try { fsyncImpl(fd) } catch (_) {} fs.closeSync(fd) }

  return { appendDurable, lastDurableSeq, readAll, sealedSegments, currentRetention, close }
}

module.exports = { createDurableAuditWriter, DEFAULT_SEGMENT_MAX }
