'use strict'

/**
 * PAID STARTUP SMOKE MUST BE ASKED FOR. IT MAY NOT ARRIVE WITH A LOGIN.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE EVENT THIS EXISTS FOR — 2026-08-18, and it was not a mystery in the end.
 *
 *   00:37:31  Owner shuts the machine down from the Start menu (User32 1074)
 *   00:37:42  the user session is logged off, so PID 36564 dies with it
 *   06:54:30  next interactive logon (Winlogon 7001)
 *   06:55:08  Startup-folder shortcut runs the launcher, -Mode Startup  (+38s)
 *   06:55:11  /health matches, and the launcher then runs startupSmoke.js
 *   06:56:08  three real provider turns, PASS — nobody in the room, nobody asked
 *
 * AUTO-START IS NOT THE DEFECT. The launcher did every step correctly. The defect is the
 * word「then」on the fifth line: a successful unattended start implied paid model work.
 *
 * ⛔ AND THE SWITCH IS OPT-IN, NOT OPT-OUT. `-SkipSmoke` would have been one line shorter and
 * would have put the cost on whoever remembers to pass it — a logon shortcut written in July
 * cannot remember anything. Paid work fails toward OFF: no flag, no calls.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS IS A PARSE AND NOT A RUN, stated because「we did not execute it」is normally the
 * weaker choice and here it is not.
 *
 * The body cannot be executed under stubs. `Notify-Owner` is defined INSIDE the body, so a
 * harness cannot shadow it, and it calls MessageBox::Show, which BLOCKS until a human clicks
 * it — deliberately (a notifier may not report its own success). Every fail-closed path calls
 * it. A test that took a wrong turn would therefore hang forever rather than fail. The body
 * also hardcodes $Repo, port 8090 and C:\Aroma\xiangxiang.log, so a stub that missed would
 * touch live production.
 *
 * So the oracle is PowerShell's own parser — not grep, and not a brace-counter written here.
 * `[Parser]::ParseFile` reads the file without executing one statement of it, and the guard
 * chain around the smoke call is then a structural fact rather than a claim about text.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { SHIM_PATH, BODY_REL } = require('./launcherPin')

const REPO = path.resolve(__dirname, '..', '..')
const BODY = path.join(REPO, BODY_REL)

/**
 * The harness. It walks up from each command to collect the `if` conditions that dominate it,
 * which is the only way to say「this call is reachable only when X」without running anything.
 */
const HARNESS = `
param([string]$Path)
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)

function Get-Guards($node) {
  $g = @()
  $cur = $node
  while ($null -ne $cur.Parent) {
    $p = $cur.Parent
    if ($p -is [System.Management.Automation.Language.IfStatementAst]) {
      foreach ($cl in $p.Clauses) {
        if ([object]::ReferenceEquals($cl.Item2, $cur)) { $g += $cl.Item1.Extent.Text.Trim() }
      }
      if ($null -ne $p.ElseClause -and [object]::ReferenceEquals($p.ElseClause, $cur)) { $g += 'ELSE' }
    }
    $cur = $p
  }
  [array]::Reverse($g)
  return ,$g
}

function Has-Return($node) {
  $r = $node.FindAll({ param($n) $n -is [System.Management.Automation.Language.ReturnStatementAst] }, $true)
  return ($r.Count -gt 0)
}

function Gate($pattern) {
  $ifs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.IfStatementAst] }, $true)
  foreach ($i in $ifs) {
    $c = $i.Clauses[0]
    if ($c.Item1.Extent.Text -match $pattern) {
      return @{ found = $true; line = $c.Item1.Extent.StartLineNumber; hasReturn = (Has-Return $c.Item2); condition = $c.Item1.Extent.Text.Trim() }
    }
  }
  return @{ found = $false }
}

$cmds = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)

function Is-Nested($node) {
  # ⛔ ONE INVOCATION IS MORE THAN ONE CommandAst. \`Start-Process node -ArgumentList (Join-Path
  #    $Repo '...startupSmoke.js')\` is TWO commands to the parser: the Start-Process and the
  #    Join-Path inside its own argument. Counting nodes and calling the number 「invocations」
  #    is the mislabelled-count defect this repository keeps finding, so the nesting is
  #    reported and the caller counts the outermost.
  $cur = $node.Parent
  while ($null -ne $cur) {
    if ($cur -is [System.Management.Automation.Language.CommandAst]) { return $true }
    $cur = $cur.Parent
  }
  return $false
}

$smokeSites = @()
foreach ($c in $cmds) {
  if ($c.Extent.Text -match 'startupSmoke\\.js') {
    $smokeSites += @{ line = $c.Extent.StartLineNumber; guards = (Get-Guards $c); nested = (Is-Nested $c) }
  }
}

$nodeStart = @()
foreach ($c in $cmds) {
  if ($c.Extent.Text -match 'src/index\\.js') { $nodeStart += $c.Extent.StartLineNumber }
}

$checkouts = @()
foreach ($c in $cmds) {
  $elems = @($c.CommandElements | ForEach-Object { $_.Extent.Text })
  if ($elems -contains 'checkout') { $checkouts += $c.Extent.Text }
}

$params = @()
if ($null -ne $ast.ParamBlock) {
  foreach ($p in $ast.ParamBlock.Parameters) {
    $types = @($p.Attributes | ForEach-Object { $_.TypeName.Name })
    $params += @{
      name = $p.Name.VariablePath.UserPath
      attributes = $types
      hasDefault = ($null -ne $p.DefaultValue)
      default = $(if ($null -ne $p.DefaultValue) { $p.DefaultValue.Extent.Text } else { '' })
    }
  }
}

$runSmokeConditions = @()
$ifs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.IfStatementAst] }, $true)
foreach ($i in $ifs) {
  foreach ($cl in $i.Clauses) {
    if ($cl.Item1.Extent.Text -match '\\$RunSmoke') { $runSmokeConditions += $cl.Item1.Extent.Text.Trim() }
  }
}

$out = @{
  parseErrors        = @($errors | ForEach-Object { $_.Message })
  params             = $params
  smokeSites         = $smokeSites
  nodeStartLines     = $nodeStart
  checkoutCommands   = $checkouts
  runSmokeConditions = $runSmokeConditions
  branchGate         = (Gate "\\$branch -ne 'main'")
  foreignGate        = (Gate "\\$state -eq 'foreign'")
  keyGate            = (Gate 'IsNullOrEmpty\\(\\$key\\)')
  hubGate            = (Gate 'IsNullOrEmpty\\(\\$hub\\)')
  healthGate         = (Gate '^\\$ok$')
}
$out | ConvertTo-Json -Depth 8 -Compress
`

