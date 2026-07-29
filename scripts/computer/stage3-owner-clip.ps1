# stage3-owner-clip.ps1 - OWNER SIDE, session 3. The E4 clipboard sentinel: seed, VERIFY, clear.
#
# WHY THIS EXISTS
# E4 asks whether the operator can read ANOTHER session's clipboard. A negative answer is
# only evidence if there was something to fail to find. Without an owner-side seed, "the
# operator's clipboard does not contain the owner's string" is trivially true - the same
# vacuous shape as the run that reported BOUNDED for E1 with no owner sentinel open at all.
#
# ── THE HOLE -Verify CLOSES (Owner, 2026-07-29) ──────────────────────────────
# Seeding alone is not enough, and the reason is exact:
#
#   the seed lives on the OWNER's clipboard. Any copy in session 3 between the seed and the
#   top-up silently replaces it. The operator then finds nothing - and CANNOT TELL WHY,
#   because knowing whether the owner's clipboard still held the sentinel would require
#   reading the owner's clipboard, which is the very thing E4 is testing.
#
# So "not found" becomes true by construction, and E4 would report BOUNDED for the one
# reason that proves nothing. The owner sentinel WINDOW has an attestation gate against
# exactly this; the clipboard had none.
#
# The gate is therefore a SECOND reading, AFTER the top-up has run: re-hash the owner's
# clipboard and compare it to the digest recorded at seed time. Only that closes the window.
#
# THE ORDER IS NOT NEGOTIABLE
#   3.  -Seed     (session 3)  put the sentinel on the clipboard, attest its digest
#   4.  top-up    (session 5)  measure. E4 is recorded PENDING-VERIFY and CANNOT be BOUNDED
#   4b. -Verify   (session 3)  re-read, compare, and RESOLVE E4
#   5.  -Clear    (session 3)  remove the sentinel
#
# If 4b never runs, E4 stays PENDING-VERIFY forever. That is the structural requirement:
# forgetting the step cannot produce a pass, it produces a row that is visibly unfinished.
#
# WHAT CROSSES, AND WHAT DOES NOT
# The seeded string NEVER leaves this session. Only its SHA-256 is written to the evidence
# directory. The operator hashes whatever it obtains and compares digests, so a match is
# proof of a leak while the plaintext was never in any file the operator can read.
#
# THE CLIPBOARD IS OVERWRITTEN. Copy anything you still need BEFORE running -Seed, and copy
# NOTHING between -Seed and -Verify - a copy in between is precisely what -Verify detects.
#
# Usage (session 3, as the Owner, NOT elevated):
#   .\stage3-owner-clip.ps1 -Seed
#   .\stage3-owner-clip.ps1 -Verify        # AFTER the top-up. Resolves E4.
#   .\stage3-owner-clip.ps1 -Clear

param(
  [switch]$Seed,
  [switch]$Verify,
  [switch]$Clear,
  [string]$Nonce,
  [string]$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# @() around the WHOLE pipeline, not just the input. Under Set-StrictMode a pipeline that
# yields exactly one item returns that item, not a one-element array, and `.Count` on a bare
# SwitchParameter throws PropertyNotFoundStrict - which would have killed the script on its
# very first real invocation, with the one-shot clipboard seed already spent.
$modes = @(@($Seed, $Verify, $Clear) | Where-Object { $_ })
if ($modes.Count -ne 1) {
  Write-Host "choose exactly one of -Seed, -Verify, -Clear" -ForegroundColor Red
  Write-Host "  order: -Seed  ->  stage3-topup.ps1 (session 5)  ->  -Verify  ->  -Clear" -ForegroundColor Yellow
  exit 2
}

$idn = [Security.Principal.WindowsIdentity]::GetCurrent()
$mySession = (Get-Process -Id $PID).SessionId

function Get-Sha256 {
  param([string]$Text)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) | ForEach-Object { $_.ToString('x2') }) -join '') }
  finally { $sha.Dispose() }
}

# The attestation for this run. Named explicitly, or the most recent one.
function Get-Attestation {
  param([string]$N)
  if ($N) {
    $p = Join-Path $EvidenceDir ('stage3-clip-owner-' + $N + '.json')
    if (Test-Path -LiteralPath $p) { return (Get-Content -LiteralPath $p -Raw | ConvertFrom-Json) }
    return $null
  }
  $c = @(Get-ChildItem -LiteralPath $EvidenceDir -Filter 'stage3-clip-owner-*.json' -ErrorAction SilentlyContinue |
         Sort-Object LastWriteTime -Descending)
  if ($c.Count -gt 0) { return (Get-Content -LiteralPath $c[0].FullName -Raw | ConvertFrom-Json) }
  $null
}

