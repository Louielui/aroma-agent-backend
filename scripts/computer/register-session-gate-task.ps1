# register-session-gate-task.ps1 - Computer Operator v0, Phase 3b. THE SESSION GATE.
#
# RUN THIS YOURSELF, ELEVATED. Registering a Scheduled Task is a system change.
#
# WHAT THIS IS FOR
# Owner ruling 3b item 10: if a fixed Scheduled Task cannot be proven to run in the SAME
# AromaOperator interactive session as the Companion, stop and fall back to option C - no
# credentials, no token manipulation, no privilege escalation.
#
# So this registers the task with a ZERO-CAPABILITY payload: session-identity.ps1, which
# reports who and where a process is and does nothing else. The mechanism is proven with
# something that cannot observe or act, BEFORE any observer exists. If the gate fails,
# nothing capable was ever built.
#
# EVERY CONSTRAINT FROM THE RULING IS ENCODED HERE:
#   . principal fixed to AromaOperator
#   . LogonType Interactive (TASK_LOGON_INTERACTIVE_TOKEN) - runs ONLY in an existing
#     interactive session, and stores NO password
#   . executable fixed to the absolute path of powershell.exe
#   . script path fixed and absolute; arguments fixed; NO -Command, no caller-controlled
#     argument of any kind
#   . single instance, hard timeout
#   . the script's SHA-256 is verified before registration and recorded in the task
#     description, so a swapped script is visible
#
# PRECONDITION, AND IT IS NOT CURRENTLY MET: AromaOperator must be LOGGED ON
# INTERACTIVELY. TASK_LOGON_INTERACTIVE_TOKEN attaches to an existing session; with no
# session there is nothing to attach to and the task simply will not run. This script
# checks and tells you.

#Requires -RunAsAdministrator
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName    = 'AromaComputerOperator-SessionGate'
$AccountName = 'AromaOperator'
$Qualified   = $env:COMPUTERNAME + '\' + $AccountName
# ── THE GATE SCRIPT LIVES IN ITS OWN DIRECTORY. IT USED TO LIVE IN STAGING. ──
# It was DESTROYED there, by a re-stage, and only one Tier A row ever noticed (C4b).
#
# The cause was structural, not careless: the staging directory had FOUR writers with
# CONTRADICTORY CONTRACTS over one location, and they cannot all be true —
#
#   deploy-companion.ps1        "this directory EQUALS the derived closure; I DELETE and
#                                rebuild it"                       (Remove-Item -Recurse)
#   rollback-companion.ps1      deletes it outright                (Remove-Item -Recurse)
#   register-session-gate-task  "I keep session-identity.ps1 here, forever"
#   verify-staging.ps1          asserts staging EQUALS the closure — but enumerates
#                               `-Filter *.js`, so it is STRUCTURALLY BLIND to this .ps1
#
# Putting the file back and relying on the new re-stage guard would leave TWO deleters and
# ONE guard, plus a verifier that cannot see the file at all. Position beats procedure: this
# directory has ONE writer — this script — and nothing rebuilds it.
$GateDir     = 'C:\Aroma\ComputerOperator-Gate'
$StageDir    = 'C:\Aroma\ComputerOperator-Companion'
$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence'
# This script's OWN directory. Same defect and same fix as register-observer-task.ps1: the
# hardcoded tree is a working tree, and after the persona rename merged it was checked out to
# `main`, where session-identity.ps1's siblings do not exist. This one did not fire on
# 2026-07-30 only because the gate hash already matched and step 1 skipped the re-register —
# it was the next failure waiting, not a healthy path.
$RepoScripts = $PSScriptRoot
$PowerShell  = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$ScriptName  = 'session-identity.ps1'
$StagedScript = Join-Path $GateDir $ScriptName
$OutFile     = Join-Path $EvidenceDir 'session-identity-task.json'

