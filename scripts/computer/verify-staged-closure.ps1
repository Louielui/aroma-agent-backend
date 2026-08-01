# ===========================================================================
#  verify-staged-closure.ps1 - check the staged folder INDEPENDENTLY.
#
#  WHY THIS EXISTS SEPARATELY FROM THE STAGER
#  The stager verifies its own work, which is worth doing and is not the same
#  as being checked. It knows what it meant to write. This reads the folder
#  cold, from the repo's manifest, and compares.
#
#  It also recomputes the PACKAGE HASH from the staged tree itself. That is the
#  decisive number: executionPackage.js hashes the files beside it, so running
#  the staged copy of it produces a hash of what is actually staged. If that
#  equals the approved hash, the staged folder IS the approved package - no
#  file-by-file argument required.
#
#  READ-ONLY. It writes nothing, changes no permission, and starts nothing.
#  Run elevated, because the staged folder denies everyone else.
# ===========================================================================

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoDir     = 'C:\Aroma\aroma-3b'
$StageDir    = 'C:\Aroma\ComputerOperator-Companion'
$Node        = 'C:\Program Files\nodejs\node.exe'
$OperatorSid = 'S-1-5-21-2042659270-2029498691-2127769412-1009'

# The seven Phase 3a names. Named individually, because "the old program is
# gone" is the specific claim being checked.
$Phase3a = @('companion-entry.js','companion.js','computerOperatorFlag.js','ipcChannel.js',
             'observation.js','sealedOrderGate.js','sessionBoundary.js')
# Two of those seven are ALSO canary files, so their presence is expected and
# only the other five prove the old staging is gone.
$Phase3aOnly = @('companion-entry.js','ipcChannel.js','observation.js','companion.js')

function Say ([string]$T, [string]$C = 'Gray') { if ($C -eq 'Gray') { Write-Host $T } else { Write-Host $T -ForegroundColor $C } }
$script:Fails = 0
function Check ([string]$Label, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { Say ("  PASS  " + $Label + $(if ($Detail) { "   " + $Detail } else { '' })) 'Green' }
  else { Say ("  FAIL  " + $Label + $(if ($Detail) { "   " + $Detail } else { '' })) 'Red'; $script:Fails = $script:Fails + 1 }
}

Say ""
Say "  VERIFY STAGED CLOSURE   (read-only)" 'Cyan'
Say ""

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say ("  Running as : " + $id.Name + "   elevated=" + $elevated)
if (-not $elevated) {
  Say ""
  Say "  STOPPED: the staged folder denies everyone but Administrators and SYSTEM." 'Red'
  Say ""
  exit 1
}

# ── the reference: the repo's manifest ─────────────────────────────────────
$repoUri = $RepoDir -replace '\\','/'
$listJson = & $Node -e "process.stdout.write(JSON.stringify(require('$repoUri/scripts/computer/executionPackage').PACKAGE_FILES))"
$expected = @(($listJson | ConvertFrom-Json))
$repoHash = & $Node -e "process.stdout.write(require('$repoUri/scripts/computer/executionPackage').computePackageHash())"

Say ""
Say ("  Manifest (repo) : " + $expected.Count + " files")
Say ("  Package  (repo) : " + $repoHash)
Say ""

# ── 1. exact file set ──────────────────────────────────────────────────────
$staged = @(Get-ChildItem -LiteralPath $StageDir -Recurse -File | ForEach-Object {
  $_.FullName.Substring($StageDir.Length + 1) -replace '\\','/'
})
$stagedSansManifest = @($staged | Where-Object { $_ -ne 'STAGE-MANIFEST.json' })

$missing = @($expected | Where-Object { $stagedSansManifest -notcontains $_ })
$extra   = @($stagedSansManifest | Where-Object { $expected -notcontains $_ })

Check "staged file count matches the manifest" ($stagedSansManifest.Count -eq $expected.Count) ($stagedSansManifest.Count.ToString() + " vs " + $expected.Count)
Check "no MISSING files" ($missing.Count -eq 0) $(if ($missing.Count) { $missing -join ', ' } else { '' })
Check "no EXTRA files"   ($extra.Count -eq 0)   $(if ($extra.Count) { $extra -join ', ' } else { '' })

