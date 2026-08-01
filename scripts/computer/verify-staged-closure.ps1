# ===========================================================================
#  verify-staged-closure.ps1 - check the staged folder INDEPENDENTLY.
#
#  ── THE DEFECT THIS VERSION FIXES ─────────────────────────────────────────
#  The first version identified files by NAME SUFFIX:
#
#      if ($staged | Where-Object { $_ -like ('*' + $n) })       # WRONG
#
#  In PowerShell `-like '*x'` means "ends with x". The manifest contains
#  scripts/computer/tool-start-companion.js, whose path ends with the literal
#  string "companion.js" - so a REQUIRED file was reported as a Phase 3a
#  leftover, and the folder was fine the whole time.
#
#  A file's identity is its PATH. Not its basename, not a suffix of its path,
#  not a substring. Every comparison below is against a full repo-relative
#  path, and the banned forms are asserted absent from this file by a test in
#  the ordinary suite - because the previous version's mistake read perfectly
#  well as correct code.
#
#  ── IT VERIFIES ITS OWN COMPARISON FIRST ──────────────────────────────────
#  Four controls run before any real check, on synthetic paths, every single
#  time. A comparison this file cannot demonstrate on a known-answer case is a
#  comparison nobody should read the output of.
#
#  READ-ONLY. It writes nothing, changes no permission, starts nothing.
#  Run elevated: the staged folder denies everyone else.
# ===========================================================================

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoDir     = 'C:\Aroma\aroma-3b'
$StageDir    = 'C:\Aroma\ComputerOperator-Companion'
$Node        = 'C:\Program Files\nodejs\node.exe'
$OperatorSid = 'S-1-5-21-2042659270-2029498691-2127769412-1009'

# The manifest names this file and only this file as a permitted non-manifest
# entry. It is the manifest itself, so it cannot be listed inside itself.
$ManifestFile = 'STAGE-MANIFEST.json'

# The Phase 3a pipe Companion, by FULL REPO-RELATIVE PATH. Four paths, not four
# names: src/computer/companion.js is a different file from any other file whose
# name happens to end the same way.
$Phase3aPaths = @(
  'src/computer/companion.js',
  'src/computer/observation.js',
  'src/computer/ipcChannel.js',
  'scripts/computer/companion-entry.js'
)

function Say ([string]$T, [string]$C = 'Gray') { if ($C -eq 'Gray') { Write-Host $T } else { Write-Host $T -ForegroundColor $C } }
$script:Fails = 0
function Check ([string]$Label, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { Say ("  PASS  " + $Label + $(if ($Detail) { "   " + $Detail } else { '' })) 'Green' }
  else { Say ("  FAIL  " + $Label + $(if ($Detail) { "   " + $Detail } else { '' })) 'Red'; $script:Fails = $script:Fails + 1 }
}

# ---------------------------------------------------------------------------
#  CANONICALIZATION - fixed, and deliberately tiny.
#
#  Two operations only: separators to '/', and lowercase for comparison because
#  NTFS is case-insensitive and two staged paths differing only in case are the
#  same file to Windows and to anything that opens them.
#
#  Nothing is trimmed, nothing is stripped, no '..' is resolved. Every extra
#  normalisation step is another way for two different files to be judged the
#  same, which is the class of bug this file exists to stop repeating.
# ---------------------------------------------------------------------------
function ConvertTo-CanonicalPath ([string]$Path) {
  return ($Path -replace '\\', '/').ToLowerInvariant()
}

# Exact identity. The ONLY comparison used anywhere below.
function Test-PathInSet ([string]$Path, [string[]]$Set) {
  $c = ConvertTo-CanonicalPath $Path
  foreach ($s in $Set) { if ((ConvertTo-CanonicalPath $s) -eq $c) { return $true } }
  return $false
}

# Canonicalization that collapses two distinct entries has hidden a file.
# Refused rather than deduplicated: silently keeping one of two is how a stray
# file rides along under a name something else already accounted for.
function Assert-NoCanonicalDuplicates ([string[]]$Paths, [string]$What) {
  $seen = @{}
  $dupes = @()
  foreach ($p in $Paths) {
    $c = ConvertTo-CanonicalPath $p
    if ($seen.ContainsKey($c)) { $dupes += ($seen[$c] + '  <->  ' + $p) } else { $seen[$c] = $p }
  }
  if ($dupes.Count -gt 0) {
    Say ""
    Say ("  REFUSED: two " + $What + " paths canonicalize to the same value:") 'Red'
    foreach ($d in $dupes) { Say ("    " + $d) 'Red' }
    Say ""
    exit 2
  }
}

