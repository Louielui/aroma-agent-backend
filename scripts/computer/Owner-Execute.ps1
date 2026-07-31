# Owner-Execute.ps1  -  SCREEN 2 of the Owner Approval Ceremony
#
# ===========================================================================
#  A SEPARATE SCREEN, A SEPARATE DECISION. Approving recorded an intention;
#  this is where it would actually happen, and it asks again.
#
#  ── THE SUMMARY COMES FROM THE RECEIPT, NOT THE WORK ORDER ──────────────
#  This screen renders what the RECEIPT says was approved. It never
#  regenerates the summary from the work order file. If it did, a work order
#  edited between the two screens would be displayed as though the Owner had
#  approved it, and he would be reading — and consenting to — content he has
#  never seen.
#
#  So the order is checked AGAINST the receipt, and a mismatch is a refusal
#  that names both hashes. No "it's probably fine", no re-approval here.
#
#  ── NO NON-INTERACTIVE PATH ─────────────────────────────────────────────
#  As with screen 1: no -Execute, -Yes, -Force or -NonInteractive parameter,
#  no environment variable, and consent read from the real console keyboard.
#
#  ── THIS ROUND IT STOPS BEFORE RUNNING ──────────────────────────────────
#  The canary EXECUTE GO has not been given. Everything below runs and is
#  measurable; the final call is fenced behind ONE named switch in this file
#  and refuses. Removing that fence is a separate Owner decision.
# ===========================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoDir = 'C:\Aroma\aroma-3b'
$Node    = 'C:\Program Files\nodejs\node.exe'
$Helper  = Join-Path $RepoDir 'scripts\computer\ownerApproval.js'

# THE FENCE. Not a parameter, not an environment variable — a constant in the
# file, so enabling it is a commit somebody can see.
#
# RE-LOCKED 2026-07-31, by Owner correction, BEFORE any real wiring is added.
#
# It was opened for one commit and closed again in the next, deliberately. The
# reason is an ordering one: this file is inside the execution package, so the
# eventual unlock commit necessarily changes the package and invalidates any
# receipt bound to it. Wiring must therefore be built and reviewed while the
# fence is SHUT, and the unlock left to the very last step — after which the
# Owner approves again, against the package that will actually run.
#
# No commit in between may carry fence=true together with live wiring.
#
# ownerApprovalCeremony.test.js asserts this literal, so either direction shows
# up TWICE in a diff: here, and in the test.
$CANARY_EXECUTE_AUTHORISED = $false

function Say { param([string]$T, [string]$C = 'Gray') Write-Host $T -ForegroundColor $C }

function Cancel-Now {
  param([string] $Why)
  Say ""
  Say "  CANCELLED - nothing was run." 'Yellow'
  if ($Why) { Say ("  reason: " + $Why) 'DarkGray' }
  exit 2
}

if (-not (Test-Path -LiteralPath $Node))   { Cancel-Now "node not found" }
if (-not (Test-Path -LiteralPath $Helper)) { Cancel-Now "approval helper not found" }

Clear-Host
Say ""
Say "  ==========================================================" 'Cyan'
Say "   RUN THE APPROVED TASK?                         Step 2 of 2" 'Cyan'
Say "  ==========================================================" 'Cyan'
Say ""

# ---------------------------------------------------------------------------
# VERIFY - all of it, before the Owner is asked anything
# ---------------------------------------------------------------------------
$raw = & $Node $Helper verify
$verifyExit = $LASTEXITCODE
$v = $null
try { $v = $raw | ConvertFrom-Json } catch { Cancel-Now "could not read the approval record" }