Write-Host "=== Phase 3b - session gate task ===" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# PREFLIGHT
# ---------------------------------------------------------------------------
$fail = @()
if (-not (Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue)) { $fail += "$AccountName does not exist" }
if (-not (Test-Path -LiteralPath $PowerShell)) { $fail += "powershell.exe not found at $PowerShell" }
if (-not (Test-Path -LiteralPath (Join-Path $RepoScripts $ScriptName))) { $fail += "missing source script: $ScriptName" }
    # The gate directory is created by THIS script and by nothing else - see the note above.
    # The staging directory is deliberately NOT required any more: this script no longer
    # writes there, and coupling the gate to a directory that gets rebuilt is what broke it.
if (-not (Test-Path -LiteralPath $GateDir)) {
  New-Item -ItemType Directory -Force -Path $GateDir | Out-Null
  Write-Host ("created gate directory: " + $GateDir) -ForegroundColor Green
}
foreach ($c in 'Register-ScheduledTask','New-ScheduledTaskPrincipal','New-ScheduledTaskAction') {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { $fail += "required cmdlet missing: $c" }
}
if ($fail.Count) {
  Write-Host "PREFLIGHT FAILED - nothing was registered:" -ForegroundColor Red
  $fail | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  return
}

# THE PRECONDITION. Checked and reported plainly rather than discovered as a silent
# "task never ran".
$loggedOn = $false
try { $loggedOn = [bool](@(quser 2>$null) | Select-String -Pattern ([regex]::Escape($AccountName)) -Quiet) } catch { }
Write-Host ""
Write-Host ("AromaOperator logged on interactively : " + $loggedOn) -ForegroundColor $(if ($loggedOn) { 'Green' } else { 'Yellow' })
if (-not $loggedOn) {
  Write-Host ""
  Write-Host "The task will be REGISTERED but cannot RUN until that account is logged on" -ForegroundColor Yellow
  Write-Host "interactively (Start -> your avatar -> Switch user -> sign in as AromaOperator," -ForegroundColor Yellow
  Write-Host "then switch back to your own session; leave AromaOperator signed in)." -ForegroundColor Yellow
  Write-Host "TASK_LOGON_INTERACTIVE_TOKEN attaches to an EXISTING session and stores no" -ForegroundColor Yellow
  Write-Host "password - with no session there is nothing to attach to." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# stage the probe read-only, and pin its hash
# ---------------------------------------------------------------------------
# ── C4 DISCIPLINE: BASELINE AND BACK UP BEFORE CHANGING THE TASK ────────────
# Re-registering DESTROYS and recreates the task. If anything below fails half-way, the only
# route into session 5 is gone - and that costs the whole Part A precondition chain. So the
# existing definition is exported and backed up FIRST. No baseline, no destructive change.
function HashStr { param([string]$s)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)) | ForEach-Object { $_.ToString('x2') }) -join '' }
  finally { $sha.Dispose() }
}
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$gateXmlBefore = $null
try { $gateXmlBefore = (Export-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-String) } catch { }
if ($gateXmlBefore) {
  $bk = Join-Path $EvidenceDir ('sessiongate-backup-pre-gatedir-' + $stamp + '.xml')
  # WriteAllText, NOT Set-Content: Set-Content appends its own trailing newline, which is what
  # made C7 structurally unable to pass. Measured: 1346 written, 1348 read back.
  [IO.File]::WriteAllText($bk, $gateXmlBefore, (New-Object Text.UTF8Encoding($true)))
  Write-Host ""
  Write-Host ("prior definition backed up : " + $bk) -ForegroundColor Green
  Write-Host ("  sha : " + (HashStr $gateXmlBefore))
} else {
  Write-Host ""
  Write-Host "no existing task to back up (first registration, or it is already gone)." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# stage the probe read-only, and pin its hash
# ---------------------------------------------------------------------------
Copy-Item -LiteralPath (Join-Path $RepoScripts $ScriptName) -Destination $StagedScript -Force
$hash = (Get-FileHash -LiteralPath $StagedScript -Algorithm SHA256).Hash
$srcHash = (Get-FileHash -LiteralPath (Join-Path $RepoScripts $ScriptName) -Algorithm SHA256).Hash
Write-Host ""
Write-Host ("staged probe : " + $StagedScript)
Write-Host ("SHA-256      : " + $hash)
# The copy is VERIFIED, not assumed. This directory is readable by the Owner (unlike the
# Gate-B probe directory), so the strong check is available here and is used.
if ($hash -ne $srcHash) {
  Write-Host ""
  Write-Host "*** ABORT: the staged copy does not match the repo source. Nothing registered. ***" -ForegroundColor Red
  Write-Host ("  source : " + $srcHash) -ForegroundColor Red
  Write-Host ("  staged : " + $hash) -ForegroundColor Red
  return
}
Write-Host "copy verified against the repo source." -ForegroundColor Green

# ---------------------------------------------------------------------------
# register the ONE fixed task
# ---------------------------------------------------------------------------
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "removed the previous registration" -ForegroundColor Yellow
}

