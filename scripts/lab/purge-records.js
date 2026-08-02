'use strict'

/**
 * purge-records.js — PHYSICAL purge of named records from the Xiangxiang archive.
 *
 * ── WHY THIS EXISTS BESIDE `delete` ───────────────────────────────────────
 * `xiangxiang-archive.js delete` already rewrites the archive without the removed records. This
 * script exists because "deleted" has to survive a harder question than "is it still in the
 * active file?". A deletion is only real when the bytes are gone from the active archive AND
 * from every snapshot that copied them, and when somebody has actually looked for them
 * afterwards rather than assuming.
 *
 * So this does the three things separately, and reports each:
 *
 *   1. LOGICAL   — an audit record naming ids, counts, time and the Owner's reason.
 *                  It contains no deleted text, no names, no subjects, no summary. An audit
 *                  that preserved the text would defeat the deletion it records.
 *   2. PHYSICAL  — the active archive is rebuilt from the ORIGINAL LINE BYTES of the records
 *                  that stay, written to a temp file, fsync'd, closed, and moved into place
 *                  with an atomic rename. No .bak, no .old, no copy of the previous file under
 *                  any name — keeping one would be keeping the thing being deleted.
 *   3. SNAPSHOTS — every backup snapshot holding a target is REMOVED WHOLE. Snapshots are not
 *                  edited: a rewritten snapshot no longer matches the manifest that proves it
 *                  intact, so a repaired backup is an untrustworthy backup.
 *
 * ── THE SEARCH FOR RESIDUE HAPPENS IN THIS PROCESS, ON PURPOSE ────────────
 * To look for the deleted text afterwards you need the deleted text. Writing it to a needle
 * file would create a fresh copy of exactly what was being removed. So everything — purge,
 * snapshot removal, new baseline, and the scan for leftovers — happens in ONE process, with the
 * text held only in memory, and only counts are ever printed.
 *
 * ── WHAT IT DOES NOT CLAIM ────────────────────────────────────────────────
 * Zero readable residue in the active archive and in every snapshot. NOT forensic
 * unrecoverability: a rename unlinks bytes, it does not scrub the sectors that held them, and
 * this script has no evidence about the state of the underlying disk.
 *
 *   node scripts/lab/purge-records.js --ids turn_a,turn_b --reason "..." [--dry-run]
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const ARCHIVE_ROOT = process.env.XIANGXIANG_ARCHIVE_ROOT || 'C:\\Aroma\\XiangxiangLab\\conversation-archive'
const LAB_ROOT = process.env.XIANGXIANG_LAB_ROOT || 'C:\\Aroma\\XiangxiangLab'
const BACKUP_ROOT = process.env.XIANGXIANG_BACKUP_ROOT || 'D:\\XiangxiangArchiveBackups'
const BACKUP_SCRIPT = 'C:\\Aroma\\aroma-agent-backend\\scripts\\lab\\Backup-XiangxiangArchive.ps1'

const ARCHIVE = path.join(ARCHIVE_ROOT, 'archive.jsonl')
const AUDIT = path.join(ARCHIVE_ROOT, 'audit.jsonl')

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const shaFile = (p) => sha(fs.readFileSync(p))

function arg (name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const DRY = process.argv.includes('--dry-run')
const ids = String(arg('ids', '')).split(',').map((s) => s.trim()).filter(Boolean)
const reason = arg('reason', '')
const authorisedBy = arg('authorised-by', 'louie')

function die (msg) { console.error('\nREFUSED: ' + msg + '\n'); process.exit(1) }

if (ids.length === 0) die('--ids is required')
if (!reason) die('--reason is required — a deletion without a recorded reason is not auditable')
if (!fs.existsSync(ARCHIVE)) die('no archive at ' + ARCHIVE)

/* ── 1. READ, AND IDENTIFY EXACTLY ────────────────────────────────────────── */

const originalBuf = fs.readFileSync(ARCHIVE)
const originalSha = sha(originalBuf)
const originalLines = originalBuf.toString('utf8').split(/\r?\n/).filter((l) => l.trim())