if ($verifyExit -ne 0 -or -not $v.ok) {
  Say "  THIS TASK CANNOT BE RUN." 'Red'
  Say ""
  switch ($v.refusal) {
    'no_receipt' {
      Say "  Nothing has been approved yet. Please do Step 1 first." 'White'
    }
    'work_order_changed' {
      # The case this whole design exists for, said in plain words.
      Say "  The task has CHANGED since you approved it." 'Red'
      Say ""
      Say "  You approved one thing; the computer now holds a different" 'White'
      Say "  one. It will not run either of them." 'White'
      Say ""
      Say "  To continue, approve the new version from Step 1." 'White'
      Say ""
      Say ("  approved version : " + $v.approvedHash) 'DarkGray'
      Say ("  current version  : " + $v.currentHash) 'DarkGray'
    }
    'receipt_self_mismatch' {
      Say "  The approval record has been altered. It will not be used." 'Red'
    }
    'pre_implementation_receipt' {
      # A receipt from before the execution package existed. It recorded WHAT would be done
      # and nothing about the code that does it, so it cannot authorise a run.
      Say "  This approval is from before the program was finished." 'Red'
      Say ""
      Say "  You approved WHAT the task would do, at a time when the" 'White'
      Say "  program that does it had not been written yet. It is kept" 'White'
      Say "  as a record, but it cannot be used to run anything." 'White'
      Say ""
      Say "  Please approve again from Step 1." 'White'
    }
    'execution_package_changed' {
      # The reason the package exists: the intent still matches, the CODE does not.
      Say "  The program has CHANGED since you approved it." 'Red'
      Say ""
      Say "  The task itself is unchanged, but the program that would" 'White'
      Say "  carry it out is not the one you approved. It will not run." 'White'
      Say ""
      Say "  Please approve again from Step 1." 'White'
      Say ""
      if ($v.changedFiles) {
        Say "  what changed:" 'DarkGray'
        $v.changedFiles | ForEach-Object { Say ("    " + $_.change + "  " + $_.path) 'DarkGray' }
      }
    }
    'execution_package_incomplete' {
      Say "  Part of the program is missing. Nothing will run." 'Red'
      Say ("  " + $v.reason) 'DarkGray'
    }
    default {
      Say ("  " + $v.reason) 'White'
    }
  }
  Say ""
  exit 3
}

# ---------------------------------------------------------------------------
# THE SCREEN - rendered from the RECEIPT
# ---------------------------------------------------------------------------
Say "  This is what you approved:" 'White'
Say ""
$v.summary -split "`n" | ForEach-Object { Say $_ 'White' }
Say ""
Say ("  approved on : " + $v.approvedAt) 'DarkGray'
Say ""
Say "  Checked and matching: the task is exactly the one you approved." 'Green'
Say ""
Say "  ----------------------------------------------------------" 'Cyan'
Say "    Press  E  to RUN IT NOW      Press  C  to CANCEL" 'Cyan'
Say "  ----------------------------------------------------------" 'Cyan'
Say ""

if (-not [Environment]::UserInteractive) { Cancel-Now "not an interactive session" }
try {
  if ([Console]::IsInputRedirected) { Cancel-Now "input is redirected - a person must press the key" }
} catch { Cancel-Now "could not determine whether input is a console" }

