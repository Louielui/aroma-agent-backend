'use strict'

/**
 * exactWslExecRunner.test.js — THE CONSTRUCTED SPAWN CALL, PROVEN, NOT SCANNED.
 *
 * Every assertion here is about what reaches spawnSync: the launcher path, the exact argv,
 * the empty environment, shell:false, the bounds. Source-text scans are kept to the one
 * property a spawn fake cannot see (no shell-interpreted separator anywhere in the module).
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const R = require('../agent/exactWslExecRunner')

/** A spawn fake that records the call and answers like a healthy process. */
function recordingSpawn (answer = {}) {
  const calls = []
  const spawn = (exe, argv, opts) => {
    calls.push({ exe, argv, opts })
    return Object.assign({ status: 0, stdout: '', stderr: '' }, answer)
  }
  return { calls, spawn }
}

const LINUX = ['git', '-C', '/x', 'status']
const EXPECTED = ['-d', 'OpenClawGateway', '--exec', 'git', '-C', '/x', 'status']

/* ══════════════ the contract ══════════════ */

test('X1. the Windows argv for a Linux argv is EXACTLY -d <distro> --exec <argv>', () => {
  assert.deepStrictEqual(R.windowsArgvFor(LINUX), EXPECTED)
  const { calls, spawn } = recordingSpawn()
  R.createExactWslExecRunner({ spawn })(LINUX)
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].exe, 'C:\\Windows\\System32\\wsl.exe')
  assert.deepStrictEqual(calls[0].argv, EXPECTED)
})

test('X2. ⛔ no element of the spawn argv is the bare separator, and index 2 is --exec', () => {
  const { calls, spawn } = recordingSpawn()
  R.createExactWslExecRunner({ spawn })(['rm', '-rf', '--', '/home/openclaw/.aroma/sandboxes/x'])
  const argv = calls[0].argv
  assert.strictEqual(argv[2], '--exec', 'the third element is the exec flag')
  assert.notStrictEqual(argv[2], '--')
  // a LINUX-side `--` (git pathspec, rm safety) is a normal argument and passes through intact
  assert.deepStrictEqual(argv.slice(3), ['rm', '-rf', '--', '/home/openclaw/.aroma/sandboxes/x'])
})

test('X3. shell metacharacters stay ONE literal argv element', () => {
  const HOSTILE = 'A|B;C>D$HOME`id`'
  const { calls, spawn } = recordingSpawn()
  R.createExactWslExecRunner({ spawn })(['printf', '%s', HOSTILE, '&&', 'echo', 'SECOND'])
  const argv = calls[0].argv
  assert.strictEqual(argv[5], HOSTILE, 'the hostile element is delivered verbatim')
  assert.strictEqual(argv.length, 3 + 6, 'nothing was split or joined')
  assert.strictEqual(calls[0].opts.shell, false)
})

test('X4. an element with spaces stays ONE element', () => {
  const { calls, spawn } = recordingSpawn()
  R.createExactWslExecRunner({ spawn })(['printf', '%s|', 'a b', 'c'])
  assert.deepStrictEqual(calls[0].argv.slice(3), ['printf', '%s|', 'a b', 'c'])
})

test('X5. $HOME is not expanded and *.js is not glob-expanded', () => {
  const { calls, spawn } = recordingSpawn()
  R.createExactWslExecRunner({ spawn })(['echo', '$HOME', '*.js'])
  assert.deepStrictEqual(calls[0].argv.slice(3), ['echo', '$HOME', '*.js'])
  assert.strictEqual(calls[0].opts.shell, false, 'and no shell exists to expand them later')
})

test('X6. ⛔ the Windows environment handed to wsl.exe is EMPTY, whatever the parent holds', () => {
  const before = { s: process.env.AROMA_LIVE_SENTINEL, w: process.env.WSLENV }
  process.env.AROMA_LIVE_SENTINEL = 'must-not-cross'
  process.env.WSLENV = 'AROMA_LIVE_SENTINEL/u'
  try {
    const { calls, spawn } = recordingSpawn()
    R.createExactWslExecRunner({ spawn })(['true'])
    const env = calls[0].opts.env
    assert.deepStrictEqual(env, {}, 'env:{} — not inherited, not allowlisted')
    assert.strictEqual(env, R.CHILD_ENV, 'and it is the frozen constant itself')
    assert.ok(Object.isFrozen(R.CHILD_ENV))
    assert.ok(!('AROMA_LIVE_SENTINEL' in env) && !('WSLENV' in env))
  } finally {
    if (before.s === undefined) delete process.env.AROMA_LIVE_SENTINEL; else process.env.AROMA_LIVE_SENTINEL = before.s
    if (before.w === undefined) delete process.env.WSLENV; else process.env.WSLENV = before.w
  }
})

test('X7. shell is exactly false, windowsHide exactly true, encoding utf8', () => {
  const { calls, spawn } = recordingSpawn()
  R.createExactWslExecRunner({ spawn })(['true'])
  assert.strictEqual(calls[0].opts.shell, false)
  assert.strictEqual(calls[0].opts.windowsHide, true)
  assert.strictEqual(calls[0].opts.encoding, 'utf8')
})

test('X8. ⛔ the distro cannot be overridden by any option or argument', () => {
  const { calls, spawn } = recordingSpawn()
  // every plausible smuggling route: constructor option, per-call option, or a distro-shaped argv
  const run = R.createExactWslExecRunner({ spawn, distro: 'Ubuntu', DISTRO: 'Ubuntu' })
  run(['true'], { distro: 'Ubuntu', DISTRO: 'Ubuntu' })
  run(['-d', 'Ubuntu', 'true'])
  for (const c of calls) {
    assert.strictEqual(c.argv[0], '-d')
    assert.strictEqual(c.argv[1], 'OpenClawGateway')
  }
  // a '-d' inside the Linux argv is just an argument to the exec'd program, after --exec
  assert.deepStrictEqual(calls[1].argv, ['-d', 'OpenClawGateway', '--exec', '-d', 'Ubuntu', 'true'])
  assert.strictEqual(R.DISTRO, 'OpenClawGateway')
})

