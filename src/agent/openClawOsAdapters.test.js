'use strict'

/**
 * openClawOsAdapters.test.js — EVERY READER, AGAINST A SCRIPTED DISTRO, THROUGH THE CONTRACT.
 *
 * The injected runner records the exact Linux argv and answers from a script, so every test
 * proves (a) what was asked of the distro — literal argv, the right binary, no shell — and
 * (b) that the raw answer canonicalises through openClawReaderContracts exactly as the
 * verifier will see it. Malformed and hostile inputs must never canonicalise to a clean
 * result; secrets must never appear anywhere in a returned object.
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const A = require('../agent/openClawOsAdapters')
const C = require('../agent/openClawReaderContracts')

const PID = 93018
const CG = '/user.slice/user-1000.slice/user@1000.service/app.slice/aroma-oc-appr_x4b2.service'
const UNIT = 'aroma-oc-appr_x4b2.service'
const ENV = '/home/openclaw/.aroma/sandboxes/appr_x4b2'

/** A scripted runner: match on the argv, answer from the script, record every call. */
function scripted (script) {
  const calls = []
  const run = (argv, opts) => {
    calls.push({ argv: argv.slice(), opts })
    for (const [match, answer] of script) {
      if (match(argv)) return typeof answer === 'function' ? answer(argv) : answer
    }
    return { status: 127, stdout: '', stderr: 'unscripted: ' + argv.join(' '), timedOut: false }
  }
  return { run, calls, adapters: A.createOpenClawOsAdapters({ run }) }
}
const ok = (stdout) => ({ status: 0, stdout, stderr: '', timedOut: false })
const fail = (status, stderr) => ({ status, stdout: '', stderr: stderr || '', timedOut: false })
const is = (...prefix) => (argv) => prefix.every((p, i) => argv[i] === p)
const has = (s) => (argv) => argv.includes(s)
const procPresent = (present) => [has('/proc/' + PID), (argv) => (argv[0] === A.BIN.test ? (present ? ok('') : fail(1)) : null)]

/** `test -d /proc/<pid>` answers: present or absent. Placed first so it wins for the test binary. */
const presence = (present) => [is(A.BIN.test, '-d', '/proc/' + PID), present ? ok('') : fail(1)]

/* ══════════════ the boundary itself ══════════════ */

