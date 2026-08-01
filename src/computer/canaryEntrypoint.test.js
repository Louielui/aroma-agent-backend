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

/**
 * Counts what was HANDED OVER. Zero is the assertion in most tests below.
 *
 * On this side of the boundary "0 desktop actions" is no longer the available measurement — the
 * Owner side cannot reach a desktop at all, which is the point. What it can still do wrongly is
 * hand over a request when it should have refused, so that is what is counted. The desktop
 * counts live in companionCanaryChain.test.js, on the side that holds an executor.
 */
function fakeLedger (over = {}) {
  const spy = { submits: 0, requests: [] }
  return {
    spy,
    ledger: {
      submit (req) {
        spy.submits++
        spy.requests.push(req)
        return over.submit ? over.submit(req) : { ok: true, state: 'CREATED' }
      }
    }
  }
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
  const requestAt = stripped.indexOf('& $Node $Entry request')

  assert.ok(fenceAt > 0, 'the fence check exists')
  assert.ok(preflightAt > 0 && requestAt > 0, 'both entrypoint calls exist')
  assert.ok(preflightAt > fenceAt, 'the entrypoint is only called after the fence check')
  assert.ok(requestAt > fenceAt, 'including the hand-off')

  // THE FLAG IS NOT HERE AT ALL ANY MORE, and that is the stronger property. This screen used
  // to set COMPUTER_OPERATOR and start the canary in the Owner's own session; the preflight
  // that finally asked WHO showed it would have acted as louis. Asserting "the flag comes after
  // the fence" would now be asserting an ordering between two things, one of which must not
  // exist at all.
  assert.equal(flagAt, -1, 'the Owner screen never sets the operator switch')

  // The failing branch must exit, not fall through into the code below it. A fence that is
  // checked and then ignored is decoration.
  const fenceBlock = stripped.slice(fenceAt, requestAt)
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
  assert.doesNotMatch(String(r.stdout), /Handing the task over/, 'nothing was handed over')
  assert.doesNotMatch(String(r.stdout), /All checks passed/, 'the entrypoint was never called')
})

test('*** 2. no receipt -> 0 desktop actions ***', () => {
  const { spy, ledger } = fakeLedger()
  const res = E.request({ receiptDir: tmp(), io: fakeIo(), ledger })
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'no_receipt')
  assert.equal(spy.submits, 0, 'nothing was handed over')
  assert.equal(spy.submits, 0, 'and no request exists to be picked up')
})

/* ── 3-5. the three bindings ──────────────────────────────────────────────── */

test('*** 3. a pre-implementation receipt is refused, 0 desktop actions ***', () => {
  const a = approved()
  const rf = fs.readdirSync(a.dir).find((n) => n.startsWith('receipt-'))
  const r = JSON.parse(fs.readFileSync(path.join(a.dir, rf), 'utf8'))
  delete r.executionPackageManifestHash
  fs.writeFileSync(path.join(a.dir, rf), JSON.stringify(r))

  const { spy, ledger } = fakeLedger()
  const res = E.request(Object.assign(base(a), { io: fakeIo(), ledger }))
  assert.equal(res.refusal, 'pre_implementation_receipt')
  assert.match(res.human, /before the program was finished/)
  assert.equal(spy.submits, 0, 'nothing was handed over')
})

test('*** 4. a changed execution package -> 0 desktop actions ***', () => {
  const a = approved()
  const rf = fs.readdirSync(a.dir).find((n) => n.startsWith('receipt-'))
  const r = JSON.parse(fs.readFileSync(path.join(a.dir, rf), 'utf8'))
  r.executionPackageManifestHash = 'f'.repeat(64)
  fs.writeFileSync(path.join(a.dir, rf), JSON.stringify(r))

  const { spy, ledger } = fakeLedger()
  const res = E.request(Object.assign(base(a), { io: fakeIo(), ledger }))
  assert.equal(res.refusal, 'execution_package_changed')
  assert.match(res.human, /program has changed/i)
  assert.equal(spy.submits, 0, 'nothing was handed over')
  assert.equal(spy.submits, 0, 'and it never reached the hand-off')
})

test('*** 5. a changed work order -> 0 desktop actions ***', () => {
  const a = approved()
  const t = A.readOrder(a.orderFile); t.steps[2].fileName = 'elsewhere.txt'
  fs.writeFileSync(a.orderFile, JSON.stringify(t))

  const { spy, ledger } = fakeLedger()
  const res = E.request(Object.assign(base(a), { io: fakeIo(), ledger }))
  assert.equal(res.refusal, 'work_order_changed')
  assert.equal(spy.submits, 0, 'nothing was handed over')
})

