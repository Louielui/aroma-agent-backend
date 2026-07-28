# verify-staging.ps1 - Part A step A1. Prove the staged Companion is COMPLETE and LOADS.
#
# RUN ELEVATED, after deploy-companion.ps1.
#
# Copying files is not staging. A staged set that copies cleanly can still fail to load,
# and discovering that during Part B means discovering it with no way to report it. GOV-001
# changed the derived closure from four names to five - observation.js joined it - so a
# staging directory from before that change is stale and the Companion will not start.
#
# Two independent checks, because either alone can pass while the other fails:
#   1. the staged file set equals the DERIVED closure exactly - no missing, no extra
#   2. the staged entry actually LOADS standalone, from its own directory, exit code 0

#Requires -RunAsAdministrator
param(
  [string]$StageDir = 'C:\Aroma\ComputerOperator-Companion',
  [string]$RepoRoot = 'C:\Aroma\aroma-agent-backend'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

Write-Host ("running as : " + (whoami) + "  SessionId=" + (Get-Process -Id $PID).SessionId)
Write-Host ""

$problems = @()

# ---------------------------------------------------------------------------
# 1. the DERIVED closure - asked of the manifest builder, never hardcoded here
# ---------------------------------------------------------------------------
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = 'node' }

$derivedJson = & $node -e "const M=require('$($RepoRoot -replace '\\','/')/scripts/computer/companionManifest');const m=M.buildManifest();console.log(JSON.stringify({names:m.files.map(f=>f.name).sort(),missing:m.missing}))" 2>&1
$derived = $null
try { $derived = $derivedJson | ConvertFrom-Json } catch { }
if (-not $derived) {
  Write-Host "could not derive the closure from companionManifest.js:" -ForegroundColor Red
  Write-Host ("  " + ($derivedJson | Out-String).Trim()) -ForegroundColor Red
  exit 2
}
if ($derived.missing.Count -gt 0) { $problems += ('unresolved requires in the graph: ' + ($derived.missing -join ', ')) }

Write-Host "=== derived closure ===" -ForegroundColor Cyan
$derived.names | ForEach-Object { Write-Host ("  " + $_) }

if (-not (Test-Path -LiteralPath $StageDir)) {
  Write-Host ("staging directory missing: " + $StageDir) -ForegroundColor Red
  exit 3
}
$staged = @(Get-ChildItem -LiteralPath $StageDir -Filter *.js | ForEach-Object { $_.Name } | Sort-Object)

Write-Host ""
Write-Host "=== staged on disk ===" -ForegroundColor Cyan
$staged | ForEach-Object { Write-Host ("  " + $_) }

$missing = @($derived.names | Where-Object { $staged -notcontains $_ })
$extra   = @($staged | Where-Object { $derived.names -notcontains $_ })
if ($missing.Count) { $problems += ('MISSING from staging: ' + ($missing -join ', ')) }
# Extras matter as much: the invariant is that staging EQUALS the closure. An extra file
# means something is there that no require reaches, and the set can no longer be reasoned
# about from the graph.
if ($extra.Count) { $problems += ('UNEXPECTED in staging: ' + ($extra -join ', ')) }

Write-Host ""
Write-Host ("closure match : " + ($missing.Count -eq 0 -and $extra.Count -eq 0)) -ForegroundColor $(if ($missing.Count -eq 0 -and $extra.Count -eq 0) { 'Green' } else { 'Red' })

# ---------------------------------------------------------------------------
# 2. it actually LOADS - the check that copying cannot give you
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== standalone load from the staged directory ===" -ForegroundColor Cyan
$entry = Join-Path $StageDir 'companion-entry.js'
if (-not (Test-Path -LiteralPath $entry)) {
  $problems += 'companion-entry.js is not staged'
} else {
  # Require the entry's dependencies from the staged directory only. Loading the entry
  # itself would start a listener; requiring its modules proves the closure resolves.
  $probe = "const p=require('path');const d='$($StageDir -replace '\\','\\\\')';['companion.js','ipcChannel.js','sessionBoundary.js','observation.js'].forEach(n=>require(p.join(d,n)));console.log('LOADED')"
  $out = & $node -e $probe 2>&1
  $code = $LASTEXITCODE
  Write-Host ("  exit code : " + $code)
  Write-Host ("  output    : " + ($out | Out-String).Trim())
  if ($code -ne 0) { $problems += ('staged modules did not load, exit ' + $code) }
}

Write-Host ""
if ($problems.Count -eq 0) {
  Write-Host "STAGING VERIFIED - closure exact and modules load standalone." -ForegroundColor Green
} else {
  Write-Host "STAGING FAILED - do NOT proceed to Part B:" -ForegroundColor Red
  $problems | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Red }
  Write-Host ""
  Write-Host "Re-run deploy-companion.ps1. If the closure changed, that is expected after" -ForegroundColor Yellow
  Write-Host "GOV-001 - the list is DERIVED, so it changing is the correct signal." -ForegroundColor Yellow
  exit 4
}
