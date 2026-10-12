'use strict'

/**
 * openClawOsAdapters.js — THE READ-ONLY OS EVIDENCE READERS FOR RETIREMENT.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────────────
 * The retirement verifier decides RETIRED / LIVE / UNKNOWN from injected readers and has no
 * default for any of them. This module is those readers, against the real distro, through
 * the one exact boundary: exactWslExecRunner (wsl.exe -d OpenClawGateway --exec <argv>,
 * env:{}, shell:false). Every command is a literal argv. There is no shell, no pipe, no
 * redirection, no substitution, no glob — anywhere.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
 * It creates nothing and stops nothing. No systemd-run, no systemctl start/stop, no OpenClaw,
 * no writes. It decides nothing either: every function returns the RAW contract object that
 * openClawReaderContracts parses, and the verifier interprets. A decision made here would be a
 * second retirement authority.
 *
 * ── THE FAILURE VOCABULARY ───────────────────────────────────────────────────
 *   gone        the process (or path) no longer exists — a positive fact, checked separately
 *   unreadable  we could not obtain a trustworthy answer — permission, malformed output,
 *               timeout, race, anything we did not positively understand
 * Nothing is ever partially salvaged. A pid list with one malformed row is unreadable, an fd
 * scan with one unreadable link is unreadable, a duplicate marker is unreadable. The verifier
 * turns every unreadable into UNKNOWN, which keeps the lock. Permission denied is NEVER gone.
 *
 * ── SECRETS ──────────────────────────────────────────────────────────────────
 * readEnviron never returns, stores or embeds a process environment. GNU grep in NUL-record
 * mode extracts only records beginning `AROMA_EXECUTOR_INSTANCE=`, so nothing else crosses the
 * boundary at all; the marker value itself is validated to the instance-id grammar. No error
 * message carries command output. The protected-gateway facility never reads the gateway's
 * environment.
 */

const { exactWslExec } = require('./exactWslExecRunner')

/* ══════════════ fixed trusted configuration ══════════════ */

const BIN = Object.freeze({
  cat: '/usr/bin/cat',
  test: '/usr/bin/test',
  grep: '/usr/bin/grep',
  readlink: '/usr/bin/readlink',
  find: '/usr/bin/find',
  stat: '/usr/bin/stat',
  systemctl: '/usr/bin/systemctl',
  ss: '/usr/bin/ss'
})

const EXECUTOR_UID_HIERARCHY = '/user.slice/user-1000.slice/user@1000.service/app.slice'
const SANDBOX_ROOT = '/home/openclaw/.aroma/sandboxes'
const MARKER_KEY = 'AROMA_EXECUTOR_INSTANCE'
const PROTECTED_UNIT = 'openclaw-gateway.service'
const PROTECTED_PORT = 18789

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
const CANONICAL_UINT = /^(0|[1-9][0-9]*)$/
const CANONICAL_PID = /^[1-9][0-9]*$/
const UNIT_RE = /^aroma-oc-([A-Za-z0-9_-]{1,64})\.service$/
const CGROUP_RE = /^\/user\.slice\/user-1000\.slice\/user@1000\.service\/app\.slice\/aroma-oc-[A-Za-z0-9_-]{1,64}\.service$/
const SANDBOX_PATH_RE = /^\/home\/openclaw\/\.aroma\/sandboxes\/[A-Za-z0-9_-]{1,64}(\/repo)?$/

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_MAX_OUTPUT = 1024 * 1024

/* ══════════════ small pure helpers ══════════════ */

/** A fresh null-prototype data object — nothing downstream can inherit into it. */
const data = () => Object.create(null)

/**
 * ⛔ ELEMENTS ARE DEFINED, NEVER ASSIGNED — INSIDE THE PARSERS TOO.
 * `arr.push(v)` is a [[Set]] on an index the array does not own, so an inherited numeric
 * setter on Array.prototype swallows it and the list comes back holed. The retirement
 * verifier learned this the hard way (X3-D3.3); an adapter that parsed with push would hand
 * the contract a holed list under pollution and turn a readable world into UNKNOWN — fail
 * closed, but wrong. Every list this module builds is appended through here.
 */
function append (arr, value) {
  Object.defineProperty(arr, arr.length, { value, writable: true, enumerable: true, configurable: true })
}

