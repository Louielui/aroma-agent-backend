'use strict'

/**
 * openClawOsAdapters.live.test.js — THE READERS, AGAINST THE REAL DISTRO, READ-ONLY.
 *
 * Nothing here starts, stops, writes or configures anything: systemctl show, /proc metadata,
 * cgroup.procs, stat, readlink, grep, ss. No systemd-run, no OpenClaw, no model. The shared
 * gateway (openclaw-gateway.service, :18789) is read as the protected instance and proven
 * byte-identical before and after — the one thing this file must not do is disturb it.
 *
 * ⛔ THE PRODUCTION RUNNER, WITH NOTHING INJECTED. The point of a live test is to measure the
 * real boundary; injecting a runner here would measure the test.
 *
 * Where the distro is absent the suite SKIPS rather than passing.
 */

const test = require('node:test')
const assert = require('node:assert')

const { exactWslExec, windowsArgvFor } = require('../agent/exactWslExecRunner')
const A = require('../agent/openClawOsAdapters')
const C = require('../agent/openClawReaderContracts')

function distroAvailable () {
  if (process.platform !== 'win32') return false
  const r = exactWslExec(['/usr/bin/test', '-d', '/home/openclaw'])
  return !!r && r.status === 0
}
const AVAILABLE = distroAvailable()
const opts = AVAILABLE ? {} : { skip: 'OpenClawGateway distro not available on this machine' }

/** The production adapters: nothing injected. */
const ad = A.createOpenClawOsAdapters()

/** Snapshot of the protected gateway, compared byte-for-byte at the end. */
const snapshot = () => JSON.stringify(ad.readProtectedGatewayState())
const BEFORE = AVAILABLE ? snapshot() : null

test('LIVE-A0. the exact runner is really the boundary (argv shape + a real read)', opts, () => {
  assert.deepStrictEqual(windowsArgvFor([A.BIN.test, '-d', '/proc']), ['-d', 'OpenClawGateway', '--exec', A.BIN.test, '-d', '/proc'])
  const r = exactWslExec([A.BIN.test, '-d', '/proc'])
  assert.strictEqual(r.status, 0)
})

test('LIVE-A1. the shared gateway state is readable without mutation, and its cgroup can be read', opts, () => {
  const s = ad.readProtectedGatewayState()
  assert.notStrictEqual(s.unreadable, true, 'the gateway must be readable for this proof')
  assert.strictEqual(s.unit, 'openclaw-gateway.service')
  assert.strictEqual(s.activeState, 'active')
  assert.match(s.mainPid, /^[1-9][0-9]*$/)
  assert.match(s.controlGroup, /^\/user\.slice\/user-1000\.slice\/user@1000\.service\/app\.slice\/openclaw-gateway\.service$/)
  assert.ok(s.cgroupProcs.includes(Number(s.mainPid)), 'MainPID is a member of its own cgroup')
  assert.ok(s.listeners.length >= 1, ':18789 is listening')
  for (const l of s.listeners) {
    assert.ok(l.pids.length >= 1, 'process ownership is present on every listener row')
    for (const p of l.pids) assert.strictEqual(String(p), s.mainPid, 'every :18789 listener claim is the gateway itself')
    assert.ok(l.local.endsWith(':18789'), 'the row itself names the protected port: ' + l.local)
    assert.ok(A.isProtectedLocal(l.local), 'and passes the strict local rule: ' + l.local)
  }
  // both currently measured forms are present and accepted
  const locals = s.listeners.map((l) => l.local).sort()
  assert.ok(locals.includes('127.0.0.1:18789'), 'IPv4 row present')
  assert.ok(locals.includes('[::1]:18789'), 'IPv6 row present')
  // ⛔ no environment field of any kind
  assert.ok(!Object.keys(s).some((k) => /env/i.test(k)))
})

