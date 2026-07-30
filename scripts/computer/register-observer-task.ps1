# register-observer-task.ps1 - the ONE fixed Observer task, with C4-level protection.
#
# RUN ELEVATED. Registering a scheduled task is a system change.
#
# WHY C4-LEVEL PROTECTION, ON A BRAND NEW TASK
# C4 proved AromaOperator cannot rewrite the SessionGate task. That result does not transfer
# to a task that did not exist when it was measured. And the hole C4 exists to close is
# specific: a SHA pin binds the FILE, not the POINTER to it. An account that can edit the
# task definition can repoint it at a different script and the pin never notices. Opening
# that hole a second time on the Observer task would undo the reason C4 was raised in
# priority at all.
#
# So this registers with the same discipline as the gate task and additionally exports a
# baseline XML that the Tier A probe can diff against.
#
# EVERY CONSTRAINT FROM THE ORIGINAL RULING IS ENCODED:
#   . principal fixed to AromaOperator
#   . LogonType Interactive - runs ONLY in an existing interactive session, stores NO password
#   . RunLevel Limited - not elevated
#   . executable fixed to the absolute path of powershell.exe
#   . -File, never -Command; arguments fixed, no caller-controlled part
#   . single instance, hard execution time limit
#   . 0 triggers - it can ONLY be started on demand
#   . the script's SHA-256 verified before registration and recorded in the description

#Requires -RunAsAdministrator
param(
  [string]$TaskName = 'AromaComputerOperator-Observer',
  [string]$AccountName = 'AromaOperator',
  [string]$ProbeDir = 'C:\AromaOperator-Probe',
  [string]$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence',
  [string]$RepoScripts = 'C:\Aroma\aroma-agent-backend\scripts\computer'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Qualified   = $env:COMPUTERNAME + '\' + $AccountName
$PowerShell  = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$ScriptName  = 'observer.ps1'
$Staged      = Join-Path $ProbeDir $ScriptName
$OutJson     = Join-Path $EvidenceDir 'observer-result.json'

Write-Host "=== register the fixed Observer task ===" -ForegroundColor Cyan
Write-Host ("running as : " + (whoami) + "  SessionId=" + (Get-Process -Id $PID).SessionId)

# ---------------------------------------------------------------------------
# PREFLIGHT
# ---------------------------------------------------------------------------
$fail = @()
if (-not (Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue)) { $fail += "$AccountName does not exist" }
if (-not (Test-Path -LiteralPath $PowerShell)) { $fail += "powershell.exe not at $PowerShell" }
if (-not (Test-Path -LiteralPath (Join-Path $RepoScripts $ScriptName))) { $fail += "source missing: $ScriptName" }
if (-not (Test-Path -LiteralPath $ProbeDir)) { $fail += "probe directory missing: $ProbeDir - run relocate-probe.ps1 first" }
# The probe directory is deliberately NOT the Companion staging tree: staging is derived
# from the require graph and its contents must equal that closure exactly.
if ($ProbeDir -like 'C:\Aroma\ComputerOperator-Companion*') { $fail += 'the observer must not be staged in the Companion closure' }
if ($fail.Count) {
  Write-Host "PREFLIGHT FAILED - nothing registered:" -ForegroundColor Red
  $fail | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Red }
  return
}

