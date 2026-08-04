<#
================================================================================================
 Stage1-RetireDStaging.ps1 — move the truth-data and release-records STAGING root off D:.

 WHY THIS EXISTS
 The BitLocker-locked Seagate (D:) has been retired as an automated backup target. For these
 two pipelines D: was only ever a staging + restore-verify area, so the fix is one line each.
 The restore-verify step keeps its full value; it simply happens on C: now. The core-data leg
 (Stage 2) and the Xiangxiang archive leg (Stage 3) are NOT touched here.

 ── WHY THIS IS A FILE AND NOT A PASTED BLOCK ──────────────────────────────────────────────
 The first attempt was delivered as a console block and it corrupted a script. Three defects,
 all mine, and every one of them is structurally prevented below:

  1. ARRAY FLATTENING. The plan used `@(@($old,$new))`. PowerShell collapses a single-element
     array-of-arrays into a flat 2-element array, so `$pair[0]` became the CHARACTER '$'
     instead of the line. '$' occurs 166 times in release-records, and every one was replaced.
     FIX: edits are [pscustomobject] with NAMED fields. There is no index to be wrong, and a
     PSCustomObject cannot flatten into its own properties. Assert-Edit also refuses any Old
     shorter than 20 characters, so a single character can never be a search target again.

  2. THE SIMULATION VALIDATED SOMETHING ELSE. The dry run used `@(,@(...))` and the block used
     `@(@(...))`, so the prediction never exercised the code that ran — and the predicted hash
     I handed over was itself wrong, which caused a CORRECTLY edited file to be rolled back.
     FIX: there is exactly one Apply-Edits function. The simulated text IS the text written.
     Nothing is predicted by hand and no expected hash is written down anywhere.

  3. A SELF-REFERENTIAL CHECK. The old verification asked "is Old gone and New present?" —
     which is trivially true after any replace, including a catastrophic one, so it reported
     success on a destroyed file.
     FIX: the PRIMARY gate is the CHANGED-LINE COUNT, declared per file and enforced. Rewriting
     108 lines when 1 was expected fails immediately, with no reliance on any prediction. The
     hash check is secondary and proves only that the bytes on disk equal the bytes intended.

  4. `return` DOES NOT ABORT A PASTE. Aborts here are `throw`, inside try/catch, and the catch
     RESTORES every file it had written from the .bak taken before the first write.

 ENCODING. Both targets are UTF-8 with NO BOM and LF-only line endings. Get-Content/Set-Content
 on PS 5.1 would rewrite them as ANSI + CRLF, mangling the em-dashes and every line. This
 script reads and writes the whole file as one string via [System.IO.File] with an explicit
 UTF8Encoding($false), so both properties survive untouched.

 USAGE
   Review first (no elevation, writes NOTHING, prints exactly what would change):
     powershell -NoProfile -ExecutionPolicy Bypass -File <this file> -DryRun

   Apply (elevated window; the scripts are ACL-locked read-only for louis):
     powershell -NoProfile -ExecutionPolicy Bypass -File <this file>

 It does NOT run, register, or modify any scheduled task.
================================================================================================
#>

[CmdletBinding()]
param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ── the edits, as named fields. No nested arrays anywhere in this file. ────────────────────
function New-Edit {
  param([Parameter(Mandatory)][string]$Old, [Parameter(Mandatory)][string]$New)
  [pscustomobject]@{ Old = $Old; New = $New }
}

$TD = 'C:\ProgramData\AromaBackup\scripts\aroma-truthdata-backup.ps1'
$RR = 'C:\ProgramData\AromaBackup\scripts\aroma-releaserecords-backup.ps1'

$Plan = @(
  [pscustomobject]@{
    Path                 = $TD
    ExpectedChangedLines = 2
    Edits                = @(
      New-Edit -Old "# aroma-truthdata-backup.ps1 — REVIEW COPY (STAGE 1). NOT INSTALLED / NOT SCHEDULED / NOT RUN." `
               -New "# aroma-truthdata-backup.ps1 — INSTALLED. Runs nightly 02:30 as scheduled task AromaTruthData-B2Sync."
      New-Edit -Old "`$DROOT      = 'D:\AromaTruthDataBackups'                    # D:\AromaTruthDataBackups\<backupId>" `
               -New "`$DROOT      = 'C:\AromaBackupStaging\TruthData'             # staging+verify root; D: retired 2026-08-04"
    )
  }
  [pscustomobject]@{
    Path                 = $RR
    ExpectedChangedLines = 1
    Edits                = @(
      New-Edit -Old "`$DROOT   = 'D:\AromaReleaseRecordsBackups'" `
               -New "`$DROOT   = 'C:\AromaBackupStaging\ReleaseRecords'"
    )
  }
)

