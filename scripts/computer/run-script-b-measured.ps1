# run-script-b-measured.ps1  -  ONE-SHOT MEASURED LAUNCHER FOR SCRIPT B
#
# ===========================================================================
#  Script B captures C:\Aroma before and after itself. That is useful and it is
#  not sufficient: a script measuring its own blast radius is the arrangement
#  where a bug in the measurement and a bug in the work hide each other. So the
#  parent descriptor is captured HERE, outside B, by a launcher that writes no
#  ACL at all - the same separation that was used for Script A and the reason
#  that run could be believed.
#
#  It also pins B by absolute path, SHA-256 and its own commit, and refuses if
#  the environment is not what was reviewed.
#
#  IT DOES NOT: set COMPUTER_OPERATOR, start the Companion, run the canary,
#  open Notepad, merge anything, or repair anything it finds wrong.
# ===========================================================================

#Requires -RunAsAdministrator

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoDir      = 'C:\Aroma\aroma-3b'
$ScriptB      = 'C:\Aroma\aroma-3b\scripts\computer\stage-companion.ps1'
$ExpectedHash = 'fe067bb28a1d0cb0aa8bc29e87dbedaab61c9b604b95bc732325ba059a05249c'
$ExpectedSha  = '5e44125b23feb87d6f34ad6910bf8e24cce00f45'
$AromaRoot    = 'C:\Aroma'
$StageDir     = 'C:\Aroma\ComputerOperator-Companion'
$MainSha      = '1a6d7bd5be558301baaa4628a757b303bf7a49ce'

$Stamp    = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$Evidence = Join-Path $env:TEMP ("aroma-canary-B-" + $Stamp)

function Write-Rule { param([string]$T) Write-Host ""; Write-Host ("== " + $T + " " + ('=' * [Math]::Max(0, 66 - $T.Length))) -ForegroundColor Cyan }

function Stop-Closed {
  param([string] $Message)
  Write-Host ""
  Write-Host ("STOPPED (fail-closed): " + $Message) -ForegroundColor Red
  Write-Host "  No flag was set. The Companion was not started. The canary was not run." -ForegroundColor Red
  Write-Host "=== B FAIL ===" -ForegroundColor Red
  exit 1
}

# One capture routine, one sections value, one serialisation - used for BEFORE
# and AFTER unchanged. Audit is excluded on purpose: reading the SACL needs a
# privilege that may not be held, and a capture that sometimes carries an extra
# section is a coin toss rather than a comparison.
$SECTIONS = [System.Security.AccessControl.AccessControlSections]::Owner -bor `
            [System.Security.AccessControl.AccessControlSections]::Group -bor `
            [System.Security.AccessControl.AccessControlSections]::Access

function Get-SdSnapshot {
  param([string] $Path)
  $di = New-Object System.IO.DirectoryInfo($Path)
  $sd = $di.GetAccessControl($SECTIONS)
  return [pscustomobject]@{
    Owner = $sd.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    Group = $sd.GetGroup([System.Security.Principal.SecurityIdentifier]).Value
    Sddl  = $sd.GetSecurityDescriptorSddlForm($SECTIONS)
  }
}

Write-Host "=== MEASURED RUN OF SCRIPT B ===" -ForegroundColor Cyan
Write-Host ("  UTC      : " + (Get-Date).ToUniversalTime().ToString('u'))
Write-Host ("  evidence : " + $Evidence)

# ===========================================================================
Write-Rule "1. PRECONDITIONS"

foreach ($scope in @('Process', 'User', 'Machine')) {
  $v = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', $scope)
  if ($v -and $v -ne 'off') { Stop-Closed ("COMPUTER_OPERATOR is '" + $v + "' in the " + $scope + " scope") }
  Write-Host ("  COMPUTER_OPERATOR/" + $scope.PadRight(8) + ": " + $(if ($v) { $v } else { '<unset>' })) -ForegroundColor Green
}

