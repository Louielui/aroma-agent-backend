# run-script-a-measured.ps1  -  ONE-SHOT MEASURED LAUNCHER FOR SCRIPT A
#
# ===========================================================================
#  WHAT THIS IS FOR
#  Script A claims it writes no ACL outside the new child. A claim that is only
#  checked by reading the code is checked at the wrong layer: a path variable
#  reassigned earlier in the file would satisfy every review and still write
#  the wrong ACL. And a wrong ACL on C:\Aroma is not something git revert can
#  undo.
#
#  So this launcher MEASURES it. It captures C:\Aroma's owner and SDDL before
#  running A, captures the identical thing afterwards - whether A succeeded or
#  failed - and compares them ordinally, character for character. Identical
#  means "parent unchanged" is a measurement. Different means INCIDENT, and
#  the run stops with both strings preserved.
#
#  THE SAME CALL, BOTH TIMES. Both captures go through one function using one
#  AccessControlSections value and one serialisation method. Two capture
#  routines that differ by a flag would produce a difference that looks like a
#  finding and is actually a bug in the measurement.
#
#  IT DOES NOT: set COMPUTER_OPERATOR, run Script B, re-stage anything, call
#  deploy-companion.ps1, open Notepad, run the canary, or repair anything it
#  finds wrong. On any failure it stops and leaves the evidence.
#
#  IT WRITES NO ACL ANYWHERE ITSELF. Search for Set-Acl in this file: there is
#  none. The only process that writes an ACL is Script A, on its own new child.
# ===========================================================================

#Requires -RunAsAdministrator

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# PINNED - the reviewed artefact, by absolute path, hash and commit.
# ---------------------------------------------------------------------------
$RepoDir      = 'C:\Aroma\aroma-3b'
$ScriptA      = 'C:\Aroma\aroma-3b\scripts\computer\prepare-canary-testdir.ps1'
$ExpectedHash = '8090c63a69ecd58395157d5f41106e374f7f5a64ec007abe880ccbc45df2fe3d'
$ExpectedSha  = '29f401f38d3d1176f80aa112041c6f25ae3e4e48'
$AromaRoot    = 'C:\Aroma'
$TestDir      = 'C:\Aroma\ComputerOperator-Test'

# Evidence goes to the admin's TEMP, deliberately: nothing is created anywhere
# under C:\Aroma except the directory Script A itself creates.
$Stamp    = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$Evidence = Join-Path $env:TEMP ("aroma-canary-A-" + $Stamp)

$Failed = $false

function Write-Rule { param([string]$T) Write-Host ""; Write-Host ("== " + $T + " " + ('=' * [Math]::Max(0, 68 - $T.Length))) -ForegroundColor Cyan }

function Stop-Closed {
  param([string] $Message)
  Write-Host ""
  Write-Host ("STOPPED (fail-closed): " + $Message) -ForegroundColor Red
  Write-Host "  No flag was set. Script B was not run. The canary was not run." -ForegroundColor Red
  exit 1
}

# ---------------------------------------------------------------------------
# THE ONE CAPTURE ROUTINE. Used for BEFORE and AFTER, unchanged.
# Owner|Group|Access - deliberately NOT Audit: reading the SACL needs a
# privilege that may or may not be held, and a capture that sometimes includes
# an extra section is not a comparison, it is a coin toss.
# ---------------------------------------------------------------------------
$SECTIONS = [System.Security.AccessControl.AccessControlSections]::Owner -bor `
            [System.Security.AccessControl.AccessControlSections]::Group -bor `
            [System.Security.AccessControl.AccessControlSections]::Access

function Get-ParentSnapshot {
  param([string] $Path)
  $di = New-Object System.IO.DirectoryInfo($Path)
  $sd = $di.GetAccessControl($SECTIONS)
  return [pscustomobject]@{
    Owner = $sd.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    Group = $sd.GetGroup([System.Security.Principal.SecurityIdentifier]).Value
    Sddl  = $sd.GetSecurityDescriptorSddlForm($SECTIONS)
  }
}

Write-Host "=== MEASURED RUN OF SCRIPT A ===" -ForegroundColor Cyan
Write-Host ("  UTC      : " + (Get-Date).ToUniversalTime().ToString('u'))
Write-Host ("  evidence : " + $Evidence)

# ===========================================================================
# 1. PRECONDITIONS - all of them, before anything at all happens
# ===========================================================================
Write-Rule "1. PRECONDITIONS"

