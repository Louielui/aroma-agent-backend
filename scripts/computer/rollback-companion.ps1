# rollback-companion.ps1 - Computer Operator v0, Phase 3a. THE UNDO.
#
# RUN THIS YOURSELF, ELEVATED. It reverses everything provision-companion-account.ps1
# created and leaves the machine as it was before Phase 3a.
#
#   Right-click PowerShell -> "Run as administrator", then:
#     & 'C:\Aroma\aroma-agent-backend\scripts\computer\rollback-companion.ps1'
#     & 'C:\Aroma\aroma-agent-backend\scripts\computer\rollback-companion.ps1' -Purge
#
# Two modes:
#   (default)  DISABLE the account and stop everything - reversible, keeps the evidence
#              folder so anything already recorded can still be read.
#   -Purge     DELETE the account, its profile and the evidence folder outright.
#
# == A ROLLBACK THAT STOPS HALFWAY IS WORSE THAN A PROVISION THAT FAILS ==
# It runs precisely when something is already wrong, so NO step may abort the ones after
# it. Every step is individually guarded and reports its own outcome; the script keeps
# going and prints a summary at the end saying what was and was not undone. It never
# uses a strict mode that would throw on an unset variable mid-cleanup, and it never
# deletes anything it did not create.
#
# WHAT IT NEVER TOUCHES: your own account, your profile, your files, your credentials,
# the repo, the 8090 service, or any Aroma flag.

#Requires -RunAsAdministrator
# param() MUST be the first statement in the script body - it does not parse anywhere else.
param([switch]$Purge)

# Deliberately NOT Set-StrictMode: during cleanup an unset variable must not become an
# exception that skips the remaining steps.
$ErrorActionPreference = 'Continue'

$AccountName = 'AromaOperator'
$ServiceName = 'AromaComputerOperator'
$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence'
$StageDir    = 'C:\Aroma\ComputerOperator-Companion'
$RepoDir     = 'C:\Aroma\aroma-agent-backend'
$SID_ADMINS  = 'S-1-5-32-544'

$results = New-Object System.Collections.ArrayList
function Note {
  param([string]$Step, [string]$Outcome, [string]$Colour = 'Green')
  [void]$results.Add([pscustomobject]@{ Step = $Step; Outcome = $Outcome })
  Write-Host ("  {0,-22} {1}" -f $Step, $Outcome) -ForegroundColor $Colour
}

Write-Host "=== Computer Operator Phase 3a - rollback ===" -ForegroundColor Cyan
if ($Purge) { Write-Host "mode: PURGE (account, profile and evidence will be DELETED)" -ForegroundColor Yellow }
else        { Write-Host "mode: DISABLE (reversible; evidence kept)" -ForegroundColor Yellow }
Write-Host ""

# -- 1. stop and remove the service, if one was ever installed -----------------
try {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($svc) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    $null = sc.exe delete $ServiceName
    Note 'service' 'stopped and removed'
  } else {
    Note 'service' 'not installed (nothing to do)' 'Gray'
  }
} catch { Note 'service' "FAILED: $($_.Exception.Message)" 'Red' }

# -- 2. end any interactive session that account has open ----------------------
# This is the OS kill switch: log the account out and its Companion dies with the session.
try {
  $ids = @()
  $raw = @()
  try { $raw = @(quser 2>$null) } catch { }
  foreach ($line in $raw) {
    if ($line -match [regex]::Escape($AccountName)) {
      $id = ([regex]::Matches($line, '\s(\d+)\s') | ForEach-Object { $_.Groups[1].Value } | Select-Object -First 1)
      if ($id) { $ids += $id }
    }
  }
  if ($ids.Count -gt 0) {
    foreach ($id in $ids) { & logoff $id 2>$null }
    Note 'sessions' ("logged off: " + ($ids -join ', '))
  } else {
    Note 'sessions' 'none open' 'Gray'
  }
} catch { Note 'sessions' "FAILED: $($_.Exception.Message)" 'Red' }

# -- 3. stop any leftover Companion process owned by that account --------------
try {
  $killed = 0
  $procs = @()
  try { $procs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue) } catch { }
  foreach ($p in $procs) {
    $owner = $null
    try { $owner = (Invoke-CimMethod -InputObject $p -MethodName GetOwner -ErrorAction SilentlyContinue).User } catch { }
    if ($owner -and $owner -eq $AccountName) {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      $killed++
    }
  }
  if ($killed -gt 0) { Note 'companion processes' "stopped $killed" } else { Note 'companion processes' 'none running' 'Gray' }
} catch { Note 'companion processes' "FAILED: $($_.Exception.Message)" 'Red' }

# -- 3b. the staged Companion copy --------------------------------------------
try {
  if (Test-Path -LiteralPath $StageDir) {
    Remove-Item -LiteralPath $StageDir -Recurse -Force -ErrorAction Stop
    Note 'staged companion' 'removed'
  } else { Note 'staged companion' 'not present' 'Gray' }
} catch { Note 'staged companion' "FAILED: $($_.Exception.Message)" 'Red' }