test('X9. ⛔ the launcher executable cannot be overridden', () => {
  const { calls, spawn } = recordingSpawn()
  const run = R.createExactWslExecRunner({ spawn, exe: 'C:\\evil\\wsl.exe', WSL_EXE: 'C:\\evil\\wsl.exe' })
  run(['true'], { exe: 'C:\\evil\\wsl.exe' })
  assert.strictEqual(calls[0].exe, 'C:\\Windows\\System32\\wsl.exe')
  assert.strictEqual(R.WSL_EXE, 'C:\\Windows\\System32\\wsl.exe')
})

test('X10. timeout and output stay bounded: defaults apply, and nothing can make them unbounded', () => {
  const { calls, spawn } = recordingSpawn()
  const run = R.createExactWslExecRunner({ spawn })
  run(['true'])
  assert.strictEqual(calls[0].opts.timeout, R.DEFAULT_TIMEOUT_MS)
  assert.strictEqual(calls[0].opts.maxBuffer, R.DEFAULT_MAX_OUTPUT)
  run(['true'], { timeoutMs: 5000, maxOutput: 4096 })
  assert.strictEqual(calls[1].opts.timeout, 5000)
  assert.strictEqual(calls[1].opts.maxBuffer, 4096)
  for (const bad of [0, -1, Infinity, NaN, null, 'forever', undefined]) {
    run(['true'], { timeoutMs: bad, maxOutput: bad })
    const o = calls[calls.length - 1].opts
    assert.strictEqual(o.timeout, R.DEFAULT_TIMEOUT_MS, 'timeout fallback for ' + String(bad))
    assert.strictEqual(o.maxBuffer, R.DEFAULT_MAX_OUTPUT, 'maxBuffer fallback for ' + String(bad))
  }
  assert.ok(Number.isFinite(R.DEFAULT_TIMEOUT_MS) && R.DEFAULT_TIMEOUT_MS > 0)
  assert.ok(Number.isFinite(R.DEFAULT_MAX_OUTPUT) && R.DEFAULT_MAX_OUTPUT > 0)
})

test('X11. a launcher that could not run is a FAILURE result, never a shell fallback', () => {
  const { spawn } = recordingSpawn({ status: null, error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) })
  const r = R.createExactWslExecRunner({ spawn })(['/nonexistent/bin'])
  assert.strictEqual(r.status, 1)
  assert.match(r.stderr, /ENOENT/)
  assert.strictEqual(r.timedOut, false)

  const t = recordingSpawn({ status: null, error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }) })
  const rt = R.createExactWslExecRunner({ spawn: t.spawn })(['sleep', '999'])
  assert.strictEqual(rt.timedOut, true)
  assert.strictEqual(rt.status, 1)
})

test('X12. the argv is validated before anything is spawned', () => {
  const { calls, spawn } = recordingSpawn()
  const run = R.createExactWslExecRunner({ spawn })
  // ['git', ['x']]: an element that HAS an indexOf but is not a string — the case that would
  // slip past a NUL check alone and reach spawn as an array.
  for (const bad of [undefined, null, 'git status', [], [''], [1], ['git', 2], ['git', 'a\0b'], [{}], ['git', ['x']], ['git', Symbol('s')]]) {
    assert.throws(() => run(bad), TypeError, JSON.stringify(bad))
  }
  assert.strictEqual(calls.length, 0, 'nothing reached spawn')
})

test('X13. the result shape is what the workspace has always consumed', () => {
  const { spawn } = recordingSpawn({ status: 3, stdout: 'out', stderr: 'err' })
  const r = R.createExactWslExecRunner({ spawn })(['true'])
  assert.deepStrictEqual(r, { status: 3, stdout: 'out', stderr: 'err', timedOut: false })
})

/* ══════════════ the one property a spawn fake cannot observe ══════════════ */

test('X14. ⛔ no shell-interpreted separator exists anywhere on the execution path', () => {
  const src = fs.readFileSync(path.join(__dirname, 'exactWslExecRunner.js'), 'utf8')
  // the only occurrences of the bare separator are its named constant and its documentation
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
  const bare = (code.match(/'--'/g) || []).length
  assert.strictEqual(bare, 1, "exactly one literal '--' — the BARE_SEPARATOR constant that names what is forbidden")
  assert.ok(!/\['-d',\s*DISTRO,\s*'--'\]/.test(code), 'the old prefix shape does not exist')
  assert.ok(/EXEC_FLAG\]\.concat/.test(code) || /'--exec'\]\.concat/.test(code), 'the prefix ends with the exec flag')
  assert.ok(!/shell:\s*true/.test(code))
  assert.ok(!/require\(['"]child_process['"]\)/.test(code) || /node:child_process/.test(code))
  assert.strictEqual(R.BARE_SEPARATOR, '--')
  assert.strictEqual(R.EXEC_FLAG, '--exec')
})

test('X15. the production runner is the exact runner with nothing injected', () => {
  assert.strictEqual(typeof R.exactWslExec, 'function')
  // it must build the same argv the injectable one does (pure part), without being called
  assert.deepStrictEqual(R.windowsArgvFor(['true']), ['-d', 'OpenClawGateway', '--exec', 'true'])
})
