# ===========================================================================
#  stage-canary-closure.ps1 - put the APPROVED closure where the operator can
#  run it, and prove afterwards that is what is there.
#
#  RUN ELEVATED, BY THE OWNER. It writes into C:\Aroma\ComputerOperator-Companion,
#  which is ACL-protected against the account the agent runs as - deliberately.
#
#  WHY THIS REPLACES THE OLD STAGING
#  stage-companion.ps1 staged SEVEN files, flat, in one directory: the Phase 3a
#  pipe Companion. The canary closure is thirty-nine files across two directory
#  trees, and every relative `require` in it depends on that shape. Flattening
#  would break resolution; leaving it unstaged means the operator account cannot
#  run the canary at all.
#
#  THE LIST IS NOT WRITTEN HERE
#  It comes from executionPackage.js - the same list the Owner's approval hashes
#  and the same list the cross-language closure walk checks. A second list in
#  this file would be a second opinion about what runs, and the one in the
#  approval is the one that counts.
#
#  WHAT IT LEAVES BEHIND
#  STAGE-MANIFEST.json, holding the package hash and a SHA-256 per file. The
#  machine preflight reads it and re-checks every file by content, and refuses
#  any file present that the manifest does not name.
# ===========================================================================

[CmdletBinding()]
param(
  [switch] $WhatIfOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoDir  = 'C:\Aroma\aroma-3b'
$StageDir = 'C:\Aroma\ComputerOperator-Companion'
$Node     = 'C:\Program Files\nodejs\node.exe'
$OperatorSid = 'S-1-5-21-2042659270-2029498691-2127769412-1009'

function Say ([string]$T, [string]$C = 'Gray') { if ($C -eq 'Gray') { Write-Host $T } else { Write-Host $T -ForegroundColor $C } }
function Stop-Now ([string]$Why) { Say ""; Say ("  STOPPED: " + $Why) 'Red'; Say ""; exit 1 }

Say ""
Say "  STAGE CANARY CLOSURE" 'Cyan'
Say ""

# ── who is running this ─────────────────────────────────────────────────────
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say ("  Running as : " + $id.Name)
Say ("  Elevated   : " + $elevated)
# The elevation gate is checked AFTER the list is read, so -WhatIfOnly works
# without it. A preview that itself needs administrator rights is a preview
# nobody runs, and then the only way to see what will be staged is to stage it.
if (-not $elevated -and -not $WhatIfOnly) { Stop-Now "this needs administrator rights - the staged folder is protected. Use -WhatIfOnly to preview." }

foreach ($p in @($RepoDir, $Node)) { if (-not (Test-Path -LiteralPath $p)) { Stop-Now ("not found: " + $p) } }

# ── the list, from the approved manifest ───────────────────────────────────
$listJson = & $Node -e "process.stdout.write(JSON.stringify(require('$($RepoDir -replace '\\','/')/scripts/computer/executionPackage').PACKAGE_FILES))"
if ($LASTEXITCODE -ne 0) { Stop-Now "the package list could not be read" }
$files = @(($listJson | ConvertFrom-Json))
if ($files.Count -lt 20) { Stop-Now ("the package list looks wrong: " + $files.Count + " entries") }

$pkgHash = & $Node -e "process.stdout.write(require('$($RepoDir -replace '\\','/')/scripts/computer/executionPackage').computePackageHash())"
if ($LASTEXITCODE -ne 0) { Stop-Now "the package hash could not be computed" }

Say ""
Say ("  Files to stage : " + $files.Count)
Say ("  Package        : " + $pkgHash.Substring(0, 12) + "...")
Say ""

if ($WhatIfOnly) {
  foreach ($f in $files) { Say ("    " + $f) 'DarkGray' }
  Say ""
  Say "  -WhatIfOnly: nothing was written." 'Yellow'
  Say ""
  exit 0
}

# ===========================================================================
#  INVENTORY, BACKUP, RECORD - and only then delete.
#
#  The previous version backed up the folder and then cleared it with a single
#  Remove-Item. The backup was real and the ordering was right, but the
#  deletion was SILENT: nothing said what had been removed, so a file that had
#  no business being there left no trace of ever having been there. When a
#  question was later asked about one, the only available answer was an
#  inference from a passing check.
#
#  A deletion nobody can name is a deletion nobody can audit. So every file is
#  inventoried and classified first, everything outside the manifest is printed
#  by full path, the backup is VERIFIED by hash before anything is removed, and
#  the removals are written to REMOVED-FILES.json inside the backup.
#
#  If the backup is incomplete or a hash disagrees, nothing is deleted at all.
# ===========================================================================
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$BackupDir = Join-Path 'C:\Aroma\ComputerOperator-Backups' ("stage-" + $stamp)

# Same identity rule as the verifier: a file IS its full repo-relative path.
# No basename, no suffix, no wildcard - that comparison reported a required
# file as a leftover once already.
function ConvertTo-CanonicalPath ([string]$Path) { return ($Path -replace '\\', '/').ToLowerInvariant() }
function Test-PathInSet ([string]$Path, [string[]]$Set) {
  $c = ConvertTo-CanonicalPath $Path
  foreach ($s in $Set) { if ((ConvertTo-CanonicalPath $s) -eq $c) { return $true } }
  return $false
}

$inventory = @()
$outsideManifest = @()

if (Test-Path -LiteralPath $StageDir) {
  # ── 1. inventory everything that is there now ───────────────────────────
  foreach ($f in @(Get-ChildItem -LiteralPath $StageDir -Recurse -File -Force)) {
    $rel = ($f.FullName.Substring($StageDir.Length + 1)) -replace '\\', '/'
    $entry = [ordered]@{
      repoRelativePath = $rel
      sha256           = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower()
      size             = [int64] $f.Length
      inManifest       = (Test-PathInSet $rel $files)
    }
    $inventory += $entry
    if (-not $entry.inManifest -and $rel -ne 'STAGE-MANIFEST.json') { $outsideManifest += $entry }
  }

  Say ""
  Say ("  Present before staging : " + $inventory.Count + " files")
  Say ("    in the manifest      : " + @($inventory | Where-Object { $_.inManifest }).Count)
  Say ("    NOT in the manifest  : " + $outsideManifest.Count)

  if ($outsideManifest.Count -gt 0) {
    # ── 2. name every one of them, in full ────────────────────────────────
    Say ""
    Say "  These are NOT in the current manifest and will be removed:" 'Yellow'
    foreach ($e in $outsideManifest) {
      Say ("    " + $e.repoRelativePath + "   " + $e.size + " bytes   " + $e.sha256.Substring(0, 16) + "...") 'Yellow'
    }
  }

  # ── 3. the backup, complete, before anything goes ───────────────────────
  New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
  Copy-Item -LiteralPath $StageDir -Destination $BackupDir -Recurse -Force
  Say ""
  Say ("  Backed up to : " + $BackupDir) 'DarkGray'

  # The backup is a copy of $StageDir INTO $BackupDir, so it lands one level
  # down under the source folder's own name.
  $BackupRoot = Join-Path $BackupDir (Split-Path $StageDir -Leaf)

  # ── 4. verify the backup by hash before deleting anything ───────────────
  $bad = @()
  foreach ($e in $inventory) {
    $b = Join-Path $BackupRoot ($e.repoRelativePath -replace '/', '\')
    if (-not (Test-Path -LiteralPath $b)) { $bad += ($e.repoRelativePath + ' (absent from the backup)'); continue }
    $h = (Get-FileHash -LiteralPath $b -Algorithm SHA256).Hash.ToLower()
    if ($h -ne $e.sha256) { $bad += ($e.repoRelativePath + ' (hash differs in the backup)') }
  }
  if ($bad.Count -gt 0) {
    Say ""
    Say "  BACKUP VERIFICATION FAILED. Nothing has been deleted." 'Red'
    foreach ($b in $bad) { Say ("    " + $b) 'Red' }
    Say ""
    Say "  The staged folder is untouched. Investigate before retrying." 'Yellow'
    Say ""
    exit 1
  }
  Say ("  Backup verified : " + $inventory.Count + " files, hash for hash") 'DarkGray'

  # ── 5. record the removals, in the backup, before making them ───────────
  if ($outsideManifest.Count -gt 0) {
    $removed = @()
    foreach ($e in $outsideManifest) {
      $removed += [ordered]@{
        repoRelativePath = $e.repoRelativePath
        sha256           = $e.sha256
        size             = $e.size
        backupPath       = (Join-Path $BackupRoot ($e.repoRelativePath -replace '/', '\'))
        recordedAt       = (Get-Date).ToUniversalTime().ToString('u')
        reason           = 'not_in_current_manifest'
      }
    }
    $removed | ConvertTo-Json -Depth 5 | Out-File -FilePath (Join-Path $BackupDir 'REMOVED-FILES.json') -Encoding utf8
    Say ("  Removals recorded: " + (Join-Path $BackupDir 'REMOVED-FILES.json')) 'DarkGray'
  } else {
    Say "  Nothing outside the manifest - no removal record needed." 'DarkGray'
  }
} else {
  New-Item -ItemType Directory -Path $StageDir -Force | Out-Null
  Say "  Created the staged folder." 'DarkGray'
}

# ── the ACL, captured before anything is written ───────────────────────────
$sddlBefore = (Get-Acl -LiteralPath $StageDir).Sddl

# ── 6. clear, then copy, preserving the tree ───────────────────────────────
# Unchanged semantics: a full clear, so nothing survives by accident. What
# changed is that by this line every file removed has been inventoried, backed
# up, hash-verified in the backup, and named on screen.
Get-ChildItem -LiteralPath $StageDir -Force | Remove-Item -Recurse -Force
$copied = 0
foreach ($rel in $files) {
  $src = Join-Path $RepoDir ($rel -replace '/', '\')
  if (-not (Test-Path -LiteralPath $src)) { Stop-Now ("missing from the repo: " + $rel) }
  $dst = Join-Path $StageDir ($rel -replace '/', '\')
  $dstDir = Split-Path $dst -Parent
  if (-not (Test-Path -LiteralPath $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
  Copy-Item -LiteralPath $src -Destination $dst -Force
  $copied = $copied + 1
}

# ── the manifest, written last ─────────────────────────────────────────────
$manifestFiles = @()
foreach ($rel in $files) {
  $abs = Join-Path $StageDir ($rel -replace '/', '\')
  $manifestFiles += @{ path = $rel; sha256 = (Get-FileHash -LiteralPath $abs -Algorithm SHA256).Hash.ToLower() }
}
$manifest = @{
  packageHash = $pkgHash
  stagedAt    = (Get-Date).ToUniversalTime().ToString('u')
  stagedBy    = $id.Name
  files       = $manifestFiles
}
$manifest | ConvertTo-Json -Depth 5 | Out-File -FilePath (Join-Path $StageDir 'STAGE-MANIFEST.json') -Encoding utf8

# ── verify what is now on disk, by reading it back ─────────────────────────
$bad = @()
foreach ($e in $manifestFiles) {
  $abs = Join-Path $StageDir ($e.path -replace '/', '\')
  $repoAbs = Join-Path $RepoDir ($e.path -replace '/', '\')
  $a = (Get-FileHash -LiteralPath $abs -Algorithm SHA256).Hash.ToLower()
  $b = (Get-FileHash -LiteralPath $repoAbs -Algorithm SHA256).Hash.ToLower()
  if ($a -ne $b) { $bad += $e.path }
}
if ($bad.Count -gt 0) { Stop-Now ("staged copies differ from the repo: " + ($bad -join ', ')) }

# ── the ACL, after ─────────────────────────────────────────────────────────
$aclAfter = Get-Acl -LiteralPath $StageDir
$sddlAfter = $aclAfter.Sddl

Say ""
Say ("  Staged   : " + $copied + " files")
Say ("  ACL      : " + $(if ($sddlBefore -eq $sddlAfter) { 'unchanged by this script' } else { 'CHANGED - see below' })) $(if ($sddlBefore -eq $sddlAfter) { 'Green' } else { 'Red' })
if ($sddlBefore -ne $sddlAfter) {
  Say ("    before : " + $sddlBefore) 'DarkGray'
  Say ("    after  : " + $sddlAfter) 'DarkGray'
}
Say ""
Say "  Permissions on the staged folder:" 'Cyan'
Say ("    protected (no inheritance) : " + $aclAfter.AreAccessRulesProtected)
foreach ($r in @($aclAfter.Access)) {
  $who = $r.IdentityReference.ToString()
  $sid = ''
  try { $sid = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $sid = '?' }
  $mark = ''
  if ($sid -eq $OperatorSid) {
    # The operator must be able to READ and RUN what is staged, and must not be
    # able to change it. A staged program the operator can edit is not a staged
    # program, it is a suggestion.
    $canWrite = ($r.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) -ne 0
    $mark = $(if ($canWrite -and $r.AccessControlType -eq 'Allow') { '   <-- OPERATOR CAN MODIFY: WRONG' } else { '   <-- operator: read + execute only' })
  }
  Say ("    " + $r.AccessControlType + " " + $who + " (" + $sid + ") " + $r.FileSystemRights + $mark)
}
Say ""
Say "  Done. Nothing was started and no switch was set." 'Green'
Say ""
exit 0
