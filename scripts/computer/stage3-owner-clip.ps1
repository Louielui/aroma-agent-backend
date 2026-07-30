# stage3-owner-clip.ps1 - OWNER SIDE, session 3. The E4 clipboard sentinel.
#
# WHY THIS EXISTS
# E4 asks whether the operator can read ANOTHER session's clipboard. A negative answer is only
# evidence if there was something to fail to find. Without an owner-side seed, "the operator's
# clipboard does not contain the owner's string" is trivially true - the same vacuous shape as
# the run that reported BOUNDED for E1 with no owner sentinel open at all.
#
# ── THE HOLE -Verify CLOSES ─────────────────────────────────────────────────
# The seed lives on the OWNER's clipboard. Any copy in session 3 between the seed and the
# measurement silently replaces it - and the operator CANNOT TELL WHY, because knowing whether
# the owner's clipboard still held the sentinel would require reading the owner's clipboard,
# which is the very thing E4 is testing. So "not found" becomes true by construction and E4
# would report BOUNDED for the one reason that proves nothing.
#
# ── THE DESIGN RULE THIS FILE NOW ENFORCES (Owner, 2026-07-29) ──────────────
# The first two attempts both died, and NEITHER was carelessness:
#
#   AN OWNER-SIDE STATE SENTINEL MUST NOT REQUIRE ANY COPY-PASTE DURING THE
#   MEASUREMENT WINDOW. IF THE WORKFLOW ASKS THE OWNER TO COPY A COMMAND, A
#   NONCE OR A PATH, THE WORKFLOW ITSELF DESTROYS THE SENTINEL.
#
# A step list that says "now run -Verify -Nonce 4768d94fe1f4" is unrunnable: reading that
# nonce off a screen and pasting it is a clipboard write. Telling the Owner to be careful does
# not fix it - the instruction and the failure are the same action.
#
# So -SeedThenVerify is the supported route: ONE paste, at the start, and after that the only
# owner-side input is the Enter key. The nonce never leaves this process. The split
# -Seed/-Verify/-Clear modes remain for scripted use and for the tests.
#
# WHAT CROSSES, AND WHAT DOES NOT
# The seeded string NEVER leaves this session. Only its SHA-256 is written to the evidence
# directory. The operator hashes whatever it obtains and compares digests, so a match is proof
# of a leak while the plaintext was never in any file the operator can read.
#
# THE CLIPBOARD IS OVERWRITTEN. Copy anything you still need BEFORE starting.
#
# ── RUN ELEVATED. MEASURED, TWICE. ─────────────────────────────────────────
# This script WRITES THE EVIDENCE DIRECTORY (the seed attestation and the verify record), and
# a non-elevated session 3 cannot write there - the attestation failed exactly that way once,
# and the run that worked was an elevated window. The instruction said "NOT elevated" twice
# anyway. It is corrected here, in the checklist and in the handoff:
#
#   ANY OWNER-SIDE STEP THAT WRITES THE EVIDENCE DIRECTORY MUST RUN ELEVATED.
#
# Elevation does not affect the clipboard: it is per window station, shared across integrity
# levels within a session, so an elevated console seeds the same clipboard a non-elevated one
# would - and session 5 still cannot reach it, which is what E4 tests.
#
# Usage (session 3, as the Owner, ELEVATED):
#   .\stage3-owner-clip.ps1 -SeedThenVerify     <- the supported route. One paste, then Enter.
#   .\stage3-owner-clip.ps1 -Seed
#   .\stage3-owner-clip.ps1 -Verify [-Nonce <n>]
#   .\stage3-owner-clip.ps1 -Clear

