# verify-observer-kill.ps1 - prove the observerKill MECHANISM before Part B relies on it.
#
# WHY THIS RUNS IN SESSION 3, AS louis, NOW
# Part B is the first time an observation process ever runs, and during Part B there is no
# contact with the Owner. Turning up to that with an unbuilt and untried stop is exactly
# the "a bound is not a control" problem. So the mechanism is exercised here first, against
# a deliberately long-running stand-in, in the session where a failure can still be
# discussed.
#
# WHAT THIS DOES AND DOES NOT PROVE
#   proves      : Stop-ScheduledTask and Stop-Process -Id genuinely terminate a running
#                 task-launched process, and that the process is GONE afterwards rather
#                 than merely reported stopped
#   proves      : a task registered in one's own context can be stopped in one's own context
#   DOES NOT    : that louis can stop a process owned by AromaOperator. That is a different
#                 question - cross-account process rights - and E6 already measured that a
#                 handle to another session's process is not obtainable. In Part B the
#                 harness runs AS AromaOperator, so it stops its OWN observer, which is the
#                 case exercised here. An Owner-initiated cross-session kill is a SEPARATE
#                 binding and is not covered by this script.
#
# Zero capability: no observation, no input, no network. It starts a sleeper and stops it.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$nonce    = [guid]::NewGuid().ToString('N').Substring(0, 8)
$TaskName = 'AromaObserverKillProbe-' + $nonce
$PowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$marker   = Join-Path $env:TEMP ('observer-kill-probe-' + $nonce + '.pid')
$rows     = New-Object System.Collections.Generic.List[object]

Write-Host ("measuring as : " + (whoami) + "  SessionId=" + (Get-Process -Id $PID).SessionId)
Write-Host ("probe task   : " + $TaskName)
Write-Host ""

# The stand-in writes its own PID then sleeps. Writing the PID is what lets us prove the
# process was ALIVE before the kill - the 3a lesson: a target that was already dead makes
# every kill look successful.
$sleeper = @'
$PID | Set-Content -LiteralPath $args[0] -Encoding UTF8
Start-Sleep -Seconds 300
'@
$sleeperPath = Join-Path $env:TEMP ('observer-kill-sleeper-' + $nonce + '.ps1')
[System.IO.File]::WriteAllText($sleeperPath, $sleeper, (New-Object System.Text.UTF8Encoding($true)))

function Start-Sleeper {
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $TaskName
  $waited = 0
  while (-not (Test-Path -LiteralPath $marker) -and $waited -lt 40) { Start-Sleep -Milliseconds 250; $waited++ }
  if (-not (Test-Path -LiteralPath $marker)) { return $null }
  $thePid = [int](Get-Content -LiteralPath $marker -Raw).Trim()
  # LIVENESS PROOF, not an assumption
  $p = Get-Process -Id $thePid -ErrorAction SilentlyContinue
  if (-not $p) { return $null }
  $thePid
}
function Is-Gone {
  param([int]$TargetPid)
  $waited = 0
  while ($waited -lt 40) {
    if (-not (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 250; $waited++
  }
  $false
}

# register the probe task in our own context
$a = New-ScheduledTaskAction -Execute $PowerShell -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $sleeperPath + '" "' + $marker + '"')
$p = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
try {
  Register-ScheduledTask -TaskName $TaskName -Action $a -Principal $p -Settings $s -Force -ErrorAction Stop | Out-Null
} catch {
  Write-Host ("CANNOT REGISTER PROBE TASK: " + $_.Exception.Message) -ForegroundColor Red
  return
}

# ── BINDING 1: Stop-ScheduledTask ──────────────────────────────────────────────
$pid1 = Start-Sleeper
if (-not $pid1) {
  $rows.Add([ordered]@{ binding = 'Stop-ScheduledTask'; aliveBefore = $false; stopped = $false; verdict = 'INVALID - sleeper never proven alive' })
} else {
  Write-Host ("BINDING 1  sleeper alive, PID " + $pid1) -ForegroundColor Green
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $gone = Is-Gone -TargetPid $pid1
  $rows.Add([ordered]@{ binding = 'Stop-ScheduledTask'; aliveBefore = $true; stoppedPid = $pid1; stopped = $gone; verdict = $(if ($gone) { 'STOPS IT' } else { 'DOES NOT STOP IT' }) })
  Write-Host ("BINDING 1  process gone after Stop-ScheduledTask : " + $gone) -ForegroundColor $(if ($gone) { 'Green' } else { 'Red' })
}

Write-Host ""

# ── BINDING 2: Stop-Process on the PID, against a FRESH process ───────────────
# Fresh, because binding 1 killed the first one. Reusing it would be the 3a KILL 3 mistake:
# a dead target makes the next kill pass while proving nothing.
$pid2 = Start-Sleeper
if (-not $pid2) {
  $rows.Add([ordered]@{ binding = 'Stop-Process'; aliveBefore = $false; stopped = $false; verdict = 'INVALID - sleeper never proven alive' })
} else {
  Write-Host ("BINDING 2  FRESH sleeper alive, PID " + $pid2) -ForegroundColor Green
  Stop-Process -Id $pid2 -Force -ErrorAction SilentlyContinue
  $gone = Is-Gone -TargetPid $pid2
  $rows.Add([ordered]@{ binding = 'Stop-Process'; aliveBefore = $true; stoppedPid = $pid2; stopped = $gone; verdict = $(if ($gone) { 'STOPS IT' } else { 'DOES NOT STOP IT' }) })
  Write-Host ("BINDING 2  process gone after Stop-Process       : " + $gone) -ForegroundColor $(if ($gone) { 'Green' } else { 'Red' })
}

# ── cleanup, with residue accounting ──────────────────────────────────────────
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $sleeperPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue

$residue = @()
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { $residue += ('task ' + $TaskName) }
if (Test-Path -LiteralPath $sleeperPath) { $residue += $sleeperPath }
if (Test-Path -LiteralPath $marker) { $residue += $marker }

Write-Host ""
Write-Host "=== result ===" -ForegroundColor Cyan
$rows | ForEach-Object { Write-Host ("  {0,-20} aliveBefore={1,-6} stopped={2,-6} {3}" -f $_.binding, $_.aliveBefore, $_.stopped, $_.verdict) }
Write-Host ""
Write-Host ("residueLeft : " + ($residue.Count -gt 0)) -ForegroundColor $(if ($residue.Count) { 'Red' } else { 'Green' })
$residue | ForEach-Object { Write-Host ("  residuePath: " + $_) -ForegroundColor Red }
Write-Host ""
Write-Host "SCOPE: same-account, same-session stop. Cross-account (Owner stopping an" -ForegroundColor Yellow
Write-Host "AromaOperator process from session 3) is a DIFFERENT binding and is NOT" -ForegroundColor Yellow
Write-Host "covered by this run." -ForegroundColor Yellow
