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
# FINAL UNLOCK, 2026-07-31, by Owner decision — the last step of the sequence:
#
#   wire + test (fence shut) -> independent review -> THIS COMMIT
#   -> recompute and seal the package -> Owner approves again -> Execute
#
# Opening this file changes the execution package, which is why it comes last:
# every receipt bound to the previous package hash is now invalid, including the
# one already signed. That is the design working, not a side effect. Nothing can
# run until the Owner approves again against the package that will actually run.
#
# The fence is NOT the safety here, and should never be leaned on as if it were.
# The real guarantees are: COMPUTER_OPERATOR defaults off and is set only in the
# Process scope for the life of one child; the receipt binds both the work order
# and the code; and the Owner's approval comes after this commit, not before.
#
# ownerApprovalCeremony.test.js asserts this literal and is the only test that
# does, so a flip shows up in exactly two files — this one and that one.
# ── RE-LOCKED 2026-07-31 ON AN ARCHITECTURE RULING ──────────────────────
# Pressing E revealed that this path runs the canary as whoever double-clicks
# it — louis — never as AromaOperator. run-notepad-canary.js calls
# executor.execute() directly; the Companion is constructed and then unused, so
# every containment guarantee attached to it (separate account, separate
# session, non-elevated token, the DENY around C:\Aroma) applies to nothing on
# this path. Running it elevated would have "fixed" the ACL check by opening an
# ELEVATED Notepad, which is worse than the failure it cured.
#
# Owner ruling: the canary must run as AromaOperator, non-elevated, inside its
# own interactive session, THROUGH the Companion. The Owner reads, approves and
# triggers; he never calls the executor or the adapter himself.
#
# So this stays shut until that chain exists. It is not a temporary
# inconvenience — with the current wiring, opening it would authorise the wrong
# identity to act.
$CANARY_EXECUTE_AUTHORISED = $false

function Say { param([string]$T, [string]$C = 'Gray') Write-Host $T -ForegroundColor $C }

function Cancel-Now {
  param([string] $Why)
  Say ""
  Say "  CANCELLED - nothing was run." 'Yellow'
  if ($Why) { Say ("  reason: " + $Why) 'DarkGray' }
  exit 2
}

# ===========================================================================
#  READING THE OWNER'S ANSWER
#
#  ── WHAT WENT WRONG BEFORE, MEASURED FROM THE SYMPTOM ──────────────────
#  The screen rendered and INSTANTLY said "you pressed something other than
#  A", with no key touched. ReadKey did not throw - it RETURNED, immediately,
#  with an event whose Character was not 'A'. Almost certainly a key event
#  carrying no character: a modifier, or something already sitting in the
#  input buffer when the window opened. The old code compared that straight
#  against 'A' and reported it as the Owner's mistake.
#
#  Two separate defects, and the second is the worse one:
#    1. a non-character event was treated as an answer;
#    2. "no keyboard" and "wrong key" produced THE SAME SENTENCE, so the
#       Owner had no way to tell a tool failure from his own action.
#
#  ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────
#  It does not relax anything. An unreadable keyboard still approves nothing.
#  Skipping a Shift key-down is not leniency - a modifier was never an answer.
#  And it sets no console encoding and no hidden state: the fix is in how the
#  events are read, not in configuring the machine underneath.
# ===========================================================================
function Read-OwnerChoice {
  param([string[]] $Accept)

  # Capability FIRST, so "cannot ask" is decided before anything is read and
  # can never be confused with "asked and got the wrong answer".
  if (-not [Environment]::UserInteractive) { return @{ ok = $false; kind = 'no_keyboard'; detail = 'the session is not interactive' } }
  try {
    if ([Console]::IsInputRedirected) { return @{ ok = $false; kind = 'no_keyboard'; detail = 'input is redirected, so no person is typing' } }
  } catch { return @{ ok = $false; kind = 'no_keyboard'; detail = 'could not tell whether input is a console' } }
  if ($Host.Name -ne 'ConsoleHost') { return @{ ok = $false; kind = 'no_keyboard'; detail = ('this host is ' + $Host.Name + ', which has no console keyboard') } }
  try { $null = $Host.UI.RawUI.KeyAvailable } catch { return @{ ok = $false; kind = 'no_keyboard'; detail = 'this host exposes no keyboard buffer' } }

  # Anything already queued when the window opened is NOT a decision.
  try { $Host.UI.RawUI.FlushInputBuffer() } catch { }

  $ignored = 0
  while ($ignored -lt 50) {
    $k = $null
    try { $k = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') }
    catch { return @{ ok = $false; kind = 'no_keyboard'; detail = $_.Exception.Message } }
    if ($null -eq $k) { $ignored++; continue }

    $ch = [string]$k.Character
    # Modifiers and control keys carry no character. Waiting past them is what
    # a person expects; treating them as an answer is what broke.
    if ([string]::IsNullOrEmpty($ch)) { $ignored++; continue }
    if ([int][char]$ch[0] -lt 32) { $ignored++; continue }

    $up = $ch.ToUpper()
    if ($Accept -contains $up) { return @{ ok = $true; key = $up } }
    return @{ ok = $false; kind = 'other_key'; detail = $ch }
  }
  # Fifty events and not one character: the keyboard is not reaching us.
  return @{ ok = $false; kind = 'no_keyboard'; detail = 'only non-character key events arrived' }
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

$choice = Read-OwnerChoice -Accept @('E', 'C')

if (-not $choice.ok -and $choice.kind -eq 'no_keyboard') {
  Say ""
  Say "  THIS TOOL COULD NOT READ YOUR KEYBOARD." 'Red'
  Say ""
  Say "  You did nothing wrong. Nothing was run and nothing was" 'White'
  Say "  changed - the screen simply cannot take your answer." 'White'
  Say ""
  Say "  Please tell whoever set this up, and pass on this line:" 'White'
  Say ("    keyboard unavailable: " + $choice.detail) 'DarkGray'
  Say ("    host=" + $Host.Name + "  interactive=" + [Environment]::UserInteractive) 'DarkGray'
  Say ""
  exit 5
}
if (-not $choice.ok) { Cancel-Now ("you pressed '" + $choice.detail + "' rather than E or C") }
if ($choice.key -eq 'C') { Cancel-Now "you chose Cancel" }

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