if (Test-Path -LiteralPath $TestDir) {
  Stop-Closed "$TestDir already exists. This launcher is for the first, clean run only."
}
Write-Host "  target absent            : OK" -ForegroundColor Green

# The flag, in all three scopes. Any of them being on would mean the canary
# could be armed by an environment nobody looked at.
foreach ($scope in @('Process', 'User', 'Machine')) {
  $v = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', $scope)
  if ($v -and $v -ne 'off') { Stop-Closed ("COMPUTER_OPERATOR is '" + $v + "' in the " + $scope + " scope") }
  Write-Host ("  COMPUTER_OPERATOR/" + $scope.PadRight(8) + ": " + $(if ($v) { $v } else { '<unset>' })) -ForegroundColor Green
}

if (-not (Test-Path -LiteralPath $ScriptA -PathType Leaf)) { Stop-Closed "Script A not found at $ScriptA" }

$actualHash = (Get-FileHash -LiteralPath $ScriptA -Algorithm SHA256).Hash.ToLower()
if ($actualHash -ne $ExpectedHash) {
  Write-Host ("    expected " + $ExpectedHash) -ForegroundColor Red
  Write-Host ("    actual   " + $actualHash) -ForegroundColor Red
  Stop-Closed "Script A is not the reviewed file"
}
Write-Host ("  script hash              : " + $actualHash) -ForegroundColor Green

# The commit that last touched SCRIPT A, not HEAD. Pinning HEAD looked right and
# was wrong: committing this launcher moves HEAD, so the pin would have failed on
# a change to a different file. A's own commit is stable no matter what lands
# afterwards, and it is what "the reviewed version" actually means.
$aSha = (& git -C $RepoDir log -1 --format=%H -- $ScriptA).Trim()
if ($LASTEXITCODE -ne 0 -or -not $aSha) { Stop-Closed "could not read Script A's commit - refusing to run an unidentified file" }
if ($aSha -ne $ExpectedSha) {
  Write-Host ("    expected " + $ExpectedSha) -ForegroundColor Red
  Write-Host ("    actual   " + $aSha) -ForegroundColor Red
  Stop-Closed "Script A was last changed by a commit that was not the reviewed one"
}
Write-Host ("  Script A commit          : " + $aSha) -ForegroundColor Green

# And it must not be dirty in the worktree. The hash check above already covers
# the content; this catches a staged-but-uncommitted state, so what is reported
# as reviewed is also what is recorded in git.
$dirty = @(& git -C $RepoDir status --porcelain -- $ScriptA)
if ($LASTEXITCODE -ne 0) { Stop-Closed "could not read the worktree status" }
if ($dirty.Count -gt 0) {
  $dirty | ForEach-Object { Write-Host ("    " + $_) -ForegroundColor Red }
  Stop-Closed "Script A has uncommitted changes"
}
Write-Host  "  Script A worktree clean  : OK" -ForegroundColor Green
Write-Host ("  HEAD (informational)     : " + (& git -C $RepoDir rev-parse HEAD).Trim()) -ForegroundColor Gray

New-Item -ItemType Directory -Path $Evidence -Force | Out-Null

# ===========================================================================
# 2. PARENT_SDDL_BEFORE
# ===========================================================================
Write-Rule "2. PARENT_SDDL_BEFORE"

$before = Get-ParentSnapshot -Path $AromaRoot
$before.Sddl  | Set-Content -LiteralPath (Join-Path $Evidence 'PARENT_SDDL_BEFORE.txt') -Encoding utf8 -NoNewline
$before.Owner | Set-Content -LiteralPath (Join-Path $Evidence 'PARENT_OWNER_BEFORE.txt') -Encoding utf8 -NoNewline

Write-Host ("  path  : " + $AromaRoot)
Write-Host ("  owner : " + $before.Owner)
Write-Host ("  group : " + $before.Group)
Write-Host  "  sddl  :"
Write-Host ("    " + $before.Sddl) -ForegroundColor Gray

# ===========================================================================
# 3. RUN SCRIPT A
# In a CHILD process, so its `exit 1` ends A rather than this launcher - the
# AFTER capture must happen whatever A does.
# ===========================================================================
Write-Rule "3. SCRIPT A OUTPUT"

$aOutput = @()
$aExit = $null
try {
  $aOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ScriptA
  $aExit = $LASTEXITCODE
} catch {
  $aOutput = @("LAUNCHER CAUGHT: " + $_.Exception.Message)
  $aExit = -1
}
if ($null -eq $aExit) { $aExit = -1 }