/** Parsed once — the harness executes nothing, so there is nothing to isolate between tests. */
let AST = null
function ast () {
  if (AST) return AST
  const file = path.join(os.tmpdir(), 'aroma-launcher-ast-' + process.pid + '.ps1')
  fs.writeFileSync(file, HARNESS, 'utf8')
  try {
    const raw = execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, '-Path', BODY],
      { encoding: 'utf8', timeout: 60000 })
    AST = JSON.parse(raw)
  } finally {
    try { fs.unlinkSync(file) } catch (e) { /* a leftover temp file must not fail a proof */ }
  }
  // ⛔ NOT SKIPPED IF THE PARSER IS MISSING. A skipped structural proof is a green that
  //    measured nothing — the exact shape this repository keeps finding. The launcher is a
  //    Windows artifact; if PowerShell cannot parse it here, this must go red.
  assert.deepEqual(AST.parseErrors, [], 'the launcher body must parse cleanly')
  return AST
}

const one = (v) => Array.isArray(v) ? v : (v === null || v === undefined ? [] : [v])

/** The invocations — outermost commands only. See Is-Nested in the harness for why. */
const invocations = () => one(ast().smokeSites).filter((s) => s.nested !== true)

/* ═══ THE CONTRACT ════════════════════════════════════════════════════════════ */

test('*** ⛔ -RunSmoke EXISTS, IS A SWITCH, AND DEFAULTS TO OFF ***', () => {
  const params = one(ast().params)
  const run = params.find((p) => p.name === 'RunSmoke')
  assert.ok(run, '⛔ the launcher has no -RunSmoke parameter — paid smoke is still unconditional')
  assert.ok(one(run.attributes).includes('switch'), '⛔ -RunSmoke must be a [switch]: ' + JSON.stringify(run.attributes))
  // A switch with no default value IS $false. A default would be a second place to get it wrong.
  assert.equal(run.hasDefault, false, '⛔ -RunSmoke carries a default (' + run.default + '); a switch must simply be absent')

  // ⛔ AND IT IS OPT-IN. An opt-out flag would satisfy every other assertion in this file.
  assert.equal(params.find((p) => p.name === 'SkipSmoke'), undefined,
    '⛔ -SkipSmoke exists: cost was put on the caller who must remember, which a shortcut cannot')

  // -Mode is untouched.
  const mode = params.find((p) => p.name === 'Mode')
  assert.ok(mode, 'the -Mode parameter must survive')
  assert.equal(mode.default, "'Open'", "-Mode's default must remain 'Open'")
})

test('*** ⛔ DEFAULT Startup RUNS SMOKE ZERO TIMES — the guard is $RunSmoke itself ***', () => {
  const sites = invocations()
  assert.equal(sites.length, 1, '⛔ startupSmoke.js is invoked from ' + sites.length + ' places; exactly one is provable')

  // ⛔ EVERY mention, nested ones included, must sit behind the flag — not just the one counted.
  for (const s of one(ast().smokeSites)) {
    assert.ok(one(s.guards).includes('$RunSmoke'),
      '⛔ a startupSmoke.js site at line ' + s.line + ' is NOT dominated by $RunSmoke: ' + JSON.stringify(s.guards))
  }
  // With the switch absent that condition is $false, so nothing there is reachable. Count = 0.
})

