# observer-kill.ps1 - stop the Observer, and PROVE it stopped.
#
# The fourth kill binding. The three demonstrated in 3a were all proven against the
# Companion, and none of them reach the Observer: it is a separate process started by a
# scheduled task, so serviceGate only blocks the next dispatch, companionAbort stops a
# process with no parent-child link to it, and osBackstop destroys a channel it does not
# use to do its work. An observation in flight survives all three.
#
# WHAT "STOPPED" MEANS HERE
# Not "the stop command returned without error". The PID is polled until it is genuinely
# absent, because a stop that was never confirmed is the same shape as the 3a KILL 3
# failure - a target that was already gone made every kill look successful.
#
# SCOPE. This is the SAME-ACCOUNT, same-session stop: the harness runs as AromaOperator and
# stops its own Observer, which is the Part B case. An Owner-initiated cross-session kill
# needs elevation - measured: OpenProcess for PROCESS_TERMINATE across sessions returns
# ERROR_ACCESS_DENIED unelevated - and lives in owner-escape-hatch.ps1.

param(
  [string]$TaskName = 'AromaComputerOperator-Observer',
  [int]$ObserverPid = 0,
  [int]$TimeoutMs = 10000,
  [string]$OutJson = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$idn = [Security.Principal.WindowsIdentity]::GetCurrent()
$mySession = (Get-Process -Id $PID).SessionId
$started = Get-Date

Write-Host ("running as : " + $idn.Name + "  SessionId=" + $mySession)
Write-Host ""

function Wait-Gone {
  param([int]$TargetPid, [int]$MaxMs)
  $waited = 0
  while ($waited -lt $MaxMs) {
    if (-not (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 250; $waited += 250
  }
  $false
}

$result = [ordered]@{
  probe = 'observer-kill'
  taskName = $TaskName
  requestedPid = $ObserverPid
  aliveBefore = $null
  stopScheduledTaskRan = $false
  stopProcessRan = $false
  gone = $null
  verdict = $null
  residueLeft = $false
  residuePath = $null
  measuredBy = $idn.Name; measuredSid = $idn.User.Value; sessionId = $mySession
  at = $started.ToString('o'); elapsedMs = $null
}

# LIVENESS FIRST. Without this a kill against nothing reports success and proves nothing.
if ($ObserverPid -gt 0) {
  $result.aliveBefore = [bool](Get-Process -Id $ObserverPid -ErrorAction SilentlyContinue)
  Write-Host ("target PID " + $ObserverPid + " alive before : " + $result.aliveBefore) -ForegroundColor $(if ($result.aliveBefore) { 'Green' } else { 'Yellow' })
}

try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop; $result.stopScheduledTaskRan = $true }
catch { Write-Host ("Stop-ScheduledTask: " + $_.Exception.Message) -ForegroundColor Yellow }

if ($ObserverPid -gt 0) {
  try { Stop-Process -Id $ObserverPid -Force -ErrorAction Stop; $result.stopProcessRan = $true }
  catch { Write-Host ("Stop-Process: " + $_.Exception.Message) -ForegroundColor Yellow }
  $result.gone = Wait-Gone -TargetPid $ObserverPid -MaxMs $TimeoutMs
}

$result.elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds

if ($ObserverPid -le 0) {
  # No PID to verify against, so nothing here can be claimed. Stopping the task may well
  # have worked; "may well have" is not a result.
  $result.verdict = 'INVALID'
  $result.residuePath = 'no observer pid supplied - stop not verifiable'
  $result.residueLeft = $true
} elseif ($result.aliveBefore -ne $true) {
  $result.verdict = 'INVALID'
  $result.residuePath = 'target was not proven alive before the kill'
} elseif ($result.gone -eq $true) {
  $result.verdict = 'STOPPED'
} else {
  $result.verdict = 'TIMEOUT-ORPHAN'
  $result.residueLeft = $true
  $result.residuePath = ('process ' + $ObserverPid + ' still running after ' + $TimeoutMs + 'ms')
}

Write-Host ""
Write-Host ("verdict : " + $result.verdict) -ForegroundColor $(if ($result.verdict -eq 'STOPPED') { 'Green' } else { 'Red' })
if ($result.residuePath) { Write-Host ("residue : " + $result.residuePath) -ForegroundColor Red }

$json = ($result | ConvertTo-Json -Depth 5 -Compress)
Write-Output $json
if ($OutJson) {
  try { Set-Content -LiteralPath $OutJson -Value $json -Encoding UTF8 -ErrorAction Stop }
  catch { Write-Host ("COULD NOT WRITE: " + $_.Exception.Message) -ForegroundColor Red }
}

if ($result.verdict -eq 'TIMEOUT-ORPHAN') { exit 9 }
if ($result.verdict -eq 'INVALID') { exit 8 }
exit 0