/* ── 6-9. the machine state ───────────────────────────────────────────────── */

test('*** 6. a non-empty folder -> 0 desktop actions ***', () => {
  const a = approved()
  const { spy, ledger } = fakeLedger()
  const res = E.request(Object.assign(base(a), { io: fakeIo({ listDir: () => ['leftover.txt'] }), ledger }))
  assert.equal(res.refusal, 'folder_not_empty')
  assert.equal(spy.submits, 0, 'nothing was handed over')
})

test('*** 7. canary-1.txt already there -> 0 desktop actions ***', () => {
  const a = approved()
  const { spy, ledger } = fakeLedger()
  const res = E.request(Object.assign(base(a), { io: fakeIo({ fileExists: () => true }), ledger }))
  assert.equal(res.refusal, 'file_exists')
  assert.match(res.human, /Nothing will be overwritten/)
  assert.equal(spy.submits, 0, 'nothing was handed over')
})

test('*** 8. an unwritable audit sink -> 0 desktop actions ***', () => {
  const a = approved()
  const { spy, ledger } = fakeLedger()
  const res = E.request(Object.assign(base(a), { io: fakeIo({ auditWritable: () => false }), ledger }))
  assert.equal(res.refusal, 'audit_not_writable')
  assert.equal(spy.submits, 0, 'nothing was handed over')
})