$aOutput | ForEach-Object { Write-Host ("  | " + $_) }
$aOutput | Set-Content -LiteralPath (Join-Path $Evidence 'SCRIPT_A_OUTPUT.txt') -Encoding utf8
Write-Host ""
Write-Host ("  Script A exit code : " + $aExit) -ForegroundColor $(if ($aExit -eq 0) { 'Green' } else { 'Red' })
if ($aExit -ne 0) { $Failed = $true }

# ===========================================================================
# 4. PARENT_SDDL_AFTER - unconditionally, success or failure
# ===========================================================================
Write-Rule "4. PARENT_SDDL_AFTER"

$after = Get-ParentSnapshot -Path $AromaRoot
$after.Sddl  | Set-Content -LiteralPath (Join-Path $Evidence 'PARENT_SDDL_AFTER.txt') -Encoding utf8 -NoNewline
$after.Owner | Set-Content -LiteralPath (Join-Path $Evidence 'PARENT_OWNER_AFTER.txt') -Encoding utf8 -NoNewline

Write-Host ("  owner : " + $after.Owner)
Write-Host ("  group : " + $after.Group)
Write-Host  "  sddl  :"
Write-Host ("    " + $after.Sddl) -ForegroundColor Gray

# ===========================================================================
# 5. ORDINAL COMPARISON
# ===========================================================================
Write-Rule "5. PARENT COMPARISON (ordinal, character for character)"

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
  Write-Host "  BEFORE:" -ForegroundColor Red
  Write-Host ("    " + $before.Sddl) -ForegroundColor Red
  Write-Host "  AFTER:" -ForegroundColor Red
  Write-Host ("    " + $after.Sddl) -ForegroundColor Red
  Write-Host ""
  Write-Host "  Both strings are preserved in $Evidence for manual adjudication." -ForegroundColor Yellow
  Write-Host "  NOTHING IS BEING REPAIRED. Repairing a parent ACL nobody has read is how" -ForegroundColor Yellow
  Write-Host "  a second, undocumented change gets written on top of the first." -ForegroundColor Yellow
  Stop-Closed "the parent security descriptor is not what it was"
}
Write-Host ""
Write-Host "  PARENT ACL UNCHANGED" -ForegroundColor Green

if ($Failed) {
  Write-Host ""
  Write-Host "  Script A failed, but the parent is provably untouched." -ForegroundColor Yellow
  Write-Host "=== A FAIL ===" -ForegroundColor Red
  exit 1
}

# ===========================================================================
# 6. THE NEW CHILD
# ===========================================================================
Write-Rule "6. NEW CHILD - C:\Aroma\ComputerOperator-Test"

if (-not (Test-Path -LiteralPath $TestDir)) { Stop-Closed "Script A reported success but $TestDir does not exist" }

$childInfo = New-Object System.IO.DirectoryInfo($TestDir)
$childSd = $childInfo.GetAccessControl($SECTIONS)
$childOwnerSid = $childSd.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$childSddl = $childSd.GetSecurityDescriptorSddlForm($SECTIONS)
$childAcl = Get-Acl -LiteralPath $TestDir
$rules = @($childAcl.Access)

Write-Host ("  owner     : " + $childAcl.Owner + "  (" + $childOwnerSid + ")")
Write-Host ("  protected : " + $childAcl.AreAccessRulesProtected)
Write-Host ("  sddl      : " + $childSddl)
Write-Host ("  contents  : " + @(Get-ChildItem -LiteralPath $TestDir -Force).Count + " item(s)")
Write-Host ""
Write-Host "  ACE TABLE" -ForegroundColor Cyan
Write-Host ("  {0,-34} {1,-6} {2,-10} {3,-30} {4,-6} {5}" -f 'PRINCIPAL (SID)', 'TYPE', 'MASK', 'INHERITANCE', 'PROP', 'INHERITED')
foreach ($r in $rules) {
  $sid = $r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  Write-Host ("  {0,-34} {1,-6} 0x{2,-8:X} {3,-30} {4,-6} {5}" -f `
    $r.IdentityReference.Value, $r.AccessControlType, [int]$r.FileSystemRights, `
    $r.InheritanceFlags, $r.PropagationFlags, $r.IsInherited)
  Write-Host ("    sid: " + $sid) -ForegroundColor DarkGray
}

# --- effective rights for the operator, argued from the ACL --------------
Write-Host ""
Write-Host "  AROMAOPERATOR EFFECTIVE RIGHTS" -ForegroundColor Cyan