if (-not (Test-Path -LiteralPath $ScriptB -PathType Leaf)) { Stop-Closed "Script B not found at $ScriptB" }
$actualHash = (Get-FileHash -LiteralPath $ScriptB -Algorithm SHA256).Hash.ToLower()
if ($actualHash -ne $ExpectedHash) {
  Write-Host ("    expected " + $ExpectedHash) -ForegroundColor Red
  Write-Host ("    actual   " + $actualHash) -ForegroundColor Red
  Stop-Closed "Script B is not the reviewed file"
}
Write-Host ("  script hash              : " + $actualHash) -ForegroundColor Green

# B's own commit, not HEAD - HEAD moves when anything else lands.
$bSha = (& git -C $RepoDir log -1 --format=%H -- $ScriptB).Trim()
if ($LASTEXITCODE -ne 0 -or -not $bSha) { Stop-Closed "could not read Script B's commit" }
if ($bSha -ne $ExpectedSha) {
  Write-Host ("    expected " + $ExpectedSha) -ForegroundColor Red
  Write-Host ("    actual   " + $bSha) -ForegroundColor Red
  Stop-Closed "Script B was last changed by a commit that was not the reviewed one"
}
Write-Host ("  Script B commit          : " + $bSha) -ForegroundColor Green

$dirty = @(& git -C $RepoDir status --porcelain -- $ScriptB)
if ($dirty.Count -gt 0) { Stop-Closed "Script B has uncommitted changes" }
Write-Host  "  Script B worktree clean  : OK" -ForegroundColor Green

# main must not have moved. Checked here rather than trusted, because "main is
# untouched" is one of the things being reported at the end.
$mainNow = (& git -C $RepoDir rev-parse main).Trim()
if ($mainNow -ne $MainSha) { Stop-Closed ("main is at " + $mainNow + ", expected " + $MainSha) }
Write-Host ("  main                     : " + $mainNow + " (unchanged)") -ForegroundColor Green

New-Item -ItemType Directory -Path $Evidence -Force | Out-Null

# ===========================================================================
Write-Rule "2. PARENT_SDDL_BEFORE"
$before = Get-SdSnapshot -Path $AromaRoot
$before.Sddl  | Set-Content -LiteralPath (Join-Path $Evidence 'PARENT_SDDL_BEFORE.txt') -Encoding utf8 -NoNewline
$before.Owner | Set-Content -LiteralPath (Join-Path $Evidence 'PARENT_OWNER_BEFORE.txt') -Encoding utf8 -NoNewline
Write-Host ("  owner : " + $before.Owner)
Write-Host ("  group : " + $before.Group)
Write-Host ("  sddl  : " + $before.Sddl) -ForegroundColor Gray

# ===========================================================================
Write-Rule "3. SCRIPT B OUTPUT"
$bOutput = @()
$bExit = -1
try {
  $bOutput = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ScriptB)
  $bExit = $LASTEXITCODE
} catch {
  $bOutput = @("LAUNCHER CAUGHT: " + $_.Exception.Message)
  $bExit = -1
}
$bOutput | ForEach-Object { Write-Host ("  | " + $_) }
$bOutput | Set-Content -LiteralPath (Join-Path $Evidence 'SCRIPT_B_OUTPUT.txt') -Encoding utf8
Write-Host ""
Write-Host ("  Script B exit code : " + $bExit) -ForegroundColor $(if ($bExit -eq 0) { 'Green' } else { 'Red' })

# ===========================================================================
# Unconditional: the failure path is exactly where this measurement matters.
Write-Rule "4. PARENT_SDDL_AFTER"
$after = Get-SdSnapshot -Path $AromaRoot
$after.Sddl  | Set-Content -LiteralPath (Join-Path $Evidence 'PARENT_SDDL_AFTER.txt') -Encoding utf8 -NoNewline
$after.Owner | Set-Content -LiteralPath (Join-Path $Evidence 'PARENT_OWNER_AFTER.txt') -Encoding utf8 -NoNewline
Write-Host ("  owner : " + $after.Owner)
Write-Host ("  group : " + $after.Group)
Write-Host ("  sddl  : " + $after.Sddl) -ForegroundColor Gray

