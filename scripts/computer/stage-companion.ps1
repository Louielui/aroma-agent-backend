# stage-companion.ps1  -  SCRIPT B
#
# ===========================================================================
#  ONE PURPOSE: re-stage the Companion, because its require closure grew from
#  five files to seven and the deployed copy is stale.
#
#  IT DOES NOT: start the Companion, set COMPUTER_OPERATOR, run the canary,
#  open Notepad, touch the parent ACL, touch any other child, call
#  deploy-companion.ps1, or merge anything.
#
#  ── THE HONEST PART, SAID FIRST ─────────────────────────────────────────
#  Unlike Script A, this CANNOT meet "only touch the new child". Re-staging
#  means deleting and rebuilding an EXISTING child. Two paths are written:
#
#      C:\Aroma\ComputerOperator-Companion   the staging directory
#      C:\Aroma\ComputerOperator-Backups     the backup, which exists only
#                                            because deleting without one
#                                            was rejected
#
#  Everything else under C:\Aroma is read-only here, and the parent's own
#  descriptor is never written at all.
#
#  ── BACKUP BEFORE DELETE, VERIFIED, WITH AUTOMATIC RESTORE ──────────────
#  deploy-companion.ps1 does Remove-Item -Recurse -Force and then rebuilds.
#  If anything fails between those two, the old staging is gone. This script
#  copies first, VERIFIES THE COPY BY HASH, and only then deletes. Any failure
#  after the delete restores from that backup before exiting.
#
#  ── IT DOES NOT DECIDE WHAT TO DESTROY ──────────────────────────────────
#  The staging directory is inventoried read-only FIRST. Anything present that
#  is not one of the seven closure files stops the run and is reported. A
#  re-stage once silently destroyed session-identity.ps1 and only one Tier A
#  row ever noticed. There is no -ForceRestage here, deliberately.
#
#  ── ARRAY UNWRAPPING ────────────────────────────────────────────────────
#  Every .Count and every index below reads a variable assigned through @( ),
#  or wraps the call site. PowerShell unwraps one-element arrays on return and
#  yields $null for empty ones, and under StrictMode that is fatal in exactly
#  the two cases that are CORRECT. It already killed one elevated run.
# ===========================================================================

#Requires -RunAsAdministrator

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# PINNED SPECIFICATION
# ---------------------------------------------------------------------------
$RepoDir     = 'C:\Aroma\aroma-3b'
$Branch      = 'feat/computer-3b-observation'
$SourceSha   = '3a6b5ab343b5878b4b58d9ca2a2c13d0079f17c9'  # last commit touching any closure file
$AromaRoot   = 'C:\Aroma'
$StageDir    = 'C:\Aroma\ComputerOperator-Companion'
$BackupRoot  = 'C:\Aroma\ComputerOperator-Backups'
$AccountName = 'AromaOperator'
$Node        = 'C:\Program Files\nodejs\node.exe'

$SID_OPERATOR = 'S-1-5-21-2042659270-2029498691-2127769412-1009'
$SID_ADMINS   = 'S-1-5-32-544'
$SID_SYSTEM   = 'S-1-5-18'

$MASK_READEXEC = 0x1200A9   # ReadAndExecute, +SYNCHRONIZE as .NET builds an Allow rule
$MASK_FULL     = 0x1F01FF   # FullControl,    +SYNCHRONIZE

# The closure, by name and by content. Both are checked: the name list catches
# a file appearing or vanishing, the hashes catch a file being different.
$CLOSURE = [ordered]@{
  'companion-entry.js'      = '1edf466f76adab982e7b17e39953f4b0867fd65e9f29ece03e419f916294bef2'
  'companion.js'            = 'b6c4ae49895686ab2bae31832f256929b1bb759f26dc1fc3b86d53733168709a'
  'computerOperatorFlag.js' = '7041ab939688e167c3d417a022988171be5cbc8b5f2dfcf6886fd5ced8f5644b'
  'ipcChannel.js'           = '1d748ae2e7fd770fb973849bd3281e239c7ff86d127205001312afd2a60e06bf'
  'observation.js'          = '942dabf0ba653ff36afc47abd74763caa358d7fd9456254c5592043705d02b17'
  'sealedOrderGate.js'      = 'c7c7d78dbd0a88ecedcb494f9790a58d61f8c961db7d5d9b59f9bda45eaac4b3'
  'sessionBoundary.js'      = '3ade684cd16e58556780dec0f2bf9b7f7cbce811726e72cb806d6c840dbeea28'
}
$ClosureNames = @($CLOSURE.Keys)

