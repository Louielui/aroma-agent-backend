'use strict'

/**
 * canaryEntrypoint.test.js — the fixed entrypoint and the flag lifecycle.
 *
 * No real adapter, no real child, no Notepad. Every "0 desktop actions" claim is asserted as a
 * COUNT on a fake, because a refusal that arrives after the typing is not a refusal.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const E = require('../../scripts/computer/run-notepad-canary')
const A = require('../../scripts/computer/ownerApproval')
const PKG = require('../../scripts/computer/executionPackage')

const SCRIPTS = path.resolve(__dirname, '..', '..', 'scripts', 'computer')
const EXECUTE_PS1 = path.join(SCRIPTS, 'Owner-Execute.ps1')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-entry-'))

/**
 * Script-level parameters, asked of the real PowerShell parser.
 *
 * A regex cannot tell `function Say { param(...) }` from a script param block without becoming
 * a parser, and the first version of this check in the sibling test failed exactly there. Kept
 * as a small local copy rather than imported across test files: a test that depends on another
 * test file's internals fails for reasons that have nothing to do with what it is testing.
 */
function scriptParamNames (file) {
  const ps = [
    '$e=$null;',
    `$ast=[System.Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$null,[ref]$e);`,
    'if($ast.ParamBlock -eq $null){ "" } else { ($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) -join "," }'
  ].join(' ')
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 60000 })
  assert.equal(r.status, 0, 'the parser ran: ' + (r.stderr || ''))
  return String(r.stdout).trim().split(',').filter(Boolean)
}

/** A world the test fully controls. Defaults are the happy path. */
function fakeIo (over = {}) {
  const io = {
    records: new Map(),
    flagScopes: () => ({ Process: null, User: null, Machine: null }),
    dirExists: () => true,
    fileExists: () => false,
    listDir: () => [],
    auditWritable: () => true,
    executionRecordExists: (id) => io.records.has(id),
    writeExecutionRecord: (id, r) => io.records.set(id, r)
  }
  return Object.assign(io, over)
}

/** Counts what reached a desktop. Zero is the assertion in most tests below. */
function fakeOperator (over = {}) {
  const spy = { builds: 0, executes: 0, ordersSeen: [], flagAtExecute: [], desktopActions: 0 }
  const build = (opts) => {
    spy.builds++
    spy.buildOpts = opts
    return {
      enabled: over.enabled === false ? false : true,
      reason: over.reason || null,
      executor: {
        execute: (order, o) => {
          spy.executes++
          spy.ordersSeen.push(order)
          spy.flagAtExecute.push(o && o.flagOn)
          if (over.execute) return over.execute(order, o)
          spy.desktopActions += 3
          return { ok: true, stepsRun: 3, desktopActions: 3 }
        }
      }
    }
  }
  return { spy, build }
}

/** A receipt dir with one valid v2 receipt, and the order file it was issued against. */
function approved (at) {
  const dir = tmp()
  const orderFile = path.join(dir, 'wo.json')
  fs.copyFileSync(A.DRAFT, orderFile)
  const { receipt } = A.issue({ receiptDir: dir, orderFile, at: at || new Date().toISOString() })
  return { dir, orderFile, receipt }
}

const base = (o = {}) => Object.assign({ receiptDir: o.dir, orderFile: o.orderFile, artifactStore: { write: () => ({}) }, runner: { run: () => ({ ok: true }) } }, o.extra)

/* ── 1-2. the fence and the missing receipt ───────────────────────────────── */