# ===========================================================================
Write-Rule "5. PARENT COMPARISON (ordinal)"
$sddlSame  = [string]::Equals($before.Sddl,  $after.Sddl,  [System.StringComparison]::Ordinal)
$ownerSame = [string]::Equals($before.Owner, $after.Owner, [System.StringComparison]::Ordinal)
$groupSame = [string]::Equals($before.Group, $after.Group, [System.StringComparison]::Ordinal)
Write-Host ("  owner identical : " + $ownerSame) -ForegroundColor $(if ($ownerSame) { 'Green' } else { 'Red' })
Write-Host ("  group identical : " + $groupSame) -ForegroundColor $(if ($groupSame) { 'Green' } else { 'Red' })
Write-Host ("  SDDL  identical : " + $sddlSame)  -ForegroundColor $(if ($sddlSame)  { 'Green' } else { 'Red' })
Write-Host ("  SDDL length     : before " + $before.Sddl.Length + ", after " + $after.Sddl.Length)

if (-not ($sddlSame -and $ownerSame -and $groupSame)) {
  Write-Host ""
  Write-Host "*** PARENT ACL CHANGED - INCIDENT ***" -ForegroundColor Red
  Write-Host ("  BEFORE: " + $before.Sddl) -ForegroundColor Red
  Write-Host ("  AFTER : " + $after.Sddl) -ForegroundColor Red
  Write-Host ("  Both preserved in " + $Evidence + ". Nothing is being repaired.") -ForegroundColor Yellow
  Stop-Closed "the parent security descriptor is not what it was"
}
Write-Host ""
Write-Host "  PARENT ACL UNCHANGED" -ForegroundColor Green

if ($bExit -ne 0) {
  Write-Host ""
  Write-Host "  Script B failed, and the parent is provably untouched by it." -ForegroundColor Yellow
  Write-Host "=== B FAIL ===" -ForegroundColor Red
  exit 1
}

# ===========================================================================
Write-Rule "6. STAGED RESULT"
if (-not (Test-Path -LiteralPath $StageDir)) { Stop-Closed "Script B reported success but the staging directory does not exist" }
$staged = @(Get-ChildItem -LiteralPath $StageDir -File | Sort-Object Name)
Write-Host ("  " + $staged.Count + " file(s):")
foreach ($f in $staged) {
  Write-Host ("    " + (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower() + "  " + $f.Name)
}
$stageSnap = Get-SdSnapshot -Path $StageDir
Write-Host ("  owner : " + $stageSnap.Owner)
Write-Host ("  sddl  : " + $stageSnap.Sddl) -ForegroundColor Gray

Write-Rule "VERDICT"
foreach ($scope in @('Process', 'User', 'Machine')) {
  $v = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', $scope)
  if ($v -and $v -ne 'off') { Stop-Closed ("COMPUTER_OPERATOR became '" + $v + "' during the run") }
}
$mainAfter = (& git -C $RepoDir rev-parse main).Trim()
if ($mainAfter -ne $MainSha) { Stop-Closed ("main moved to " + $mainAfter) }

Write-Host "  COMPUTER_OPERATOR : still OFF in all three scopes" -ForegroundColor Green
Write-Host ("  main              : " + $mainAfter + " (unchanged)") -ForegroundColor Green
Write-Host "  PARENT ACL        : UNCHANGED (ordinal match)" -ForegroundColor Green
Write-Host ("  staged            : " + $staged.Count + " files") -ForegroundColor Green
Write-Host ("  evidence          : " + $Evidence) -ForegroundColor Gray
Write-Host ""
Write-Host "  Canary NOT run. Flag NOT set. Companion NOT started." -ForegroundColor Gray
Write-Host "=== B PASS ===" -ForegroundColor Green
exit 0