$loggedOn = $false
try { $loggedOn = [bool](@(quser 2>$null) | Select-String -Pattern ([regex]::Escape($AccountName)) -Quiet) } catch { }
Write-Host ""
Write-Host ("$AccountName logged on interactively : " + $loggedOn) -ForegroundColor $(if ($loggedOn) { 'Green' } else { 'Yellow' })
if (-not $loggedOn) {
  Write-Host "It will REGISTER but cannot RUN: an interactive-token task attaches to an" -ForegroundColor Yellow
  Write-Host "EXISTING session and stores no password - with no session there is nothing" -ForegroundColor Yellow
  Write-Host "to attach to." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# stage the observer read-only and pin its hash
# ---------------------------------------------------------------------------
# ── HASH THE REPO SOURCE, NOT THE STAGED COPY ───────────────────────────────
# GATE B collided with this line. restrict-probe-dir.ps1 denies the Owner ReadData on the
# probe directory, so `Get-FileHash` on $Staged now fails with Access Denied — and this
# script runs as the Owner, elevated.
#
# The fix is to change the tool, NOT to lift the boundary. Reverting a verified control so
# one utility can keep working inverts the priority: the boundary is the deliverable and the
# utility is a convenience.
#
# WHAT THIS COSTS, STATED PLAINLY. Hashing $Staged verified what actually landed. Hashing the
# SOURCE records what was SENT and assumes Copy-Item was faithful. That is genuinely weaker,
# and it is NOT left uncompensated:
#
#   C8-observer-script-sha-matches-pin, in tierA-probe.ps1, hashes the STAGED file and
#   compares it to the SHA recorded in this description — running as AromaOperator, in
#   session 5, which is the account that CAN read it.
#
# So the writer records intent and a reader in the capable session verifies reality. A bad
# copy shows up as a failing C8 rather than as nothing at all.
Copy-Item -LiteralPath (Join-Path $RepoScripts $ScriptName) -Destination $Staged -Force
$Source = Join-Path $RepoScripts $ScriptName
$hash = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
# .Length needs FILE_READ_ATTRIBUTES, which Gate B does not deny, so this still reads the
# staged file - but it is taken from the source too, so the two figures describe one thing.
$bytes = (Get-Item -LiteralPath $Source).Length

# explicit DENY on write, explicit ALLOW read+execute. Explicit ACEs are evaluated before
# inherited ones, so this does not depend on reasoning about inheritance order - and
# C:\ grants Authenticated Users Modify by default, which is what would otherwise apply.
$facl = Get-Acl -LiteralPath $Staged
$denyRights = [Security.AccessControl.FileSystemRights]::Write `
  -bor [Security.AccessControl.FileSystemRights]::Delete `
  -bor [Security.AccessControl.FileSystemRights]::ChangePermissions `
  -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
$facl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($Qualified, $denyRights, 'Deny')))
$facl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($Qualified, 'ReadAndExecute', 'Allow')))
Set-Acl -LiteralPath $Staged -AclObject $facl

Write-Host ""
Write-Host "=== staged observer ===" -ForegroundColor Cyan
Write-Host ("  path    : " + $Staged)
Write-Host ("  SHA-256 : " + $hash)
Write-Host ("  bytes   : " + $bytes)
Write-Host "  ACL for $AccountName :"
@((Get-Acl -LiteralPath $Staged).Access | Where-Object { $_.IdentityReference -like ('*' + $AccountName) }) |
  ForEach-Object { Write-Host ("    {0,-5} {1}" -f $_.AccessControlType, $_.FileSystemRights) }
Write-Host "  icacls:"
icacls $Staged

# ---------------------------------------------------------------------------
# register the ONE fixed task
# ---------------------------------------------------------------------------
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host ""
  Write-Host "removed the previous registration" -ForegroundColor Yellow
}

# FIXED. No -Command, no caller input, no variable part except paths this script controls.
$argString = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $Staged + '" -Action list_windows -OutJson "' + $OutJson + '"'
$action = New-ScheduledTaskAction -Execute $PowerShell -Argument $argString -WorkingDirectory $ProbeDir
$principal = New-ScheduledTaskPrincipal -UserId $Qualified -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable:$false `
  -DontStopOnIdleEnd
$desc = "Aroma Computer Operator 3b Observer. Read-only, single-shot. Script SHA-256 $hash"

Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings -Description $desc | Out-Null

$t = Get-ScheduledTask -TaskName $TaskName
Write-Host ""
Write-Host "=== registered ===" -ForegroundColor Cyan
Write-Host ("  task name      : " + $t.TaskName)
Write-Host ("  principal      : " + $t.Principal.UserId)
Write-Host ("  logon type     : " + $t.Principal.LogonType + "   (Interactive = no stored password)")
Write-Host ("  run level      : " + $t.Principal.RunLevel + "   (Limited = not elevated)")
Write-Host ("  execute        : " + $t.Actions[0].Execute)
Write-Host ("  arguments      : " + $t.Actions[0].Arguments)
Write-Host ("  multi instance : " + $t.Settings.MultipleInstances)
Write-Host ("  time limit     : " + $t.Settings.ExecutionTimeLimit)
$triggerCount = @($t.Triggers | Where-Object { $_ }).Count
Write-Host ("  triggers       : " + $triggerCount + "   (0 = on demand only)")
if ($triggerCount -ne 0) { Write-Host "  WARNING: this task has a trigger. It must be on-demand only." -ForegroundColor Red }

# ---------------------------------------------------------------------------
# C4 BASELINE - export the full XML so a later diff has something to compare against
# ---------------------------------------------------------------------------
if (-not (Test-Path -LiteralPath $EvidenceDir)) { New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null }
$baselinePath = Join-Path $EvidenceDir 'observer-task-baseline.xml'
$xml = (Export-ScheduledTask -TaskName $TaskName | Out-String)
# WriteAllText, NOT Set-Content. Set-Content APPENDS ITS OWN TRAILING NEWLINE, so the file on
# disk was always two characters longer than the string it came from - measured: 1346 written,
# 1348 read back. Any later comparison by hash therefore compared a value against
# itself-plus-a-newline and could never agree, which is exactly why C7 came back INVALID.
# C7 also TrimEnd()s both sides now, so an already-written baseline still compares correctly.
[IO.File]::WriteAllText($baselinePath, $xml, (New-Object Text.UTF8Encoding($true)))
$sha = [Security.Cryptography.SHA256]::Create()
try { $xmlHash = ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($xml)) | ForEach-Object { $_.ToString('x2') }) -join '' } finally { $sha.Dispose() }

Write-Host ""
Write-Host "=== C4 baseline ===" -ForegroundColor Cyan
Write-Host ("  baseline XML : " + $baselinePath)
Write-Host ("  XML SHA-256  : " + $xmlHash)
Write-Host ""
Write-Host "The pin binds the FILE. This baseline is what lets a later check notice the" -ForegroundColor Yellow
Write-Host "POINTER being changed - the hole C4 exists to close, now covered for this task" -ForegroundColor Yellow
Write-Host "too. Add an observer-task row to the Tier A probe and diff against this." -ForegroundColor Yellow
Write-Host ""
Write-Host ("OBSERVER SHA-256 : " + $hash)
Write-Host ("OBSERVER BYTES   : " + $bytes)