test('LIVE-A2. the protected gate answers literal true against a fresh baseline, and re-reads each time', opts, () => {
  const baseline = ad.readProtectedGatewayState()
  const gate = ad.createProtectedInstancesOk(baseline)
  const v = gate()
  assert.strictEqual(v, true)
  assert.deepStrictEqual(C.parseProtectedResult(v), { kind: 'ok', clean: true })
  // an INTERNALLY INCONSISTENT baseline (MainPID not in its own cgroup) cannot even be built
  const inconsistent = Object.assign(Object.create(null), baseline, { mainPid: '1' })
  assert.throws(() => ad.createProtectedInstancesOk(inconsistent), TypeError)
  // a WRONG-PORT baseline cannot be built at all (the port is verified from the rows themselves)
  const wrongPort = Object.assign(Object.create(null), baseline, {
    listeners: baseline.listeners.map((l) => Object.assign(Object.create(null), { local: '127.0.0.1:1', pids: [...l.pids] }))
  })
  assert.throws(() => ad.createProtectedInstancesOk(wrongPort), TypeError)
  // a VALID baseline that differs from reality (right port, different address) is false —
  // proven without touching the gateway
  const differs = Object.assign(Object.create(null), baseline, {
    listeners: baseline.listeners.map((l) => Object.assign(Object.create(null), { local: '10.0.0.1:18789', pids: [...l.pids] }))
  })
  assert.strictEqual(ad.createProtectedInstancesOk(differs)(), false)
})

test('LIVE-A3. the pid list is canonical and ascending, and contains the gateway MainPID', opts, () => {
  const raw = ad.listPids()
  const p = C.parsePidListResult(raw)
  assert.strictEqual(p.kind, 'ok', JSON.stringify(raw).slice(0, 100))
  assert.ok(p.pids.length > 5)
  for (let i = 1; i < p.pids.length; i++) assert.ok(p.pids[i] > p.pids[i - 1], 'ascending')
  const gw = ad.readProtectedGatewayState()
  assert.ok(p.pids.includes(Number(gw.mainPid)))
})

test('LIVE-A4. readStatus on an observed pid: REAL uid 1000 for the gateway, 0 for pid 1', opts, () => {
  const gw = ad.readProtectedGatewayState()
  const pid = Number(gw.mainPid)
  assert.deepStrictEqual(C.parseStatusResult(ad.readStatus(pid)), { kind: 'ok', uid: 1000 })
  assert.deepStrictEqual(C.parseStatusResult(ad.readStatus(1)), { kind: 'ok', uid: 0 })
  // a pid that does not exist is GONE, positively
  assert.deepStrictEqual(C.parseStatusResult(ad.readStatus(4194000)), { kind: 'gone' })
})

test('LIVE-A5. readEnviron never exposes an environment: marker null on a same-uid process, unreadable on root, gone on absent', opts, () => {
  // a same-uid process that is NOT the protected gateway: the user manager or any uid-1000 pid
  const pids = C.parsePidListResult(ad.listPids()).pids
  const gw = Number(ad.readProtectedGatewayState().mainPid)
  const candidate = pids.find((pid) => pid !== gw && C.parseStatusResult(ad.readStatus(pid)).uid === 1000)
  assert.ok(candidate, 'a same-uid process other than the gateway exists')
  const raw = ad.readEnviron(candidate)
  assert.deepStrictEqual(Object.keys(raw).sort(), ['marker', 'ok'], 'exactly two keys — nothing else can ride along')
  assert.deepStrictEqual(C.parseEnvironResult(raw), { kind: 'ok', marker: null })
  assert.ok(!JSON.stringify(raw).includes('='), 'no KEY=VALUE material in the result')

  // root-owned pid 1: permission denied is UNREADABLE, never gone
  assert.deepStrictEqual(C.parseEnvironResult(ad.readEnviron(1)), { kind: 'unreadable' })
  // absent pid: gone
  assert.deepStrictEqual(C.parseEnvironResult(ad.readEnviron(4194000)), { kind: 'gone' })
})