Say ""
Say "  VERIFY STAGED CLOSURE   (read-only)" 'Cyan'
Say ""

# ===========================================================================
#  CONTROLS - the comparison proves itself before it is trusted.
# ===========================================================================
Say "  Self-check on the path comparison:" 'Cyan'

# 1. The exact false positive that made the previous version wrong.
$c1 = -not (Test-PathInSet 'scripts/computer/tool-start-companion.js' $Phase3aPaths)
Check "tool-start-companion.js does NOT match companion.js" $c1 'scripts/computer/tool-start-companion.js'

# 2. The true positive. Without this, (1) could pass by matching nothing at all.
$c2 = (Test-PathInSet 'src/computer/companion.js' $Phase3aPaths)
Check "the real src/computer/companion.js DOES match" $c2 'src/computer/companion.js'

# 3. Same basename, different directory.
$c3 = -not (Test-PathInSet 'scripts/computer/companion.js' $Phase3aPaths)
Check "same basename in another directory does NOT match" $c3 'scripts/computer/companion.js vs src/computer/companion.js'

# 4. Separator and case differences are the same file; a different path is not.
$c4 = (Test-PathInSet 'src\computer\Companion.js' $Phase3aPaths) -and
      (-not (Test-PathInSet 'src/computer/companionProductionFactory.js' $Phase3aPaths))
Check "separators and case normalise; a longer name still does not match" $c4 'src\computer\Companion.js'

if ($script:Fails -gt 0) {
  Say ""
  Say "  STOPPED: the comparison failed its own controls. Nothing else was checked." 'Red'
  Say ""
  exit 2
}
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
$repoUri = $RepoDir -replace '\\', '/'
$listJson = & $Node -e "process.stdout.write(JSON.stringify(require('$repoUri/scripts/computer/executionPackage').PACKAGE_FILES))"
$expected = @(($listJson | ConvertFrom-Json))
$repoHash = & $Node -e "process.stdout.write(require('$repoUri/scripts/computer/executionPackage').computePackageHash())"
Assert-NoCanonicalDuplicates $expected 'manifest'

Say ""
Say ("  Manifest (repo) : " + $expected.Count + " files")
Say ("  Package  (repo) : " + $repoHash)

# ── what is actually staged, as full relative paths ────────────────────────
$staged = @(Get-ChildItem -LiteralPath $StageDir -Recurse -File | ForEach-Object {
  ($_.FullName.Substring($StageDir.Length + 1)) -replace '\\', '/'
})
Assert-NoCanonicalDuplicates $staged 'staged'

$stagedFiles = @($staged | Where-Object { -not (Test-PathInSet $_ @($ManifestFile)) })

Say ""
Say "  STAGED FILES (full repo-relative paths):" 'Cyan'
foreach ($p in ($stagedFiles | Sort-Object)) { Say ("    " + $p) }
$excluded = @($staged | Where-Object { Test-PathInSet $_ @($ManifestFile) })
Say ""
Say ("  By-design exclusions: " + $(if ($excluded.Count) { ($excluded | Sort-Object) -join ', ' } else { '(none)' }))
Say ""

# ── 1. exact file set ──────────────────────────────────────────────────────
$missing = @($expected | Where-Object { -not (Test-PathInSet $_ $stagedFiles) })
$extra   = @($stagedFiles | Where-Object { -not (Test-PathInSet $_ $expected) })

Say "  Set comparison:" 'Cyan'
Check "staged file count matches the manifest" ($stagedFiles.Count -eq $expected.Count) ($stagedFiles.Count.ToString() + " vs " + $expected.Count)

if ($missing.Count -gt 0) { Say "    MISSING (in manifest, not staged):" 'Red'; foreach ($p in $missing) { Say ("      " + $p) 'Red' } }
Check "no MISSING files" ($missing.Count -eq 0) ($missing.Count.ToString())

if ($extra.Count -gt 0) { Say "    EXTRA (staged, not in manifest):" 'Red'; foreach ($p in $extra) { Say ("      " + $p) 'Red' } }
Check "no EXTRA files" ($extra.Count -eq 0) ($extra.Count.ToString())