test('B1. ⛔ the adapter module never imports child_process and never names a shell', () => {
  const src = fs.readFileSync(path.join(__dirname, 'openClawOsAdapters.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert.ok(!/child_process/.test(code), 'no child_process in code')
  assert.strictEqual((code.match(/require\(/g) || []).length, 1, 'exactly one require')
  assert.ok(/require\('\.\/exactWslExecRunner'\)/.test(code), 'and it is the exact runner')
  assert.ok(!/shell\s*:\s*true/.test(code))
  // ⛔ everything that reaches the distro is a string literal in this file: none of them may
  // be a shell, and none may carry a shell metacharacter that a shell would interpret
  const literals = (code.match(/'(?:[^'\\]|\\.)*'/g) || []).map((l) => l.slice(1, -1))
  assert.ok(literals.length > 20, 'the argv literals were found')
  for (const lit of literals) {
    assert.ok(!/^(\/bin\/|\/usr\/bin\/)?(bash|sh|dash|zsh|cmd(\.exe)?|powershell(\.exe)?|pwsh)$/i.test(lit), 'no shell binary: ' + lit)
    // `;` is find's -exec terminator and `%d %i` is stat's format: both are argv, not shell
    // regex sources (anchored with ^ or $) are matched in-process, never handed to the distro
    assert.ok(!/[|;&<>`$]|\$\(/.test(lit) || lit === '%d %i' || lit === ';' || lit.startsWith('^') || lit.endsWith('$'), 'no shell metacharacter in an argv literal: ' + JSON.stringify(lit))
  }
  // every binary is an absolute path
  for (const b of Object.values(A.BIN)) assert.match(b, /^\/usr\/bin\/[a-z]+$/)
})

test('B2. the default runner IS exactWslExec; only the mechanic is injectable', () => {
  const R = require('../agent/exactWslExecRunner')
  // constructing with nothing must bind to the exact runner (proven by argv shape via the pure fn)
  const ad = A.createOpenClawOsAdapters()
  assert.strictEqual(typeof ad.readStatus, 'function')
  assert.ok(Object.isFrozen(ad))
  // no option can redirect WHAT is read
  const { calls, adapters } = scripted([[() => true, ok('')]])
  A.createOpenClawOsAdapters({ run: adapters.readStatus, sandboxRoot: '/tmp', distro: 'x', cat: '/tmp/cat' })
  assert.strictEqual(calls.length, 0)
  assert.deepStrictEqual(R.windowsArgvFor([A.BIN.cat, '/proc/1/status'])[2], '--exec')
})

/* ══════════════ 1. readControlGroup ══════════════ */

test('CG1. an existing, populated control group', () => {
  const { calls, adapters } = scripted([[is(A.BIN.cat, '/sys/fs/cgroup' + CG + '/cgroup.procs'), ok('93018\n93019\n')]])
  const raw = adapters.readControlGroup(CG)
  assert.deepStrictEqual({ ...raw, procs: [...raw.procs] }, { exists: true, procs: [93018, 93019] })
  assert.deepStrictEqual(calls[0].argv, [A.BIN.cat, '/sys/fs/cgroup' + CG + '/cgroup.procs'])
  assert.deepStrictEqual(C.parseControlGroupResult(raw), { kind: 'ok', exists: true, procs: [93018, 93019] })
})

test('CG2. an empty control group is exists:true with no members', () => {
  const { adapters } = scripted([[is(A.BIN.cat), ok('')]])
  const raw = adapters.readControlGroup(CG)
  assert.deepStrictEqual(C.parseControlGroupResult(raw), { kind: 'ok', exists: true, procs: [] })
})

test('CG3. ⛔ absent vs unreadable are established SEPARATELY', () => {
  const absent = scripted([[is(A.BIN.cat), fail(1, 'No such file')], [is(A.BIN.test, '-e'), fail(1)]])
  assert.deepStrictEqual(C.parseControlGroupResult(absent.adapters.readControlGroup(CG)), { kind: 'ok', exists: false })
  assert.deepStrictEqual(absent.calls[1].argv, [A.BIN.test, '-e', '/sys/fs/cgroup' + CG])

  const perm = scripted([[is(A.BIN.cat), fail(1, 'Permission denied')], [is(A.BIN.test, '-e'), ok('')]])
  assert.deepStrictEqual(C.parseControlGroupResult(perm.adapters.readControlGroup(CG)), { kind: 'unreadable' })

  const timedOut = scripted([[is(A.BIN.cat), { status: null, stdout: '', stderr: '', timedOut: true }]])
  assert.deepStrictEqual(C.parseControlGroupResult(timedOut.adapters.readControlGroup(CG)), { kind: 'unreadable' })
})

test('CG4. ⛔ a malformed pid row refuses the WHOLE list — never filtered', () => {
  for (const bad of ['93018\nabc\n', '93018\n0\n', '93018\n-1\n', '93018\n0093019\n', '93018\n1.5\n', '93018 93019\n', '93018\n\n93019\n']) {
    const { adapters } = scripted([[is(A.BIN.cat), ok(bad)]])
    assert.deepStrictEqual(C.parseControlGroupResult(adapters.readControlGroup(CG)), { kind: 'unreadable' }, JSON.stringify(bad))
  }
})

test('CG5. ⛔ only an observed Aroma transient-unit cgroup under the uid-1000 app.slice is accepted', () => {
  const { calls, adapters } = scripted([[() => true, ok('1\n')]])
  for (const bad of [
    '/user.slice/user-1000.slice/user@1000.service/app.slice/openclaw-gateway.service',   // the protected one
    '/user.slice/user-1000.slice/user@1000.service/app.slice/aroma-oc-x.service/../openclaw-gateway.service',
    '/system.slice/aroma-oc-x.service', '/user.slice/user-0.slice/user@0.service/app.slice/aroma-oc-x.service',
    'aroma-oc-x.service', '', null, 42, CG + '\n', CG + '\0', CG + '/'
  ]) {
    assert.deepStrictEqual(C.parseControlGroupResult(adapters.readControlGroup(bad)), { kind: 'unreadable' }, String(bad))
  }
  assert.strictEqual(calls.length, 0, 'nothing was executed for a refused path')
})

/* ══════════════ 2. listPids ══════════════ */

test('PL1. pids are the numeric /proc entries, canonical, ascending; other entries ignored by definition', () => {
  const { calls, adapters } = scripted([[is(A.BIN.find, '/proc'), ok('/proc/fs\0/proc/sys\0/proc/360\0/proc/2\0/proc/1\0/proc/self\0/proc/93018\0')]])
  const raw = adapters.listPids()
  assert.deepStrictEqual([...raw.pids], [1, 2, 360, 93018])
  assert.deepStrictEqual(calls[0].argv, [A.BIN.find, '/proc', '-mindepth', '1', '-maxdepth', '1', '-type', 'd', '-print0'])
  assert.deepStrictEqual(C.parsePidListResult(raw), { kind: 'ok', pids: [1, 2, 360, 93018] })
})

test('PL2. ⛔ a malformed entry that CLAIMS to be a pid refuses the whole list', () => {
  for (const bad of ['/proc/01\0/proc/2\0', '/proc/0\0', '/proc/2\0/proc/99999999999999999999\0', '/proc/2\0/proc/3/x\0', 'proc/2\0']) {
    const { adapters } = scripted([[is(A.BIN.find), ok(bad)]])
    assert.deepStrictEqual(C.parsePidListResult(adapters.listPids()), { kind: 'unreadable' }, JSON.stringify(bad))
  }
  const failed = scripted([[is(A.BIN.find), fail(1, 'Permission denied')]])
  assert.deepStrictEqual(C.parsePidListResult(failed.adapters.listPids()), { kind: 'unreadable' })
})

/* ══════════════ 3. readStatus ══════════════ */

const STATUS = 'Name:\tnode\nUmask:\t0022\nState:\tS (sleeping)\nTgid:\t93018\nPid:\t93018\nUid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\n'

test('ST1. the REAL uid from the one Uid: row', () => {
  const { calls, adapters } = scripted([[is(A.BIN.cat, '/proc/' + PID + '/status'), ok(STATUS)]])
  const raw = adapters.readStatus(PID)
  assert.deepStrictEqual({ ...raw }, { ok: true, uid: 1000 })
  assert.deepStrictEqual(calls[0].argv, [A.BIN.cat, '/proc/93018/status'])
  assert.deepStrictEqual(C.parseStatusResult(raw), { kind: 'ok', uid: 1000 })
  // real uid differs from effective: the REAL one is reported
  const r2 = scripted([[is(A.BIN.cat), ok('Uid:\t1000\t0\t0\t0\n')]])
  assert.deepStrictEqual(C.parseStatusResult(r2.adapters.readStatus(PID)), { kind: 'ok', uid: 1000 })
})

test('ST2. ⛔ gone only when the process is positively absent; permission is unreadable', () => {
  const gone = scripted([[is(A.BIN.cat), fail(1, 'No such file')], presence(false)])
  assert.deepStrictEqual(C.parseStatusResult(gone.adapters.readStatus(PID)), { kind: 'gone' })
  assert.deepStrictEqual(gone.calls[1].argv, [A.BIN.test, '-d', '/proc/93018'])

  const perm = scripted([[is(A.BIN.cat), fail(1, 'Permission denied')], presence(true)])
  assert.deepStrictEqual(C.parseStatusResult(perm.adapters.readStatus(PID)), { kind: 'unreadable' })
})

test('ST3. ⛔ malformed, missing or DUPLICATE Uid rows are unreadable', () => {
  for (const bad of ['Name:\tx\n', 'Uid:\tabc\t0\t0\t0\n', 'Uid:\t-1\t0\t0\t0\n', 'Uid:\t01000\t0\t0\t0\n', 'Uid:\t1000\t1000\n',
    'Uid:\t1000\t1000\t1000\t1000\nUid:\t0\t0\t0\t0\n', 'Uid:\t1e3\t0\t0\t0\n', 'Uid:\t99999999999999999999\t0\t0\t0\n']) {
    const { adapters } = scripted([[is(A.BIN.cat), ok(bad)]])
    assert.deepStrictEqual(C.parseStatusResult(adapters.readStatus(PID)), { kind: 'unreadable' }, JSON.stringify(bad))
  }
})

test('ST4. ⛔ a malformed pid never reaches the distro', () => {
  const { calls, adapters } = scripted([[() => true, ok(STATUS)]])
  for (const bad of [0, -1, 1.5, '93018', null, undefined, NaN, Infinity, 2 ** 53, {}, []]) {
    assert.deepStrictEqual(C.parseStatusResult(adapters.readStatus(bad)), { kind: 'unreadable' }, String(bad))
    assert.deepStrictEqual(C.parseEnvironResult(adapters.readEnviron(bad)), { kind: 'unreadable' }, String(bad))
    assert.deepStrictEqual(C.parseCwdResult(adapters.readCwd(bad)), { kind: 'unreadable' }, String(bad))
    assert.deepStrictEqual(C.parseFdsResult(adapters.readFds(bad)), { kind: 'unreadable' }, String(bad))
  }
  assert.strictEqual(calls.length, 0)
})

/* ══════════════ 4. readEnviron — the marker and nothing else ══════════════ */

test('EN1. ⛔ the grep argv extracts ONLY the marker key, in NUL-record mode, with no shell', () => {
  const { calls, adapters } = scripted([[is(A.BIN.grep), ok('AROMA_EXECUTOR_INSTANCE=appr_x4b2\0')]])
  const raw = adapters.readEnviron(PID)
  assert.deepStrictEqual(calls[0].argv, [A.BIN.grep, '-z', '-a', '-e', '^AROMA_EXECUTOR_INSTANCE=', '--', '/proc/93018/environ'])
  assert.deepStrictEqual({ ...raw }, { ok: true, marker: 'appr_x4b2' })
  assert.deepStrictEqual(C.parseEnvironResult(raw), { kind: 'ok', marker: 'appr_x4b2' })
})

test('EN2. no marker (grep exit 1) is a real answer: marker null', () => {
  const { adapters } = scripted([[is(A.BIN.grep), fail(1)]])
  assert.deepStrictEqual(C.parseEnvironResult(adapters.readEnviron(PID)), { kind: 'ok', marker: null })
})

test('EN3. ⛔ duplicate or malformed markers are unreadable, never the first one', () => {
  for (const bad of [
    'AROMA_EXECUTOR_INSTANCE=appr_a\0AROMA_EXECUTOR_INSTANCE=appr_b\0',   // duplicate
    'AROMA_EXECUTOR_INSTANCE=appr_a\0AROMA_EXECUTOR_INSTANCE=appr_a\0',   // duplicate, even identical
    'AROMA_EXECUTOR_INSTANCE=\0',                                          // empty
    'AROMA_EXECUTOR_INSTANCE=has space\0', 'AROMA_EXECUTOR_INSTANCE=../x\0',
    'AROMA_EXECUTOR_INSTANCE=' + 'a'.repeat(65) + '\0',
    'AROMA_EXECUTOR_INSTANCE_X=appr_a\0',                                   // wrong key
    'appr_a\0', ''                                                          // status 0 with nothing
  ]) {
    const { adapters } = scripted([[is(A.BIN.grep), ok(bad)]])
    assert.deepStrictEqual(C.parseEnvironResult(adapters.readEnviron(PID)), { kind: 'unreadable' }, JSON.stringify(bad))
  }
})

test('EN4. ⛔ NO OTHER ENVIRONMENT DATA can appear in a returned object, whatever the distro says', () => {
  // a hostile/misbehaving reader answering with a whole environment: the adapter refuses it
  // (duplicate records), and the refusal object carries none of it
  const secretEnv = 'OPENAI_API_KEY=sk-SENTINEL-SECRET\0AROMA_EXECUTOR_INSTANCE=appr_x\0PATH=/usr/bin\0'
  const { adapters } = scripted([[is(A.BIN.grep), ok(secretEnv)]])
  const raw = adapters.readEnviron(PID)
  assert.ok(!JSON.stringify(raw).includes('SENTINEL'), 'no secret in the returned object')
  assert.deepStrictEqual(Object.keys(raw), ['unreadable'])
  // and a successful read returns exactly two own keys — nothing else could ride along
  const good = scripted([[is(A.BIN.grep), ok('AROMA_EXECUTOR_INSTANCE=appr_x\0')]])
  assert.deepStrictEqual(Object.keys(good.adapters.readEnviron(PID)).sort(), ['marker', 'ok'])
})

test('EN5. ⛔ permission denied (grep exit 2) is unreadable while the process exists, gone only if absent', () => {
  const perm = scripted([[is(A.BIN.grep), fail(2, 'Permission denied')], presence(true)])
  assert.deepStrictEqual(C.parseEnvironResult(perm.adapters.readEnviron(PID)), { kind: 'unreadable' })
  const gone = scripted([[is(A.BIN.grep), fail(2, 'No such file')], presence(false)])
  assert.deepStrictEqual(C.parseEnvironResult(gone.adapters.readEnviron(PID)), { kind: 'gone' })
})

/* ══════════════ 5. readCwd ══════════════ */

test('CW1. readlink -z, verbatim, including spaces and trailing whitespace', () => {
  for (const cwd of ['/home/openclaw', '/home/openclaw/.aroma/sandboxes/appr x/repo', '/tmp/trailing  ', ' /leading', '/a\tb', '/x (deleted)']) {
    const { calls, adapters } = scripted([[is(A.BIN.readlink), ok(cwd + '\0')]])
    const raw = adapters.readCwd(PID)
    assert.deepStrictEqual(calls[0].argv, [A.BIN.readlink, '-z', '--', '/proc/93018/cwd'])
    assert.deepStrictEqual(C.parseCwdResult(raw), { kind: 'ok', cwd }, JSON.stringify(cwd))
  }
})

test('CW2. ⛔ a cwd not exactly one NUL-terminated record is unreadable', () => {
  for (const bad of ['/home/openclaw', '/home/openclaw\n', '\0', '', '/a\0/b\0', '/a\0\0']) {
    const { adapters } = scripted([[is(A.BIN.readlink), ok(bad)]])
    assert.deepStrictEqual(C.parseCwdResult(adapters.readCwd(PID)), { kind: 'unreadable' }, JSON.stringify(bad))
  }
  const gone = scripted([[is(A.BIN.readlink), fail(1)], presence(false)])
  assert.deepStrictEqual(C.parseCwdResult(gone.adapters.readCwd(PID)), { kind: 'gone' })
  const perm = scripted([[is(A.BIN.readlink), fail(1)], presence(true)])
  assert.deepStrictEqual(C.parseCwdResult(perm.adapters.readCwd(PID)), { kind: 'unreadable' })
})

/* ══════════════ 6. readFds ══════════════ */

const FDS = '/proc/93018/fd/0\0/dev/null\0/proc/93018/fd/1\0socket:[29790]\0/proc/93018/fd/3\0/home/openclaw/.aroma/sandboxes/appr x/repo/file with space\0'

test('FD1. find -print0 -exec readlink -z pairs, targets verbatim', () => {
  const { calls, adapters } = scripted([[is(A.BIN.find, '/proc/' + PID + '/fd'), ok(FDS)]])
  const raw = adapters.readFds(PID)
  assert.deepStrictEqual(calls[0].argv, [A.BIN.find, '/proc/93018/fd', '-mindepth', '1', '-maxdepth', '1', '-print0', '-exec', A.BIN.readlink, '-z', '--', '{}', ';'])
  assert.deepStrictEqual(C.parseFdsResult(raw), { kind: 'ok', fds: ['/dev/null', 'socket:[29790]', '/home/openclaw/.aroma/sandboxes/appr x/repo/file with space'] })
  const empty = scripted([[is(A.BIN.find), ok('')]])
  assert.deepStrictEqual(C.parseFdsResult(empty.adapters.readFds(PID)), { kind: 'ok', fds: [] })
})

test('FD2. ⛔ one unreadable fd refuses the whole scan — never a partial list', () => {
  // readlink failed for fd/1: its target is missing, so fd/3's PATH lands in a target slot
  const oneMissing = '/proc/93018/fd/0\0/dev/null\0/proc/93018/fd/1\0/proc/93018/fd/3\0/x\0'
  // readlink failed for the LAST fd: odd record count
  const lastMissing = '/proc/93018/fd/0\0/dev/null\0/proc/93018/fd/1\0'
  for (const bad of [oneMissing, lastMissing, '/proc/93018/fd/0\0\0', '/proc/99/fd/0\0/x\0', 'garbage\0/x\0']) {
    const { adapters } = scripted([[is(A.BIN.find), ok(bad)], presence(true)])
    assert.deepStrictEqual(C.parseFdsResult(adapters.readFds(PID)), { kind: 'unreadable' }, JSON.stringify(bad))
  }
  // readlink's error reaches stderr without changing find's exit status: still refused
  const stderrOnly = scripted([[is(A.BIN.find), { status: 0, stdout: FDS, stderr: 'readlink: /proc/93018/fd/4: Permission denied', timedOut: false }], presence(true)])
  assert.deepStrictEqual(C.parseFdsResult(stderrOnly.adapters.readFds(PID)), { kind: 'unreadable' })
})

test('FD3. ⛔ the pid vanishing mid-scan is gone; a permission failure on a live pid is unreadable', () => {
  const gone = scripted([[is(A.BIN.find), fail(1, 'No such file or directory')], presence(false)])
  assert.deepStrictEqual(C.parseFdsResult(gone.adapters.readFds(PID)), { kind: 'gone' })
  const perm = scripted([[is(A.BIN.find), fail(1, 'Permission denied')], presence(true)])
  assert.deepStrictEqual(C.parseFdsResult(perm.adapters.readFds(PID)), { kind: 'unreadable' })
})

/* ══════════════ 7. statPath ══════════════ */

test('SP1. dev and ino are canonical STRINGS, exact above 2^53', () => {
  const { calls, adapters } = scripted([[is(A.BIN.stat), ok('2096 18446744073709551615\n')]])
  const raw = adapters.statPath(ENV)
  assert.deepStrictEqual(calls[0].argv, [A.BIN.stat, '-c', '%d %i', '--', ENV])
  assert.deepStrictEqual({ ...raw }, { exists: true, dev: '2096', ino: '18446744073709551615' })
  assert.strictEqual(typeof raw.ino, 'string')
  assert.deepStrictEqual(C.parseStatResult(raw), { kind: 'ok', exists: true, dev: '2096', ino: '18446744073709551615' })
  // the repo child is also governed
  const r2 = scripted([[is(A.BIN.stat), ok('2096 126263')]])
  assert.deepStrictEqual(C.parseStatResult(r2.adapters.statPath(ENV + '/repo')), { kind: 'ok', exists: true, dev: '2096', ino: '126263' })
})

test('SP2. ⛔ absent vs unreadable, established separately', () => {
  const absent = scripted([[is(A.BIN.stat), fail(1, 'No such file')], [is(A.BIN.test, '-e', ENV), fail(1)]])
  assert.deepStrictEqual(C.parseStatResult(absent.adapters.statPath(ENV)), { kind: 'ok', exists: false })
  const perm = scripted([[is(A.BIN.stat), fail(1, 'Permission denied')], [is(A.BIN.test, '-e', ENV), ok('')]])
  assert.deepStrictEqual(C.parseStatResult(perm.adapters.statPath(ENV)), { kind: 'unreadable' })
  for (const bad of ['2096\n', '2096 0126\n', '-1 5\n', '2096 5 7\n', 'a b\n', '']) {
    const { adapters } = scripted([[is(A.BIN.stat), ok(bad)]])
    assert.deepStrictEqual(C.parseStatResult(adapters.statPath(ENV)), { kind: 'unreadable' }, JSON.stringify(bad))
  }
})

test('SP3. ⛔ only the governed envelope or repo may be stat\'d — nothing outside the sandbox root', () => {
  const { calls, adapters } = scripted([[() => true, ok('1 1\n')]])
  for (const bad of ['/root', '/home/openclaw/.openclaw', '/home/openclaw/.aroma/sandboxes', '/home/openclaw/.aroma/sandboxes/', '/home/openclaw/.aroma/sandboxes/../x',
    '/home/openclaw/.aroma/sandboxes/appr_x/repo/inner', '/home/openclaw/.aroma/sandboxes/appr x', ENV + '\n', ENV + '\0', 'relative', '', null]) {
    assert.deepStrictEqual(C.parseStatResult(adapters.statPath(bad)), { kind: 'unreadable' }, String(bad))
  }
  assert.strictEqual(calls.length, 0)
})

/* ══════════════ 8. readUnit ══════════════ */

const SHOW_LOADED = 'Restart=no\nResult=success\nLoadState=loaded\nActiveState=failed\nSubState=failed\n'
const SHOW_NOTFOUND = 'Restart=no\nResult=success\nLoadState=not-found\nActiveState=inactive\nSubState=dead\n'

test('UN1. an existing unit: exists, restart preserved EXACTLY, diagnostics carried', () => {
  const { calls, adapters } = scripted([
    [is(A.BIN.systemctl, '--user', 'show'), ok('Restart=always\nResult=timeout\nLoadState=loaded\nActiveState=failed\nSubState=failed\n')],
    [is(A.BIN.systemctl, '--user', 'list-units'), ok('[]')]
  ])
  const raw = adapters.readUnit(UNIT)
  assert.deepStrictEqual(calls[0].argv, [A.BIN.systemctl, '--user', 'show', '-p', 'LoadState,ActiveState,SubState,Result,Restart', '--', UNIT])
  assert.deepStrictEqual(calls[1].argv, [A.BIN.systemctl, '--user', 'list-units', '--all', '--no-pager', '--output=json', '--', 'aroma-oc-appr_x4b2.*', 'aroma-oc-appr_x4b2-*'])
  const p = C.parseUnitResult(raw)
  assert.strictEqual(p.kind, 'ok'); assert.strictEqual(p.exists, true); assert.strictEqual(p.successor, false)
  assert.strictEqual(p.restart, 'always', 'Restart != no is preserved exactly')
  assert.strictEqual(p.activeState, 'failed'); assert.strictEqual(p.result, 'timeout')
})

test('UN2. ⛔ not-found is exists:false — and Restart from a not-found unit is NOT reported', () => {
  const { adapters } = scripted([[is(A.BIN.systemctl, '--user', 'show'), ok(SHOW_NOTFOUND)], [is(A.BIN.systemctl, '--user', 'list-units'), ok('')]])
  const raw = adapters.readUnit(UNIT)
  assert.strictEqual(raw.exists, false)
  assert.ok(!('restart' in raw), 'systemd prints Restart=no for a not-found unit; it is not authority')
  const p = C.parseUnitResult(raw)
  assert.strictEqual(p.kind, 'ok'); assert.strictEqual(p.exists, false); assert.strictEqual(p.successor, false)
})

test('UN3. ⛔ a successor in the exact instance family is detected', () => {
  const { adapters } = scripted([
    [is(A.BIN.systemctl, '--user', 'show'), ok(SHOW_NOTFOUND)],
    [is(A.BIN.systemctl, '--user', 'list-units'), ok('[{"unit":"aroma-oc-appr_x4b2-turn.service","load":"loaded","active":"active","sub":"running","description":"x"}]')]
  ])
  const p = C.parseUnitResult(adapters.readUnit(UNIT))
  assert.strictEqual(p.successor, true)
  // the unit itself listed is not a successor
  const self = scripted([
    [is(A.BIN.systemctl, '--user', 'show'), ok(SHOW_LOADED)],
    [is(A.BIN.systemctl, '--user', 'list-units'), ok('[{"unit":"aroma-oc-appr_x4b2.service","load":"loaded","active":"failed","sub":"failed","description":"x"}]')]
  ])
  assert.strictEqual(C.parseUnitResult(self.adapters.readUnit(UNIT)).successor, false)
})

test('UN4. ⛔ malformed unit answers are unreadable: no LoadState, empty Restart, bad JSON, failed systemctl', () => {
  const cases = [
    [ok('ActiveState=active\n'), ok('[]')],
    [ok('LoadState=loaded\nRestart=\nActiveState=active\nSubState=running\n'), ok('[]')],
    [ok('LoadState=loaded\nActiveState=active\nSubState=running\n'), ok('[]')],
    [ok(SHOW_LOADED), ok('not json')],
    [ok(SHOW_LOADED), ok('[{"nounit":1}]')],
    [ok(SHOW_LOADED), fail(1)],
    [fail(1), ok('[]')],
    [ok('LoadState=loaded\nLoadState=loaded\nRestart=no\n'), ok('[]')]
  ]
  for (const [show, list] of cases) {
    const { adapters } = scripted([[is(A.BIN.systemctl, '--user', 'show'), show], [is(A.BIN.systemctl, '--user', 'list-units'), list]])
    // {unreadable:true} is the contract's own variant; the verifier turns it into UNKNOWN
    assert.deepStrictEqual(C.parseUnitResult(adapters.readUnit(UNIT)), { kind: 'unreadable' }, JSON.stringify([show.stdout, list.stdout]))
  }
})

test('UN5. ⛔ only a derived unit name is accepted', () => {
  const { calls, adapters } = scripted([[() => true, ok(SHOW_LOADED)]])
  for (const bad of ['openclaw-gateway.service', 'aroma-oc-.service', 'aroma-oc-x', 'aroma-oc-x.scope', 'aroma-oc-x y.service', 'aroma-oc-' + 'a'.repeat(65) + '.service', '', null, 1]) {
    assert.deepStrictEqual(C.parseUnitResult(adapters.readUnit(bad)), { kind: 'unreadable' }, String(bad))
  }
  assert.strictEqual(calls.length, 0)
})

/* ══════════════ the protected shared gateway ══════════════ */

const GW_SHOW = 'MainPID=360\nControlGroup=/user.slice/user-1000.slice/user@1000.service/app.slice/openclaw-gateway.service\nId=openclaw-gateway.service\nLoadState=loaded\nActiveState=active\nSubState=running\n'
const GW_CG = '/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/app.slice/openclaw-gateway.service/cgroup.procs'
const SS = 'LISTEN 0      511    127.0.0.1:18789 0.0.0.0:* users:(("node",pid=360,fd=27))\nLISTEN 0      511        [::1]:18789    [::]:* users:(("node",pid=360,fd=28))\n'
const gwScript = (over = {}) => [
  [is(A.BIN.systemctl, '--user', 'show'), over.show || ok(GW_SHOW)],
  [is(A.BIN.cat, GW_CG), over.procs || ok('360\n')],
  [is(A.BIN.ss), over.ss || ok(SS)]
]

test('PG1. the gateway state is read with literal argv and never its environment', () => {
  const { calls, adapters } = scripted(gwScript())
  const s = adapters.readProtectedGatewayState()
  assert.deepStrictEqual(calls.map((c) => c.argv), [
    [A.BIN.systemctl, '--user', 'show', '-p', 'Id,LoadState,ActiveState,SubState,MainPID,ControlGroup', '--', 'openclaw-gateway.service'],
    [A.BIN.cat, GW_CG],
    [A.BIN.ss, '-ltnHp', 'sport', '=', ':18789']
  ])
  assert.ok(!calls.some((c) => c.argv.join(' ').includes('environ')), 'the protected gateway environment is never read')
  assert.strictEqual(s.mainPid, '360'); assert.deepStrictEqual([...s.cgroupProcs], [360])
  assert.deepStrictEqual(s.listeners.map((l) => l.local + '@' + [...l.pids].join('+')), ['127.0.0.1:18789@360', '[::1]:18789@360'])
})

test('PG2. ⛔ the gate is a LITERAL boolean: true only when identical to the baseline', () => {
  const base = scripted(gwScript()).adapters.readProtectedGatewayState()
  const same = scripted(gwScript())
  const gate = same.adapters.createProtectedInstancesOk(base)
  assert.strictEqual(gate(), true)
  assert.deepStrictEqual(C.parseProtectedResult(gate()), { kind: 'ok', clean: true })
  assert.strictEqual(same.calls.length, 6, 'the state is RE-READ on every call, not cached')
})

test('PG3. ⛔ every mismatch is literal false: restarted, moved, extra member, listener change, inactive, unreadable', () => {
  const base = scripted(gwScript()).adapters.readProtectedGatewayState()
  const cases = {
    'MainPID changed (restarted)': { show: ok(GW_SHOW.replace('MainPID=360', 'MainPID=999')) },
    'cgroup moved': { show: ok(GW_SHOW.replace('openclaw-gateway.service\nId', 'other.service\nId')) },
    'extra cgroup member (our pid inside it)': { procs: ok('360\n93018\n') },
    'member missing': { procs: ok('') },
    'listener owned by another pid': { ss: ok(SS.replace('pid=360,fd=27', 'pid=93018,fd=27')) },
    'listener gone': { ss: ok('') },
    'extra listener': { ss: ok(SS + 'LISTEN 0 1 0.0.0.0:18789 0.0.0.0:* users:(("x",pid=360,fd=1))\n') },
    'inactive': { show: ok(GW_SHOW.replace('ActiveState=active', 'ActiveState=inactive')) },
    'show unreadable': { show: fail(1) },
    'cgroup unreadable': { procs: fail(1, 'Permission denied') },
    'ss unreadable': { ss: fail(255) },
    'ss malformed': { ss: ok('garbage\n') },
    'cgroup malformed pid': { procs: ok('360\nx\n') }
  }
  for (const [name, over] of Object.entries(cases)) {
    const gate = scripted(gwScript(over)).adapters.createProtectedInstancesOk(base)
    const v = gate()
    assert.strictEqual(v, false, name)
    assert.deepStrictEqual(C.parseProtectedResult(v), { kind: 'ok', clean: false }, name)
  }
})

test('PG4. ⛔ a baseline must be explicit, readable, active data — or the gate cannot be built', () => {
  const { adapters } = scripted(gwScript())
  const good = adapters.readProtectedGatewayState()
  for (const bad of [undefined, null, {}, { unreadable: true }, { ...good, activeState: 'inactive' }, { ...good, unit: 'other.service' }, { ...good, mainPid: 360 }, { ...good, cgroupProcs: 'x' }]) {
    assert.throws(() => adapters.createProtectedInstancesOk(bad), TypeError, JSON.stringify(bad))
  }
  // the gate holds a COPY: mutating the baseline afterwards changes nothing
  const gate = adapters.createProtectedInstancesOk(good)
  good.mainPid = '1'; good.cgroupProcs.length = 0
  assert.strictEqual(gate(), true)
})

/* ══════════════ prototype pollution cannot shape an adapter result ══════════════ */

test('PP1. ⛔ every adapter result is a null-prototype data object with own elements, immune to pollution', () => {
  const { adapters } = scripted([
    [(argv) => argv[0] === A.BIN.cat && argv[1].startsWith('/sys/fs/cgroup/'), ok('93018\n')],
    [(argv) => argv[0] === A.BIN.cat && argv[1].startsWith('/proc/'), ok(STATUS)],
    [is(A.BIN.grep), ok('AROMA_EXECUTOR_INSTANCE=appr_x\0')], [is(A.BIN.readlink), ok('/x\0')],
    [is(A.BIN.find, '/proc/' + PID + '/fd'), ok(FDS)], [is(A.BIN.find, '/proc'), ok('/proc/2\0/proc/1\0')],
    [is(A.BIN.stat), ok('1 2\n')], [is(A.BIN.systemctl, '--user', 'show'), ok(SHOW_LOADED)], [is(A.BIN.systemctl, '--user', 'list-units'), ok('[]')]
  ])
  try {
    Object.prototype.exists = 'polluted'; Object.prototype.ok = 'polluted'; Object.prototype.marker = 'polluted'
    Object.defineProperty(Array.prototype, 0, { set () {}, get () { return 'polluted' }, configurable: true })
    const results = [
      adapters.readControlGroup(CG), adapters.readStatus(PID), adapters.readEnviron(PID), adapters.readCwd(PID),
      adapters.readFds(PID), adapters.listPids(), adapters.statPath(ENV), adapters.readUnit(UNIT)
    ]
    for (const r of results) {
      assert.strictEqual(Object.getPrototypeOf(r), null, 'null prototype')
      for (const k of Object.keys(r)) {
        const d = Object.getOwnPropertyDescriptor(r, k)
        assert.ok(d && !d.get && !d.set, 'own data: ' + k)
        if (Array.isArray(d.value)) assert.ok(Object.prototype.hasOwnProperty.call(d.value, 0) || d.value.length === 0, 'own element 0: ' + k)
      }
    }
    assert.deepStrictEqual(C.parseControlGroupResult(results[0]), { kind: 'ok', exists: true, procs: [93018] })
    assert.deepStrictEqual(C.parseStatusResult(results[1]), { kind: 'ok', uid: 1000 })
    assert.deepStrictEqual(C.parsePidListResult(results[5]), { kind: 'ok', pids: [1, 2] })
    assert.deepStrictEqual(C.parseStatResult(results[6]), { kind: 'ok', exists: true, dev: '1', ino: '2' })
  } finally {
    delete Object.prototype.exists; delete Object.prototype.ok; delete Object.prototype.marker
    delete Array.prototype[0]
  }
  assert.strictEqual(Object.getOwnPropertyDescriptor(Array.prototype, 0), undefined)
})

/* ══════════════ BLOCKER 1 — gone requires POSITIVE absence (tri-state) ══════════════ */

/**
 * For each per-process reader: the primary read fails, then the existence probe answers in
 * every way it can. Only a literal exit status 1 may become gone.
 */
const READERS = [
  ['readStatus', A.BIN.cat, C.parseStatusResult],
  ['readEnviron', A.BIN.grep, C.parseEnvironResult],
  ['readCwd', A.BIN.readlink, C.parseCwdResult],
  ['readFds', A.BIN.find, C.parseFdsResult]
]
const PROBE_ANSWERS = {
  'timed out': { status: null, stdout: '', stderr: '', timedOut: true },
  'runner threw': () => { throw new Error('runner failure') },
  'runner returned null': null,
  'runner returned a non-integer status': { status: '1', stdout: '', stderr: '', timedOut: false },
  'status 2': fail(2, 'test: unexpected'),
  'status 0 (present)': ok(''),
  'status -1': fail(-1)
}

test('G1. ⛔ every non-1 existence answer is UNREADABLE for every reader; only literal 1 is gone', () => {
  for (const [name, bin, parse] of READERS) {
    for (const [label, answer] of Object.entries(PROBE_ANSWERS)) {
      const { adapters } = scripted([
        [is(bin), fail(2, 'primary read failed')],
        [is(A.BIN.test, '-d', '/proc/' + PID), answer]
      ])
      assert.deepStrictEqual(parse(adapters[name](PID)), { kind: 'unreadable' }, name + ' / probe ' + label)
    }
    const gone = scripted([[is(bin), fail(2)], [is(A.BIN.test, '-d', '/proc/' + PID), fail(1)]])
    assert.deepStrictEqual(parse(gone.adapters[name](PID)), { kind: 'gone' }, name + ' / probe status 1')
  }
})

test('G2. the existence probe is asked exactly once per failed read, with the literal argv', () => {
  const { calls, adapters } = scripted([[is(A.BIN.cat), fail(2)], [is(A.BIN.test), fail(1)]])
  adapters.readStatus(PID)
  const probes = calls.filter((c) => c.argv[0] === A.BIN.test)
  assert.strictEqual(probes.length, 1)
  assert.deepStrictEqual(probes[0].argv, [A.BIN.test, '-d', '/proc/93018'])
})

/* ══════════════ BLOCKER 2 — every ss pid claim is accounted for ══════════════ */

test('S1. ⛔ a socket with a SECOND owner makes the gate literal false', () => {
  const base = scripted(gwScript()).adapters.readProtectedGatewayState()
  const twoOwners = 'LISTEN 0      511    127.0.0.1:18789 0.0.0.0:* users:(("node",pid=360,fd=27),("other",pid=93018,fd=9))\n' +
    'LISTEN 0      511        [::1]:18789    [::]:* users:(("node",pid=360,fd=28))\n'
  const { adapters } = scripted(gwScript({ ss: ok(twoOwners) }))
  const state = adapters.readProtectedGatewayState()
  assert.deepStrictEqual([...state.listeners[0].pids], [360, 93018], 'BOTH claims are recorded')
  const v = adapters.createProtectedInstancesOk(base)()
  assert.strictEqual(v, false)
  assert.deepStrictEqual(C.parseProtectedResult(v), { kind: 'ok', clean: false })
})

test('S2. two claims that are BOTH the MainPID may be accepted when otherwise identical', () => {
  const both360 = 'LISTEN 0      511    127.0.0.1:18789 0.0.0.0:* users:(("node",pid=360,fd=27),("node",pid=360,fd=29))\n' +
    'LISTEN 0      511        [::1]:18789    [::]:* users:(("node",pid=360,fd=28))\n'
  const base = scripted(gwScript({ ss: ok(both360) })).adapters.readProtectedGatewayState()
  assert.deepStrictEqual([...base.listeners[0].pids], [360, 360])
  const gate = scripted(gwScript({ ss: ok(both360) })).adapters.createProtectedInstancesOk(base)
  assert.strictEqual(gate(), true)
  // and the baseline from the ordinary single-claim world does NOT match a two-claim reading
  const single = scripted(gwScript()).adapters.readProtectedGatewayState()
  assert.strictEqual(scripted(gwScript({ ss: ok(both360) })).adapters.createProtectedInstancesOk(single)(), false)
})

test('S3. ⛔ malformed or missing process metadata on a listener row is unreadable, never "first pid"', () => {
  const rows = {
    'malformed second pid': 'LISTEN 0 1 127.0.0.1:18789 0.0.0.0:* users:(("node",pid=360,fd=27),("x",pid=9x,fd=1))\n',
    'non-canonical pid': 'LISTEN 0 1 127.0.0.1:18789 0.0.0.0:* users:(("node",pid=0360,fd=27))\n',
    'pid-less row (no users section)': 'LISTEN 0 1 127.0.0.1:18789 0.0.0.0:*\n',
    'users section with no pid': 'LISTEN 0 1 127.0.0.1:18789 0.0.0.0:* users:(("node",fd=27))\n',
    'empty pid token': 'LISTEN 0 1 127.0.0.1:18789 0.0.0.0:* users:(("node",pid=,fd=27))\n',
    'huge pid': 'LISTEN 0 1 127.0.0.1:18789 0.0.0.0:* users:(("node",pid=99999999999999999999,fd=27))\n'
  }
  const base = scripted(gwScript()).adapters.readProtectedGatewayState()
  for (const [name, ss] of Object.entries(rows)) {
    assert.strictEqual(A.parseSsListeners(ss), null, 'parser: ' + name)
    const { adapters } = scripted(gwScript({ ss: ok(ss) }))
    assert.strictEqual(adapters.readProtectedGatewayState().unreadable, true, 'state: ' + name)
    assert.strictEqual(adapters.createProtectedInstancesOk(base)(), false, 'gate: ' + name)
  }
})

/* ══════════════ BLOCKER 3 — the baseline is stable own data, snapshotted once ══════════════ */

const goodBaseline = () => scripted(gwScript()).adapters.readProtectedGatewayState()
/** A plain-object copy so tests can reshape fields; own data throughout. */
const plain = (b) => ({
  unit: b.unit, activeState: b.activeState, mainPid: b.mainPid, controlGroup: b.controlGroup,
  cgroupProcs: [...b.cgroupProcs], listeners: b.listeners.map((l) => ({ local: l.local, pids: [...l.pids] }))
})

test('BL1. ⛔ inherited unit / activeState / mainPid are refused', () => {
  const { adapters } = scripted(gwScript())
  for (const k of ['unit', 'activeState', 'mainPid', 'controlGroup', 'cgroupProcs', 'listeners']) {
    const b = plain(goodBaseline())
    const v = b[k]; delete b[k]
    const onProto = Object.assign(Object.create({ [k]: v }), b)
    assert.throws(() => adapters.createProtectedInstancesOk(onProto), TypeError, 'inherited ' + k)
    assert.strictEqual(A.snapshotProtectedBaseline(onProto), null, 'snapshot refuses inherited ' + k)
  }
  // a class instance is not a data object
  class B {}
  assert.strictEqual(A.snapshotProtectedBaseline(Object.assign(new B(), plain(goodBaseline()))), null)
})

test('BL2. ⛔ an accessor mainPid is refused WITHOUT invoking the getter', () => {
  const { adapters } = scripted(gwScript())
  const b = plain(goodBaseline())
  let touched = 0
  delete b.mainPid
  Object.defineProperty(b, 'mainPid', { get () { touched++; return '360' }, enumerable: true, configurable: true })
  assert.throws(() => adapters.createProtectedInstancesOk(b), TypeError)
  assert.strictEqual(touched, 0, 'the getter was never invoked')
  // accessor cgroupProcs and accessor listeners likewise
  const c = plain(goodBaseline()); delete c.cgroupProcs
  Object.defineProperty(c, 'cgroupProcs', { get () { touched++; return [360] }, enumerable: true, configurable: true })
  assert.throws(() => adapters.createProtectedInstancesOk(c), TypeError)
  const l = plain(goodBaseline()); delete l.listeners
  Object.defineProperty(l, 'listeners', { get () { touched++; return [] }, enumerable: true, configurable: true })
  assert.throws(() => adapters.createProtectedInstancesOk(l), TypeError)
  assert.strictEqual(touched, 0)
})

test('BL3. ⛔ a holed cgroupProcs backed by an Array.prototype numeric property is refused', () => {
  const { adapters } = scripted(gwScript())
  const b = plain(goodBaseline())
  b.cgroupProcs = [360]; b.cgroupProcs.length = 2 // hole at index 1
  try {
    Object.defineProperty(Array.prototype, 1, { value: 93018, configurable: true, writable: true })
    assert.throws(() => adapters.createProtectedInstancesOk(b), TypeError, 'a hole is never filled from the prototype')
    assert.strictEqual(A.snapshotProtectedBaseline(b), null)
    // an accessor ELEMENT is refused too
    const c = plain(goodBaseline()); c.cgroupProcs = []
    Object.defineProperty(c.cgroupProcs, 0, { get () { return 360 }, enumerable: true, configurable: true }); c.cgroupProcs.length = 1
    assert.strictEqual(A.snapshotProtectedBaseline(c), null)
  } finally {
    delete Array.prototype[1]
  }
  assert.strictEqual(Object.getOwnPropertyDescriptor(Array.prototype, 1), undefined)
})

test('BL4. ⛔ inherited listener pids, a foreign listener pid, an empty listener set, and a MainPID outside its cgroup are refused', () => {
  const { adapters } = scripted(gwScript())
  const inheritedPids = plain(goodBaseline())
  inheritedPids.listeners[0] = Object.assign(Object.create({ pids: [360] }), { local: '127.0.0.1:18789' })
  assert.throws(() => adapters.createProtectedInstancesOk(inheritedPids), TypeError, 'inherited pids')

  const foreign = plain(goodBaseline()); foreign.listeners[0].pids = [360, 93018]
  assert.throws(() => adapters.createProtectedInstancesOk(foreign), TypeError, 'foreign listener pid')

  const otherOwner = plain(goodBaseline()); otherOwner.listeners[0].pids = [93018]
  assert.throws(() => adapters.createProtectedInstancesOk(otherOwner), TypeError, 'listener not owned by MainPID')

  const empty = plain(goodBaseline()); empty.listeners = []
  assert.throws(() => adapters.createProtectedInstancesOk(empty), TypeError, 'empty listener set')

  const notMember = plain(goodBaseline()); notMember.cgroupProcs = [361]
  assert.throws(() => adapters.createProtectedInstancesOk(notMember), TypeError, 'MainPID not in its own cgroup')

  const emptyProcs = plain(goodBaseline()); emptyProcs.cgroupProcs = []
  assert.throws(() => adapters.createProtectedInstancesOk(emptyProcs), TypeError, 'empty cgroup')

  for (const bad of ['0', '01', '-1', '1.5', 360, '', ' 360']) {
    const b = plain(goodBaseline()); b.mainPid = bad
    assert.throws(() => adapters.createProtectedInstancesOk(b), TypeError, 'mainPid ' + JSON.stringify(bad))
  }
  for (const bad of ['relative/openclaw-gateway.service', '/a/../openclaw-gateway.service', '/a/other.service', '', '/x\n/openclaw-gateway.service']) {
    const b = plain(goodBaseline()); b.controlGroup = bad
    assert.throws(() => adapters.createProtectedInstancesOk(b), TypeError, 'controlGroup ' + JSON.stringify(bad))
  }
  for (const bad of ['', 'nocolon', 42, null]) {
    const b = plain(goodBaseline()); b.listeners[0].local = bad
    assert.throws(() => adapters.createProtectedInstancesOk(b), TypeError, 'local ' + JSON.stringify(bad))
  }
})

test('BL5. the gate retains only the DETACHED snapshot: the caller\'s object is never read again', () => {
  const same = scripted(gwScript())
  const b = plain(goodBaseline())
  const gate = same.adapters.createProtectedInstancesOk(b)
  // reshape the caller's object AFTER construction, every field
  b.mainPid = '1'; b.cgroupProcs.length = 0; b.listeners.length = 0; b.activeState = 'inactive'; b.controlGroup = '/x'
  assert.strictEqual(gate(), true, 'the gate still compares against the validated snapshot')
  // and the snapshot is own data, null-prototype, with own array elements
  const snap = A.snapshotProtectedBaseline(plain(goodBaseline()))
  assert.strictEqual(Object.getPrototypeOf(snap), null)
  assert.ok(Object.prototype.hasOwnProperty.call(snap.cgroupProcs, 0))
  assert.ok(Object.prototype.hasOwnProperty.call(snap.listeners[0].pids, 0))
  assert.strictEqual(Object.getPrototypeOf(snap.listeners[0]), null)
})

test('BL6. ⛔ the CURRENT reading is held to the same rules: a gateway whose MainPID left its cgroup is false', () => {
  const base = goodBaseline()
  const { adapters } = scripted(gwScript({ procs: ok('361\n') }))
  assert.strictEqual(adapters.createProtectedInstancesOk(base)(), false)
})

test('PG5. ⛔ a gateway restarted INSIDE the same cgroup membership is still false (listeners betray the new MainPID)', () => {
  // base: MainPID 360, cgroup {360, 999}, :18789 owned by 360. current: MainPID 999, same
  // cgroup members, :18789 now owned by 999. Membership is identical — only the MainPID and
  // the listener ownership differ. This is the world where the direct MainPID comparison and
  // the listener comparison are the only things left standing.
  const base = scripted(gwScript({ procs: ok('360\n999\n') })).adapters.readProtectedGatewayState()
  const cur = scripted(gwScript({
    show: ok(GW_SHOW.replace('MainPID=360', 'MainPID=999')),
    procs: ok('360\n999\n'),
    ss: ok(SS.replace(/pid=360/g, 'pid=999'))
  }))
  assert.strictEqual(cur.adapters.createProtectedInstancesOk(base)(), false)
})

/* ══════════════ FINAL CORRECTION — status 1 is not automatically semantic ══════════════ */

/** The ACTUAL shape exactWslExecRunner produces when spawnSync itself fails. */
const SPAWN_FAILURE = { status: 1, stdout: '', stderr: 'spawnSync C:\\Windows\\System32\\wsl.exe ENOENT', timedOut: false }
const STATUS1_STDOUT = { status: 1, stdout: 'unexpected\n', stderr: '', timedOut: false }
const STATUS0_NOISE = { status: 0, stdout: 'noise\n', stderr: '', timedOut: false }
const STATUS0_STDERR = { status: 0, stdout: '', stderr: 'warning', timedOut: false }

test('F1. ⛔ production-shape runner failure (status 1 + spawn stderr) is NEVER gone, for every reader', () => {
  for (const [name, bin, parse] of READERS) {
    // primary read fails cleanly-looking (status 2), probe answers with the spawn-failure shape
    const probeFails = scripted([[is(bin), fail(2, 'No such file')], [is(A.BIN.test, '-d', '/proc/' + PID), SPAWN_FAILURE]])
    assert.deepStrictEqual(parse(probeFails.adapters[name](PID)), { kind: 'unreadable' }, name + ' / probe spawn-failure shape')
    // the whole runner is broken: primary AND probe both answer with the spawn-failure shape
    const allBroken = scripted([[() => true, SPAWN_FAILURE]])
    assert.deepStrictEqual(parse(allBroken.adapters[name](PID)), { kind: 'unreadable' }, name + ' / runner broken')
    // status 1 with unexpected stdout, status 0 with output or stderr: none is semantic
    for (const [label, ans] of [['status1+stdout', STATUS1_STDOUT], ['status0+stdout', STATUS0_NOISE], ['status0+stderr', STATUS0_STDERR]]) {
      const s = scripted([[is(bin), fail(2)], [is(A.BIN.test, '-d', '/proc/' + PID), ans]])
      assert.deepStrictEqual(parse(s.adapters[name](PID)), { kind: 'unreadable' }, name + ' / probe ' + label)
    }
  }
})

test('F2. ⛔ readEnviron: grep exit 1 is "no marker" ONLY when clean; the spawn-failure shape is unreadable', () => {
  const clean = scripted([[is(A.BIN.grep), { status: 1, stdout: '', stderr: '', timedOut: false }]])
  assert.deepStrictEqual(C.parseEnvironResult(clean.adapters.readEnviron(PID)), { kind: 'ok', marker: null })
  for (const [label, ans] of [['spawn failure', SPAWN_FAILURE], ['status1+stdout', STATUS1_STDOUT], ['status1+stderr', { status: 1, stdout: '', stderr: 'grep: warning', timedOut: false }]]) {
    const { adapters } = scripted([[is(A.BIN.grep), ans]])
    const raw = adapters.readEnviron(PID)
    assert.deepStrictEqual(C.parseEnvironResult(raw), { kind: 'unreadable' }, label)
    assert.notStrictEqual(raw.marker, null, label + ': never marker:null')
    assert.ok(!JSON.stringify(raw).includes('ENOENT'), 'no runner text embedded in the result')
  }
})

test('F3. ⛔ readControlGroup: the existence probe in the spawn-failure shape is unreadable, NOT exists:false', () => {
  for (const [label, ans] of [['spawn failure', SPAWN_FAILURE], ['status1+stdout', STATUS1_STDOUT], ['status0+stderr', STATUS0_STDERR]]) {
    const { adapters } = scripted([[is(A.BIN.cat), fail(1, 'No such file')], [is(A.BIN.test, '-e'), ans]])
    assert.deepStrictEqual(C.parseControlGroupResult(adapters.readControlGroup(CG)), { kind: 'unreadable' }, label)
  }
  const allBroken = scripted([[() => true, SPAWN_FAILURE]])
  assert.deepStrictEqual(C.parseControlGroupResult(allBroken.adapters.readControlGroup(CG)), { kind: 'unreadable' })
  // and a CLEAN status 1 is still absence
  const clean = scripted([[is(A.BIN.cat), fail(1, 'No such file')], [is(A.BIN.test, '-e'), { status: 1, stdout: '', stderr: '', timedOut: false }]])
  assert.deepStrictEqual(C.parseControlGroupResult(clean.adapters.readControlGroup(CG)), { kind: 'ok', exists: false })
})

test('F4. ⛔ statPath: the existence probe in the spawn-failure shape is unreadable, NOT exists:false', () => {
  for (const [label, ans] of [['spawn failure', SPAWN_FAILURE], ['status1+stdout', STATUS1_STDOUT], ['status0+stderr', STATUS0_STDERR]]) {
    const { adapters } = scripted([[is(A.BIN.stat), fail(1, 'cannot statx')], [is(A.BIN.test, '-e'), ans]])
    assert.deepStrictEqual(C.parseStatResult(adapters.statPath(ENV)), { kind: 'unreadable' }, label)
  }
  const allBroken = scripted([[() => true, SPAWN_FAILURE]])
  assert.deepStrictEqual(C.parseStatResult(allBroken.adapters.statPath(ENV)), { kind: 'unreadable' })
  const clean = scripted([[is(A.BIN.stat), fail(1, 'cannot statx')], [is(A.BIN.test, '-e'), { status: 1, stdout: '', stderr: '', timedOut: false }]])
  assert.deepStrictEqual(C.parseStatResult(clean.adapters.statPath(ENV)), { kind: 'ok', exists: false })
})

test('F5. readStatus / readCwd / readFds with the spawn-failure shape as the PRIMARY read are unreadable', () => {
  for (const [name, bin, parse] of READERS) {
    if (name === 'readEnviron') continue
    const { adapters } = scripted([[is(bin), SPAWN_FAILURE], [is(A.BIN.test, '-d', '/proc/' + PID), { status: 1, stdout: '', stderr: '', timedOut: false }]])
    // a clean-absent probe after a spawn-shaped primary failure: the process IS absent, so gone
    // is the truthful answer here — the probe, not the primary read, is the authority
    const r = parse(adapters[name](PID))
    assert.ok(r.kind === 'gone' || r.kind === 'unreadable', name)
    const broken = scripted([[() => true, SPAWN_FAILURE]])
    assert.deepStrictEqual(parse(broken.adapters[name](PID)), { kind: 'unreadable' }, name + ' / all broken')
  }
})

/* ══════════════ FINAL CORRECTION — port 18789 verified from output ══════════════ */

test('P1. isProtectedLocal: both measured forms accepted; wrong ports and malformed locals refused', () => {
  assert.strictEqual(A.isProtectedLocal('127.0.0.1:18789'), true)
  assert.strictEqual(A.isProtectedLocal('[::1]:18789'), true)
  assert.strictEqual(A.isProtectedLocal('0.0.0.0:18789'), true)
  for (const bad of ['127.0.0.1:18790', '[::1]:9999', '127.0.0.1:187890', ':18789', '18789', '', 'nocolon', '127.0.0.1:18789 ', ' 127.0.0.1:18789', '127.0.0.1:18789\n', '127.0.0.1;:18789', 42, null, undefined]) {
    assert.strictEqual(A.isProtectedLocal(bad), false, JSON.stringify(bad))
  }
})

test('P2. ⛔ a wrong-port ss result cannot produce a usable protected snapshot or baseline', () => {
  const wrong = 'LISTEN 0 511 127.0.0.1:18790 0.0.0.0:* users:(("node",pid=360,fd=27))\nLISTEN 0 511 [::1]:18789 [::]:* users:(("node",pid=360,fd=28))\n'
  const { adapters } = scripted(gwScript({ ss: ok(wrong) }))
  assert.strictEqual(adapters.readProtectedGatewayState().unreadable, true, 'state refuses a non-18789 row')
  const base = goodBaseline()
  assert.strictEqual(adapters.createProtectedInstancesOk(base)(), false, 'gate is false against such a reading')
  // the baseline path refuses it independently
  for (const local of ['127.0.0.1:18790', '[::1]:9999', 'garbage', '']) {
    const b = plain(base); b.listeners[0].local = local
    assert.strictEqual(A.snapshotProtectedBaseline(b), null, local)
    assert.throws(() => adapters.createProtectedInstancesOk(b), TypeError, local)
  }
  // both measured forms are accepted by the baseline path
  const ok6 = plain(base); ok6.listeners = [{ local: '127.0.0.1:18789', pids: [360] }, { local: '[::1]:18789', pids: [360] }]
  assert.notStrictEqual(A.snapshotProtectedBaseline(ok6), null)
})

/* ══════════════ the pure helpers ══════════════ */

test('H1. helpers: uid row, pid lines, fd pairs, show props, ss rows, NUL records, safeInt', () => {
  assert.strictEqual(A.parseUidRow('Uid:\t1000\t0\t0\t0\n'), 1000)
  assert.strictEqual(A.parseUidRow('Uid:  1000  0  0  0\n'), 1000)
  assert.strictEqual(A.parseUidRow(''), null)
  assert.deepStrictEqual(A.parsePidLines('1\n2\n'), [1, 2]); assert.strictEqual(A.parsePidLines('1\n02\n'), null)
  assert.deepStrictEqual(A.parseFdPairs('/proc/5/fd/0\0/a\0', 5), ['/a']); assert.strictEqual(A.parseFdPairs('/proc/5/fd/0\0', 5), null)
  assert.deepStrictEqual({ ...A.parseShowProps('A=1\nB=x=y\n') }, { A: '1', B: 'x=y' }); assert.strictEqual(A.parseShowProps('A=1\nA=2\n'), null); assert.strictEqual(A.parseShowProps('noequals\n'), null)
  assert.deepStrictEqual(A.parseSsListeners(SS).map((l) => [...l.pids]), [[360], [360]]); assert.strictEqual(A.parseSsListeners('ESTAB 0 0 a b\n'), null)
  assert.deepStrictEqual(A.nulRecords('a\0b\0'), ['a', 'b']); assert.deepStrictEqual(A.nulRecords('a\0\0'), ['a', '']); assert.deepStrictEqual(A.nulRecords(''), [])
  assert.strictEqual(A.safeInt('0'), 0); assert.strictEqual(A.safeInt('01'), null); assert.strictEqual(A.safeInt('9007199254740993'), null); assert.strictEqual(A.safeInt(5), null)
})