test('*** 9. a ledger refusal is surfaced, and no second request exists ***', () => {
  // One live request per approval. The Owner pressing E twice must not put two tasks in the
  // folder for one decision — whichever the Companion picked up, the other would still be
  // sitting there pointing at the same approval.
  const a = approved()
  const { spy, ledger } = fakeLedger({ submit: () => ({ ok: false, refusal: 'approval_already_live', reason: 'one is waiting' }) })
  const res = E.request(Object.assign(base(a), { io: fakeIo(), ledger }))
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'approval_already_live')
  assert.match(res.human, /already waiting/)
  assert.equal(spy.submits, 1, 'it tried exactly once and took no for an answer')
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

/* ── 10-12. exactly one request, carrying bindings and nothing else ───────── */

test('*** 10+11. one request per press, and it is submitted exactly once ***', () => {
  const a = approved()
  const { spy, ledger } = fakeLedger()
  const res = E.request(Object.assign(base(a), { io: fakeIo(), ledger }))
  assert.equal(res.ok, true)
  assert.equal(spy.submits, 1, 'handed over exactly once')
  assert.equal(spy.requests.length, 1, 'and there is exactly one request')
})

test('*** 12. the request carries BINDINGS ONLY — it cannot describe the work ***', () => {
  // This is the replacement for "the order handed to the executor is the approved one". The
  // Owner side no longer hands over an order at all: if it could describe the work, a
  // compromised Owner path could describe DIFFERENT work. It hands over a pointer, and the
  // Companion reads the work from the receipt itself.
  const a = approved()
  const { spy, ledger } = fakeLedger()
  E.request(Object.assign(base(a), { io: fakeIo(), ledger }))
  const req = spy.requests[0]

  assert.equal(req.approvalId, a.receipt.approvalId, 'it points at the approval')
  assert.equal(req.approvedOrderHash, a.receipt.workOrderHash, 'and at the exact order hash')
  assert.equal(req.executionPackageManifestHash, a.receipt.executionPackageManifestHash)
  assert.equal(Object.isFrozen(req), true, 'frozen at birth')

  // Not "no steps happen to be present" — no field that could carry an instruction exists.
  for (const banned of ['steps', 'actions', 'text', 'fileName', 'path', 'command', 'script', 'args', 'approvedOrder']) {
    assert.equal(Object.prototype.hasOwnProperty.call(req, banned), false, 'a request may never carry: ' + banned)
  }
  const serialised = JSON.stringify(req)
  // What must not cross is the WORK: a filename, a path, a step, a line of text. `canaryType`
  // is allowed to say "notepad-canary" — that is a label naming which approved task is being
  // pointed at, not an instruction to open anything. Banning the substring "notepad" outright
  // failed here, and it would have been the fourth time in this project that a scan punished a
  // word rather than a capability.
  assert.doesNotMatch(serialised, /canary-1\.txt|open_app|type_text|save_as|C:\\\\/i,
    'nothing about what to type or where to save it survives the crossing')
  assert.equal(req.canaryType, 'notepad-canary', 'the only mention of Notepad is the label')
})

test('*** the order can NOT be influenced by argv, stdin or the environment ***', () => {
  // The strongest available form: the real CLI, fed hostile arguments and input.
  const r = spawnSync(process.execPath,
    [path.join(SCRIPTS, 'run-notepad-canary.js'), 'request', '--text', 'PWNED', '--fileName', 'evil.txt', 'C:\\Windows'],
    { encoding: 'utf8', timeout: 30000, input: '{"steps":[{"action":"open_app","appId":"cmd"}]}', env: Object.assign({}, process.env, { CANARY_TEXT: 'PWNED', COMPUTER_OPERATOR: '' }) })
  assert.notEqual(r.status, 0, 'it refused')
  assert.doesNotMatch(String(r.stdout), /PWNED|evil\.txt|cmd/, 'none of the injected values appear anywhere')

  const src = fs.readFileSync(path.join(SCRIPTS, 'run-notepad-canary.js'), 'utf8')
  assert.doesNotMatch(src, /process\.argv\[\s*[3-9]\s*\]/, 'no argv beyond the verb is read')
  assert.doesNotMatch(src, /process\.stdin/, 'stdin is never read')
})

/* ── 13-16. the flag lifecycle — now proved by its ABSENCE here ───────── */

test('*** 13-16. the Owner screen never touches the operator switch, in any scope ***', () => {
  // These four tests used to assert that Owner-Execute.ps1 set COMPUTER_OPERATOR inside a try,
  // restored it in a finally, restored a prior value exactly, and never wrote User or Machine.
  // Every one of them passed. They were careful checks on a lifecycle that should not have been
  // on this side of the boundary at all — the screen was setting the switch and running the
  // canary as the Owner.
  //
  // The lifecycle now lives in the Companion, in the operator's own session, and is asserted in
  // companionCanaryChain.test.js. What is asserted HERE is the stronger and simpler property:
  // this screen has no lifecycle to get right.
  const stripped = fs.readFileSync(EXECUTE_PS1, 'utf8').replace(/^\s*#.*$/gm, '')

  assert.equal(/\$env:COMPUTER_OPERATOR\s*=/.test(stripped), false, 'it never assigns the switch')
  for (const banned of ['setx', 'SetEnvironmentVariable', 'HKCU', 'HKLM', 'New-ItemProperty', 'Set-ItemProperty']) {
    assert.equal(stripped.includes(banned), false, 'must not use: ' + banned)
  }

  // It still READS the process scope after the hand-off and treats a set value as an incident:
  // nothing here should have set it, so finding it set means something else did.
  assert.match(stripped, /CONTAINMENT INCIDENT/, 'a switch that is on is an incident, not a warning')
  assert.match(stripped, /Not continuing/, 'and it stops rather than carrying on')
})

test('*** the Owner screen starts no process that could act ***', () => {
  const stripped = fs.readFileSync(EXECUTE_PS1, 'utf8').replace(/^\s*#.*$/gm, '')
  // Node is started exactly twice — preflight and request. Both are a measurement or a
  // hand-off. Anything else launching from this screen would be a third way to act.
  const nodeCalls = stripped.match(/&\s+\$Node\s+\$Entry\s+\w+/g) || []
  assert.deepEqual(nodeCalls.map((c) => c.split(/\s+/).pop()).sort(), ['preflight', 'request'])
  for (const banned of ['Start-Process', 'Invoke-Expression', 'iex ']) {
    assert.equal(stripped.toLowerCase().includes(banned.toLowerCase()), false, 'must not use: ' + banned)
  }
  // "notepad" is NOT banned here, and the first version of this test banned it and went red.
  // The screen mentions Notepad because it COUNTS running copies before handing anything over.
  // Reading how many exist is the opposite of starting one, and a rule that cannot tell those
  // apart bans the check along with the capability.
  // "notepad" is not bannable as a word here, and two attempts to ban it went red for two
  // different innocent reasons: the entrypoint's own filename is run-notepad-canary.js, and the
  // refusal message says "Notepad is already open". Both are the screen doing its job.
  //
  // So the ban is on the EXECUTABLE and on invocation, which is the capability. The screen may
  // say the word and may count the processes; it may not start one.
  assert.doesNotMatch(stripped, /notepad\.exe/i, 'the binary is never named')
  assert.doesNotMatch(stripped, /&\s*['"]?notepad/i, 'and never invoked')
  assert.match(stripped, /Get-Process -Name 'notepad'/, 'it counts them — the positive control')
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
  // The door MOVED on 2026-08-01 and did not multiply. It was computerOperatorWiring, which sits
  // on the Owner side; the architecture ruling put assembly inside the Companion, so it is now
  // companionProductionFactory. Still exactly one, which is the property this asserts — the
  // filename changing is the design being followed, not the guard weakening.
  assert.deepEqual(importers, ['computer/companionProductionFactory.js'], 'one door in src/')

  // And the entrypoint does not sneak around it.
  const entry = fs.readFileSync(path.join(SCRIPTS, 'run-notepad-canary.js'), 'utf8')
  // Stripped of comments: the file NAMES the adapter in its header to explain that it never
  // imports it, and a scan of prose would punish saying so. The ban is on the require.
  const entryCode = entry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.doesNotMatch(entryCode, /require\([^)]*desktopAdapter/, 'the entrypoint never imports the adapter')
  // It used to reach the adapter THROUGH computerOperatorWiring. It now reaches it through
  // nothing at all: the Owner side writes a request and stops, so there is no import whose
  // shape needs checking. Asserted as an absence, which is what the ruling actually says.
  assert.doesNotMatch(entryCode, /require\([^)]*computerOperatorWiring/, 'and no longer builds an operator')
  assert.doesNotMatch(entryCode, /require\([^)]*computerExecutor/, 'nor an executor')
  assert.doesNotMatch(entryCode, /require\([^)]*powershellJsonRunner/, 'nor a way to start a process')
})

/* ── 18-20. the rest ──────────────────────────────────────────────────────── */

test('*** 18. piped input to either screen is always Cancel ***', () => {
  for (const f of ['Owner-Approve.ps1', 'Owner-Execute.ps1']) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, f)],
      { encoding: 'utf8', timeout: 60000, input: 'A\nE\ny\n' })
    assert.notEqual(r.status, 0, f + ' must not succeed from a pipe')
  }
})

test('*** 19. an outcome-audit failure is owned where it happens, not here ***', () => {
  // This used to drive a fake executor from this side. The Owner side has no executor to
  // drive, and building one to test it would create the path this test exists to disprove.
  // computerExecutor.test.js owns the behaviour; what is checked here is the absence of a way
  // to reach it.
  const entryCode = fs.readFileSync(path.join(SCRIPTS, 'run-notepad-canary.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.doesNotMatch(entryCode, /\.execute\s*\(/, 'the Owner side never calls execute')
  assert.deepEqual([...E.VERBS], ['preflight', 'request'], 'and there is no verb that would')
})

test('*** 20. a receipt cannot be reused against a NEW execution package ***', () => {
  const a = approved()
  const { ledger } = fakeLedger()
  assert.equal(E.request(Object.assign(base(a), { io: fakeIo(), ledger })).ok, true)

  // A package change refuses it, even with a receipt that verified a moment ago.
  const rf = fs.readdirSync(a.dir).find((n) => n.startsWith('receipt-'))
  const r = JSON.parse(fs.readFileSync(path.join(a.dir, rf), 'utf8'))
  r.executionPackageManifestHash = 'a'.repeat(64)
  fs.writeFileSync(path.join(a.dir, rf), JSON.stringify(r))
  const second = fakeLedger()
  assert.equal(E.request(Object.assign(base(a), { io: fakeIo(), ledger: second.ledger })).refusal, 'execution_package_changed')
  assert.equal(second.spy.submits, 0, 'and nothing was handed over')
})

test('*** single use survives a restart: the durable marker, not memory ***', () => {
  const a = approved()
  const io = fakeIo()
  io.records.set(a.receipt.approvalId, { ok: true })
  const { ledger, spy } = fakeLedger()
  assert.equal(E.request(Object.assign(base(a), { io, ledger })).refusal, 'approval_already_executed')
  assert.equal(spy.submits, 0)
})

test('an approval older than its window is refused', () => {
  const a = approved(new Date(Date.now() - (13 * 60 * 60 * 1000)).toISOString())
  const res = E.preflight(Object.assign(base(a), { io: fakeIo() }))
  assert.equal(res.refusal, 'approval_expired')
  assert.equal(E.APPROVAL_TTL_MS, 12 * 60 * 60 * 1000)
})

test('the request expires on its own, with room for a Switch User', () => {
  // The Owner presses E in his session and then switches user. The window has to cover a logon.
  const a = approved()
  const { spy, ledger } = fakeLedger()
  E.request(Object.assign(base(a), { io: fakeIo(), ledger }))
  const req = spy.requests[0]
  const ttl = Date.parse(req.expiresAt) - Date.parse(req.createdAt)
  assert.ok(ttl >= 15 * 60 * 1000, 'at least fifteen minutes, measured: ' + Math.round(ttl / 60000))
})