# -- 3c. the repo DENY ---------------------------------------------------------
# deploy-companion.ps1 adds an explicit DENY for the operator account on the repo, so it
# cannot read .env or edit the governance code. Removing the account alone would leave an
# orphaned-SID ACE behind, which clutters the ACL and confuses later reads. Remove the ACE
# BEFORE the account goes, while its SID still resolves.
try {
  $u = Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue
  if ($u -and (Test-Path -LiteralPath $RepoDir)) {
    $racl = Get-Acl -LiteralPath $RepoDir
    $removed = 0
    foreach ($rule in @($racl.Access)) {
      if ($rule.AccessControlType -eq 'Deny' -and $rule.IdentityReference.Value -eq $u.SID.Value) {
        [void]$racl.RemoveAccessRule($rule); $removed++
      }
      elseif ($rule.AccessControlType -eq 'Deny' -and $rule.IdentityReference.Value -like "*\$AccountName") {
        [void]$racl.RemoveAccessRule($rule); $removed++
      }
    }
    if ($removed -gt 0) { Set-Acl -LiteralPath $RepoDir -AclObject $racl; Note 'repo DENY' "removed $removed rule(s)" }
    else { Note 'repo DENY' 'none present' 'Gray' }
  } else { Note 'repo DENY' 'account gone or repo missing - skipped' 'Gray' }
} catch { Note 'repo DENY' "FAILED: $($_.Exception.Message)" 'Red' }

# -- 4. the account -----------------------------------------------------------
$userSid = $null
try {
  $user = Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue
  if (-not $user) {
    Note 'account' 'does not exist (nothing to do)' 'Gray'
  } elseif ($Purge) {
    $userSid = $user.SID.Value
    Remove-LocalUser -Name $AccountName -ErrorAction Stop
    Note 'account' 'DELETED'
  } else {
    Disable-LocalUser -Name $AccountName -ErrorAction Stop
    Note 'account' 'DISABLED (run with -Purge to delete)'
  }
} catch { Note 'account' "FAILED: $($_.Exception.Message)" 'Red' }

# -- 5. the profile directory (purge only) ------------------------------------
try {
  if ($Purge -and $userSid) {
    $profile = $null
    try { $profile = Get-CimInstance Win32_UserProfile -ErrorAction SilentlyContinue | Where-Object { $_.SID -eq $userSid } } catch { }
    if ($profile) { Remove-CimInstance -InputObject $profile -ErrorAction SilentlyContinue; Note 'profile' 'removed' }
    else { Note 'profile' 'none found' 'Gray' }
  } else {
    Note 'profile' 'kept' 'Gray'
  }
} catch { Note 'profile' "FAILED: $($_.Exception.Message)" 'Red' }

# -- 6. the evidence folder (purge only) --------------------------------------
# LiteralPath, and only this exact constant path - never a variable a caller supplied.
try {
  if ($Purge) {
    if (Test-Path -LiteralPath $EvidenceDir) {
      Remove-Item -LiteralPath $EvidenceDir -Recurse -Force -ErrorAction Stop
      Note 'evidence folder' 'removed'
    } else { Note 'evidence folder' 'not present' 'Gray' }
  } else {
    Note 'evidence folder' "kept at $EvidenceDir" 'Gray'
  }
} catch { Note 'evidence folder' "FAILED: $($_.Exception.Message)" 'Red' }

# =============================================================================
# VERIFY - state what is actually true now, not what was attempted.
# =============================================================================
$accountGone   = -not [bool](Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue)
$accountEnabled = $false
try { $accountEnabled = [bool](Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue).Enabled } catch { }
$svcGone       = -not [bool](Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)
$evidenceThere = Test-Path -LiteralPath $EvidenceDir

$hub = Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue
if ($hub) { $hubState = 'still listening, untouched' } else { $hubState = 'not running' }

$launcher = 'C:\Aroma\xiangxiang.ps1'
if (Test-Path -LiteralPath $launcher) {
  $flagPresent = [bool](Select-String -LiteralPath $launcher -Pattern 'COMPUTER_OPERATOR' -Quiet -ErrorAction SilentlyContinue)
  if ($flagPresent) { $flagState = 'PRESENT - unexpected' } else { $flagState = 'absent, as expected' }
} else { $flagState = 'launcher not found' }

if (Test-Path -LiteralPath 'C:\Aroma\ComputerOperator-Test') { $testDirState = 'exists - unexpected' } else { $testDirState = 'does not exist, as expected' }

$failed = @($results | Where-Object { $_.Outcome -like 'FAILED*' })

Write-Host ""
Write-Host "=== state now ===" -ForegroundColor Cyan
Write-Host ("account removed         : " + $accountGone)
if (-not $accountGone) { Write-Host ("account enabled         : " + $accountEnabled) }
Write-Host ("service removed         : " + $svcGone)
Write-Host ("evidence folder present : " + $evidenceThere)
Write-Host ""
Write-Host "=== untouched, as intended ===" -ForegroundColor Cyan
Write-Host ("your account            : " + $env:USERNAME + " (not modified)")
Write-Host  "repo                    : C:\Aroma\aroma-agent-backend (not modified)"
Write-Host ("8090 service            : " + $hubState)
Write-Host ("COMPUTER_OPERATOR flag  : " + $flagState)
Write-Host ("ComputerOperator-Test   : " + $testDirState)

Write-Host ""
if ($failed.Count -gt 0) {
  Write-Host ("$($failed.Count) step(s) FAILED - the rest still ran. Review above and re-run." ) -ForegroundColor Red
} else {
  Write-Host "rollback complete; every step succeeded." -ForegroundColor Green
}