test('*** 1. the fence is checked BEFORE the flag and BEFORE the entrypoint ***', () => {
  // ── RESPONSIBILITY, narrowed 2026-07-31 ──────────────────────────────────
  // This used to also assert the fence's current VALUE. That was never this test's job, and
  // it made the value live in two files: locking or unlocking the fence meant editing three
  // places, and a pre-unlock check found exactly that. One of them would eventually be missed.
  //
  // The value is owned by ownerApprovalCeremony.test.js, which does nothing else.
  // What is owned HERE is the ORDERING, which holds whichever way the fence is set: the check
  // happens first, and nothing outside the file can route around it.
  const code = fs.readFileSync(EXECUTE_PS1, 'utf8')
  const stripped = code.replace(/^\s*#.*$/gm, '')

  const fenceAt = stripped.indexOf('if (-not $CANARY_EXECUTE_AUTHORISED)')
  const flagAt = stripped.indexOf("$env:COMPUTER_OPERATOR = 'on'")
  const preflightAt = stripped.indexOf('& $Node $Entry preflight')
  const runAt = stripped.indexOf('& $Node $Entry run')

  assert.ok(fenceAt > 0, 'the fence check exists')
  assert.ok(flagAt > 0 && preflightAt > 0 && runAt > 0, 'the flag and both entrypoint calls exist')
  assert.ok(flagAt > fenceAt, 'the flag is only ever set after the fence check')
  assert.ok(preflightAt > fenceAt, 'the entrypoint is only called after the fence check')
  assert.ok(runAt > fenceAt, 'including the run phase')

  // The failing branch must exit, not fall through into the code below it. A fence that is
  // checked and then ignored is decoration.
  const fenceBlock = stripped.slice(fenceAt, flagAt)
  assert.match(fenceBlock, /exit\s+4/, 'a shut fence exits rather than continuing')

  // Nothing outside the file can supply the value: not a parameter, not an environment
  // variable, not stdin, not a fallback assignment.
  assert.deepEqual(scriptParamNames(EXECUTE_PS1), [], 'no script parameter')
  assert.doesNotMatch(stripped, /\$env:[A-Za-z_]*CANARY/i, 'no environment variable')
  assert.doesNotMatch(stripped, /Read-Host|\[Console\]::In\b/, 'no stdin')
  const assignments = stripped.match(/\$CANARY_EXECUTE_AUTHORISED\s*=/g) || []
  assert.equal(assignments.length, 1, 'exactly one assignment — no fallback re-assignment')

  // And a scripted run reaches none of it, whichever way the fence is set: the interactivity
  // gate stops it earlier.
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', EXECUTE_PS1],
    { encoding: 'utf8', timeout: 60000, input: 'E\n' })
  assert.notEqual(r.status, 0, 'a scripted run must not succeed')
  assert.doesNotMatch(String(r.stdout), /Running\.\.\./, 'the flag was never set')
  assert.doesNotMatch(String(r.stdout), /All checks passed/, 'the entrypoint was never called')
})

test('*** 2. no receipt -> 0 desktop actions ***', () => {
  const { spy, build } = fakeOperator()
  const res = E.run({ receiptDir: tmp(), io: fakeIo(), buildComputerOperator: build })
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'no_receipt')
  assert.equal(spy.executes, 0)
  assert.equal(spy.desktopActions, 0)
})

/* ── 3-5. the three bindings ──────────────────────────────────────────────── */

test('*** 3. a pre-implementation receipt is refused, 0 desktop actions ***', () => {
  const a = approved()
  const rf = fs.readdirSync(a.dir).find((n) => n.startsWith('receipt-'))
  const r = JSON.parse(fs.readFileSync(path.join(a.dir, rf), 'utf8'))
  delete r.executionPackageManifestHash
  fs.writeFileSync(path.join(a.dir, rf), JSON.stringify(r))

  const { spy, build } = fakeOperator()
  const res = E.run(Object.assign(base(a), { io: fakeIo(), buildComputerOperator: build }))
  assert.equal(res.refusal, 'pre_implementation_receipt')
  assert.match(res.human, /before the program was finished/)
  assert.equal(spy.executes, 0)
})

test('*** 4. a changed execution package -> 0 desktop actions ***', () => {
  const a = approved()
  const rf = fs.readdirSync(a.dir).find((n) => n.startsWith('receipt-'))
  const r = JSON.parse(fs.readFileSync(path.join(a.dir, rf), 'utf8'))
  r.executionPackageManifestHash = 'f'.repeat(64)
  fs.writeFileSync(path.join(a.dir, rf), JSON.stringify(r))

  const { spy, build } = fakeOperator()
  const res = E.run(Object.assign(base(a), { io: fakeIo(), buildComputerOperator: build }))
  assert.equal(res.refusal, 'execution_package_changed')
  assert.match(res.human, /program has changed/i)
  assert.equal(spy.executes, 0)
  assert.equal(spy.builds, 0, 'it did not even build the operator')
})