/** A fresh array of own data elements copied from `values` by own descriptor. */
function ownArray (values) {
  const out = []
  for (let i = 0; i < values.length; i++) {
    const d = Object.getOwnPropertyDescriptor(values, i)
    append(out, d ? d.value : undefined)
  }
  return out
}

const UNREADABLE = () => { const o = data(); o.unreadable = true; return o }
const GONE = () => { const o = data(); o.gone = true; return o }

/** The tri-state answer of an existence probe. Only ABSENT may ever become gone. */
const PRESENCE = Object.freeze({ PRESENT: 'present', ABSENT: 'absent', UNKNOWN: 'unknown' })

/** Genuine data object: prototype is Object.prototype or null, and not an array. */
function isDataObject (v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const p = Object.getPrototypeOf(v)
  return p === Object.prototype || p === null
}

/** One field, read once, as an OWN DATA property; null for missing, inherited or accessor. */
function ownData (o, key) {
  const d = Object.getOwnPropertyDescriptor(o, key)
  if (!d || typeof d.get === 'function' || typeof d.set === 'function') return null
  return { value: d.value }
}

/**
 * A dense own-data array snapshot: every index in range must be an own data property (no
 * holes — an inherited numeric property is never evidence — and no accessors). Each element is
 * checked by `ok` and copied by descriptor into a fresh array. Returns null on any refusal.
 */
function denseOwnArray (v, ok) {
  if (!Array.isArray(v)) return null
  const out = []
  for (let i = 0; i < v.length; i++) {
    const d = Object.getOwnPropertyDescriptor(v, i)
    if (!d || typeof d.get === 'function' || typeof d.set === 'function') return null
    if (!ok(d.value)) return null
    append(out, d.value)
  }
  return out
}

const isValidPid = (pid) => Number.isSafeInteger(pid) && pid > 0