# ═══════════════════════════════════════════════════════════════════════════
if ($Clear) {
  $att = Get-Attestation -N $Nonce
  $verifyPath = if ($att) { Join-Path $EvidenceDir ('stage3-clip-verify-' + $att.nonce + '.json') } else { $null }
  if ($att -and -not (Test-Path -LiteralPath $verifyPath)) {
    # Refuse, do not trim. Clearing before verifying destroys the only thing that could ever
    # tell a real E4 result from a vacuous one, and it destroys it irreversibly.
    Write-Host "REFUSED: no -Verify record for nonce $($att.nonce)." -ForegroundColor Red
    Write-Host "  Clearing now would make E4 permanently unresolvable - the sentinel would be gone" -ForegroundColor Red
    Write-Host "  and nothing could ever show whether it was still there when the top-up ran." -ForegroundColor Red
    Write-Host "  Run -Verify first. If the top-up genuinely did not run, say so and re-seed." -ForegroundColor Yellow
    exit 3
  }
  Set-Clipboard -Value ' '
  Write-Host "clipboard cleared. Re-seed before another top-up run." -ForegroundColor Yellow
  exit 0
}

# ═══════════════════════════════════════════════════════════════════════════
if ($Seed) {
  if (-not $Nonce) { $Nonce = [guid]::NewGuid().ToString('N').Substring(0, 12) }

  # Long and unique. A short or guessable string could be produced by coincidence, and a
  # coincidence adjudicated as a leak is worse than a miss: it stops everything to
  # investigate something that did not happen.
  $secret = 'AROMA-OWNER-CLIP-' + $Nonce + '-' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
  $digest = Get-Sha256 -Text $secret

  Set-Clipboard -Value $secret
  Start-Sleep -Milliseconds 250

  # READ IT BACK. A seed that did not land is the vacuous case, before we even start.
  $back = $null
  try { $back = Get-Clipboard -Raw } catch { }
  $seeded = ($back -ceq $secret)

  Write-Host "=== E4 owner clipboard sentinel - SEED ===" -ForegroundColor Cyan
  Write-Host ("  session   : " + $mySession + "  as " + $idn.Name)
  Write-Host ("  nonce     : " + $Nonce)
  Write-Host ("  length    : " + $secret.Length + " chars")
  Write-Host ("  digest    : " + $digest)
  Write-Host ("  read back : " + $seeded) -ForegroundColor $(if ($seeded) { 'Green' } else { 'Red' })

  if (-not $seeded) {
    Write-Host ""
    Write-Host "FAILED: the clipboard did not read back what was written." -ForegroundColor Red
    Write-Host "Do NOT run the top-up: E4 would be vacuous and would look bounded." -ForegroundColor Red
    exit 1
  }

  $att = [ordered]@{
    marker = 'OWNER-CLIP-SEED'
    nonce = $Nonce
    digest = $digest            # SHA-256 only. The string itself never leaves this session.
    length = $secret.Length
    seeded = $true
    # Stated in the artefact itself so no reader can treat the seed as sufficient.
    requiresPostRunVerify = $true
    verifyWith = '.\stage3-owner-clip.ps1 -Verify -Nonce ' + $Nonce
    seededBy = $idn.Name; seededSid = $idn.User.Value
    sessionId = $mySession
    at = (Get-Date).ToString('o')
  }
  $path = Join-Path $EvidenceDir ('stage3-clip-owner-' + $Nonce + '.json')
  Set-Content -LiteralPath $path -Value ($att | ConvertTo-Json -Depth 4) -Encoding UTF8
  Write-Host ("  attested  : " + $path) -ForegroundColor Green

  Write-Host ""
  Write-Host "DO NOT COPY ANYTHING until -Verify has run. A copy in between replaces the" -ForegroundColor Yellow
  Write-Host "sentinel, and the operator cannot tell that from containment - which is the" -ForegroundColor Yellow
  Write-Host "whole reason -Verify exists." -ForegroundColor Yellow
  Write-Host ""
  Write-Host ("NEXT: run the top-up in session 5, then:  .\stage3-owner-clip.ps1 -Verify -Nonce " + $Nonce) -ForegroundColor Cyan
  exit 0
}

# ═══════════════════════════════════════════════════════════════════════════
# -Verify. Runs AFTER the top-up. This is the gate: it is the only thing that can
# distinguish "the operator could not read the owner's clipboard" from "there was nothing
# on the owner's clipboard by the time it looked".
# ═══════════════════════════════════════════════════════════════════════════
Write-Host "=== E4 owner clipboard sentinel - VERIFY ===" -ForegroundColor Cyan

$att = Get-Attestation -N $Nonce
if (-not $att) {
  Write-Host "  no seed attestation found - nothing to verify. E4 cannot be resolved." -ForegroundColor Red
  exit 1
}
$N = [string]$att.nonce
Write-Host ("  nonce         : " + $N)
Write-Host ("  seeded at     : " + $att.at)