$Stamp     = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$BackupDir = Join-Path $BackupRoot ("companion-" + $Stamp)

# State needed by the restore path.
$script:OriginalSddl  = $null
$script:OriginalFiles = @()
$script:BackupReady   = $false
$script:StageDeleted  = $false

$SECTIONS = [System.Security.AccessControl.AccessControlSections]::Owner -bor `
            [System.Security.AccessControl.AccessControlSections]::Group -bor `
            [System.Security.AccessControl.AccessControlSections]::Access

function Write-Rule { param([string]$T) Write-Host ""; Write-Host ("== " + $T + " " + ('=' * [Math]::Max(0, 66 - $T.Length))) -ForegroundColor Cyan }

function Get-SdSnapshot {
  param([string] $Path)
  $di = New-Object System.IO.DirectoryInfo($Path)
  $sd = $di.GetAccessControl($SECTIONS)
  return [pscustomobject]@{
    Owner = $sd.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    Sddl  = $sd.GetSecurityDescriptorSddlForm($SECTIONS)
  }
}

function Restore-Staging {
  # Only meaningful once the backup is verified AND the old staging is gone.
  if (-not $script:BackupReady -or -not $script:StageDeleted) { return 'not_needed' }
  try {
    Write-Host "  RESTORING from backup..." -ForegroundColor Yellow
    if (Test-Path -LiteralPath $StageDir) { Remove-Item -LiteralPath $StageDir -Recurse -Force }
    New-Item -ItemType Directory -Path $StageDir | Out-Null
    foreach ($f in @(Get-ChildItem -LiteralPath $BackupDir -File)) {
      if ($f.Name -eq 'BACKUP-MANIFEST.txt') { continue }
      Copy-Item -LiteralPath $f.FullName -Destination $StageDir
    }
    if ($script:OriginalSddl) {
      $racl = Get-Acl -LiteralPath $StageDir
      $racl.SetSecurityDescriptorSddlForm($script:OriginalSddl)
      Set-Acl -LiteralPath $StageDir -AclObject $racl
    }
    Write-Host "  restored" -ForegroundColor Yellow
    return 'restored'
  } catch {
    Write-Host ("  RESTORE FAILED: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host ("  The backup is intact at " + $BackupDir) -ForegroundColor Red
    return 'restore_failed'
  }
}

function Stop-Closed {
  param([string] $Message)
  $r = Restore-Staging
  Write-Host ""
  Write-Host ("STOPPED (fail-closed): " + $Message) -ForegroundColor Red
  Write-Host ("  restore: " + $r) -ForegroundColor Yellow
  Write-Host "  No flag was set. The Companion was not started. The canary was not run." -ForegroundColor Red
  Write-Host "=== B FAIL ===" -ForegroundColor Red
  exit 1
}

function Set-ProtectedAcl {
  # Break inheritance and grant explicitly. ($true,$false) discards inherited
  # ACEs - keeping them would keep C:\Aroma's inherit-only Deny FullControl for
  # the operator, and a Deny beats an Allow.
  param([string] $Path, [bool] $IncludeOperator)
  $a = Get-Acl -LiteralPath $Path
  $a.SetAccessRuleProtection($true, $false)
  if ($IncludeOperator) {
    $a.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier($SID_OPERATOR)), 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  $a.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($SID_ADMINS)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  $a.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($SID_SYSTEM)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  Set-Acl -LiteralPath $Path -AclObject $a
}

function Test-Acl {
  param([string] $Path, [string] $Label, [hashtable] $Expected)
  $acl = Get-Acl -LiteralPath $Path
  $rules = @($acl.Access)
  Write-Host ("  " + $Label) -ForegroundColor Cyan
  Write-Host ("    owner     : " + $acl.Owner)
  Write-Host ("    protected : " + $acl.AreAccessRulesProtected)
  Write-Host ("    sddl      : " + (Get-SdSnapshot -Path $Path).Sddl)

  if (-not $acl.AreAccessRulesProtected) { Stop-Closed ($Label + ": inheritance is not protected") }
  $inh = @($rules | Where-Object { $_.IsInherited })
  if ($inh.Count -gt 0) { Stop-Closed ($Label + ": " + $inh.Count + " inherited ACE(s) survived") }
  $den = @($rules | Where-Object { $_.AccessControlType -eq 'Deny' })
  if ($den.Count -gt 0) { Stop-Closed ($Label + ": " + $den.Count + " Deny ACE(s) present") }
  if ($rules.Count -ne $Expected.Count) {
    $rules | ForEach-Object { Write-Host ("      " + $_.IdentityReference.Value + " " + $_.AccessControlType + " 0x" + ('{0:X}' -f [int]$_.FileSystemRights)) -ForegroundColor Red }
    Stop-Closed ($Label + ": expected " + $Expected.Count + " ACE(s), found " + $rules.Count)
  }
  foreach ($sid in @($Expected.Keys)) {
    $ace = @($rules | Where-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $sid })
    if ($ace.Count -ne 1) { Stop-Closed ($Label + ": expected one ACE for " + $sid + ", found " + $ace.Count) }
    if ($ace[0].AccessControlType -ne 'Allow') { Stop-Closed ($Label + ": " + $sid + " is not an Allow") }
    if ([int]$ace[0].FileSystemRights -ne $Expected[$sid]) {
      Stop-Closed ($Label + ": " + $sid + " mask is 0x" + ('{0:X}' -f [int]$ace[0].FileSystemRights) + ", expected 0x" + ('{0:X}' -f $Expected[$sid]))
    }
  }
  Write-Host ("    ACEs      : " + $rules.Count + " as specified, no Deny, no inherited") -ForegroundColor Green
}

