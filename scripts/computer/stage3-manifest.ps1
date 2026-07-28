# stage3-manifest.ps1 - mint the run manifest. Part A, session 3, normal rights.
#
# The manifest is the AUTHORITY on whether a redo is needed. Not the evidence directory:
# an empty evidence directory has two causes - the harness never ran, or it ran and could
# not write - and those need opposite responses. Absence cannot tell them apart, so the
# ruling comes from a positive record instead.
#
# It lives in the evidence directory because that is the one location MEASURED to be both
# writable by AromaOperator (it marks the manifest consumed from session 5) and readable by
# the Owner from session 3 - writeEvidence = true in the v1 set, EVIDENCE-002.
#
# Nonces are single-use. Any retry is a full Part A redo, so this refuses to overwrite an
# existing manifest that has not been consumed: silently minting fresh nonces over a live
# run would produce two runs that each think they are the only one.

param(
  [string]$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence',
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$manifestPath = Join-Path $EvidenceDir 'stage3-manifest.json'
$idn = [Security.Principal.WindowsIdentity]::GetCurrent()

Write-Host ("running as : " + $idn.Name + "  SessionId=" + (Get-Process -Id $PID).SessionId)
Write-Host ""

if (-not (Test-Path -LiteralPath $EvidenceDir)) {
  Write-Host ("evidence directory does not exist: " + $EvidenceDir) -ForegroundColor Red
  Write-Host "Run deploy-companion.ps1 first. Nothing was written." -ForegroundColor Red
  exit 2
}

if ((Test-Path -LiteralPath $manifestPath) -and -not $Force) {
  $existing = $null
  try { $existing = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { }
  if ($existing -and $existing.consumed -eq $false) {
    Write-Host "A manifest already exists and is NOT consumed:" -ForegroundColor Yellow
    Write-Host ("  ownerNonce    : " + $existing.ownerNonce)
    Write-Host ("  operatorNonce : " + $existing.operatorNonce)
    Write-Host ("  minted        : " + $existing.mintedAt)
    Write-Host ""
    Write-Host "That run has not been used yet. Minting new nonces over it would leave two" -ForegroundColor Yellow
    Write-Host "runs each believing it is the only one. Use it, or pass -Force to discard." -ForegroundColor Yellow
    exit 3
  }
}

$ownerNonce = [guid]::NewGuid().ToString('N').Substring(0, 12)
$operatorNonce = [guid]::NewGuid().ToString('N').Substring(0, 12)

$manifest = [ordered]@{
  probe = 'stage3-manifest'
  ownerNonce = $ownerNonce
  operatorNonce = $operatorNonce
  # THE FIELD THAT DECIDES A REDO. Set true by the harness BEFORE it measures anything, so
  # a crashed run cannot be quietly retried into a clean-looking result.
  consumed = $false
  consumedAt = $null
  consumedBy = $null
  consumedSessionId = $null
  mintedAt = (Get-Date).ToString('o')
  mintedBy = $idn.Name
  mintedSessionId = (Get-Process -Id $PID).SessionId
}

$json = ($manifest | ConvertTo-Json -Depth 5)
Set-Content -LiteralPath $manifestPath -Value $json -Encoding UTF8 -ErrorAction Stop

# write-then-verify: a manifest that did not land is worse than none, because the harness
# would refuse to start and the reason would not be obvious
$readBack = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($readBack.ownerNonce -ne $ownerNonce -or $readBack.operatorNonce -ne $operatorNonce) {
  Write-Host "MANIFEST DID NOT VERIFY after writing - do not proceed." -ForegroundColor Red
  exit 4
}

$hash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash

Write-Host "=== manifest minted ===" -ForegroundColor Green
Write-Host ("  path          : " + $manifestPath)
Write-Host ("  SHA-256       : " + $hash)
Write-Host ("  consumed      : false")
Write-Host ""
Write-Host "  ownerNonce    : $ownerNonce" -ForegroundColor Cyan
Write-Host "  operatorNonce : $operatorNonce" -ForegroundColor Cyan
Write-Host ""
Write-Host "WRITE THESE TWO DOWN. Part C checks them by eye as well as by file." -ForegroundColor Yellow
Write-Host "A results file whose nonces do not match this manifest is REJECTED, not read." -ForegroundColor Yellow