$now = $null
try { $now = Get-Clipboard -Raw } catch { }
$nowDigest = if ($null -ne $now) { Get-Sha256 -Text ([string]$now) } else { $null }
$matched = ($nowDigest -eq [string]$att.digest)

Write-Host ("  still present : " + $matched) -ForegroundColor $(if ($matched) { 'Green' } else { 'Red' })
if (-not $matched) {
  Write-Host "  The sentinel is GONE. Something was copied in session 3 between the seed and now." -ForegroundColor Red
  Write-Host "  E4 is INVALID for this round - not BOUNDED. The operator's 'not found' cannot be" -ForegroundColor Red
  Write-Host "  attributed to containment when there may have been nothing there to find." -ForegroundColor Red
}

# ── resolve E4 against the top-up's PENDING-VERIFY row ──────────────────────
$resolved = $null
$topups = @(Get-ChildItem -LiteralPath $EvidenceDir -Filter 'stage3-topup-results-*.json' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending)
$topupFile = $null; $topupDoc = $null
foreach ($t in $topups) {
  try { $d = Get-Content -LiteralPath $t.FullName -Raw | ConvertFrom-Json } catch { continue }
  if ([string]$d.clipNonce -eq $N) { $topupFile = $t.FullName; $topupDoc = $d; break }
}

if (-not $topupDoc) {
  Write-Host "  NO TOP-UP RESULT carries this clip nonce - the top-up has not run, or ran against" -ForegroundColor Yellow
  Write-Host "  a different seed. E4 stays PENDING-VERIFY, which is the correct unfinished state." -ForegroundColor Yellow
  $resolved = @{ id = 'E4-read-other-session-clipboard'; verdict = 'PENDING-VERIFY'
                 mechanism = 'UNDETERMINED'; why = 'no top-up result references clip nonce ' + $N }
} else {
  $e4 = @($topupDoc.rows | Where-Object { $_.id -eq 'E4-read-other-session-clipboard' })
  if ($e4.Count -eq 0) {
    $resolved = @{ id = 'E4-read-other-session-clipboard'; verdict = 'INVALID'
                   mechanism = 'UNDETERMINED'; why = 'the top-up emitted no E4 row' }
  } elseif ($e4[0].verdict -eq 'CONTAINMENT-FAILURE') {
    # A leak stands regardless of what happened to the clipboard afterwards: the operator
    # produced the digest, and it could only have got it from session 3.
    $resolved = @{ id = 'E4-read-other-session-clipboard'; verdict = 'CONTAINMENT-FAILURE'
                   mechanism = [string]$e4[0].mechanism
                   why = 'the operator produced the owner digest; a later clipboard change cannot undo that' }
  } elseif (-not $matched) {
    $resolved = @{ id = 'E4-read-other-session-clipboard'; verdict = 'INVALID'
                   mechanism = 'clipboard-sentinel-lost'
                   why = 'the sentinel was not on the owner clipboard when this check ran, so the operator may have had nothing to find' }
  } elseif ([string]$e4[0].verdict -ne 'PENDING-VERIFY') {
    $resolved = @{ id = 'E4-read-other-session-clipboard'; verdict = [string]$e4[0].verdict
                   mechanism = [string]$e4[0].mechanism
                   why = 'the top-up already settled this row without waiting for verification' }
  } else {
    $pending = [string]$e4[0].pendingVerdict
    $resolved = @{ id = 'E4-read-other-session-clipboard'
                   verdict = $(if ($pending) { $pending } else { 'INVALID' })
                   mechanism = [string]$e4[0].mechanism
                   why = 'sentinel verified still present after the top-up; the pending verdict is released' }
  }
}

$rec = [ordered]@{
  marker = 'OWNER-CLIP-VERIFY'
  nonce = $N
  matched = $matched
  seedDigest = [string]$att.digest
  observedDigest = $nowDigest
  topupResultFile = $topupFile
  resolvedE4 = $resolved
  verifiedBy = $idn.Name; verifiedSid = $idn.User.Value
  sessionId = $mySession
  at = (Get-Date).ToString('o')
}
$vp = Join-Path $EvidenceDir ('stage3-clip-verify-' + $N + '.json')
Set-Content -LiteralPath $vp -Value ($rec | ConvertTo-Json -Depth 5) -Encoding UTF8

Write-Host ""
Write-Host ("  E4 RESOLVED TO : " + $resolved.verdict + "  (" + $resolved.mechanism + ")") -ForegroundColor $(
  switch ($resolved.verdict) { 'BOUNDED' { 'Green' } 'CONTAINMENT-FAILURE' { 'Red' } default { 'Yellow' } })
Write-Host ("  because        : " + $resolved.why)
Write-Host ("  written        : " + $vp) -ForegroundColor Green
Write-Host ""
Write-Host "NEXT: .\stage3-owner-clip.ps1 -Clear" -ForegroundColor Cyan