Write-Host "=== SCRIPT B - re-stage the Companion ===" -ForegroundColor Cyan
Write-Host ("  UTC : " + (Get-Date).ToUniversalTime().ToString('u'))

# ===========================================================================
# 0. PREFLIGHT
# ===========================================================================
Write-Rule "0. PREFLIGHT"

if (-not (Test-Path -LiteralPath $Node)) { Stop-Closed "node.exe not found at $Node" }
if (-not (Test-Path -LiteralPath $RepoDir -PathType Container)) { Stop-Closed "repo not found: $RepoDir" }

foreach ($scope in @('Process', 'User', 'Machine')) {
  $v = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', $scope)
  if ($v -and $v -ne 'off') { Stop-Closed ("COMPUTER_OPERATOR is '" + $v + "' in the " + $scope + " scope") }
}
Write-Host "  COMPUTER_OPERATOR : OFF in Process, User and Machine" -ForegroundColor Green

$branchNow = (& git -C $RepoDir rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0) { Stop-Closed "could not read the branch" }
if ($branchNow -ne $Branch) { Stop-Closed ("worktree is on '" + $branchNow + "', expected '" + $Branch + "'") }
Write-Host ("  branch            : " + $branchNow) -ForegroundColor Green

$srcPaths = @($ClosureNames | ForEach-Object {
  $p = Join-Path (Join-Path $RepoDir 'src\computer') $_
  if (Test-Path -LiteralPath $p) { $p } else { Join-Path (Join-Path $RepoDir 'scripts\computer') $_ }
})
$closureSha = (& git -C $RepoDir log -1 --format=%H -- $srcPaths).Trim()
if ($LASTEXITCODE -ne 0 -or -not $closureSha) { Stop-Closed "could not read the closure commit" }
if ($closureSha -ne $SourceSha) {
  Write-Host ("    expected " + $SourceSha) -ForegroundColor Red
  Write-Host ("    actual   " + $closureSha) -ForegroundColor Red
  Stop-Closed "the closure sources were last changed by a commit that is not the reviewed one"
}
Write-Host ("  closure commit    : " + $closureSha) -ForegroundColor Green
Write-Host ("  HEAD (info)       : " + (& git -C $RepoDir rev-parse HEAD).Trim()) -ForegroundColor Gray

