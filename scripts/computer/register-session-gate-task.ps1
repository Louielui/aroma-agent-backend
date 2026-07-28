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
$StageDir    = 'C:\Aroma\ComputerOperator-Companion'
$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence'
$RepoScripts = 'C:\Aroma\aroma-agent-backend\scripts\computer'
$PowerShell  = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$ScriptName  = 'session-identity.ps1'
$StagedScript = Join-Path $StageDir $ScriptName
$OutFile     = Join-Path $EvidenceDir 'session-identity-task.json'

Write-Host "=== Phase 3b - session gate task ===" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# PREFLIGHT
# ---------------------------------------------------------------------------
$fail = @()
if (-not (Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue)) { $fail += "$AccountName does not exist" }
if (-not (Test-Path -LiteralPath $PowerShell)) { $fail += "powershell.exe not found at $PowerShell" }
if (-not (Test-Path -LiteralPath (Join-Path $RepoScripts $ScriptName))) { $fail += "missing source script: $ScriptName" }
if (-not (Test-Path -LiteralPath $StageDir)) { $fail += "staging directory missing - run deploy-companion.ps1 first" }
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
Copy-Item -LiteralPath (Join-Path $RepoScripts $ScriptName) -Destination $StagedScript -Force
$hash = (Get-FileHash -LiteralPath $StagedScript -Algorithm SHA256).Hash
Write-Host ""
Write-Host ("staged probe : " + $StagedScript)
Write-Host ("SHA-256      : " + $hash)

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
$action = New-ScheduledTaskAction -Execute $PowerShell -Argument $argString -WorkingDirectory $StageDir

# Interactive token: runs only while that user is logged on, and no password is stored.
$principal = New-ScheduledTaskPrincipal -UserId $Qualified -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -DisallowStartIfOnBatteries:$false `
  -StopIfGoingOnBatteries:$false `
  -AllowStartIfOnBatteries `
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
Write-Host ("triggers       : " + $t.Triggers.Count + "   (0 = it can ONLY be started on demand)")
Write-Host ""
Write-Host "Next: run verify-session-gate.ps1 (elevated) once AromaOperator is signed in." -ForegroundColor Cyan
