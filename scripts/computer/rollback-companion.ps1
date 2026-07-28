# rollback-companion.ps1 — Computer Operator v0, Phase 3a. THE UNDO.
#
# RUN THIS YOURSELF, ELEVATED. It reverses everything provision-companion-account.ps1
# created and leaves the machine as it was before Phase 3a.
#
#   Right-click PowerShell -> "Run as administrator", then:
#     & 'C:\Aroma\aroma-agent-backend\scripts\computer\rollback-companion.ps1'
#
# Two modes:
#   (default)  DISABLE the account and stop everything — reversible, keeps the evidence
#              folder so anything already recorded can still be read.
#   -Purge     DELETE the account, its profile and the evidence folder outright.
#
# WHAT IT NEVER TOUCHES: your own account, your profile, your files, your credentials,
# the repo, the 8090 service, or any Aroma flag. It only unwinds what Phase 3a added.

#Requires -RunAsAdministrator
# param() MUST be the first statement in the script body — it does not parse anywhere else.
param([switch]$Purge)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$AccountName = 'AromaOperator'
$ServiceName = 'AromaComputerOperator'
$EvidenceDir = "C:\Aroma\ComputerOperator-Evidence"

Write-Host "=== Computer Operator Phase 3a — rollback ===" -ForegroundColor Cyan

# ── 1. stop the service, if one was ever installed ────────────────────────────
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
  Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  sc.exe delete $ServiceName | Out-Null
  Write-Host "service $ServiceName stopped and removed" -ForegroundColor Green
} else {
  Write-Host "service $ServiceName not installed (nothing to stop)"
}

# ── 2. end any session that account has open ──────────────────────────────────
# This is the OS kill switch: log the account out and its Companion dies with the session.
try {
  $sessions = (quser 2>$null) | Select-String -Pattern $AccountName
  foreach ($s in $sessions) {
    $id = ($s -split '\s+' | Where-Object { $_ -match '^\d+$' } | Select-Object -First 1)
    if ($id) { logoff $id; Write-Host "logged off session $id" -ForegroundColor Green }
  }
} catch { }

# ── 3. stop any leftover Companion process owned by that account ──────────────
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  $owner = (Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue).User
  if ($owner -eq $AccountName) {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "stopped Companion process $($_.ProcessId)" -ForegroundColor Green
  }
}

# ── 4. the account ────────────────────────────────────────────────────────────
$user = Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue
if (-not $user) {
  Write-Host "$AccountName does not exist (nothing to remove)"
} elseif ($Purge) {
  $sid = $user.SID.Value
  Remove-LocalUser -Name $AccountName
  Write-Host "$AccountName DELETED" -ForegroundColor Green
  $profile = Get-CimInstance Win32_UserProfile -ErrorAction SilentlyContinue | Where-Object { $_.SID -eq $sid }
  if ($profile) { Remove-CimInstance -InputObject $profile; Write-Host "profile removed" -ForegroundColor Green }
  if (Test-Path $EvidenceDir) { Remove-Item -Recurse -Force $EvidenceDir; Write-Host "evidence folder removed" -ForegroundColor Green }
} else {
  Disable-LocalUser -Name $AccountName
  Write-Host "$AccountName DISABLED (reversible; run with -Purge to delete)" -ForegroundColor Green
  Write-Host "evidence kept at $EvidenceDir"
}

# ── 5. confirm what was NOT touched ───────────────────────────────────────────
# Each value is computed into a variable first — an if/else inside an interpolated
# $( ) that also contains quotes does not parse.
$hub = Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue
if ($hub) { $hubState = 'still listening, untouched' } else { $hubState = 'not running' }

$flagPresent = Select-String -Path 'C:\Aroma\xiangxiang.ps1' -Pattern 'COMPUTER_OPERATOR' -Quiet -ErrorAction SilentlyContinue
if ($flagPresent) { $flagState = 'PRESENT - unexpected' } else { $flagState = 'absent, as expected' }

if (Test-Path 'C:\Aroma\ComputerOperator-Test') { $testDirState = 'exists - unexpected' } else { $testDirState = 'does not exist, as expected' }

Write-Host ""
Write-Host "=== untouched, as intended ===" -ForegroundColor Cyan
Write-Host ("your account            : " + $env:USERNAME + " (not modified)")
Write-Host  "repo                    : C:\Aroma\aroma-agent-backend (not modified)"
Write-Host ("8090 service            : " + $hubState)
Write-Host ("COMPUTER_OPERATOR flag  : " + $flagState)
Write-Host ("ComputerOperator-Test   : " + $testDirState)