test('*** 5. a changed work order -> 0 desktop actions ***', () => {
  const a = approved()
  const t = A.readOrder(a.orderFile); t.steps[2].fileName = 'elsewhere.txt'
  fs.writeFileSync(a.orderFile, JSON.stringify(t))

  const { spy, build } = fakeOperator()
  const res = E.run(Object.assign(base(a), { io: fakeIo(), buildComputerOperator: build }))
  assert.equal(res.refusal, 'work_order_changed')
  assert.equal(spy.executes, 0)
})

/* ── 6-9. the machine state ───────────────────────────────────────────────── */

test('*** 6. a non-empty folder -> 0 desktop actions ***', () => {
  const a = approved()
  const { spy, build } = fakeOperator()
  const res = E.run(Object.assign(base(a), { io: fakeIo({ listDir: () => ['leftover.txt'] }), buildComputerOperator: build }))
  assert.equal(res.refusal, 'folder_not_empty')
  assert.equal(spy.executes, 0)
})

test('*** 7. canary-1.txt already there -> 0 desktop actions ***', () => {
  const a = approved()
  const { spy, build } = fakeOperator()
  const res = E.run(Object.assign(base(a), { io: fakeIo({ fileExists: () => true }), buildComputerOperator: build }))
  assert.equal(res.refusal, 'file_exists')
  assert.match(res.human, /Nothing will be overwritten/)
  assert.equal(spy.executes, 0)
})

test('*** 8. an unwritable audit sink -> 0 desktop actions ***', () => {
  const a = approved()
  const { spy, build } = fakeOperator()
  const res = E.run(Object.assign(base(a), { io: fakeIo({ auditWritable: () => false }), buildComputerOperator: build }))
  assert.equal(res.refusal, 'audit_not_writable')
  assert.equal(spy.executes, 0)
  assert.equal(spy.builds, 0)
})

test('*** 9. a registry refusal is surfaced, and no desktop action follows ***', () => {
  const a = approved()
  const { spy, build } = fakeOperator({ execute: () => ({ ok: false, refusal: 'approval_id_already_used', desktopActions: 0 }) })
  const res = E.run(Object.assign(base(a), { io: fakeIo(), buildComputerOperator: build }))
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'approval_id_already_used')
  assert.equal(spy.desktopActions, 0)
})

test('the flag scopes are checked in preflight, and any of them set refuses', () => {
  const a = approved()
  for (const scope of ['Process', 'User', 'Machine']) {
    const scopes = { Process: null, User: null, Machine: null }
    scopes[scope] = 'on'
    const res = E.preflight(Object.assign(base(a), { io: fakeIo({ flagScopes: () => scopes }) }))
    assert.equal(res.refusal, 'flag_already_set', scope)
  }
})

/* ── 10-12. exactly once, and exactly the approved order ──────────────────── */

test('*** 10+11. buildComputerOperator once, executor.execute once ***', () => {
  const a = approved()
  const { spy, build } = fakeOperator()
  const res = E.run(Object.assign(base(a), { io: fakeIo(), buildComputerOperator: build }))
  assert.equal(res.ok, true)
  assert.equal(spy.builds, 1, 'built exactly once')
  assert.equal(spy.executes, 1, 'executed exactly once')
})

test('*** 12. the order handed to the executor is field-for-field the approved one ***', () => {
  const a = approved()
  const { spy, build } = fakeOperator()
  E.run(Object.assign(base(a), { io: fakeIo(), buildComputerOperator: build }))

  const passed = spy.ordersSeen[0]
  assert.deepEqual(passed, a.receipt.approvedOrder, 'deep equality with what the Owner approved')
  // And it is the receipt's object, not a reconstruction from the draft file.
  assert.equal(passed.approvalId, a.receipt.approvalId)
  assert.equal(passed.orderHash, a.receipt.workOrderHash)
  assert.equal(Object.isFrozen(passed), true, 'frozen — nothing downstream can decorate it')
  assert.equal(spy.flagAtExecute[0], true, 'and it is told the flag is on')
})