$StagingDirs = @('C:\AromaBackupStaging\TruthData', 'C:\AromaBackupStaging\ReleaseRecords')

# ── helpers ────────────────────────────────────────────────────────────────────────────────

function Assert-Edit {
  param($Edit, [string]$Where)
  if ($null -eq $Edit) { throw "$Where : edit is null" }
  if (-not ($Edit.PSObject.Properties.Name -contains 'Old')) { throw "$Where : edit has no Old field (array flattening?)" }
  if (-not ($Edit.PSObject.Properties.Name -contains 'New')) { throw "$Where : edit has no New field (array flattening?)" }
  if ($Edit.Old -isnot [string] -or $Edit.New -isnot [string]) { throw "$Where : Old/New must be strings" }
  # THE GUARD THAT WOULD HAVE STOPPED THE 166-REPLACEMENT INCIDENT OUTRIGHT.
  if ($Edit.Old.Length -lt 20) { throw "$Where : Old is only $($Edit.Old.Length) chars - refusing to search for a fragment" }
}

function Read-Text { param([string]$Path) [System.IO.File]::ReadAllText($Path, $Utf8NoBom) }

function Get-TextSha256 {
  param([string]$Text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { ([System.BitConverter]::ToString($sha.ComputeHash($Utf8NoBom.GetBytes($Text)))).Replace('-', '') }
  finally { $sha.Dispose() }
}

function Get-ChangedLineCount {
  param([string]$Before, [string]$After)
  $a = $Before -split "`n"
  $b = $After  -split "`n"
  if ($a.Count -ne $b.Count) { return -1 }   # a line-count change is never expected here
  $n = 0
  for ($i = 0; $i -lt $a.Count; $i++) { if ($a[$i] -cne $b[$i]) { $n++ } }
  $n
}

# THE ONE CODE PATH. The dry run and the real run both call this and nothing else, so what is
# shown can never diverge from what is written.
function Apply-Edits {
  param([string]$Text, $Edits, [string]$Where)
  $out = $Text
  $i = 0
  foreach ($e in $Edits) {
    $i++
    Assert-Edit -Edit $e -Where "$Where edit#$i"
    $hits = ([regex]::Matches($out, [regex]::Escape($e.Old))).Count
    if ($hits -ne 1) { throw "$Where edit#$i : expected exactly 1 occurrence, found $hits" }
    $out = $out.Replace($e.Old, $e.New)
  }
  $out
}

# ── PHASE 1: simulate every file. Writes nothing. Any failure aborts before any change. ────

Write-Host '=== PHASE 1: simulate (nothing is written) ===' -ForegroundColor Cyan

$Work = @()
foreach ($f in $Plan) {
  if (-not (Test-Path -LiteralPath $f.Path)) { throw "missing target: $($f.Path)" }
  $name   = Split-Path $f.Path -Leaf
  $before = Read-Text -Path $f.Path
  $after  = Apply-Edits -Text $before -Edits $f.Edits -Where $name

  $changed = Get-ChangedLineCount -Before $before -After $after
  if ($changed -ne $f.ExpectedChangedLines) {
    throw "$name : expected $($f.ExpectedChangedLines) changed line(s), simulation produced $changed"
  }

  $Work += [pscustomobject]@{
    Path        = $f.Path
    Name        = $name
    Before      = $before
    After       = $after
    ShaBefore   = (Get-TextSha256 -Text $before)
    ShaAfter    = (Get-TextSha256 -Text $after)
    Changed     = $changed
    BakPath     = $null
  }
}

foreach ($w in $Work) {
  Write-Host ("  {0}" -f $w.Name) -ForegroundColor Green
  Write-Host ("    changed lines : {0} (expected {1})" -f $w.Changed, ($Plan | Where-Object { $_.Path -eq $w.Path }).ExpectedChangedLines)
  Write-Host ("    sha before    : {0}" -f $w.ShaBefore)
  Write-Host ("    sha after     : {0}" -f $w.ShaAfter)
  $lb = $w.Before -split "`n"; $la = $w.After -split "`n"
  for ($i = 0; $i -lt $lb.Count; $i++) {
    if ($lb[$i] -cne $la[$i]) {
      Write-Host ("    line {0}" -f ($i + 1)) -ForegroundColor Yellow
      Write-Host ("      - {0}" -f $lb[$i])
      Write-Host ("      + {0}" -f $la[$i])
    }
  }
}

if ($DryRun) {
  Write-Host "`nDRY RUN - nothing was written, no backup was taken, no task was touched." -ForegroundColor Yellow
  return
}

# ── PHASE 2: apply. Elevation required; .bak before the first write; rollback on any fault. ─

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'NOT ELEVATED - the target scripts are read-only for louis. Nothing was changed.'
}