# ── 2. every file, by content ──────────────────────────────────────────────
$changed = @()
foreach ($rel in $expected) {
  $s = Join-Path $StageDir ($rel -replace '/', '\')
  $r = Join-Path $RepoDir  ($rel -replace '/', '\')
  if (-not (Test-Path -LiteralPath $s)) { continue }
  if ((Get-FileHash -LiteralPath $s -Algorithm SHA256).Hash.ToLower() -ne
      (Get-FileHash -LiteralPath $r -Algorithm SHA256).Hash.ToLower()) { $changed += $rel }
}
if ($changed.Count -gt 0) { foreach ($p in $changed) { Say ("      CHANGED: " + $p) 'Red' } }
Check "every staged file matches the repo byte for byte" ($changed.Count -eq 0) ($expected.Count.ToString() + " hashed")

# ── 3. the decisive number: package hash OF THE STAGED TREE ────────────────
$stageUri = $StageDir -replace '\\', '/'
$stagedHash = & $Node -e "process.stdout.write(require('$stageUri/scripts/computer/executionPackage').computePackageHash())"
Check "package hash computed FROM THE STAGED TREE equals the approved hash" ($stagedHash -eq $repoHash) $stagedHash

# ── 4. Phase 3a, by exact path ─────────────────────────────────────────────
$leftovers = @($stagedFiles | Where-Object { Test-PathInSet $_ $Phase3aPaths })
if ($leftovers.Count -gt 0) { foreach ($p in $leftovers) { Say ("      PHASE 3A REMNANT: " + $p) 'Red' } }
Check "no Phase 3a remnant, by exact path" ($leftovers.Count -eq 0) ('checked: ' + ($Phase3aPaths -join ', '))

# ── 5. the ACL ─────────────────────────────────────────────────────────────
Say ""
Say "  Staged folder permissions:" 'Cyan'
$acl = Get-Acl -LiteralPath $StageDir
Say ("    owner     : " + $acl.Owner)
Say ("    protected : " + $acl.AreAccessRulesProtected)
$opRules = @()
$strangers = @()
foreach ($r in @($acl.Access)) {
  $sid = '?'
  try { $sid = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { }
  if ($sid -eq $OperatorSid) { $opRules += $r }
  elseif ($sid -notin @('S-1-5-18', 'S-1-5-32-544') -and $r.IdentityReference.Value -notlike '*louis*') {
    $strangers += ($r.IdentityReference.Value + ' (' + $sid + ')')
  }
  Say ("    " + $r.AccessControlType + "  " + $r.IdentityReference.Value.PadRight(32) + $r.FileSystemRights)
}
Say ""
Check "inheritance is OFF (the C:\Aroma tree does not decide this folder)" ($acl.AreAccessRulesProtected -eq $true)
Check "the operator has an entry (it must be able to run what is staged)" ($opRules.Count -gt 0)

$write  = [int][Security.AccessControl.FileSystemRights]::Write
$modify = [int][Security.AccessControl.FileSystemRights]::Modify
$full   = [int][Security.AccessControl.FileSystemRights]::FullControl
$opCanWrite = $false
foreach ($r in $opRules) {
  if ($r.AccessControlType -ne 'Allow') { continue }
  $m = [int]$r.FileSystemRights
  if (($m -band $write) -ne 0) { $opCanWrite = $true }
  if (($m -band $modify) -eq $modify) { $opCanWrite = $true }
  if (($m -band $full) -eq $full) { $opCanWrite = $true }
}
Check "the operator CANNOT modify the staged program" (-not $opCanWrite) $(if ($opRules.Count) { [string]$opRules[0].FileSystemRights } else { '' })
Check "no unknown identity has access" ($strangers.Count -eq 0) $(if ($strangers.Count) { $strangers -join ', ' } else { 'only SYSTEM, Administrators, louis, AromaOperator' })

# ── 6. the staged manifest agrees with the staged files ────────────────────
$mPath = Join-Path $StageDir $ManifestFile
if (Test-Path -LiteralPath $mPath) {
  $m = Get-Content -LiteralPath $mPath -Raw | ConvertFrom-Json
  Check "STAGE-MANIFEST records the approved package hash" ($m.packageHash -eq $repoHash) ([string]$m.packageHash)
  Check "STAGE-MANIFEST lists the same number of files" (@($m.files).Count -eq $expected.Count) (@($m.files).Count.ToString())
  Say ("    staged at : " + $m.stagedAt + "   by " + $m.stagedBy)
} else {
  Check ($ManifestFile + " exists") $false
}

Say ""
if ($script:Fails -eq 0) { Say "  ALL CHECKS PASSED. Nothing was changed." 'Green' }
else { Say ("  " + $script:Fails + " CHECK(S) FAILED.") 'Red' }
Say ""
exit $script:Fails