test('*** the order can NOT be influenced by argv, stdin or the environment ***', () => {
  // The strongest available form: the real CLI, fed hostile arguments and input.
  const r = spawnSync(process.execPath,
    [path.join(SCRIPTS, 'run-notepad-canary.js'), 'run', '--text', 'PWNED', '--fileName', 'evil.txt', 'C:\\Windows'],
    { encoding: 'utf8', timeout: 30000, input: '{"steps":[{"action":"open_app","appId":"cmd"}]}', env: Object.assign({}, process.env, { CANARY_TEXT: 'PWNED', COMPUTER_OPERATOR: '' }) })
  assert.notEqual(r.status, 0, 'it refused')
  assert.doesNotMatch(String(r.stdout), /PWNED|evil\.txt|cmd/, 'none of the injected values appear anywhere')

  const src = fs.readFileSync(path.join(SCRIPTS, 'run-notepad-canary.js'), 'utf8')
  assert.doesNotMatch(src, /process\.argv\[\s*[3-9]\s*\]/, 'no argv beyond the verb is read')
  assert.doesNotMatch(src, /process\.stdin/, 'stdin is never read')
})

/* ── 13-16. the flag lifecycle, asserted against the script ───────────────── */

test('*** 13+14. the flag is restored in a finally, on success AND on failure ***', () => {
  const code = fs.readFileSync(EXECUTE_PS1, 'utf8')
  const stripped = code.replace(/^\s*#.*$/gm, '')
  assert.match(stripped, /try\s*\{[\s\S]*\$env:COMPUTER_OPERATOR\s*=\s*'on'[\s\S]*\}\s*finally\s*\{/,
    'the set is inside a try whose finally restores')
  assert.match(stripped, /finally\s*\{[\s\S]*Remove-Item\s+Env:\\COMPUTER_OPERATOR/,
    'an originally-unset flag is REMOVED, not set to a string')
})

test('*** 15. an original value is restored exactly, not blanked ***', () => {
  const stripped = fs.readFileSync(EXECUTE_PS1, 'utf8').replace(/^\s*#.*$/gm, '')
  assert.match(stripped, /\$flagWasSet\s*=\s*\$null\s*-ne\s*\$env:COMPUTER_OPERATOR/, 'the prior state is captured')
  assert.match(stripped, /\$flagOriginal\s*=\s*\$env:COMPUTER_OPERATOR/, 'and so is the prior value')
  assert.match(stripped, /if\s*\(\$flagWasSet\)\s*\{\s*\$env:COMPUTER_OPERATOR\s*=\s*\$flagOriginal/, 'restored as itself')
  // Captured BEFORE the assignment, or it would capture 'on'.
  assert.ok(stripped.indexOf('$flagOriginal = $env:COMPUTER_OPERATOR') < stripped.indexOf("$env:COMPUTER_OPERATOR = 'on'"))
})

test('*** 16. User and Machine scopes are never written, by any mechanism ***', () => {
  const stripped = fs.readFileSync(EXECUTE_PS1, 'utf8').replace(/^\s*#.*$/gm, '')
  for (const banned of ['setx', 'SetEnvironmentVariable', 'HKCU', 'HKLM', 'New-ItemProperty', 'Set-ItemProperty']) {
    assert.equal(stripped.includes(banned), false, 'must not use: ' + banned)
  }
  // Both scopes are READ before and after, and compared — a silent change would be caught.
  assert.match(stripped, /GetEnvironmentVariable\('COMPUTER_OPERATOR',\s*'User'\)/)
  assert.match(stripped, /GetEnvironmentVariable\('COMPUTER_OPERATOR',\s*'Machine'\)/)
  assert.match(stripped, /CONTAINMENT INCIDENT/, 'and a failure to restore is an incident, not a warning')
  // Banning the WORD "retry" failed on the script's own sentence, "Not retrying." — a rule
  // aimed at the behaviour tripped on the honest disclaimer about that behaviour. Assert the
  // behaviour instead: the flag is turned on in exactly one place, so there is no loop that
  // re-attempts it.
  const sets = stripped.match(/\$env:COMPUTER_OPERATOR\s*=\s*'on'/g) || []
  assert.equal(sets.length, 1, 'the flag is turned on in exactly one place — no retry loop')
  assert.match(stripped, /Not retrying/, 'and the script says so to the Owner')
})

/* ── 17. no bypass ────────────────────────────────────────────────────────── */

test('*** 17. no production path reaches the adapter except through the wiring ***', () => {
  const SRC = path.resolve(__dirname, '..')
  const importers = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!e.name.endsWith('.js') || e.name.endsWith('.test.js')) continue
      if (/require\(['"][^'"]*desktopAdapter['"]\)/.test(fs.readFileSync(p, 'utf8'))) importers.push(path.relative(SRC, p).replace(/\\/g, '/'))
    }
  }
  walk(SRC)
  assert.deepEqual(importers, ['computer/computerOperatorWiring.js'], 'one door in src/')

  // And the entrypoint does not sneak around it.
  const entry = fs.readFileSync(path.join(SCRIPTS, 'run-notepad-canary.js'), 'utf8')
  // Stripped of comments: the file NAMES the adapter in its header to explain that it never
  // imports it, and a scan of prose would punish saying so. The ban is on the require.
  const entryCode = entry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.doesNotMatch(entryCode, /require\([^)]*desktopAdapter/, 'the entrypoint never imports the adapter')
  assert.match(entry, /computerOperatorWiring/, 'it goes through the wiring')
})

/* ── 18-20. the rest ──────────────────────────────────────────────────────── */

test('*** 18. piped input to either screen is always Cancel ***', () => {
  for (const f of ['Owner-Approve.ps1', 'Owner-Execute.ps1']) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, f)],
      { encoding: 'utf8', timeout: 60000, input: 'A\nE\ny\n' })
    assert.notEqual(r.status, 0, f + ' must not succeed from a pipe')
  }
})