Write-Host "`n=== PHASE 2: apply ===" -ForegroundColor Cyan
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$written = New-Object System.Collections.ArrayList

try {
  # BACKUP EVERYTHING FIRST. The previous incident cost nothing only because the .bak existed.
  foreach ($w in $Work) {
    $w.BakPath = "$($w.Path).bak-$stamp"
    Copy-Item -LiteralPath $w.Path -Destination $w.BakPath -Force
    $bakSha = Get-TextSha256 -Text (Read-Text -Path $w.BakPath)
    if ($bakSha -ne $w.ShaBefore) { throw "$($w.Name) : backup does not match the original - refusing to continue" }
    Write-Host ("  backup ok : {0}" -f $w.BakPath)
  }

  foreach ($w in $Work) {
    [System.IO.File]::WriteAllText($w.Path, $w.After, $Utf8NoBom)
    [void]$written.Add($w)

    # SECONDARY CHECK: the bytes on disk must equal the bytes we intended. No hand-written
    # expected value exists to be wrong - the comparison is against this run's own output.
    $onDisk = Read-Text -Path $w.Path
    $sha    = Get-TextSha256 -Text $onDisk
    if ($sha -ne $w.ShaAfter) { throw "$($w.Name) : on-disk content does not match the simulated content" }

    # PRIMARY CHECK, re-run against what is actually on disk.
    $changed = Get-ChangedLineCount -Before $w.Before -After $onDisk
    $expect  = ($Plan | Where-Object { $_.Path -eq $w.Path }).ExpectedChangedLines
    if ($changed -ne $expect) { throw "$($w.Name) : $changed line(s) differ on disk, expected $expect" }

    Write-Host ("  written   : {0}  ({1} line(s) changed, sha {2})" -f $w.Name, $changed, $sha) -ForegroundColor Green
  }

  foreach ($d in $StagingDirs) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    if (-not (Test-Path -LiteralPath $d)) { throw "could not create staging dir: $d" }
    Write-Host ("  staging   : {0}" -f $d) -ForegroundColor Green
  }

  Write-Host "`nDONE. No scheduled task was run, registered, or modified." -ForegroundColor Green
  Write-Host 'Next: verify read-only, then trigger one manual run of each task.' -ForegroundColor Yellow
}
catch {
  Write-Host "`nFAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'ROLLING BACK...' -ForegroundColor Red
  foreach ($w in $written) {
    try {
      [System.IO.File]::WriteAllText($w.Path, $w.Before, $Utf8NoBom)
      $sha = Get-TextSha256 -Text (Read-Text -Path $w.Path)
      $ok  = ($sha -eq $w.ShaBefore)
      Write-Host ("  restored {0} : {1}" -f $w.Name, $(if ($ok) { 'OK (hash matches original)' } else { 'MISMATCH - use ' + $w.BakPath })) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
    }
    catch {
      Write-Host ("  RESTORE FAILED for {0} - restore by hand from {1}" -f $w.Name, $w.BakPath) -ForegroundColor Red
    }
  }
  Write-Host 'No scheduled task was run, registered, or modified.' -ForegroundColor Yellow
  throw
}