test('*** ⛔ HEALTH SUCCESS ALONE MUST NOT IMPLY SMOKE ***', () => {
  const guards = one(invocations()[0].guards)
  // Both must be present: $ok (it never smokes a dead server) AND $RunSmoke (nobody asked).
  assert.ok(guards.includes('$ok'), '⛔ smoke escaped the health gate: ' + JSON.stringify(guards))
  assert.ok(guards.includes('$RunSmoke'), '⛔ a healthy start still implies paid work: ' + JSON.stringify(guards))
  assert.deepEqual(guards, ['$ok', '$RunSmoke'],
    '⛔ the guard chain is not exactly [health, explicit request]: ' + JSON.stringify(guards))
})

test('*** ⛔ $RunSmoke GUARDS ONE THING ONLY — it may not gate a safety check ***', () => {
  const conds = one(ast().runSmokeConditions)
  assert.deepEqual(conds, ['$RunSmoke'],
    '⛔ $RunSmoke appears in ' + conds.length + ' conditions; a flag that reaches a second decision can turn one off')
})

/* ═══ EVERY GATE THAT WAS ALREADY THERE IS STILL IN FRONT ═════════════════════ */

test('*** ⛔ ALL FOUR FAIL-CLOSED GATES STILL PRECEDE THE START, AND THE SMOKE ***', () => {
  const a = ast()
  const nodeLine = Math.min(...one(a.nodeStartLines))
  const smokeLine = invocations()[0].line
  assert.ok(Number.isFinite(nodeLine), 'the node start command must still be findable')

  for (const [name, gate] of [['repo not on main', a.branchGate], ['foreign 8090', a.foreignGate],
    ['ANTHROPIC_API_KEY', a.keyGate], ['HUB_TOKEN', a.hubGate]]) {
    assert.equal(gate.found, true, '⛔ the ' + name + ' gate is gone')
    assert.equal(gate.hasReturn, true, '⛔ the ' + name + ' gate no longer returns — it stopped being fail-closed')
    assert.ok(gate.line < nodeLine, '⛔ the ' + name + ' gate no longer precedes the node start (' + gate.line + ' vs ' + nodeLine + ')')
    assert.ok(gate.line < smokeLine, '⛔ the ' + name + ' gate no longer precedes the smoke (' + gate.line + ' vs ' + smokeLine + ')')
  }
})

test('*** ⛔ A FAILED START CANNOT REACH THE SMOKE ***', () => {
  const a = ast()
  const smokeLine = invocations()[0].line
  assert.ok(Math.min(...one(a.nodeStartLines)) < smokeLine, 'the server must be started before it can be smoked')
  // The health gate exists and the smoke sits inside it; the dead-process and unhealthy
  // branches are its siblings and therefore cannot contain the call.
  assert.equal(a.healthGate.found, true, '⛔ the $ok health gate is gone')
  assert.ok(one(invocations()[0].guards).includes('$ok'), '⛔ the smoke left the health branch')
})

test('*** ⛔ NO AUTO-CHECKOUT WAS INTRODUCED ***', () => {
  // Deliberately a COMMAND-level check: the file says the words「never auto-checkout」in prose,
  // and a text search would either trip on the comment or be tuned until it stopped meaning
  // anything. The parser distinguishes a sentence from a call.
  assert.deepEqual(one(ast().checkoutCommands), [], '⛔ a checkout command appeared in the launcher')
})

/* ═══ THE FIXED ENTRY, AND WHAT IT DOES NOT SAY ═══════════════════════════════ */

test('*** ⛔ THE LOGIN SHORTCUT PATH IS SMOKE-FREE BY CONSTRUCTION ***', () => {
  /**
   * The chain is 香香.lnk → powershell -File C:\Aroma\xiangxiang.ps1 -Mode Startup → the body.
   * The shim forwards -Mode and nothing else, so it CANNOT pass -RunSmoke. That is the point:
   * the installed logon entry becomes smoke-free without touching the shortcut or the shim,
   * both of which sit outside the repository (the shim is hash-pinned in launcherPin.js).
   */
  const shim = fs.readFileSync(SHIM_PATH, 'utf8')
  assert.match(shim, /& \$body -Mode \$Mode/, 'the shim must still hand off with -Mode only')
  assert.doesNotMatch(shim, /RunSmoke/, 'the shim must NOT forward -RunSmoke; the logon path may not opt into cost')
})

test('*** THE SKIP IS SAID OUT LOUD, NOT INFERRED FROM SILENCE ***', () => {
  const body = fs.readFileSync(BODY, 'utf8')
  assert.ok(/startup smoke skipped/.test(body),
    'a skipped smoke must write its own log line — otherwise a start that paid and a start that did not read identically')
})

test('*** ⛔ THE STALE COST CLAIM IS GONE, AND NOT REPLACED BY ANOTHER GUESS ***', () => {
  /**
   * The comment said「Costs two model calls per start」. The 2026-08-18 forensic measured THREE
   * visible cases, one of which performed a read — and no telemetry anywhere pins the real
   * provider call count for the smoke process. A number nobody derived is worse than no number.
   */
  const body = fs.readFileSync(BODY, 'utf8')
  assert.ok(!/Costs two model calls per start/.test(body), '⛔ the unsupported count is still there')
  assert.ok(!/Two model calls take about/.test(body), '⛔ the second unsupported count is still there')
})