test('LIVE-A6. readCwd and readFds on the gateway pid (read-only metadata), and on pid 1 (unreadable)', opts, () => {
  const pid = Number(ad.readProtectedGatewayState().mainPid)
  const cwd = C.parseCwdResult(ad.readCwd(pid))
  assert.strictEqual(cwd.kind, 'ok'); assert.ok(cwd.cwd.startsWith('/'))
  const fds = C.parseFdsResult(ad.readFds(pid))
  assert.strictEqual(fds.kind, 'ok'); assert.ok(fds.fds.length >= 3)
  assert.ok(fds.fds.every((f) => typeof f === 'string' && f !== ''))
  assert.deepStrictEqual(C.parseFdsResult(ad.readFds(1)), { kind: 'unreadable' }, 'root fds: unreadable, not gone')
  assert.deepStrictEqual(C.parseCwdResult(ad.readCwd(4194000)), { kind: 'gone' })
})

test('LIVE-A7. readControlGroup: an absent Aroma transient cgroup is exists:false; the protected path is refused', opts, () => {
  const absent = '/user.slice/user-1000.slice/user@1000.service/app.slice/aroma-oc-appr_x4b2_absent.service'
  assert.deepStrictEqual(C.parseControlGroupResult(ad.readControlGroup(absent)), { kind: 'ok', exists: false })
  // the gateway's own cgroup is not an Aroma transient unit: refused before any read
  const gw = ad.readProtectedGatewayState()
  assert.deepStrictEqual(C.parseControlGroupResult(ad.readControlGroup(gw.controlGroup)), { kind: 'unreadable' })
})

test('LIVE-A8. statPath: the sandbox root itself is refused; an absent envelope is exists:false; dev/ino are strings', opts, () => {
  assert.deepStrictEqual(C.parseStatResult(ad.statPath(A.SANDBOX_ROOT)), { kind: 'unreadable' })
  assert.deepStrictEqual(C.parseStatResult(ad.statPath(A.SANDBOX_ROOT + '/appr_x4b2_absent')), { kind: 'ok', exists: false })
  // if any envelope exists on this machine, its identity comes back as canonical strings
  const ls = exactWslExec([A.BIN.find, A.SANDBOX_ROOT, '-mindepth', '1', '-maxdepth', '1', '-type', 'd', '-print0'])
  const first = A.nulRecords(ls.stdout).map((p) => p.slice(A.SANDBOX_ROOT.length + 1)).find((n) => /^[A-Za-z0-9_-]{1,64}$/.test(n))
  if (first) {
    const st = C.parseStatResult(ad.statPath(A.SANDBOX_ROOT + '/' + first))
    assert.strictEqual(st.kind, 'ok'); assert.strictEqual(st.exists, true)
    assert.match(st.dev, /^(0|[1-9][0-9]*)$/); assert.match(st.ino, /^(0|[1-9][0-9]*)$/)
  }
})

test('LIVE-A9. readUnit through user systemd: a not-found Aroma unit is exists:false with no successor; a non-derived name is refused', opts, () => {
  const u = C.parseUnitResult(ad.readUnit('aroma-oc-appr_x4b2_absent.service'))
  assert.strictEqual(u.kind, 'ok'); assert.strictEqual(u.exists, false); assert.strictEqual(u.successor, false)
  assert.strictEqual(u.restart, null)
  assert.deepStrictEqual(C.parseUnitResult(ad.readUnit('openclaw-gateway.service')), { kind: 'unreadable' })
})

test('LIVE-A10. ⛔ nothing changed: the protected gateway is byte-identical before and after this file', opts, () => {
  const after = snapshot()
  assert.strictEqual(after, BEFORE, 'gateway state (MainPID, cgroup membership, :18789 listeners) must be unchanged')
  assert.ok(!after.includes('environ'))
})
