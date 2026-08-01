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

# ── back up whatever is there now ──────────────────────────────────────────
# Never a blind overwrite: what is in that folder today is what the last
# verified state was built from, and it is the only way back if this goes wrong.
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$BackupDir = Join-Path 'C:\Aroma\ComputerOperator-Backups' ("stage-" + $stamp)
if (Test-Path -LiteralPath $StageDir) {
  New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
  Copy-Item -LiteralPath $StageDir -Destination $BackupDir -Recurse -Force
  Say ("  Backed up to : " + $BackupDir) 'DarkGray'
} else {
  New-Item -ItemType Directory -Path $StageDir -Force | Out-Null
  Say "  Created the staged folder." 'DarkGray'
}

# ── the ACL, captured before anything is written ───────────────────────────
$sddlBefore = (Get-Acl -LiteralPath $StageDir).Sddl

# ── clear, then copy, preserving the tree ──────────────────────────────────
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