const parsed = originalLines.map((line, i) => {
  try { return { line, rec: JSON.parse(line), i } } catch (_) { return { line, rec: null, i } }
})
const malformed = parsed.filter((p) => p.rec === null).length
if (malformed > 0) die(malformed + ' malformed line(s) — refusing to rewrite an archive that cannot be fully parsed')

const targets = []
for (const id of ids) {
  const hits = parsed.filter((p) => p.rec.id === id)
  if (hits.length === 0) die('record not found: ' + id)
  if (hits.length > 1) die('record id appears ' + hits.length + ' times: ' + id)
  targets.push(hits[0])
}
const targetSet = new Set(targets.map((t) => t.i))
const keep = parsed.filter((p) => !targetSet.has(p.i))

console.log('=== BEFORE ===')
console.log('archive        : ' + ARCHIVE)
console.log('bytes          : ' + originalBuf.length)
console.log('sha256         : ' + originalSha)
console.log('records        : ' + parsed.length)
console.log('to purge       : ' + targets.length)
console.log('to keep        : ' + keep.length)
for (const t of targets) {
  const r = t.rec
  console.log('  TARGET ' + r.id + '  schemaVersion=' + r.schemaVersion + '  role=' + r.role +
    '  turnIndex=' + r.turnIndex + '  at=' + r.at + '  conv=' + r.conversationId +
    '  textChars=' + (r.text === null ? 'null' : String(r.text).length))
}

/* ── 2. NEEDLES — DERIVED IN MEMORY, NEVER WRITTEN, NEVER PRINTED ─────────── */

