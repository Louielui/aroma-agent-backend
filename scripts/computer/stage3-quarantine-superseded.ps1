# stage3-quarantine-superseded.ps1 - retire pre-console baselines so nothing can read them.
#
# RUN ELEVATED, in session 3, BEFORE stage3-console-check.ps1.
#
# Two session-3 baselines existed on disk - one taken over RDP (dpiX 144, 2496x1664) and
# one at the console (dpiX 120, 1920x1080) - with no declared authority between them.
# Everything downstream compares against "the session-3 baseline", so whichever was found
# first would have won.
#
# The false-halt direction is annoying. The false-PASS direction is worse: a step reading
# the wrong baseline and finding it consistent would report agreement it never had.
#
# So this does not rename or reorder. It MOVES superseded artefacts into superseded\ where
# the glob used to find the authoritative baseline cannot reach them, and it never deletes:
# a superseded measurement is still a record of what was true when it was taken.

#Requires -RunAsAdministrator
param(
  [string]$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence',
  [switch]$WhatIfOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

Write-Host ("running as : " + (whoami) + "  SessionId=" + (Get-Process -Id $PID).SessionId)
Write-Host ""

if (-not (Test-Path -LiteralPath $EvidenceDir)) {
  Write-Host ("evidence directory not found: " + $EvidenceDir) -ForegroundColor Red
  exit 2
}

$supersededDir = Join-Path $EvidenceDir 'superseded'

# Everything that carries display geometry or a run identity from before the console
# measurement. Task baselines and Companion artefacts are NOT touched - they are not
# display-dependent and are still current.
$patterns = @(
  'stage3-authoritative-baseline*.json',
  'stage3-baseline*.json',
  'baseline-session3*.json',
  'baseline-recheck*.json',
  'stage3-owner-reference-*.*',
  'stage3-sentinel-*.json',
  'stage3-STARTED-*.json',
  'stage3-COMPLETED-*.json',
  'stage3-results*.json',
  'stage3-capture-*.png',
  'stage3-manifest.json'
)

$found = @()
foreach ($p in $patterns) {
  try { $found += @(Get-ChildItem -LiteralPath $EvidenceDir -Filter $p -File -ErrorAction SilentlyContinue) } catch { }
}
$found = @($found | Sort-Object FullName -Unique)

Write-Host "=== artefacts to retire ===" -ForegroundColor Cyan
if ($found.Count -eq 0) {
  Write-Host "  none - the evidence directory holds no stale Stage 3 display artefacts" -ForegroundColor Green
} else {
  $found | ForEach-Object { Write-Host ("  " + $_.Name + "   " + $_.Length + " bytes   " + $_.LastWriteTime) }
}

Write-Host ""
Write-Host "=== NOT touched (not display-dependent, still current) ===" -ForegroundColor Cyan
foreach ($keep in @('observer-task-baseline.xml', 'observer-result.json', 'containment-probe-rerun.out', 'tierA-probe.out')) {
  if (Test-Path -LiteralPath (Join-Path $EvidenceDir $keep)) { Write-Host ("  " + $keep) }
}

if ($WhatIfOnly) {
  Write-Host ""
  Write-Host "-WhatIfOnly: nothing moved." -ForegroundColor Yellow
  exit 0
}

if ($found.Count -gt 0) {
  if (-not (Test-Path -LiteralPath $supersededDir)) { New-Item -ItemType Directory -Force -Path $supersededDir | Out-Null }
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $target = Join-Path $supersededDir $stamp
  New-Item -ItemType Directory -Force -Path $target | Out-Null

  $moved = @(); $failed = @()
  foreach ($f in $found) {
    try { Move-Item -LiteralPath $f.FullName -Destination (Join-Path $target $f.Name) -Force -ErrorAction Stop; $moved += $f.Name }
    catch { $failed += ($f.Name + ' : ' + $_.Exception.Message) }
  }
  Write-Host ""
  Write-Host ("moved " + $moved.Count + " item(s) to " + $target) -ForegroundColor Green
  if ($failed.Count) {
    Write-Host "COULD NOT MOVE:" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Red }
    Write-Host "A stale artefact left readable can still be picked up downstream. Fix before continuing." -ForegroundColor Red
    exit 3
  }
}

# prove the read path is now unambiguous
$remaining = @(Get-ChildItem -LiteralPath $EvidenceDir -Filter 'stage3-authoritative-baseline*.json' -File -ErrorAction SilentlyContinue)
Write-Host ""
Write-Host ("authoritative-baseline candidates now visible : " + $remaining.Count) -ForegroundColor $(if ($remaining.Count -eq 0) { 'Green' } else { 'Red' })
if ($remaining.Count -ne 0) {
  Write-Host "Expected 0 at this point - stage3-console-check.ps1 writes the new one next." -ForegroundColor Red
  exit 4
}
Write-Host ""
Write-Host "QUARANTINE COMPLETE - now run stage3-console-check.ps1 at the console." -ForegroundColor Green