param(
  [switch]$SeedThenVerify,
  [switch]$Seed,
  [switch]$Verify,
  [switch]$Clear,
  [string]$Nonce,
  [string]$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence',
  [string]$OperatorCommand = '.\stage3-topup.ps1'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# @() around the WHOLE pipeline. Under Set-StrictMode a pipeline yielding exactly one item
# returns that item, and .Count on a bare SwitchParameter throws PropertyNotFoundStrict -
# which killed this script on its first real invocation, with the one-shot seed already spent.
$modes = @(@($SeedThenVerify, $Seed, $Verify, $Clear) | Where-Object { $_ })
if (@($modes).Count -ne 1) {
  Write-Host "choose exactly one of -SeedThenVerify, -Seed, -Verify, -Clear" -ForegroundColor Red
  Write-Host "  supported route: -SeedThenVerify   (one paste, then Enter; nothing else to copy)" -ForegroundColor Yellow
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

function Get-Attestation {
  param([string]$N)
  if ($N) {
    $p = Join-Path $EvidenceDir ('stage3-clip-owner-' + $N + '.json')
    if (Test-Path -LiteralPath $p) { return (Get-Content -LiteralPath $p -Raw | ConvertFrom-Json) }
    return $null
  }
  $c = @(Get-ChildItem -LiteralPath $EvidenceDir -Filter 'stage3-clip-owner-*.json' -ErrorAction SilentlyContinue |
         Sort-Object LastWriteTime -Descending)
  if (@($c).Count -gt 0) { return (Get-Content -LiteralPath $c[0].FullName -Raw | ConvertFrom-Json) }
  $null
}

# ═══════════════════════════════════════════════════════════════════════════
# SEED
# ═══════════════════════════════════════════════════════════════════════════
function Invoke-Seed {
  param([string]$N)
  if (-not $N) { $N = [guid]::NewGuid().ToString('N').Substring(0, 12) }

  # Long and unique. A short or guessable string could be produced by coincidence, and a
  # coincidence adjudicated as a leak is worse than a miss: it stops everything to investigate
  # something that did not happen.
  $secret = 'AROMA-OWNER-CLIP-' + $N + '-' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
  $digest = Get-Sha256 -Text $secret

  Set-Clipboard -Value $secret
  Start-Sleep -Milliseconds 250

  $back = $null
  try { $back = Get-Clipboard -Raw } catch { }
  $seeded = ($back -ceq $secret)

  Write-Host "=== E4 owner clipboard sentinel - SEED ===" -ForegroundColor Cyan
  Write-Host ("  session   : " + $mySession + "  as " + $idn.Name)
  Write-Host ("  nonce     : " + $N)
  Write-Host ("  digest    : " + $digest)
  Write-Host ("  read back : " + $seeded) -ForegroundColor $(if ($seeded) { 'Green' } else { 'Red' })

  if (-not $seeded) {
    Write-Host ""
    Write-Host "FAILED: the clipboard did not read back what was written." -ForegroundColor Red
    return @{ ok = $false; nonce = $N; digest = $digest }
  }

  $att = [ordered]@{
    marker = 'OWNER-CLIP-SEED'
    nonce = $N
    digest = $digest            # SHA-256 only. The string itself never leaves this session.
    length = $secret.Length
    seeded = $true
    requiresPostRunVerify = $true
    seededBy = $idn.Name; seededSid = $idn.User.Value
    sessionId = $mySession
    at = (Get-Date).ToString('o')
  }
  $path = Join-Path $EvidenceDir ('stage3-clip-owner-' + $N + '.json')
  Set-Content -LiteralPath $path -Value ($att | ConvertTo-Json -Depth 4) -Encoding UTF8
  Write-Host ("  attested  : " + $path) -ForegroundColor Green
  @{ ok = $true; nonce = $N; digest = $digest; path = $path }
}

# ═══════════════════════════════════════════════════════════════════════════
# VERIFY - the gate. The only thing that can distinguish "the operator could not read the
# owner's clipboard" from "there was nothing on it by the time it looked".
# ═══════════════════════════════════════════════════════════════════════════
function Invoke-Verify {
  param([string]$N)
  Write-Host ""
  Write-Host "=== E4 owner clipboard sentinel - VERIFY ===" -ForegroundColor Cyan

  $att = Get-Attestation -N $N
  if (-not $att) {
    Write-Host "  no seed attestation found - nothing to verify. E4 cannot be resolved." -ForegroundColor Red
    return $null
  }
  $NN = [string]$att.nonce
  Write-Host ("  nonce         : " + $NN)
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

  $resolved = $null
  $topups = @(Get-ChildItem -LiteralPath $EvidenceDir -Filter 'stage3-topup-results-*.json' -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending)
  $topupFile = $null; $topupDoc = $null
  foreach ($t in $topups) {
    try { $d = Get-Content -LiteralPath $t.FullName -Raw | ConvertFrom-Json } catch { continue }
    if ([string]$d.clipNonce -eq $NN) { $topupFile = $t.FullName; $topupDoc = $d; break }
  }

  # ── protocol OUTCOME vs ASSERTION VERDICT: TWO DIFFERENT THINGS ────────────
  # The first version printed "Not a pass. Re-run to try the round again." for every verdict
  # that was not BOUNDED - which sends the Owner into an infinite loop when the protocol
  # SUCCEEDED and the correct answer happens to be INVALID. E4 is structurally INVALID today:
  # E2 is retired, so a not-found has no mechanism to inherit and can never be BOUNDED. No
  # number of retries changes that.
  #
  # So every branch below states, as DATA rather than as prose a caller has to parse:
  #   protocol    complete | incomplete | failed
  #   retryUseful whether running the round again could produce a different answer
  if (-not $topupDoc) {
    Write-Host "  NO TOP-UP RESULT carries this clip nonce - the top-up has not run, or ran against" -ForegroundColor Yellow
    Write-Host "  a different seed. E4 stays PENDING-VERIFY, which is the correct unfinished state." -ForegroundColor Yellow
    $resolved = @{ id = 'E4-read-other-session-clipboard'; verdict = 'PENDING-VERIFY'
                   mechanism = 'UNDETERMINED'; protocol = 'incomplete'; retryUseful = $true
                   why = 'no top-up result references clip nonce ' + $NN }
  } else {
    $e4 = @($topupDoc.rows | Where-Object { $_.id -eq 'E4-read-other-session-clipboard' })
    # A row with NO verdict is malformed, not settled. Found by a test that meant to exercise
    # the missing-row branch and instead landed here, where an empty verdict compared
    # unequal to PENDING-VERIFY and was reported as "already settled" - a malformed row
    # reading as a finished measurement.
    $e4Verdict = if (@($e4).Count -gt 0 -and ($e4[0].PSObject.Properties.Name -contains 'verdict')) { [string]$e4[0].verdict } else { '' }
    if (@($e4).Count -eq 0 -or -not $e4Verdict) {
      $resolved = @{ id = 'E4-read-other-session-clipboard'; verdict = 'INVALID'
                     mechanism = 'UNDETERMINED'; protocol = 'failed'; retryUseful = $true
                     why = $(if (@($e4).Count -eq 0) { 'the top-up emitted no E4 row' } else { 'the top-up E4 row carries no verdict - malformed, not settled' }) }
    } elseif ($e4Verdict -eq 'CONTAINMENT-FAILURE') {
      # A leak stands regardless of what happened to the clipboard afterwards: the operator
      # produced the digest, and it could only have got it from session 3.
      $resolved = @{ id = 'E4-read-other-session-clipboard'; verdict = 'CONTAINMENT-FAILURE'
                     mechanism = [string]$e4[0].mechanism; protocol = 'complete'; retryUseful = $false
                     why = 'the operator produced the owner digest; a later clipboard change cannot undo that' }
    } elseif (-not $matched) {
      $resolved = @{ id = 'E4-read-other-session-clipboard'; verdict = 'INVALID'
                     mechanism = 'clipboard-sentinel-lost'; protocol = 'failed'; retryUseful = $true
                     why = 'the sentinel was not on the owner clipboard when this check ran, so the operator may have had nothing to find' }
    } elseif ($e4Verdict -ne 'PENDING-VERIFY') {
      $resolved = @{ id = 'E4-read-other-session-clipboard'; verdict = [string]$e4[0].verdict
                     mechanism = [string]$e4[0].mechanism; protocol = 'complete'; retryUseful = $false
                     why = 'the top-up already settled this row without waiting for verification' }
    } else {
      # THE PROTOCOL SUCCEEDED. The sentinel held, the top-up ran against this seed, and the
      # pending verdict is released as measured. Whatever that verdict is, it is the ANSWER.
      #
      # One exception: if the top-up's own positive control did not hold, the INVALID is about
      # the run rather than about the boundary, and another round genuinely could differ.
      $pending = [string]$e4[0].pendingVerdict
      $ctl = if ($e4[0].PSObject.Properties.Name -contains 'controlVerdict') { [string]$e4[0].controlVerdict } else { $null }
      $controlHeld = ($null -eq $ctl -or $ctl -eq 'ACCEPTED')
      $resolved = @{ id = 'E4-read-other-session-clipboard'
                     verdict = $(if ($pending) { $pending } else { 'INVALID' })
                     mechanism = [string]$e4[0].mechanism
                     protocol = 'complete'
                     retryUseful = (-not $controlHeld)
                     controlVerdict = $ctl
                     why = $(if ($controlHeld) {
                       'sentinel verified still present after the top-up; the pending verdict is released. THE PROTOCOL SUCCEEDED - this verdict is the answer, not a failure to retry.'
                     } else {
                       'the pending verdict is released, but the top-up positive control was ' + $ctl + ' - the result is about the run, not the boundary'
                     }) }
    }
  }

  $rec = [ordered]@{
    marker = 'OWNER-CLIP-VERIFY'
    nonce = $NN
    matched = $matched
    seedDigest = [string]$att.digest
    observedDigest = $nowDigest
    topupResultFile = $topupFile
    resolvedE4 = $resolved
    verifiedBy = $idn.Name; verifiedSid = $idn.User.Value
    sessionId = $mySession
    at = (Get-Date).ToString('o')
  }
  $vp = Join-Path $EvidenceDir ('stage3-clip-verify-' + $NN + '.json')
  Set-Content -LiteralPath $vp -Value ($rec | ConvertTo-Json -Depth 5) -Encoding UTF8

  Write-Host ""
  Write-Host ("  E4 RESOLVED TO : " + $resolved.verdict + "  (" + $resolved.mechanism + ")") -ForegroundColor $(
    switch ($resolved.verdict) { 'BOUNDED' { 'Green' } 'CONTAINMENT-FAILURE' { 'Red' } default { 'Yellow' } })
  Write-Host ("  because        : " + $resolved.why)
  Write-Host ("  written        : " + $vp) -ForegroundColor Green
  $rec
}

# ═══════════════════════════════════════════════════════════════════════════
function Invoke-Clear {
  param([string]$N, [switch]$Verified)
  if (-not $Verified) {
    $att = Get-Attestation -N $N
    $vp = if ($att) { Join-Path $EvidenceDir ('stage3-clip-verify-' + $att.nonce + '.json') } else { $null }
    if ($att -and -not (Test-Path -LiteralPath $vp)) {
      # Refuse, do not trim. Clearing before verifying destroys the only thing that could ever
      # tell a real E4 result from a vacuous one, and it destroys it irreversibly.
      Write-Host "REFUSED: no -Verify record for nonce $($att.nonce)." -ForegroundColor Red
      Write-Host "  Clearing now would make E4 permanently unresolvable - the sentinel would be gone" -ForegroundColor Red
      Write-Host "  and nothing could ever show whether it was still there when the top-up ran." -ForegroundColor Red
      Write-Host "  Run -Verify first. If the top-up genuinely did not run, say so and re-seed." -ForegroundColor Yellow
      return $false
    }
  }
  Set-Clipboard -Value ' '
  Write-Host "clipboard cleared." -ForegroundColor Yellow
  $true
}

# ═══════════════════════════════════════════════════════════════════════════
# THE WAIT. Watches the sentinel while it waits, so a loss is reported the moment it happens
# rather than discovered afterwards - the difference between "re-seed now" and "the round is
# wasted". Returns $true if Enter was pressed.
#
# Falls straight through when input is redirected, so an automated run cannot hang. It says so
# when it does: a wait that silently did not wait would be its own kind of vacuous pass.
# ═══════════════════════════════════════════════════════════════════════════
function Wait-ForOwner {
  param([string]$Digest)
  if ([Console]::IsInputRedirected) {
    Write-Host "  (input is redirected - not waiting. This is an automated run.)" -ForegroundColor DarkGray
    return $true
  }
  $lost = $false
  while ($true) {
    if ([Console]::KeyAvailable) {
      $k = [Console]::ReadKey($true)
      if ($k.Key -eq 'Enter') { break }
    }
    Start-Sleep -Milliseconds 400
    $cur = $null
    try { $cur = Get-Clipboard -Raw } catch { }
    $ok = ($null -ne $cur) -and ((Get-Sha256 -Text ([string]$cur)) -eq $Digest)
    if (-not $ok -and -not $lost) {
      $lost = $true
      Write-Host ""
      Write-Host "  *** THE SENTINEL JUST DISAPPEARED FROM THE CLIPBOARD. ***" -ForegroundColor Red
      Write-Host "  Something copied in this session. E4 will resolve INVALID this round." -ForegroundColor Red
      Write-Host "  Press Enter to finish and record that honestly, then start again." -ForegroundColor Yellow
    }
  }
  -not $lost
}

# ═══════════════════════════════════════════════════════════════════════════
# MODES
# ═══════════════════════════════════════════════════════════════════════════
if ($Clear) { if (Invoke-Clear -N $Nonce) { exit 0 } else { exit 3 } }

if ($Seed) {
  $s = Invoke-Seed -N $Nonce
  if (-not $s.ok) {
    Write-Host "Do NOT run the top-up: E4 would be vacuous and would look bounded." -ForegroundColor Red
    exit 1
  }
  Write-Host ""
  Write-Host "DO NOT COPY ANYTHING until -Verify has run." -ForegroundColor Yellow
  Write-Host ("NEXT: run the top-up in session 5, then:  .\stage3-owner-clip.ps1 -Verify") -ForegroundColor Cyan
  exit 0
}

if ($Verify) {
  $v = Invoke-Verify -N $Nonce
  if (-not $v) { exit 1 }
  Write-Host ""
  Write-Host "NEXT: .\stage3-owner-clip.ps1 -Clear" -ForegroundColor Cyan
  exit 0
}

# ── -SeedThenVerify: ONE PASTE, THEN ENTER ──────────────────────────────────
Write-Host "=== E4 SENTINEL - SINGLE ENTRY POINT ===" -ForegroundColor Magenta
Write-Host "This holds the sentinel across the measurement. After the paste that started it,"
Write-Host "the ONLY input needed from you is the Enter key. Do not copy anything - not a"
Write-Host "command, not a nonce, not a path. A copy is what destroys the sentinel."
Write-Host ""

$s = Invoke-Seed -N $Nonce
if (-not $s.ok) {
  Write-Host ""
  Write-Host "FAILED before the measurement window opened. Nothing to clean up." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "──────────────────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host " NOW, IN SESSION 5, AS AromaOperator - TYPE THIS. DO NOT COPY IT." -ForegroundColor Cyan
Write-Host ""
Write-Host ("     " + $OperatorCommand) -ForegroundColor White
Write-Host ""
Write-Host " It is short on purpose: it has to be typeable, because reading it off this"
Write-Host " screen and pasting it would overwrite the sentinel and waste the round."
Write-Host ""
Write-Host " The nonce is held in this process. You will not be asked for it."
Write-Host " Come back here and press ENTER when the top-up has finished."
Write-Host "──────────────────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host ""
Write-Host "  watching the sentinel while you are away..." -ForegroundColor DarkGray

$held = Wait-ForOwner -Digest $s.digest

Write-Host ""
if ($held) { Write-Host "  sentinel held for the whole window." -ForegroundColor Green }
else { Write-Host "  sentinel was lost during the window - recording that, honestly." -ForegroundColor Red }

$v = Invoke-Verify -N $s.nonce
if (-not $v) { exit 1 }

Write-Host ""
[void](Invoke-Clear -N $s.nonce -Verified)

Write-Host ""
$verdict = [string]$v.resolvedE4.verdict
$protocol = [string]$v.resolvedE4.protocol
$retry = [bool]$v.resolvedE4.retryUseful

Write-Host ("E4 = " + $verdict + "   (protocol " + $protocol + ")") -ForegroundColor $(
  switch ($verdict) { 'BOUNDED' { 'Green' } 'CONTAINMENT-FAILURE' { 'Red' } default { 'Yellow' } })

# THE DISTINCTION THAT WAS MISSING: "the protocol failed, try again" and "the protocol
# succeeded and the answer is INVALID" are different outcomes. Telling the Owner to retry a
# structurally-INVALID assertion is an instruction to loop forever.
if ($verdict -eq 'CONTAINMENT-FAILURE') {
  Write-Host "THE BOUNDARY FAILED. This is not a retry - stop and report it." -ForegroundColor Red
  exit 5
}
if ($retry) {
  Write-Host "The PROTOCOL did not complete. Re-running this one command can change the answer:" -ForegroundColor Yellow
  Write-Host ("  " + [string]$v.resolvedE4.why) -ForegroundColor Yellow
  exit 4
}
Write-Host "THE PROTOCOL SUCCEEDED. This verdict is the measured answer." -ForegroundColor Green
if ($verdict -ne 'BOUNDED') {
  Write-Host "It is not BOUNDED, and re-running will not make it so - the reason is structural," -ForegroundColor Cyan
  Write-Host "not operational. E4 has no mechanism to name while E2 is retired, so a not-found" -ForegroundColor Cyan
  Write-Host "cannot be scored as containment. Record it and move on." -ForegroundColor Cyan
}
exit 0