// TWO CLASSES, AND ONLY ONE OF THEM DECIDES THE VERDICT.
//
// The first version of this scan used every Latin word of 4+ characters as a needle, and
// promptly reported "RESIDUE FOUND" in ten files \u2014 the launcher, a batch file, some JSON
// records \u2014 because a reply about somebody's mail contains ordinary English words, and so does
// every other file on the machine. Twenty-two hits, every one of them noise.
//
// A scanner that cries wolf is a scanner that gets ignored, so:
//
//   DISTINCTIVE \u2014 the whole turn, multi-word capitalised sequences (the shape a person's or a
//                 company's name takes), and 6-character CJK windows. These do not appear by
//                 coincidence. A hit here is real residue and FAILS the run.
//   GENERIC     \u2014 single Latin words. Reported for completeness, never used for the verdict,
//                 because "the deleted reply contained the word 'about'" is not a finding.
function needlesFrom (text) {
  const distinctive = new Set()
  const generic = new Set()
  const t = String(text || '')
  if (!t) return { distinctive, generic }
  distinctive.add(t)
  for (const m of t.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) || []) distinctive.add(m)
  for (const run of t.match(/[\u4e00-\u9fff]{6,}/g) || []) {
    for (let i = 0; i + 6 <= run.length; i++) distinctive.add(run.slice(i, i + 6))
  }
  for (const m of t.match(/[A-Za-z][A-Za-z'-]{3,}/g) || []) generic.add(m)
  return { distinctive, generic }
}
const needlesDistinctive = new Set()
const needlesGeneric = new Set()
for (const t of targets) {
  const { distinctive, generic } = needlesFrom(t.rec.text)
  for (const n of distinctive) needlesDistinctive.add(n)
  for (const n of generic) needlesGeneric.add(n)
}
console.log('residue needles derived (in memory only): ' +
  needlesDistinctive.size + ' distinctive, ' + needlesGeneric.size + ' generic (advisory)')

/* ── 3. SNAPSHOTS THAT HOLD A TARGET ──────────────────────────────────────── */

function snapshotsHolding () {
  if (!fs.existsSync(BACKUP_ROOT)) return []
  const out = []
  for (const name of fs.readdirSync(BACKUP_ROOT)) {
    const dir = path.join(BACKUP_ROOT, name)
    if (!fs.statSync(dir).isDirectory()) continue
    const af = path.join(dir, 'archive.jsonl')
    if (!fs.existsSync(af)) continue
    const body = fs.readFileSync(af, 'utf8')
    if (ids.some((id) => body.includes(id))) out.push({ name, dir, sha256: shaFile(af) })
  }
  return out
}
const holding = snapshotsHolding()
console.log('\n=== SNAPSHOTS HOLDING A TARGET ===')
for (const s of holding) console.log('  ' + s.name + '  archive.jsonl sha256=' + s.sha256.slice(0, 16))
console.log('count: ' + holding.length)

if (DRY) { console.log('\n--dry-run: nothing was changed.'); process.exit(0) }

/* ── 4. SNAPSHOT PURGE — WHOLE DIRECTORIES, NEVER EDITED ──────────────────── */

console.log('\n=== SNAPSHOT PURGE ===')
const purgedSnapshots = []
for (const s of holding) {
  fs.rmSync(s.dir, { recursive: true, force: true })
  purgedSnapshots.push(s.name)
  console.log('  removed ' + s.name)
}
const stillThere = fs.existsSync(BACKUP_ROOT)
  ? fs.readdirSync(BACKUP_ROOT).filter((n) => n.startsWith('snapshot-')).length
  : 0
console.log('snapshots remaining: ' + stillThere)

/* ── 5. PHYSICAL PURGE — temp, fsync, close, atomic rename ────────────────── */

console.log('\n=== PHYSICAL PURGE ===')
// The kept records go back as their ORIGINAL LINE BYTES. Re-serialising from the parsed object
// could reorder keys or change number formatting, which would make "the rest is unchanged"
// something you have to take on trust instead of something you can hash.
const newBody = keep.length ? keep.map((p) => p.line).join('\n') + '\n' : ''
const tmp = ARCHIVE + '.purge-' + crypto.randomBytes(6).toString('hex') + '.tmp'

const fd = fs.openSync(tmp, 'wx')
try {
  fs.writeSync(fd, Buffer.from(newBody, 'utf8'))
  fs.fsyncSync(fd)          // on disk, not just in the page cache, BEFORE the rename
} finally {
  fs.closeSync(fd)
}

// Verify the temp file BEFORE it becomes the archive.
const tmpBuf = fs.readFileSync(tmp)
const tmpLines = tmpBuf.toString('utf8').split(/\r?\n/).filter((l) => l.trim())
let bad = null
if (tmpLines.length !== keep.length) bad = 'expected ' + keep.length + ' records, temp has ' + tmpLines.length
for (let i = 0; !bad && i < keep.length; i++) {
  if (tmpLines[i] !== keep[i].line) bad = 'kept record ' + i + ' is not byte-identical'
  else { try { JSON.parse(tmpLines[i]) } catch (_) { bad = 'kept record ' + i + ' does not parse' } }
}
if (!bad) for (const id of ids) if (tmpBuf.toString('utf8').includes(id)) bad = 'purged id ' + id + ' still present'
if (bad) {
  fs.rmSync(tmp, { force: true })
  die('the rebuilt archive failed verification (' + bad + ') — the original was NOT touched')
}

// Atomic replace. The previous file is NOT copied anywhere first: a backup of it would be a
// preserved copy of the records being deleted.
fs.renameSync(tmp, ARCHIVE)
try {
  const dfd = fs.openSync(ARCHIVE_ROOT, 'r')
  try { fs.fsyncSync(dfd) } finally { fs.closeSync(dfd) }
} catch (_) { /* directory fsync is not available on every Windows volume; the file was fsync'd */ }

const afterBuf = fs.readFileSync(ARCHIVE)
console.log('records now    : ' + afterBuf.toString('utf8').split(/\r?\n/).filter((l) => l.trim()).length)
console.log('bytes now      : ' + afterBuf.length)
console.log('sha256 now     : ' + sha(afterBuf))
console.log('temp left      : ' + fs.existsSync(tmp))

/* ── 6. LOGICAL AUDIT — ids, counts, time, reason. NO TEXT. ───────────────── */

const auditRecord = {
  schemaVersion: 2,
  event: 'records_purged',
  at: new Date().toISOString(),
  purgedIds: ids,
  purgedConversationIds: [...new Set(targets.map((t) => t.rec.conversationId))],
  purgedCount: targets.length,
  remaining: keep.length,
  archiveShaBefore: originalSha,
  archiveShaAfter: sha(afterBuf),
  snapshotsPurged: purgedSnapshots,
  reason,
  authorisedBy,
  note: 'Ids, counts and hashes only. The deleted text, names, subjects and any summary of them are deliberately absent — an audit that kept them would defeat the deletion it records.'
}
const afd = fs.openSync(AUDIT, 'a')
try {
  fs.writeSync(afd, JSON.stringify(auditRecord) + '\n')
  fs.fsyncSync(afd)
} finally {
  fs.closeSync(afd)
}
console.log('\n=== LOGICAL AUDIT ===')
console.log('audit.jsonl    : ' + AUDIT + '  (' + fs.readFileSync(AUDIT, 'utf8').split('\n').filter((l) => l.trim()).length + ' line(s))')

/* ── 7. NEW CLEAN BASELINE SNAPSHOT ───────────────────────────────────────── */

console.log('\n=== NEW BASELINE SNAPSHOT ===')
let baselineOk = false
try {
  const out = execFileSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', BACKUP_SCRIPT, '-Quiet'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  baselineOk = /restore PROVEN/i.test(out) || /BACKED UP/i.test(out)
  for (const l of out.split('\n').map((s) => s.trimEnd()).filter(Boolean)) console.log('  ' + l.trim())
} catch (err) {
  console.log('  baseline snapshot FAILED: ' + (err.message || err))
}
console.log('baseline created: ' + baselineOk)

/* ── 8. RESIDUE SCAN — counts only ────────────────────────────────────────── */

function walk (dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    let st
    try { st = fs.statSync(p) } catch (_) { continue }
    if (st.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

const scanFiles = [...walk(ARCHIVE_ROOT), ...walk(LAB_ROOT), ...walk(BACKUP_ROOT)]
const uniqueFiles = [...new Set(scanFiles)]
let distinctiveHits = 0
let genericHits = 0
const hitFiles = []
for (const f of uniqueFiles) {
  let body
  try { body = fs.readFileSync(f, 'utf8') } catch (_) { continue }
  let d = 0
  let g = 0
  for (const n of needlesDistinctive) if (body.includes(n)) d++
  for (const n of needlesGeneric) if (body.includes(n)) g++
  distinctiveHits += d
  genericHits += g
  if (d > 0 || g > 0) hitFiles.push({ file: f, distinctive: d, generic: g })
}

console.log('\n=== RESIDUE SCAN (counts only — no needle is ever printed) ===')
console.log('files scanned      : ' + uniqueFiles.length)
console.log('roots              : archive dir, Lab root, backup chain')
console.log('needles            : ' + needlesDistinctive.size + ' distinctive, ' + needlesGeneric.size + ' generic')
for (const h of hitFiles) {
  console.log('  ' + (h.distinctive > 0 ? 'RESIDUE ' : 'generic ') + h.file +
    '  distinctive=' + h.distinctive + '  generic=' + h.generic)
}
console.log('DISTINCTIVE HITS   : ' + distinctiveHits +
  (distinctiveHits === 0 ? '   → zero readable residue' : '   → REAL RESIDUE FOUND'))
console.log('generic word hits  : ' + genericHits + '   (advisory only — ordinary English, not a finding)')

/* ── 9. LEFTOVER WORKING FILES ────────────────────────────────────────────── */

const leftovers = uniqueFiles.filter((f) => /\.(tmp|bak|old|orig|working|save|swp)$|\.tmp-|\.purge-|~$/i.test(path.basename(f)))
console.log('\n=== LEFTOVER TEMP / BAK / WORKING FILES ===')
console.log('count: ' + leftovers.length)
for (const l of leftovers) console.log('  ' + l)

console.log('\n=== RESULT ===')
const ok = distinctiveHits === 0 && leftovers.length === 0 && baselineOk && !fs.existsSync(tmp)
console.log(ok ? 'PURGE COMPLETE — zero readable residue in the active archive and every snapshot.'
  : 'PURGE INCOMPLETE — see the counts above.')
console.log('NOT a claim of forensic unrecoverability: a rename unlinks bytes, it does not scrub')
console.log('the sectors that held them, and this script has no evidence about the disk itself.')
process.exit(ok ? 0 : 1)