# ===========================================================================
# 1. THE MANIFEST - derived, then checked against the pinned closure
# ===========================================================================
Write-Rule "1. SOURCE MANIFEST"

$manifest = @(& $Node (Join-Path $RepoDir 'scripts\computer\companionManifest.js') --list)
if ($LASTEXITCODE -ne 0 -or $manifest.Count -eq 0) { Stop-Closed "could not compute the manifest" }

$manifestNames = @($manifest | ForEach-Object { Split-Path $_ -Leaf } | Sort-Object)
$diff = @(Compare-Object -ReferenceObject (@($ClosureNames) | Sort-Object) -DifferenceObject $manifestNames)
if ($diff.Count -gt 0) {
  $diff | ForEach-Object {
    $side = if ($_.SideIndicator -eq '<=') { 'MISSING   ' } else { 'UNEXPECTED' }
    Write-Host ("    " + $side + " " + $_.InputObject) -ForegroundColor Red
  }
  Stop-Closed "the derived closure is not the reviewed seven files - refusing to fall back to anything"
}

Write-Host ("  " + $manifest.Count + " files, hashes checked against the pinned closure:") -ForegroundColor Green
foreach ($src in $manifest) {
  $name = Split-Path $src -Leaf
  $h = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash.ToLower()
  if ($h -ne $CLOSURE[$name]) {
    Write-Host ("    " + $name + " expected " + $CLOSURE[$name]) -ForegroundColor Red
    Write-Host ("    " + $name + " actual   " + $h) -ForegroundColor Red
    Stop-Closed ("source hash mismatch: " + $name)
  }
  Write-Host ("    " + $h + "  " + $name) -ForegroundColor Green
}

# ===========================================================================
# 2. PARENT SDDL - BEFORE
# ===========================================================================
Write-Rule "2. PARENT_SDDL_BEFORE"
$parentBefore = Get-SdSnapshot -Path $AromaRoot
Write-Host ("  owner : " + $parentBefore.Owner)
Write-Host ("  sddl  : " + $parentBefore.Sddl) -ForegroundColor Gray

# ===========================================================================
# 3. INVENTORY THE EXISTING STAGING - READ ONLY. NOTHING IS DELETED HERE.
# ===========================================================================
Write-Rule "3. EXISTING STAGING INVENTORY (read-only)"