/** Parse a canonical decimal into a safe integer, or null. Never a bare Number() on input. */
function safeInt (s) {
  if (typeof s !== 'string' || !CANONICAL_UINT.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

/** NUL-separated records; a trailing NUL terminates the last record and is not a record. */
function nulRecords (stdout) {
  const s = String(stdout || '')
  if (s === '') return []
  const parts = s.split('\0')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

/** `Key=Value` lines from systemctl show into a null-prototype map; duplicates refuse. */
function parseShowProps (stdout) {
  const out = data()
  for (const line of String(stdout || '').split('\n')) {
    if (line === '') continue
    const eq = line.indexOf('=')
    if (eq <= 0) return null
    const k = line.slice(0, eq)
    if (Object.prototype.hasOwnProperty.call(out, k)) return null
    out[k] = line.slice(eq + 1)
  }
  return out
}

/** One `Uid:` row, exactly; the REAL uid is its first field. */
function parseUidRow (statusText) {
  const rows = String(statusText || '').split('\n').filter((l) => l.startsWith('Uid:'))
  if (rows.length !== 1) return null
  const fields = rows[0].slice(4).split(/[ \t]+/).filter(Boolean)
  if (fields.length !== 4) return null
  return safeInt(fields[0])
}

/** Every line a canonical pid, ascending as given; any malformed line refuses the whole list. */
function parsePidLines (stdout) {
  const lines = String(stdout || '').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const pids = []
  for (const l of lines) {
    if (!CANONICAL_PID.test(l)) return null
    const n = safeInt(l)
    if (n === null) return null
    append(pids, n)
  }
  return pids
}

/**
 * `find … -print0 -exec readlink -z` yields path\0target\0 pairs. A failed readlink drops its
 * target, which either leaves an odd record count or shifts the next fd PATH into a target
 * slot — both are detected, and the whole scan is refused.
 */
function parseFdPairs (stdout, pid) {
  const recs = nulRecords(stdout)
  if (recs.length % 2 !== 0) return null
  const fdPath = new RegExp('^/proc/' + pid + '/fd/[0-9]+$')
  const targets = []
  for (let i = 0; i < recs.length; i += 2) {
    if (!fdPath.test(recs[i])) return null
    const target = recs[i + 1]
    if (target === '' || fdPath.test(target)) return null
    append(targets, target)
  }
  return targets
}

/**
 * `ss -ltnHp` rows: LISTEN recv send LOCAL PEER users:(("name",pid=N,fd=M),...).
 *
 * ⛔ EVERY pid= CLAIM ON A ROW IS ACCOUNTED FOR.
 * The first version took the FIRST pid= token per row, so a socket shared by the gateway and
 * a second process — `users:(("node",pid=360,fd=27),("other",pid=93018,fd=9))` — reported only
 * 360 and the second owner was invisible to the protected gate. Since the reader always asks
 * with -p, process ownership is EXPECTED: a row without a well-formed users:( … ) section, a
 * row with zero pid claims, or any malformed pid token refuses the whole reading.
 */
function parseSsListeners (stdout) {
  const out = []
  for (const line of String(stdout || '').split('\n')) {
    if (line.trim() === '') continue
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5 || cols[0] !== 'LISTEN') return null
    const local = cols[3]
    if (typeof local !== 'string' || local.indexOf(':') === -1) return null
    const users = /users:\((.*)\)\s*$/.exec(line)
    if (!users) return null
    const claims = users[1].match(/pid=[^,)]*/g) || []
    if (claims.length === 0) return null
    const pids = []
    for (const c of claims) {
      const tok = c.slice(4)
      if (!CANONICAL_PID.test(tok)) return null
      const n = safeInt(tok)
      if (n === null) return null
      append(pids, n)
    }
    const row = data(); row.local = local; row.pids = pids
    append(out, row)
  }
  return out
}

/* ══════════════ the protected-gateway baseline: STABLE OWN DATA, snapshotted once ══════════════ */

const GATEWAY_CGROUP_RE = /^\/[A-Za-z0-9@._\-/]+\/openclaw-gateway\.service$/

/**
 * A listener's local identity must itself name the protected port. Measured ss forms on this
 * machine: `127.0.0.1:18789` and `[::1]:18789`. A strict suffix rule covers both and refuses
 * every other port, every empty or portless string, and anything a shell could have shaped.
 */
function isProtectedLocal (local) {
  return typeof local === 'string' &&
    /^[A-Za-z0-9.\[\]:%*_-]+$/.test(local) &&
    local.endsWith(':' + PROTECTED_PORT) &&
    local.length > (':' + PROTECTED_PORT).length
}

/**
 * ⛔ A BASELINE IS READ ONCE, AS OWN DATA, AND VALIDATED AS THE SNAPSHOT — NEVER THE CALLER'S OBJECT.
 *
 * The first version checked `b.unit === …` and `Array.isArray(b.cgroupProcs)` on the object it
 * was handed and then copied from it. An inherited field, a getter returning one value to the
 * check and another to the copy, or a holed array filled in by an Array.prototype numeric
 * property would all have validated one view and retained another — the exact defect class
 * X3-D3 closed in the instance store. This helper takes every authoritative field exactly once
 * through its own data descriptor, validates the captured values, and returns a detached
 * null-prototype snapshot. Anything else is null.
 *
 * Required facts: unit is the protected service; active; MainPID a canonical positive pid
 * string that is a MEMBER of its own cgroup; a dense positive-pid cgroup membership; a dense,
 * non-empty listener set in which every row has a local identity and every claimed pid IS the
 * MainPID. A baseline violating any of these describes a gateway we could not protect.
 */
function snapshotProtectedBaseline (raw) {
  if (!isDataObject(raw)) return null
  const f = {}
  for (const k of ['unit', 'activeState', 'mainPid', 'controlGroup', 'cgroupProcs', 'listeners']) {
    const got = ownData(raw, k)
    if (got === null) return null
    f[k] = got.value
  }
  if (f.unit !== PROTECTED_UNIT) return null
  if (f.activeState !== 'active') return null
  if (typeof f.mainPid !== 'string' || !CANONICAL_PID.test(f.mainPid)) return null
  const mainPid = safeInt(f.mainPid)
  if (mainPid === null || mainPid <= 0) return null
  if (typeof f.controlGroup !== 'string' || !GATEWAY_CGROUP_RE.test(f.controlGroup) ||
      f.controlGroup.indexOf('..') !== -1) return null

  const procs = denseOwnArray(f.cgroupProcs, isValidPid)
  if (procs === null || !procs.includes(mainPid)) return null

  const rows = denseOwnArray(f.listeners, (row) => isDataObject(row))
  if (rows === null || rows.length === 0) return null
  const listeners = []
  for (const row of rows) {
    const local = ownData(row, 'local')
    const pids = ownData(row, 'pids')
    if (local === null || pids === null) return null
    // ⛔ the baseline's own rows must name the protected port too — a wrong-port ss result can
    // never become a usable baseline
    if (!isProtectedLocal(local.value)) return null
    const ownPids = denseOwnArray(pids.value, (p) => isValidPid(p) && p === mainPid)
    if (ownPids === null || ownPids.length === 0) return null
    const l = data(); l.local = local.value; l.pids = ownPids
    append(listeners, l)
  }

  const o = data()
  o.unit = PROTECTED_UNIT
  o.activeState = 'active'
  o.mainPid = f.mainPid
  o.controlGroup = f.controlGroup
  o.cgroupProcs = ownArray(procs.slice().sort((a, b) => a - b))
  o.listeners = listeners
  return o
}

/* ══════════════ the adapters ══════════════ */

/**
 * @param {{ run?: function, timeoutMs?: number, maxOutput?: number }} mechanics
 *   `run` is the exact runner (Linux argv -> {status, stdout, stderr, timedOut}); injectable
 *   for unit tests only. Nothing about WHAT is read, or WHERE, is configurable.
 */
function createOpenClawOsAdapters (mechanics = {}) {
  const run = typeof mechanics.run === 'function' ? mechanics.run : exactWslExec
  const timeoutMs = Number.isFinite(mechanics.timeoutMs) && mechanics.timeoutMs > 0 ? mechanics.timeoutMs : DEFAULT_TIMEOUT_MS
  const maxOutput = Number.isFinite(mechanics.maxOutput) && mechanics.maxOutput > 0 ? mechanics.maxOutput : DEFAULT_MAX_OUTPUT

  /** Run one literal argv. A missing or timed-out result is a failure with no output. */
  function exec (argv, opts) {
    let r
    try { r = run(argv, Object.assign({ timeoutMs, maxOutput }, opts || {})) } catch (e) { r = null }
    if (!r || typeof r !== 'object' || r.timedOut === true || !Number.isInteger(r.status)) {
      return { status: -1, stdout: '', stderr: '', failed: true }
    }
    return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), failed: false }
  }

  /**
   * ⛔ GONE REQUIRES POSITIVE ABSENCE — A TRI-STATE, NEVER A BOOLEAN.
   *
   * The first version asked "is the process present?" and treated every non-yes as gone. A
   * timed-out probe, a runner failure, a malformed result and an exit status of 2 all became
   * "the process vanished", which the verifier then skipped as holding nothing. Only a literal
   * exit status of 1 from `test -d /proc/<pid>` is absence. Everything else is UNKNOWN, and
   * UNKNOWN can only ever produce unreadable.
   */
  /**
   * ⛔ STATUS 1 IS NOT AUTOMATICALLY SEMANTIC.
   * exactWslExecRunner represents a spawn failure — wsl.exe missing, killed, unreachable — as
   * `status:1` with the error text in stderr. That is byte-for-byte the shape a clean
   * `test -d` returns for "absent", except for the stderr. So a probe answer is only semantic
   * when the command exited cleanly: status 0 or 1 AND empty stdout AND empty stderr. Any
   * output, any other status, any failure is UNKNOWN — and UNKNOWN never becomes gone/absent.
   */
  function probeSemantic (argv) {
    const r = exec(argv)
    if (r.failed || r.stdout !== '' || r.stderr !== '') return PRESENCE.UNKNOWN
    if (r.status === 0) return PRESENCE.PRESENT
    if (r.status === 1) return PRESENCE.ABSENT
    return PRESENCE.UNKNOWN
  }

  function pidPresence (pid) {
    return probeSemantic([BIN.test, '-d', '/proc/' + pid])
  }

  /** After a failed per-process read: gone ONLY for positive absence; present or unknown is unreadable. */
  function goneOrUnreadable (pid) {
    return pidPresence(pid) === PRESENCE.ABSENT ? GONE() : UNREADABLE()
  }

  /* ── 1. control group ── */
  function readControlGroup (cgroupPath) {
    if (typeof cgroupPath !== 'string' || !CGROUP_RE.test(cgroupPath)) return UNREADABLE()
    const dir = '/sys/fs/cgroup' + cgroupPath
    const r = exec([BIN.cat, dir + '/cgroup.procs'])
    if (r.failed) return UNREADABLE()
    if (r.status === 0) {
      const procs = parsePidLines(r.stdout)
      if (procs === null) return UNREADABLE()
      const o = data(); o.exists = true; o.procs = ownArray(procs); return o
    }
    // the read failed: absent and unreadable are different facts, established separately —
    // and absence is only a CLEAN status 1 (no output at all), never a status-1-shaped failure
    if (probeSemantic([BIN.test, '-e', dir]) === PRESENCE.ABSENT) { const o = data(); o.exists = false; return o }
    return UNREADABLE()
  }

  /* ── 2. pid list ── */
  function listPids () {
    const r = exec([BIN.find, '/proc', '-mindepth', '1', '-maxdepth', '1', '-type', 'd', '-print0'], { maxOutput: 4 * 1024 * 1024 })
    if (r.failed || r.status !== 0) return UNREADABLE()
    const pids = []
    for (const rec of nulRecords(r.stdout)) {
      if (!rec.startsWith('/proc/')) return UNREADABLE()
      const name = rec.slice(6)
      if (name === '' || name.indexOf('/') !== -1) return UNREADABLE()
      if (!/^[0-9]+$/.test(name)) continue // fs, sys, tty, … are not pids by definition
      // anything that CLAIMS to be a pid must be strictly canonical
      if (!CANONICAL_PID.test(name)) return UNREADABLE()
      const n = safeInt(name)
      if (n === null) return UNREADABLE()
      append(pids, n)
    }
    pids.sort((a, b) => a - b)
    const o = data(); o.pids = ownArray(pids); return o
  }

  /* ── 3. status ── */
  function readStatus (pid) {
    if (!isValidPid(pid)) return UNREADABLE()
    const r = exec([BIN.cat, '/proc/' + pid + '/status'])
    if (r.failed) return UNREADABLE()
    if (r.status !== 0) return goneOrUnreadable(pid)
    const uid = parseUidRow(r.stdout)
    if (uid === null || uid < 0) return UNREADABLE()
    const o = data(); o.ok = true; o.uid = uid; return o
  }

  /* ── 4. environ — the marker, and nothing else ── */
  function readEnviron (pid) {
    if (!isValidPid(pid)) return UNREADABLE()
    // ⛔ NUL-RECORD GREP: only records beginning with the marker key ever leave the distro.
    const r = exec([BIN.grep, '-z', '-a', '-e', '^' + MARKER_KEY + '=', '--', '/proc/' + pid + '/environ'])
    if (r.failed) return UNREADABLE()
    // ⛔ grep's exit 1 means "no match" ONLY as a clean result: no stdout, no stderr. The runner
    // represents a spawn failure as status 1 + stderr, and that must never read as "no marker".
    if (r.status === 1) {
      if (r.stdout !== '' || r.stderr !== '') return UNREADABLE()
      const o = data(); o.ok = true; o.marker = null; return o
    }
    if (r.status !== 0) return goneOrUnreadable(pid)
    const recs = nulRecords(r.stdout)
    if (recs.length !== 1) return UNREADABLE() // zero with status 0, or duplicates: both refused
    const rec = recs[0]
    if (!rec.startsWith(MARKER_KEY + '=')) return UNREADABLE()
    const marker = rec.slice(MARKER_KEY.length + 1)
    if (!SAFE_ID.test(marker)) return UNREADABLE()
    const o = data(); o.ok = true; o.marker = marker; return o
  }

  /* ── 5. cwd ── */
  function readCwd (pid) {
    if (!isValidPid(pid)) return UNREADABLE()
    const r = exec([BIN.readlink, '-z', '--', '/proc/' + pid + '/cwd'])
    if (r.failed) return UNREADABLE()
    if (r.status !== 0) return goneOrUnreadable(pid)
    // exactly one NUL-terminated record; the path is taken verbatim, never trimmed
    const s = r.stdout
    if (s.length < 2 || s[s.length - 1] !== '\0') return UNREADABLE()
    const cwd = s.slice(0, -1)
    if (cwd === '' || cwd.indexOf('\0') !== -1) return UNREADABLE()
    const o = data(); o.ok = true; o.cwd = cwd; return o
  }

  /* ── 6. fds ── */
  function readFds (pid) {
    if (!isValidPid(pid)) return UNREADABLE()
    const dir = '/proc/' + pid + '/fd'
    const r = exec([BIN.find, dir, '-mindepth', '1', '-maxdepth', '1', '-print0',
      '-exec', BIN.readlink, '-z', '--', '{}', ';'], { maxOutput: 4 * 1024 * 1024 })
    if (r.failed) return UNREADABLE()
    if (r.status !== 0) return goneOrUnreadable(pid)
    // a readlink failure inside -exec does not change find's status; it shows in stderr and
    // in the pairing. Either is enough to refuse the scan — never a partial list.
    if (r.stderr !== '') return goneOrUnreadable(pid)
    const fds = parseFdPairs(r.stdout, pid)
    if (fds === null) return goneOrUnreadable(pid)
    const o = data(); o.ok = true; o.fds = ownArray(fds); return o
  }

  /* ── 7. stat — the governed envelope/repo only ── */
  function statPath (p) {
    if (typeof p !== 'string' || !SANDBOX_PATH_RE.test(p)) return UNREADABLE()
    const r = exec([BIN.stat, '-c', '%d %i', '--', p])
    if (r.failed) return UNREADABLE()
    if (r.status === 0) {
      const m = /^([0-9]+) ([0-9]+)\n?$/.exec(r.stdout)
      if (!m || !CANONICAL_UINT.test(m[1]) || !CANONICAL_UINT.test(m[2])) return UNREADABLE()
      // ⛔ STRINGS. A 64-bit inode above 2^53 must stay exact.
      const o = data(); o.exists = true; o.dev = m[1]; o.ino = m[2]; return o
    }
    // absence is only a CLEAN status 1 from the separate probe; a status-1-shaped runner failure is not
    if (probeSemantic([BIN.test, '-e', p]) === PRESENCE.ABSENT) { const o = data(); o.exists = false; return o }
    return UNREADABLE()
  }

  /* ── 8. unit ── */
  function readUnit (unitName) {
    const m = typeof unitName === 'string' ? UNIT_RE.exec(unitName) : null
    if (!m) return UNREADABLE()
    const id = m[1]
    const r = exec([BIN.systemctl, '--user', 'show', '-p', 'LoadState,ActiveState,SubState,Result,Restart', '--', unitName])
    if (r.failed || r.status !== 0) return UNREADABLE()
    const props = parseShowProps(r.stdout)
    if (props === null || typeof props.LoadState !== 'string' || props.LoadState === '') return UNREADABLE()
    const exists = props.LoadState !== 'not-found'

    // the instance family, matched by systemd itself — a literal argv, never a shell glob
    const l = exec([BIN.systemctl, '--user', 'list-units', '--all', '--no-pager', '--output=json', '--',
      'aroma-oc-' + id + '.*', 'aroma-oc-' + id + '-*'])
    if (l.failed || l.status !== 0) return UNREADABLE()
    let listed
    try { listed = JSON.parse(l.stdout === '' ? '[]' : l.stdout) } catch (e) { return UNREADABLE() }
    if (!Array.isArray(listed)) return UNREADABLE()
    let successor = false
    for (const row of listed) {
      if (!row || typeof row !== 'object' || typeof row.unit !== 'string') return UNREADABLE()
      if (row.unit !== unitName) successor = true
    }

    const o = data()
    o.exists = exists
    o.successor = successor
    if (exists) {
      // an existing unit must state its restart policy; an empty one is not an answer
      if (typeof props.Restart !== 'string' || props.Restart === '') return UNREADABLE()
      o.restart = props.Restart
    }
    // diagnostic only — carried, never decided on
    if (typeof props.ActiveState === 'string') o.activeState = props.ActiveState
    if (typeof props.SubState === 'string') o.subState = props.SubState
    if (typeof props.Result === 'string') o.result = props.Result
    return o
  }

  /* ── the protected shared gateway ── */

  /**
   * Read-only state of the one instance that must never be touched. Never its environment.
   * Returns { unreadable:true } or a data object; a baseline is exactly this, captured before
   * a launch, and the gate compares a fresh reading to it.
   */
  function readProtectedGatewayState () {
    const r = exec([BIN.systemctl, '--user', 'show', '-p', 'Id,LoadState,ActiveState,SubState,MainPID,ControlGroup', '--', PROTECTED_UNIT])
    if (r.failed || r.status !== 0) return UNREADABLE()
    const p = parseShowProps(r.stdout)
    if (p === null || p.Id !== PROTECTED_UNIT || typeof p.LoadState !== 'string' ||
        typeof p.ActiveState !== 'string' || typeof p.SubState !== 'string') return UNREADABLE()
    if (typeof p.MainPID !== 'string' || !CANONICAL_UINT.test(p.MainPID)) return UNREADABLE()
    if (typeof p.ControlGroup !== 'string' || !p.ControlGroup.startsWith('/') ||
        p.ControlGroup.indexOf('..') !== -1 || p.ControlGroup.indexOf('\n') !== -1) return UNREADABLE()

    const c = exec([BIN.cat, '/sys/fs/cgroup' + p.ControlGroup + '/cgroup.procs'])
    if (c.failed || c.status !== 0) return UNREADABLE()
    const procs = parsePidLines(c.stdout)
    if (procs === null) return UNREADABLE()

    const s = exec([BIN.ss, '-ltnHp', 'sport', '=', ':' + PROTECTED_PORT])
    if (s.failed || s.status !== 0) return UNREADABLE()
    const listeners = parseSsListeners(s.stdout)
    if (listeners === null) return UNREADABLE()
    // ⛔ THE PORT IS VERIFIED FROM THE OUTPUT, NOT TRUSTED FROM THE FILTER. A row that does not
    // itself name :18789 is not a protected listener, whatever ss was asked.
    for (const l of listeners) if (!isProtectedLocal(l.local)) return UNREADABLE()

    const o = data()
    o.unit = PROTECTED_UNIT
    o.loadState = p.LoadState
    o.activeState = p.ActiveState
    o.subState = p.SubState
    o.mainPid = p.MainPID
    o.controlGroup = p.ControlGroup
    o.cgroupProcs = ownArray(procs.slice().sort((a, b) => a - b))
    o.listeners = ownArray(listeners.map((l) => { const x = data(); x.local = l.local; x.pids = ownArray(l.pids); return x }))
    return o
  }

  const sameInts = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
  const listenerKey = (l) => l.local + '@' + l.pids.join('+')
  const sameListeners = (a, b) => {
    const ka = a.map(listenerKey).sort(); const kb = b.map(listenerKey).sort()
    return ka.length === kb.length && ka.every((v, i) => v === kb[i])
  }

  /**
   * The verifier's safety gate. Re-reads the gateway every time and answers a LITERAL
   * boolean: true only when the fresh reading is itself a valid, healthy snapshot (the same
   * rules the baseline had to pass) AND identical to the baseline in MainPID, control group,
   * exact cgroup membership and the :18789 listener set — every listener pid being the
   * gateway's own MainPID. Unreadable is false. Anything unexpected is false. Port state here
   * is the protection gate only — never retirement authority.
   *
   * ⛔ THE GATE RETAINS ONLY THE DETACHED, VALIDATED SNAPSHOT. The caller's baseline object is
   * read once, through snapshotProtectedBaseline, and never referenced again.
   */
  function createProtectedInstancesOk (baseline) {
    const base = snapshotProtectedBaseline(baseline)
    if (base === null) {
      throw new TypeError('createProtectedInstancesOk requires a valid, active gateway baseline captured before launch (own data only)')
    }
    return function protectedInstancesOk () {
      const cur = snapshotProtectedBaseline(readProtectedGatewayState())
      if (cur === null) return false
      if (cur.mainPid !== base.mainPid) return false
      if (cur.controlGroup !== base.controlGroup) return false
      if (!sameInts(cur.cgroupProcs, base.cgroupProcs)) return false
      if (!sameListeners(cur.listeners, base.listeners)) return false
      return true
    }
  }

  return Object.freeze({
    readControlGroup,
    listPids,
    readStatus,
    readEnviron,
    readCwd,
    readFds,
    statPath,
    readUnit,
    readProtectedGatewayState,
    createProtectedInstancesOk
  })
}

module.exports = {
  createOpenClawOsAdapters,
  // pure helpers, exported so tests can prove them directly
  parseUidRow,
  parsePidLines,
  parseFdPairs,
  parseShowProps,
  parseSsListeners,
  snapshotProtectedBaseline,
  isProtectedLocal,
  nulRecords,
  safeInt,
  ownArray,
  denseOwnArray,
  ownData,
  isDataObject,
  PRESENCE,
  BIN,
  MARKER_KEY,
  PROTECTED_UNIT,
  PROTECTED_PORT,
  SANDBOX_ROOT,
  EXECUTOR_UID_HIERARCHY,
  CGROUP_RE,
  UNIT_RE,
  SANDBOX_PATH_RE
}