test('*** 19. an outcome-audit failure stops later steps and cleans up ***', () => {
  // Owned by the executor, and asserted end-to-end from the entrypoint so the wiring cannot
  // quietly swallow it.
  const a = approved()
  const { spy, build } = fakeOperator({
    execute: () => ({ ok: false, refusal: 'audit_write_failed', phase: 'step-outcome', stepsRun: 1, desktopActions: 1, cleanup: 'attempted', auditChainComplete: false })
  })
  const res = E.run(Object.assign(base(a), { io: fakeIo(), buildComputerOperator: build }))
  assert.equal(res.ok, false)
  assert.equal(res.result.phase, 'step-outcome')
  assert.equal(res.result.cleanup, 'attempted')
  assert.equal(res.result.desktopActions, 1, 'step 1 happened; nothing after it did')
})

test('*** 20. a receipt cannot be reused against a NEW execution package ***', () => {
  const a = approved()
  const { build } = fakeOperator()
  const io = fakeIo()
  assert.equal(E.run(Object.assign(base(a), { io, buildComputerOperator: build })).ok, true)

  // Used once — the durable marker, not the in-memory registry, is what survives a restart.
  const again = E.run(Object.assign(base(a), { io, buildComputerOperator: build }))
  assert.equal(again.refusal, 'approval_already_executed')

  // And on a fresh machine state, a package change refuses it too.
  const io2 = fakeIo()
  const rf = fs.readdirSync(a.dir).find((n) => n.startsWith('receipt-'))
  const r = JSON.parse(fs.readFileSync(path.join(a.dir, rf), 'utf8'))
  r.executionPackageManifestHash = 'a'.repeat(64)
  fs.writeFileSync(path.join(a.dir, rf), JSON.stringify(r))
  assert.equal(E.run(Object.assign(base(a), { io: io2, buildComputerOperator: build })).refusal, 'execution_package_changed')
})

test('an approval older than its window is refused', () => {
  const a = approved(new Date(Date.now() - (13 * 60 * 60 * 1000)).toISOString())
  const res = E.preflight(Object.assign(base(a), { io: fakeIo() }))
  assert.equal(res.refusal, 'approval_expired')
  assert.equal(E.APPROVAL_TTL_MS, 12 * 60 * 60 * 1000)
})

test('the execution record is written whatever the outcome', () => {
  const a = approved()
  const io = fakeIo()
  const { build } = fakeOperator({ execute: () => ({ ok: false, refusal: 'step_failed' }) })
  E.run(Object.assign(base(a), { io, buildComputerOperator: build }))
  const rec = io.records.get(a.receipt.approvalId)
  assert.ok(rec, 'a failed run still consumes its authorisation')
  assert.equal(rec.ok, false)
  assert.equal(rec.executionPackageManifestHash, PKG.computePackageHash())
})