# Arguments are FIXED. No -Command, no caller input, no variable part except the two
# absolute paths this script controls.
$argString = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $StagedScript + '" "' + $OutFile + '"'
# WorkingDirectory is the GATE directory now, not staging. Pointing the working directory at
# a tree that gets deleted and rebuilt is the same defect as pointing the script there.
$action = New-ScheduledTaskAction -Execute $PowerShell -Argument $argString -WorkingDirectory $GateDir

# Interactive token: runs only while that user is logged on, and no password is stored.
$principal = New-ScheduledTaskPrincipal -UserId $Qualified -LogonType Interactive -RunLevel Limited

# -DisallowStartIfOnBatteries and -StopIfGoingOnBatteries do NOT exist. I invented both
# names from the task-scheduler UI wording. The real switches are the two positive forms
# below. Found by the AST audit (v2) that now reads each parameter from the command's own
# metadata instead of from my memory - see the note in that audit about why v1 could not
# have caught this.
$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable:$false `
  -DontStopOnIdleEnd

$desc = "Aroma Computer Operator 3b session gate. Zero capability: reports session identity only. Script SHA-256 $hash"

Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings -Description $desc | Out-Null

$t = Get-ScheduledTask -TaskName $TaskName
Write-Host ""
Write-Host "=== registered ===" -ForegroundColor Cyan
Write-Host ("task name      : " + $t.TaskName)
Write-Host ("principal      : " + $t.Principal.UserId)
Write-Host ("logon type     : " + $t.Principal.LogonType + "   (Interactive = TASK_LOGON_INTERACTIVE_TOKEN, no stored password)")
Write-Host ("run level      : " + $t.Principal.RunLevel + "   (Limited = not elevated)")
Write-Host ("execute        : " + $t.Actions[0].Execute)
Write-Host ("arguments      : " + $t.Actions[0].Arguments)
Write-Host ("multi instance : " + $t.Settings.MultipleInstances)
Write-Host ("time limit     : " + $t.Settings.ExecutionTimeLimit)
# Get-ScheduledTask returns $null - not an empty array - when a task has no triggers, and
# under Set-StrictMode -Version Latest reading .Count off $null throws. So a CORRECT
# registration was guaranteed to fail on this line.
# The obvious fix is wrong: @($null).Count is 1, which would print "triggers: 1" on a task
# with zero triggers - a false claim in the very line that asserts on-demand-only. Both
# behaviours were measured, not assumed.
$triggerCount = @($t.Triggers | Where-Object { $_ }).Count
Write-Host ("triggers       : " + $triggerCount + "   (0 = it can ONLY be started on demand)")
if ($triggerCount -ne 0) {
  Write-Host "WARNING: this task has a trigger. It must be on-demand only." -ForegroundColor Red
}
Write-Host ""
Write-Host "Next: run verify-session-gate.ps1 (elevated) once AromaOperator is signed in." -ForegroundColor Cyan