# ── 2. every file, by content ──────────────────────────────────────────────
$changed = @()
foreach ($rel in $expected) {
  $s = Join-Path $StageDir ($rel -replace '/','\')
  $r = Join-Path $RepoDir  ($rel -replace '/','\')
  if (-not (Test-Path -LiteralPath $s)) { continue }
  $hs = (Get-FileHash -LiteralPath $s -Algorithm SHA256).Hash.ToLower()
  $hr = (Get-FileHash -LiteralPath $r -Algorithm SHA256).Hash.ToLower()
  if ($hs -ne $hr) { $changed += $rel }
}
Check "every staged file matches the repo byte for byte" ($changed.Count -eq 0) $(if ($changed.Count) { $changed -join ', ' } else { $expected.Count.ToString() + " hashed" })

# ── 3. the decisive number: package hash OF THE STAGED TREE ────────────────
$stageUri = $StageDir -replace '\\','/'
$stagedHash = & $Node -e "process.stdout.write(require('$stageUri/scripts/computer/executionPackage').computePackageHash())"
Check "package hash computed FROM THE STAGED TREE equals the approved hash" ($stagedHash -eq $repoHash) $stagedHash

# ── 4. the old Phase 3a staging is gone ────────────────────────────────────
$leftovers = @()
foreach ($n in $Phase3aOnly) {
  if (@($staged | Where-Object { $_ -like ('*' + $n) }).Count -gt 0) { $leftovers += $n }
}
Check "the Phase 3a pipe Companion is gone from the staged folder" ($leftovers.Count -eq 0) $(if ($leftovers.Count) { $leftovers -join ', ' } else { 'none of: ' + ($Phase3aOnly -join ', ') })

# ── 5. the ACL ─────────────────────────────────────────────────────────────
Say ""
Say "  Staged folder permissions:" 'Cyan'
$acl = Get-Acl -LiteralPath $StageDir
Say ("    owner     : " + $acl.Owner)
Say ("    protected : " + $acl.AreAccessRulesProtected)
$opRules = @()
$strangers = @()
$denies = 0
foreach ($r in @($acl.Access)) {
  $sid = '?'
  try { $sid = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { }
  if ($r.AccessControlType -eq 'Deny') { $denies = $denies + 1 }
  if ($sid -eq $OperatorSid) { $opRules += $r }
  elseif ($sid -notin @('S-1-5-18','S-1-5-32-544') -and $r.IdentityReference.Value -notlike '*louis*') { $strangers += ($r.IdentityReference.Value + ' (' + $sid + ')') }
  Say ("    " + $r.AccessControlType + "  " + $r.IdentityReference.Value.PadRight(32) + $r.FileSystemRights)
}
Say ""

Check "inheritance is OFF (the C:\Aroma tree does not decide this folder)" ($acl.AreAccessRulesProtected -eq $true)
Check "the operator has an entry (it must be able to run what is staged)" ($opRules.Count -gt 0)

$write = [Security.AccessControl.FileSystemRights]::Write
$modify = [Security.AccessControl.FileSystemRights]::Modify
$full = [Security.AccessControl.FileSystemRights]::FullControl
$opCanWrite = $false
foreach ($r in $opRules) {
  if ($r.AccessControlType -ne 'Allow') { continue }
  if ((([int]$r.FileSystemRights) -band ([int]$write)) -ne 0) { $opCanWrite = $true }
  if ((([int]$r.FileSystemRights) -band ([int]$modify)) -eq ([int]$modify)) { $opCanWrite = $true }
  if ((([int]$r.FileSystemRights) -band ([int]$full)) -eq ([int]$full)) { $opCanWrite = $true }
}
# THE ONE THAT MATTERS. A staged program the operator can edit is not a staged
# program, it is a suggestion - the package hash would be verified against code
# the same account could rewrite a moment later.
Check "the operator CANNOT modify the staged program" (-not $opCanWrite) $(if ($opRules.Count) { [string]$opRules[0].FileSystemRights } else { '' })
Check "no unknown identity has access" ($strangers.Count -eq 0) $(if ($strangers.Count) { $strangers -join ', ' } else { 'only SYSTEM, Administrators, louis, AromaOperator' })

# ── 6. the staged manifest agrees with the staged files ────────────────────
$mPath = Join-Path $StageDir 'STAGE-MANIFEST.json'
if (Test-Path -LiteralPath $mPath) {
  $m = Get-Content -LiteralPath $mPath -Raw | ConvertFrom-Json
  Check "STAGE-MANIFEST records the approved package hash" ($m.packageHash -eq $repoHash) ([string]$m.packageHash)
  Check "STAGE-MANIFEST lists the same number of files" (@($m.files).Count -eq $expected.Count) (@($m.files).Count.ToString())
  Say ("    staged at : " + $m.stagedAt + "   by " + $m.stagedBy)
} else {
  Check "STAGE-MANIFEST.json exists" $false
}

Say ""
if ($script:Fails -eq 0) { Say "  ALL CHECKS PASSED. Nothing was changed." 'Green' }
else { Say ("  " + $script:Fails + " CHECK(S) FAILED.") 'Red' }
Say ""
exit $script:Fails