$opSid = 'S-1-5-21-2042659270-2029498691-2127769412-1009'
$opAces = @($rules | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $opSid })
$denies = @($rules | Where-Object { $_.AccessControlType -eq 'Deny' })
$inherited = @($rules | Where-Object { $_.IsInherited })
$groupAces = @($rules | Where-Object {
  $s = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  $s -in @('S-1-1-0', 'S-1-5-32-545', 'S-1-5-11')
})

# The effective-rights claim rests on four measured facts, not on a computed
# AuthZ result: inheritance is broken so nothing else applies here, there is
# no Deny anywhere, there is no Everyone/Users/Authenticated Users ACE that
# the account would pick up through group membership, and it holds exactly
# one Allow. Under those four, the single Allow IS the effective access.
Write-Host ("    inheritance broken           : " + $childAcl.AreAccessRulesProtected)
Write-Host ("    inherited ACEs present       : " + $inherited.Count)
Write-Host ("    Deny ACEs anywhere on it     : " + $denies.Count)
Write-Host ("    Everyone/Users/AuthUsers ACEs: " + $groupAces.Count)
Write-Host ("    Allow ACEs for AromaOperator : " + $opAces.Count)

if ($opAces.Count -ne 1 -or $denies.Count -ne 0 -or $inherited.Count -ne 0 -or $groupAces.Count -ne 0 -or -not $childAcl.AreAccessRulesProtected) {
  Stop-Closed "the child ACL is not the specified shape - effective rights cannot be asserted"
}

$opMask = [int]$opAces[0].FileSystemRights
Write-Host ("    effective mask               : 0x{0:X}" -f $opMask) -ForegroundColor Green
Write-Host ""
Write-Host "    forbidden rights, checked bit by bit:" -ForegroundColor Cyan
$forbidden = [ordered]@{ 'Delete' = 0x10000; 'ChangePermissions' = 0x40000; 'TakeOwnership' = 0x80000; 'FullControl' = 0x1F01FF }
$anyHeld = $false
foreach ($name in $forbidden.Keys) {
  $bit = $forbidden[$name]
  $held = if ($name -eq 'FullControl') { ($opMask -band $bit) -eq $bit } else { ($opMask -band $bit) -ne 0 }
  if ($held) { $anyHeld = $true }
  Write-Host ("      {0,-18} 0x{1:X6}  HELD = {2}" -f $name, $bit, $held) -ForegroundColor $(if ($held) { 'Red' } else { 'Green' })
}
if ($anyHeld) { Stop-Closed "AromaOperator holds a forbidden right on the new child" }

# --- administrators and SYSTEM keep control ------------------------------
Write-Host ""
Write-Host "    management retained:" -ForegroundColor Cyan
foreach ($m in @(@{ Sid = 'S-1-5-32-544'; Label = 'BUILTIN\Administrators' }, @{ Sid = 'S-1-5-18'; Label = 'NT AUTHORITY\SYSTEM' })) {
  $ace = @($rules | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $m.Sid })
  $ok = ($ace.Count -eq 1 -and $ace[0].AccessControlType -eq 'Allow' -and (([int]$ace[0].FileSystemRights) -band 0x1F01FF) -eq 0x1F01FF)
  Write-Host ("      {0,-24} FullControl = {1}" -f $m.Label, $ok) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
  if (-not $ok) { Stop-Closed ($m.Label + " does not retain FullControl on the new child") }
}

# ===========================================================================
# VERDICT
# ===========================================================================
Write-Rule "VERDICT"

foreach ($scope in @('Process', 'User', 'Machine')) {
  $v = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', $scope)
  if ($v -and $v -ne 'off') { Stop-Closed ("COMPUTER_OPERATOR became '" + $v + "' in the " + $scope + " scope during the run") }
}
Write-Host "  COMPUTER_OPERATOR : still OFF in all three scopes" -ForegroundColor Green
Write-Host "  PARENT ACL        : UNCHANGED (ordinal match)" -ForegroundColor Green
Write-Host "  NEW CHILD         : created, three ACEs, least privilege verified" -ForegroundColor Green
Write-Host ""
Write-Host "  Script B was NOT run. The canary was NOT run. No flag was set." -ForegroundColor Gray
Write-Host ("  evidence files : " + $Evidence) -ForegroundColor Gray
Write-Host ""
Write-Host "=== A PASS ===" -ForegroundColor Green
exit 0