if (-not (Test-Path -LiteralPath $StageDir)) {
  Write-Host "  the staging directory does not exist - nothing to back up" -ForegroundColor Yellow
  $script:OriginalFiles = @()
} else {
  $snap = Get-SdSnapshot -Path $StageDir
  $script:OriginalSddl = $snap.Sddl
  Write-Host ("  path  : " + $StageDir)
  Write-Host ("  owner : " + $snap.Owner)
  Write-Host ("  sddl  : " + $snap.Sddl) -ForegroundColor Gray
  Write-Host ""

  $script:OriginalFiles = @(Get-ChildItem -LiteralPath $StageDir -Force)
  Write-Host ("  " + $script:OriginalFiles.Count + " item(s):")
  foreach ($f in $script:OriginalFiles) {
    $h = if ($f.PSIsContainer) { '<directory>'.PadRight(64) } else { (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower() }
    Write-Host ("    {0}  {1,10}  {2}" -f $h, $(if ($f.PSIsContainer) { '-' } else { $f.Length }), $f.Name)
  }

  $foreign = @($script:OriginalFiles | Where-Object { $ClosureNames -notcontains $_.Name })
  if ($foreign.Count -gt 0) {
    Write-Host ""
    Write-Host "*** UNDECLARED FILES PRESENT - STOPPING ***" -ForegroundColor Red
    foreach ($f in $foreign) {
      $h = if ($f.PSIsContainer) { '<directory>' } else { (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower() }
      Write-Host ("    name  : " + $f.Name) -ForegroundColor Red
      Write-Host ("    size  : " + $(if ($f.PSIsContainer) { '-' } else { $f.Length })) -ForegroundColor Red
      Write-Host ("    hash  : " + $h) -ForegroundColor Red
      try {
        $fa = Get-Acl -LiteralPath $f.FullName
        Write-Host ("    owner : " + $fa.Owner) -ForegroundColor Red
        Write-Host ("    sddl  : " + $fa.Sddl) -ForegroundColor Red
      } catch { Write-Host ("    acl   : unreadable - " + $_.Exception.Message) -ForegroundColor Red }
      Write-Host ""
    }
    Write-Host "  Nothing has been deleted, copied or changed. This is the Owner's ruling to make," -ForegroundColor Yellow
    Write-Host "  file by file. A re-stage once destroyed session-identity.ps1 exactly here." -ForegroundColor Yellow
    Stop-Closed "undeclared files in the staging directory"
  }
  Write-Host "  no undeclared files" -ForegroundColor Green
}

# ===========================================================================
# 4. BACKUP ROOT - a NEW child of C:\Aroma, so it inherits the parent's Deny
#    the moment it exists. Same problem Script A met, same fix.
# ===========================================================================
Write-Rule "4. BACKUP ROOT"

$backupAcl = @{}
$backupAcl[$SID_ADMINS] = $MASK_FULL
$backupAcl[$SID_SYSTEM] = $MASK_FULL

if (Test-Path -LiteralPath $BackupRoot) {
  Write-Host "  exists - verifying, not repairing" -ForegroundColor Yellow
} else {
  New-Item -ItemType Directory -Path $BackupRoot | Out-Null
  # NO ACE for the operator at all: it must not read, alter or delete its own
  # prior code. $IncludeOperator is false, and that is the whole point.
  Set-ProtectedAcl -Path $BackupRoot -IncludeOperator $false
  Write-Host ("  created " + $BackupRoot) -ForegroundColor Green
}
Test-Acl -Path $BackupRoot -Label "backup root" -Expected $backupAcl

$opOnBackup = @((Get-Acl -LiteralPath $BackupRoot).Access | Where-Object {
  $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $SID_OPERATOR })
if ($opOnBackup.Count -ne 0) { Stop-Closed ("the backup root has " + $opOnBackup.Count + " ACE(s) for " + $AccountName) }
Write-Host ("    " + $AccountName + " ACEs : 0") -ForegroundColor Green

# ===========================================================================
# 5. BACK UP, AND VERIFY THE BACKUP, BEFORE ANYTHING IS DELETED
# ===========================================================================
Write-Rule "5. BACKUP"

New-Item -ItemType Directory -Path $BackupDir | Out-Null
Write-Host ("  " + $BackupDir)

$manifestLines = @("backup of $StageDir", "utc: " + (Get-Date).ToUniversalTime().ToString('u'), "source sddl: " + $script:OriginalSddl, "")
$backedUp = 0
foreach ($f in $script:OriginalFiles) {
  if ($f.PSIsContainer) { Stop-Closed ("a subdirectory is present in staging and is not handled: " + $f.Name) }
  Copy-Item -LiteralPath $f.FullName -Destination $BackupDir
  $srcH = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower()
  $dstH = (Get-FileHash -LiteralPath (Join-Path $BackupDir $f.Name) -Algorithm SHA256).Hash.ToLower()
  # A backup that was not read back is not a backup.
  if ($srcH -ne $dstH) { Stop-Closed ("backup hash mismatch for " + $f.Name) }
  $manifestLines += ("{0}  {1}" -f $srcH, $f.Name)
  $backedUp++
}
$manifestLines | Set-Content -LiteralPath (Join-Path $BackupDir 'BACKUP-MANIFEST.txt') -Encoding utf8
Write-Host ("  " + $backedUp + " file(s) copied and hash-verified") -ForegroundColor Green
$script:BackupReady = $true

# ===========================================================================
# 6. REBUILD - only now is anything destroyed
# ===========================================================================
Write-Rule "6. REBUILD"

if (Test-Path -LiteralPath $StageDir) {
  Remove-Item -LiteralPath $StageDir -Recurse -Force
  $script:StageDeleted = $true
  Write-Host "  old staging removed (backed up and verified above)" -ForegroundColor Yellow
}
New-Item -ItemType Directory -Path $StageDir | Out-Null

foreach ($src in $manifest) {
  if (-not (Test-Path -LiteralPath $src)) { Stop-Closed ("manifest names a missing file: " + $src) }
  Copy-Item -LiteralPath $src -Destination $StageDir
}

$stagedNames = @(Get-ChildItem -LiteralPath $StageDir -File | ForEach-Object { $_.Name } | Sort-Object)
$diff2 = @(Compare-Object -ReferenceObject (@($ClosureNames) | Sort-Object) -DifferenceObject $stagedNames)
if ($diff2.Count -gt 0) { Stop-Closed "the staged directory does not match the closure after copying" }

Write-Host "  staged, hashes re-verified on the destination:" -ForegroundColor Green
foreach ($name in $ClosureNames) {
  $h = (Get-FileHash -LiteralPath (Join-Path $StageDir $name) -Algorithm SHA256).Hash.ToLower()
  if ($h -ne $CLOSURE[$name]) { Stop-Closed ("staged hash mismatch: " + $name) }
  Write-Host ("    " + $h + "  " + $name) -ForegroundColor Green
}

Set-ProtectedAcl -Path $StageDir -IncludeOperator $true
$stageAcl = @{}
$stageAcl[$SID_OPERATOR] = $MASK_READEXEC
$stageAcl[$SID_ADMINS]   = $MASK_FULL
$stageAcl[$SID_SYSTEM]   = $MASK_FULL
Write-Rule "7. STAGING ACL"
Test-Acl -Path $StageDir -Label "staging" -Expected $stageAcl

$opMask = [int]@(@((Get-Acl -LiteralPath $StageDir).Access) | Where-Object {
  $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $SID_OPERATOR })[0].FileSystemRights
foreach ($pair in @(@{N='Write';B=0x116}, @{N='Delete';B=0x10000}, @{N='ChangePermissions';B=0x40000}, @{N='TakeOwnership';B=0x80000})) {
  $held = ($opMask -band $pair.B) -ne 0
  Write-Host ("    {0,-18} HELD = {1}" -f $pair.N, $held) -ForegroundColor $(if ($held) { 'Red' } else { 'Green' })
  if ($held) { Stop-Closed ($AccountName + " holds " + $pair.N + " on the staging directory") }
}

# ===========================================================================
# 8. LOAD PROOF - resolve the graph WITHOUT starting anything
# ===========================================================================
Write-Rule "8. LOAD PROOF"

# companion-entry.js calls endpoint.listen() at load, so requiring it would
# START THE COMPANION - which is forbidden this round. It is parsed instead.
# Requiring companion.js and ipcChannel.js is what the entry itself requires,
# so their transitive graph resolving IS the missing-module proof.
& $Node --check (Join-Path $StageDir 'companion-entry.js')
if ($LASTEXITCODE -ne 0) { Stop-Closed "companion-entry.js does not parse in the staged directory" }
Write-Host "  companion-entry.js  : parses (not executed - it would listen)" -ForegroundColor Green

$probe = @(
  "const p = require('node:path');",
  "const c = require(p.join(process.cwd(), 'companion.js'));",
  "const i = require(p.join(process.cwd(), 'ipcChannel.js'));",
  "const s = require(p.join(process.cwd(), 'sessionBoundary.js'));",
  "const g = require(p.join(process.cwd(), 'sealedOrderGate.js'));",
  "const f = require(p.join(process.cwd(), 'computerOperatorFlag.js'));",
  "const o = require(p.join(process.cwd(), 'observation.js'));",
  "console.log(JSON.stringify({",
  "  companion: typeof c.createCompanion,",
  "  channel: typeof i.createCompanionEndpoint,",
  "  roles: Array.isArray(s.ROLES),",
  "  gate: typeof g.verifyUnlock,",
  "  flag: f.resolveComputerOperator({}),",
  "  observation: Array.isArray(o.OBSERVATION_ACTIONS),",
  "  anyCapability: c.anyCapabilityEnabled()",
  "}));"
) -join ''

# -e, so no probe file is ever written into the staging directory - that would
# be an undeclared file, which is the thing this script refuses to tolerate.
Push-Location $StageDir
try {
  $probeOut = & $Node -e $probe
  $probeExit = $LASTEXITCODE
} finally { Pop-Location }

if ($probeExit -ne 0) { Stop-Closed "the staged modules do not load standalone" }
Write-Host ("  module graph        : " + $probeOut) -ForegroundColor Green

$parsed = $probeOut | ConvertFrom-Json
if ($parsed.companion -ne 'function') { Stop-Closed "createCompanion did not load" }
if ($parsed.gate -ne 'function') { Stop-Closed "the sealed-order gate did not load" }
if ($parsed.flag -ne 'off') { Stop-Closed "the flag resolver did not answer 'off' for an empty environment" }
if ($parsed.anyCapability -ne $false) { Stop-Closed "a capability is unconditionally enabled in the staged copy" }
Write-Host "  no missing module, no capability enabled" -ForegroundColor Green

# ===========================================================================
# 9. PARENT SDDL - AFTER
# ===========================================================================
Write-Rule "9. PARENT COMPARISON"

$parentAfter = Get-SdSnapshot -Path $AromaRoot
Write-Host ("  owner : " + $parentAfter.Owner)
Write-Host ("  sddl  : " + $parentAfter.Sddl) -ForegroundColor Gray

$same = [string]::Equals($parentBefore.Sddl, $parentAfter.Sddl, [System.StringComparison]::Ordinal) -and
        [string]::Equals($parentBefore.Owner, $parentAfter.Owner, [System.StringComparison]::Ordinal)
Write-Host ""
if (-not $same) {
  Write-Host "*** PARENT ACL CHANGED - INCIDENT ***" -ForegroundColor Red
  Write-Host ("  BEFORE: " + $parentBefore.Sddl) -ForegroundColor Red
  Write-Host ("  AFTER : " + $parentAfter.Sddl) -ForegroundColor Red
  Write-Host "  Nothing is being repaired." -ForegroundColor Yellow
  Stop-Closed "the parent security descriptor is not what it was"
}
Write-Host "  PARENT ACL UNCHANGED (ordinal match)" -ForegroundColor Green

# ===========================================================================
# VERDICT
# ===========================================================================
Write-Rule "VERDICT"
foreach ($scope in @('Process', 'User', 'Machine')) {
  $v = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', $scope)
  if ($v -and $v -ne 'off') { Stop-Closed ("COMPUTER_OPERATOR became '" + $v + "' during the run") }
}
Write-Host "  COMPUTER_OPERATOR : still OFF in all three scopes" -ForegroundColor Green
Write-Host ("  staged            : " + $stagedNames.Count + " files, ReadAndExecute to " + $AccountName) -ForegroundColor Green
Write-Host ("  backup            : " + $BackupDir) -ForegroundColor Green
Write-Host  "  PARENT ACL        : UNCHANGED" -ForegroundColor Green
Write-Host  "  Companion NOT started. No flag set. No desktop action. main untouched." -ForegroundColor Gray
Write-Host ""
Write-Host "=== B PASS ===" -ForegroundColor Green
exit 0
