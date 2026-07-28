# owner-escape-hatch.ps1 - the Owner's last resort against an orphaned Observer.
#
# THE HOLE THIS FILLS
# An orphaned Observer is normally killed by the harness. But if the harness itself dies,
# or session 5 misbehaves, nothing kills it - and back in session 3 the Owner cannot,
# because unelevated cross-session TERMINATE rights are refused. Measured, with a positive
# control, so it is a named mechanism and not an assumption:
#
#   own session 3 process   canTerminate = True   OK                    <- probe works
#   session 5 process       canTerminate = False  ERROR_ACCESS_DENIED   <- ACL
#
# So the escape hatch REQUIRES ELEVATION. That is the finding, not a workaround: without
# an admin token there is no cross-session kill, which is consistent with E6.
#
# TWO MODES
#   -Verify   register a stand-in AS AromaOperator IN session 5 via an interactive-token
#             task, prove it alive, kill it from session 3, poll until the PID is genuinely
#             absent. Run this BEFORE Part A - the hatch must not be first used in anger.
#   (default) kill any residual observer process now.
#
# Zero capability: no observation, no input, no network. It starts a sleeper and stops it.

#Requires -RunAsAdministrator
param([switch]$Verify)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$AccountName  = 'AromaOperator'
$Qualified    = $env:COMPUTERNAME + '\' + $AccountName
$ObserverTask = 'AromaComputerOperator-Observer'
$PowerShell   = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'

Write-Host ("running as : " + (whoami) + "  SessionId=" + (Get-Process -Id $PID).SessionId)
Write-Host ("elevated   : " + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
Write-Host ""

function Wait-Gone {
  param([int]$TargetPid, [int]$MaxMs = 10000)
  $waited = 0
  while ($waited -lt $MaxMs) {
    if (-not (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 250; $waited += 250
  }
  $false
}

# ---------------------------------------------------------------------------
# KILL MODE - what you actually paste when something is stuck
# ---------------------------------------------------------------------------
function Invoke-Kill {
  Write-Host "=== killing any residual Observer ===" -ForegroundColor Cyan
  Stop-ScheduledTask -TaskName $ObserverTask -ErrorAction SilentlyContinue

  # Anything running as that account, in a session that is not ours, that is a PowerShell
  # host. Deliberately narrow: it does not sweep the account's whole session.
  $mine = (Get-Process -Id $PID).SessionId
  $targets = @(Get-Process -IncludeUserName -ErrorAction SilentlyContinue |
    Where-Object { $_.UserName -like ('*\' + $AccountName) -and $_.SessionId -ne $mine -and $_.ProcessName -match 'powershell|pwsh' })

  if ($targets.Count -eq 0) { Write-Host "  no residual observer process found" -ForegroundColor Green; return }

  $residue = @()
  foreach ($t in $targets) {
    Write-Host ("  target : " + $t.ProcessName + " PID " + $t.Id + " session " + $t.SessionId + " user " + $t.UserName)
    Stop-Process -Id $t.Id -Force -ErrorAction SilentlyContinue
    $gone = Wait-Gone -TargetPid $t.Id
    Write-Host ("    gone : " + $gone) -ForegroundColor $(if ($gone) { 'Green' } else { 'Red' })
    if (-not $gone) { $residue += ('process ' + $t.Id + ' still running') }
  }
  Write-Host ""
  Write-Host ("residueLeft : " + ($residue.Count -gt 0)) -ForegroundColor $(if ($residue.Count) { 'Red' } else { 'Green' })
  $residue | ForEach-Object { Write-Host ("  residuePath: " + $_) -ForegroundColor Red }
}

# ---------------------------------------------------------------------------
# VERIFY MODE - prove the hatch works before Part A depends on it
# ---------------------------------------------------------------------------
function Invoke-Verify {
  Write-Host "=== verifying the escape hatch against a live stand-in ===" -ForegroundColor Cyan

  $loggedOn = $false
  try { $loggedOn = [bool](@(quser 2>$null) | Select-String -Pattern ([regex]::Escape($AccountName)) -Quiet) } catch { }
  if (-not $loggedOn) {
    Write-Host "  $AccountName is not logged on - an interactive-token task cannot run." -ForegroundColor Red
    Write-Host "  Sign it in first. Nothing was created." -ForegroundColor Red
    return
  }

  $nonce  = [guid]::NewGuid().ToString('N').Substring(0, 8)
  $task   = 'AromaEscapeHatchProbe-' + $nonce
  # The stand-in must live where AromaOperator can READ it - its own probe directory.
  $script = 'C:\AromaOperator-Probe\escape-hatch-sleeper-' + $nonce + '.ps1'
  $marker = 'C:\Aroma\ComputerOperator-Evidence\escape-hatch-' + $nonce + '.pid'

  $body = '$PID | Set-Content -LiteralPath ''' + $marker + ''' -Encoding UTF8' + "`r`n" + 'Start-Sleep -Seconds 300'
  [System.IO.File]::WriteAllText($script, $body, (New-Object System.Text.UTF8Encoding($true)))

  $a = New-ScheduledTaskAction -Execute $PowerShell -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $script + '"')
  $p = New-ScheduledTaskPrincipal -UserId $Qualified -LogonType Interactive -RunLevel Limited
  $s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $task -Action $a -Principal $p -Settings $s -Force -ErrorAction Stop | Out-Null

  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $task
  $waited = 0
  while (-not (Test-Path -LiteralPath $marker) -and $waited -lt 60) { Start-Sleep -Milliseconds 250; $waited++ }

  $standInPid = $null
  if (Test-Path -LiteralPath $marker) { $standInPid = [int](Get-Content -LiteralPath $marker -Raw).Trim() }

  # LIVENESS PROOF. A stand-in that never ran makes the kill look successful while proving
  # nothing - the 3a KILL 3 shape.
  $proc = if ($standInPid) { Get-Process -Id $standInPid -ErrorAction SilentlyContinue } else { $null }
  if (-not $proc) {
    Write-Host "  INVALID - the stand-in was never proven alive. The hatch is NOT verified." -ForegroundColor Red
  } else {
    Write-Host ("  stand-in alive : PID " + $standInPid + "  session " + $proc.SessionId) -ForegroundColor Green
    if ($proc.SessionId -eq (Get-Process -Id $PID).SessionId) {
      Write-Host "  INVALID - it landed in OUR session, so this does not test cross-session." -ForegroundColor Red
    } else {
      Stop-Process -Id $standInPid -Force -ErrorAction SilentlyContinue
      $gone = Wait-Gone -TargetPid $standInPid
      Write-Host ("  killed from session " + (Get-Process -Id $PID).SessionId + " -> gone : " + $gone) -ForegroundColor $(if ($gone) { 'Green' } else { 'Red' })
      Write-Host ""
      if ($gone) { Write-Host "  ESCAPE HATCH VERIFIED (elevated, cross-session)" -ForegroundColor Green }
      else { Write-Host "  ESCAPE HATCH FAILED - do not begin Part A" -ForegroundColor Red }
    }
  }

  Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $script -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue

  $residue = @()
  if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) { $residue += ('task ' + $task) }
  if (Test-Path -LiteralPath $script) { $residue += $script }
  if (Test-Path -LiteralPath $marker) { $residue += $marker }
  Write-Host ""
  Write-Host ("residueLeft : " + ($residue.Count -gt 0)) -ForegroundColor $(if ($residue.Count) { 'Red' } else { 'Green' })
  $residue | ForEach-Object { Write-Host ("  residuePath: " + $_) -ForegroundColor Red }
}

if ($Verify) { Invoke-Verify } else { Invoke-Kill }