$key = $null
try { $key = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { Cancel-Now "no console keyboard available" }
if ($null -eq $key) { Cancel-Now "no key was read" }
$ch = [string]$key.Character
if ($ch -ne 'e' -and $ch -ne 'E') { Cancel-Now "you pressed something other than E" }

# ---------------------------------------------------------------------------
# THE FENCE
# ---------------------------------------------------------------------------
if (-not $CANARY_EXECUTE_AUTHORISED) {
  Say ""
  Say "  NOT RUN." 'Yellow'
  Say ""
  Say "  Your approval is recorded and valid, and the task matches it." 'White'
  Say "  Running it is still switched off in this build, on purpose." 'White'
  Say ""
  Say "  Nothing was opened, nothing was written, nothing changed." 'White'
  Say ""
  exit 4
}

# ===========================================================================
#  PREFLIGHT, then the flag, then the child. In that order and no other.
# ===========================================================================
$Entry = Join-Path $RepoDir 'scripts\computer\run-notepad-canary.js'

# ── the checks PowerShell is the right tool for ──────────────────────────
# ACLs, process lists and the staging directory. Node does the receipt, the
# package, the folder state and the audit sink. Both run BEFORE the flag.
Say ""
Say "  Checking..." 'Cyan'

$notepads = @(Get-Process -Name 'notepad' -ErrorAction SilentlyContinue).Count
if ($notepads -ne 0) { Cancel-Now ("Notepad is already open (" + $notepads + "). Please close it first.") }

$testDir = 'C:\Aroma\ComputerOperator-Test'
try {
  $acl = Get-Acl -LiteralPath $testDir -ErrorAction Stop
} catch {
  Cancel-Now "The folder's permissions cannot be read from here. Run this as the Owner."
}
$rules = @($acl.Access)
if (-not $acl.AreAccessRulesProtected) { Cancel-Now "The folder's permissions are not the approved ones." }
if (@($rules | Where-Object { $_.IsInherited }).Count -ne 0) { Cancel-Now "The folder's permissions are not the approved ones." }
if (@($rules | Where-Object { $_.AccessControlType -eq 'Deny' }).Count -ne 0) { Cancel-Now "The folder's permissions are not the approved ones." }
if ($rules.Count -ne 3) { Cancel-Now "The folder's permissions are not the approved ones." }

# ── the Node preflight, with the flag still off ─────────────────────────
$preRaw = & $Node $Entry preflight
$preExit = $LASTEXITCODE
$pre = $null
try { $pre = $preRaw | ConvertFrom-Json } catch { Cancel-Now "the checks could not be read" }
if ($preExit -ne 0 -or -not $pre.ok) {
  Say ""
  Say "  IT WILL NOT RUN." 'Red'
  Say ""
  Say ("  " + $pre.human) 'White'
  if ($pre.detail) { Say ("  " + $pre.detail) 'DarkGray' }
  Say ""
  Say "  Nothing was opened, nothing was written, the switch stayed off." 'White'
  exit 3
}
Say "  All checks passed." 'Green'

# ===========================================================================
#  THE FLAG. Process scope ONLY, set as late as possible, restored always.
# ===========================================================================
#  User and Machine scopes are never touched — no setx, no registry, nothing
#  that outlives this window. The Node child inherits the Process value, which
#  is the entire reason the Process scope is the right one.
#
#  The original value is captured BEFORE anything changes it, so the finally
#  restores the exact prior state rather than assuming it was unset.
# ===========================================================================
$flagWasSet = $null -ne $env:COMPUTER_OPERATOR
$flagOriginal = $env:COMPUTER_OPERATOR
$userBefore = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', 'User')
$machineBefore = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', 'Machine')

$runExit = 1
$runRaw = $null
try {
  $env:COMPUTER_OPERATOR = 'on'
  Say ""
  Say "  Running..." 'Cyan'
  $runRaw = & $Node $Entry run
  $runExit = $LASTEXITCODE
} finally {
  # Restore the EXACT prior state. Unset stays unset; a prior value comes back
  # as itself. This runs on success, on failure and on Ctrl-C.
  if ($flagWasSet) { $env:COMPUTER_OPERATOR = $flagOriginal }
  else { Remove-Item Env:\COMPUTER_OPERATOR -ErrorAction SilentlyContinue }
}

# ── prove the restore, do not assume it ─────────────────────────────────
$procAfter = $env:COMPUTER_OPERATOR
$userAfter = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', 'User')
$machineAfter = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', 'Machine')

$restored = if ($flagWasSet) { $procAfter -eq $flagOriginal } else { $null -eq $procAfter }
if (-not $restored -or $userAfter -ne $userBefore -or $machineAfter -ne $machineBefore) {
  Say ""
  Say "*** CONTAINMENT INCIDENT ***" -ForegroundColor Red
  Say "  The computer operator switch did not return to how it was." 'Red'
  Say ("  process before : " + $(if ($flagWasSet) { $flagOriginal } else { '<unset>' })) 'Red'
  Say ("  process after  : " + $(if ($procAfter) { $procAfter } else { '<unset>' })) 'Red'
  Say ("  user   before/after : " + $userBefore + " / " + $userAfter) 'Red'
  Say ("  machine before/after: " + $machineBefore + " / " + $machineAfter) 'Red'
  Say ""
  Say "  Not retrying. Close this window and report it." 'Yellow'
  exit 9
}
Say "  Switch returned to off." 'Green'

# ── report the run ──────────────────────────────────────────────────────
$res = $null
try { $res = $runRaw | ConvertFrom-Json } catch { }
Say ""
if ($runExit -eq 0 -and $res -and $res.ok) {
  Say "  DONE." 'Green'
  Say ""
  Say "  The file has been created. Please open it and check it, then" 'White'
  Say "  delete it when you are satisfied." 'White'
} else {
  Say "  IT DID NOT COMPLETE." 'Yellow'
  if ($res -and $res.human) { Say ("  " + $res.human) 'White' }
  elseif ($res -and $res.refusal) { Say ("  reason: " + $res.refusal) 'DarkGray' }
  Say ""
  Say "  The switch is off and the approval has been used up." 'White'
}
Say ""
exit $runExit
