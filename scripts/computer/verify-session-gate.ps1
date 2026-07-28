# verify-session-gate.ps1 - Computer Operator v0, Phase 3b. THE GO / NO-GO MEASUREMENT.
#
# RUN THIS YOURSELF, ELEVATED, after AromaOperator is signed in.
#
# It answers ONE question, with evidence: does the fixed Scheduled Task run in the SAME
# AromaOperator interactive session that the Companion runs in?
#
# Owner ruling item 10: if it does not, STOP and fall back to option C. Not "work around
# it with credentials", not "use a token API", not "elevate". Stop.
#
# This script cannot decide to proceed. It prints GATE PASSED or GATE FAILED and, on
# failure, says option C explicitly.

#Requires -RunAsAdministrator
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$TaskName    = 'AromaComputerOperator-SessionGate'
$AccountName = 'AromaOperator'
$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence'
$OutFile     = Join-Path $EvidenceDir 'session-identity-task.json'

Write-Host "=== Phase 3b - session gate verification ===" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1. is the account actually signed in?
# ---------------------------------------------------------------------------
$sessions = @()
try { $sessions = @(quser 2>$null) } catch { }
Write-Host ""
Write-Host "interactive sessions:" -ForegroundColor Cyan
$sessions | ForEach-Object { Write-Host ("  " + $_) }
$loggedOn = [bool]($sessions | Select-String -Pattern ([regex]::Escape($AccountName)) -Quiet)
Write-Host ""
Write-Host ("AromaOperator signed in : " + $loggedOn) -ForegroundColor $(if ($loggedOn) { 'Green' } else { 'Red' })
if (-not $loggedOn) {
  Write-Host ""
  Write-Host "GATE FAILED - the account is not signed in, so an interactive-token task" -ForegroundColor Red
  Write-Host "cannot run at all. Sign in as AromaOperator (Switch user) and run this again." -ForegroundColor Red
  Write-Host "Do NOT work around this with a stored password or a token API." -ForegroundColor Red
  return
}

# ---------------------------------------------------------------------------
# 2. run the fixed task and collect its identity
# ---------------------------------------------------------------------------
if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
  Write-Host "GATE FAILED - task not registered. Run register-session-gate-task.ps1 first." -ForegroundColor Red
  return
}
Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "starting the fixed task..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName
$waited = 0
while (-not (Test-Path -LiteralPath $OutFile) -and $waited -lt 60) { Start-Sleep -Milliseconds 500; $waited++ }

$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ("last run result : 0x{0:X}" -f $info.LastTaskResult)
Write-Host ("last run time   : " + $info.LastRunTime)

if (-not (Test-Path -LiteralPath $OutFile)) {
  Write-Host ""
  Write-Host "GATE FAILED - the task produced no output." -ForegroundColor Red
  Write-Host "0x41303 means it has never run; 0x41301 means it is still running." -ForegroundColor Yellow
  Write-Host "Do NOT switch to CreateProcessAsUser or a stored password. Fall back to option C." -ForegroundColor Red
  return
}

$taskIdentity = Get-Content -LiteralPath $OutFile -Raw | ConvertFrom-Json
Write-Host ""
Write-Host "=== identity reported by the TASK ===" -ForegroundColor Cyan
Write-Host ("  user          : " + $taskIdentity.userName)
Write-Host ("  SID           : " + $taskIdentity.userSid)
Write-Host ("  session id    : " + $taskIdentity.sessionId)
Write-Host ("  window station: " + $taskIdentity.windowStation)
Write-Host ("  desktop       : " + $taskIdentity.desktop)
Write-Host ("  interactive   : " + $taskIdentity.isInteractiveStation)

# ---------------------------------------------------------------------------
# 3. the verdict
# ---------------------------------------------------------------------------
$expectedSid = (Get-LocalUser -Name $AccountName).SID.Value
$checks = [ordered]@{
  'runs as AromaOperator'                = ($taskIdentity.userSid -eq $expectedSid)
  'runs on the interactive window station (WinSta0)' = ($taskIdentity.windowStation -eq 'WinSta0')
  'runs on the Default desktop'          = ($taskIdentity.desktop -eq 'Default')
  'session is a real logged-on session'  = ($taskIdentity.listedAsLoggedOn -eq $true)
  'session id is not the Owner session'  = ($taskIdentity.sessionId -ne (Get-Process -Id $PID).SessionId)
}

Write-Host ""
Write-Host "=== gate checks ===" -ForegroundColor Cyan
$allOk = $true
foreach ($k in $checks.Keys) {
  Write-Host ("  {0,-52} {1}" -f $k, $checks[$k]) -ForegroundColor $(if ($checks[$k]) { 'Green' } else { 'Red' })
  if (-not $checks[$k]) { $allOk = $false }
}

Write-Host ""
if ($allOk) {
  Write-Host "GATE PASSED - the fixed task runs in AromaOperator's own interactive session." -ForegroundColor Green
  Write-Host ""
  Write-Host "STILL OUTSTANDING before any observation capability is built: the COMPANION" -ForegroundColor Yellow
  Write-Host "must be proven to run in THIS SAME session. It is currently started by" -ForegroundColor Yellow
  Write-Host "Start-Process -Credential, which creates a separate non-interactive logon" -ForegroundColor Yellow
  Write-Host "session - so item 6's identity match would fail. Report this output to Claude." -ForegroundColor Yellow
} else {
  Write-Host "GATE FAILED - fall back to option C. Do not use credentials, token APIs" -ForegroundColor Red
  Write-Host "or elevation to force it." -ForegroundColor Red
}
