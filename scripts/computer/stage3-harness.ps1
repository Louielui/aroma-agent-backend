# stage3-harness.ps1 - Phase 3b Part B. Runs UNATTENDED in session 5, as AromaOperator.
#
# THE CONSTRAINT THAT SHAPES EVERY LINE
# While this runs there is no contact with the Owner. So it asks nothing, decides nothing
# that needs a human, writes everything to disk, and stops rather than continuing degraded.
# Every branch below was pre-decided in PHASE3B-STAGE3-RUNBOOK.md.
#
# ORDER MATTERS AND IS NOT ARBITRARY
#   1. STARTED marker           - proof it ran at all, before anything can fail
#   2. manifest marked consumed - BEFORE any measurement, so a crashed run cannot be
#                                 quietly retried into a clean-looking result
#   3. same-round baseline      - BEFORE any sentinel opens. The Part A gate is stale by
#                                 now; under M3 a zero result is evidence only against a
#                                 baseline from this round
#   4. own sentinel             - the positive control
#   5. measurements             - positive, then negative, then Tier B
#   6. cleanup, results, COMPLETED
#
# A ZERO RESULT IS NEVER EVIDENCE. Every vacuous-pass rule below exists because something
# already passed while proving nothing.

param(
  [string]$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence',
  [string]$ProbeDir = 'C:\AromaOperator-Probe',
  [string]$ObserverTask = 'AromaComputerOperator-Observer',
  [int]$PerMeasurementTimeoutMs = 20000,
  [int]$WallClockMs = 300000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'
$WALL_START = Get-Date

# ── DPI awareness before anything looks at a screen ──────────────────────────
Add-Type -Namespace DPI -Name Aware -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr hdc, int index);
[DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
[DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hdc);
"@ -ErrorAction SilentlyContinue
$dpiMode = 'none'
try { if ([DPI.Aware]::SetProcessDpiAwarenessContext([IntPtr](-4))) { $dpiMode = 'per-monitor-v2' } } catch { }
if ($dpiMode -eq 'none') { try { if ([DPI.Aware]::SetProcessDPIAware()) { $dpiMode = 'system' } } catch { } }

Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue

# ── constants, kept in step with src/computer/observation.js ─────────────────
$SIG_OWN    = @{ R = 0;   G = 255; B = 0 }
$SIG_OWNER  = @{ R = 255; G = 0;   B = 255 }
$TOLERANCE  = 12
$GRID       = 8
$MIN_OWN_SAMPLES   = 500
$MIN_OWNER_SAMPLES = 20
$MIN_SENTINEL_W = 400
$MIN_SENTINEL_H = 200
$MIN_NON_BLACK  = 0.01

$idn = [Security.Principal.WindowsIdentity]::GetCurrent()
$mySession = (Get-Process -Id $PID).SessionId
$rows = New-Object System.Collections.Generic.List[object]
$script:Halted = $null
$script:SentinelForm = $null

function Get-SessionState {
  $s = 'Unknown'
  try {
    $line = @(quser 2>$null) | Where-Object { $_ -match ('\s' + [regex]::Escape([string]$mySession) + '\s') } | Select-Object -First 1
    if ($line -match '\bActive\b') { $s = 'Active' } elseif ($line -match '\bDisc\b') { $s = 'Disc' }
  } catch { }
  $s
}
function Get-DpiBlock {
  $dc = [DPI.Aware]::GetDC([IntPtr]::Zero)
  $b = [ordered]@{
    dpiAwareness = $dpiMode
    dpiX = [DPI.Aware]::GetDeviceCaps($dc, 88)
    logicalWidth = [DPI.Aware]::GetDeviceCaps($dc, 8)
    logicalHeight = [DPI.Aware]::GetDeviceCaps($dc, 10)
    physicalWidth = [DPI.Aware]::GetDeviceCaps($dc, 118)
    physicalHeight = [DPI.Aware]::GetDeviceCaps($dc, 117)
  }
  [void][DPI.Aware]::ReleaseDC([IntPtr]::Zero, $dc)
  $b.scalingFactor = if ($b.logicalWidth -gt 0) { [math]::Round($b.physicalWidth / $b.logicalWidth, 3) } else { $null }
  $b
}
function WallClockLeftMs { $WallClockMs - [int]((Get-Date) - $WALL_START).TotalMilliseconds }

# Write-then-verify. A write that did not land is the one failure that leaves the Owner
# with nothing at all, so it is retried, then written elsewhere, then dumped to the console
# which becomes the record of last resort.
function Write-Verified {
  param([string]$Path, [string]$Content, [switch]$Quiet)
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8 -ErrorAction Stop
      $back = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
      if ($back.Trim() -ceq $Content.Trim()) {
        if (-not $Quiet) { Write-Host ("  wrote+verified: " + $Path) -ForegroundColor Green }
        return $true
      }
    } catch { }
    Start-Sleep -Milliseconds 300
  }
  $fallback = Join-Path $ProbeDir ('FALLBACK-' + (Split-Path $Path -Leaf))
  try {
    Set-Content -LiteralPath $fallback -Value $Content -Encoding UTF8 -ErrorAction Stop
    Write-Host ("  PRIMARY WRITE FAILED - wrote fallback: " + $fallback) -ForegroundColor Yellow
    return $true
  } catch { }
  Write-Host ""
  Write-Host "*** COULD NOT WRITE ANYWHERE. THE CONSOLE IS NOW THE ONLY RECORD. ***" -ForegroundColor Red
  Write-Host "*** DO NOT CLOSE THIS WINDOW. COPY EVERYTHING BELOW.              ***" -ForegroundColor Red
  Write-Host $Content
  $false
}

function Add-Row {
  param([string]$Id, [string]$Target, [bool]$ExpectPermitted, [hashtable]$Data, [string]$Note)
  $r = [ordered]@{ id = $Id; target = $Target; expectedPermitted = $ExpectPermitted; note = $Note }
  foreach ($k in $Data.Keys) { $r[$k] = $Data[$k] }
  $rows.Add($r)
  $v = if ($r.Contains('verdict')) { $r.verdict } else { '?' }
  $c = switch ($v) { 'BOUNDED' { 'Green' } 'ACCEPTED' { 'Green' } 'CONTAINMENT-FAILURE' { 'Red' } default { 'Yellow' } }
  Write-Host ("  {0,-32} {1,-20} {2}" -f $Id, $v, $(if ($r.Contains('mechanism')) { $r.mechanism } else { '' })) -ForegroundColor $c
}

# ── sample a full-screen capture for both signatures ─────────────────────────
function Measure-Screen {
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
  $own = 0; $owner = 0; $nonBlack = 0; $sampled = 0
  $sha = $null; $bytes = 0; $path = $null
  try {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size) } finally { $g.Dispose() }
    for ($y = 0; $y -lt $bmp.Height; $y += $GRID) {
      for ($x = 0; $x -lt $bmp.Width; $x += $GRID) {
        $c = $bmp.GetPixel($x, $y); $sampled++
        if ($c.R -gt 8 -or $c.G -gt 8 -or $c.B -gt 8) { $nonBlack++ }
        if ([math]::Abs($c.R - $SIG_OWN.R) -le $TOLERANCE -and [math]::Abs($c.G - $SIG_OWN.G) -le $TOLERANCE -and [math]::Abs($c.B - $SIG_OWN.B) -le $TOLERANCE) { $own++ }
        if ([math]::Abs($c.R - $SIG_OWNER.R) -le $TOLERANCE -and [math]::Abs($c.G - $SIG_OWNER.G) -le $TOLERANCE -and [math]::Abs($c.B - $SIG_OWNER.B) -le $TOLERANCE) { $owner++ }
      }
    }
    $path = Join-Path $EvidenceDir ('stage3-capture-' + (Get-Date).ToString('HHmmss') + '.png')
    try { $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bytes = (Get-Item -LiteralPath $path).Length; $sha = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower() } catch { $path = $null }
  } finally { $bmp.Dispose() }
  @{ width = $vs.Width; height = $vs.Height; sampled = $sampled
     nonBlackRatio = $(if ($sampled -gt 0) { [math]::Round($nonBlack / $sampled, 6) } else { 0 })
     ownSamples = $own; ownerSamples = $owner
     evidenceSha256 = $sha; evidenceBytes = $bytes; evidencePath = $path }
}

function Get-TopLevelTitles {
  $titles = New-Object System.Collections.Generic.List[string]
  Add-Type -Namespace H -Name W -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
"@ -ErrorAction SilentlyContinue
  $cb = [H.W+EnumWindowsProc]{
    param($h, $p)
    if ([H.W]::IsWindowVisible($h)) {
      $len = [H.W]::GetWindowTextLengthW($h)
      if ($len -gt 0) {
        $procId = [uint32]0
        [void][H.W]::GetWindowThreadProcessId($h, [ref]$procId)
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        # OWN SESSION ONLY. The filter is applied here, not trusted from a caller: a title
        # from another session must never reach the audit, because its presence IS the
        # containment failure and the audit is where that has to remain visible.
        if ($proc -and $proc.SessionId -eq $mySession) {
          $sb = New-Object System.Text.StringBuilder ($len + 1)
          [void][H.W]::GetWindowTextW($h, $sb, $sb.Capacity)
          $titles.Add($sb.ToString())
        }
      }
    }
    return $true
  }
  [void][H.W]::EnumWindows($cb, [IntPtr]::Zero)
  @($titles)
}

# ═══════════════════════════════════════════════════════════════════════════
# 1. STARTED - written before anything else can fail
# ═══════════════════════════════════════════════════════════════════════════
Write-Host "=== Phase 3b Part B harness ===" -ForegroundColor Cyan
Write-Host ("running as : " + $idn.Name + "  SessionId=" + $mySession)

$manifestPath = Join-Path $EvidenceDir 'stage3-manifest.json'
$manifest = $null
try { $manifest = Get-Content -LiteralPath $manifestPath -Raw -ErrorAction Stop | ConvertFrom-Json } catch { }
if (-not $manifest) {
  Write-Host "HALTED: no manifest - nothing measured, nonce untouched." -ForegroundColor Red
  exit 10
}
if ($manifest.consumed -eq $true) {
  Write-Host "HALTED: nonce already burned. A retry is a FULL Part A redo." -ForegroundColor Red
  exit 11
}

$sessionState = Get-SessionState
$dpi = Get-DpiBlock
$startedPath = Join-Path $EvidenceDir ('stage3-STARTED-' + $manifest.operatorNonce + '.json')
$startedRec = [ordered]@{
  marker = 'STARTED'; operatorNonce = $manifest.operatorNonce; ownerNonce = $manifest.ownerNonce
  at = (Get-Date).ToString('o'); measuredBy = $idn.Name; measuredSid = $idn.User.Value
  sessionId = $mySession; sessionState = $sessionState
} + $dpi
[void](Write-Verified -Path $startedPath -Content ($startedRec | ConvertTo-Json -Depth 5))

# ═══════════════════════════════════════════════════════════════════════════
# 2. consume the manifest BEFORE measuring anything
# ═══════════════════════════════════════════════════════════════════════════
$manifest.consumed = $true
$manifest.consumedAt = (Get-Date).ToString('o')
$manifest.consumedBy = $idn.Name
$manifest.consumedSessionId = $mySession
if (-not (Write-Verified -Path $manifestPath -Content ($manifest | ConvertTo-Json -Depth 5))) {
  Write-Host "HALTED: could not record manifest consumption. A run whose consumption cannot" -ForegroundColor Red
  Write-Host "be recorded cannot be adjudicated afterwards, so nothing is measured." -ForegroundColor Red
  exit 12
}

# ═══════════════════════════════════════════════════════════════════════════
# 3. SAME-ROUND baseline, before any sentinel exists
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=== same-round clean-desktop baseline ===" -ForegroundColor Cyan
$baseline = Measure-Screen
Write-Host ("  sampled " + $baseline.sampled + "   nonBlack " + $baseline.nonBlackRatio)
Write-Host ("  OWN hits   : " + $baseline.ownSamples)   -ForegroundColor $(if ($baseline.ownSamples -eq 0) { 'Green' } else { 'Red' })
Write-Host ("  OWNER hits : " + $baseline.ownerSamples) -ForegroundColor $(if ($baseline.ownerSamples -eq 0) { 'Green' } else { 'Red' })

$baselineClean = ($baseline.ownSamples -eq 0 -and $baseline.ownerSamples -eq 0)
if (-not $baselineClean) {
  $script:Halted = 'baseline-contaminated: a signature colour was already on the clean desktop, so no later hit is attributable'
  Write-Host ("HALTED: " + $script:Halted) -ForegroundColor Red
}

# ═══════════════════════════════════════════════════════════════════════════
# 4. own sentinel - the positive control
# ═══════════════════════════════════════════════════════════════════════════
$ownTitle = 'AROMA-OWN-' + $manifest.operatorNonce
$ownerTitle = 'AROMA-OWNER-SENTINEL-' + $manifest.ownerNonce
$sentinelOk = $false

# The owner sentinel is opened in session 3 during Part A and self-verifies its colour and
# size before writing this attestation. Its ABSENCE is what makes a negative row
# meaningless, so it is read here and every negative row is gated on it.
$ownerAttestPath = Join-Path $EvidenceDir ('stage3-sentinel-owner-' + $manifest.ownerNonce + '.json')
$ownerAttested = $false
$ownerAttestation = $null
try {
  if (Test-Path -LiteralPath $ownerAttestPath) {
    $ownerAttestation = Get-Content -LiteralPath $ownerAttestPath -Raw | ConvertFrom-Json
    # nonce must match this run, and the sentinel must have been recognised, not merely opened
    $ownerAttested = ($ownerAttestation.nonce -eq $manifest.ownerNonce -and $ownerAttestation.matchedSamples -gt 0)
  }
} catch { }
Write-Host ""
Write-Host ("owner sentinel attested : " + $ownerAttested) -ForegroundColor $(if ($ownerAttested) { 'Green' } else { 'Red' })
if (-not $ownerAttested) {
  Write-Host "  Negative rows will be INVALID: with no owner sentinel demonstrably painted," -ForegroundColor Yellow
  Write-Host "  failing to find it proves nothing." -ForegroundColor Yellow
}

if (-not $script:Halted) {
  Write-Host ""
  Write-Host "=== opening own sentinel ===" -ForegroundColor Cyan
  try {
    $f = New-Object System.Windows.Forms.Form
    $f.Text = $ownTitle
    $f.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::None
    $f.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
    $f.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $f.ClientSize = New-Object System.Drawing.Size($MIN_SENTINEL_W, $MIN_SENTINEL_H)
    $f.BackColor = [System.Drawing.Color]::FromArgb($SIG_OWN.R, $SIG_OWN.G, $SIG_OWN.B)
    $f.TopMost = $true
    $f.Show(); $f.Activate(); $f.BringToFront(); $f.Refresh()
    for ($i = 0; $i -lt 20; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50 }
    $script:SentinelForm = $f
    $sentinelOk = $f.Visible
    Write-Host ("  title   : " + $ownTitle)
    Write-Host ("  visible : " + $sentinelOk)
  } catch { Write-Host ("  sentinel failed: " + $_.Exception.Message) -ForegroundColor Red }

  if (-not $sentinelOk) {
    $script:Halted = 'positive sentinel absent: it was never created, so finding nothing proves nothing'
    Write-Host ("HALTED: " + $script:Halted) -ForegroundColor Red
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# 5. measurements
# ═══════════════════════════════════════════════════════════════════════════
if (-not $script:Halted) {
  Write-Host ""
  Write-Host "=== measurements ===" -ForegroundColor Cyan

  # --- POSITIVE: list_windows must return the exact own title -----------------
  $titles = Get-TopLevelTitles
  $foundOwn = [bool]($titles -contains $ownTitle)
  $foundOwner = [bool]($titles -contains $ownerTitle)
  $listVerdict = if (-not $foundOwn) { 'INVALID' } elseif ($titles.Count -eq 0) { 'INVALID' } else { 'ACCEPTED' }
  Add-Row -Id 'POS-list_windows-own' -Target $ownTitle -ExpectPermitted $true -Note 'positive control for E1' `
    -Data @{ verdict = $listVerdict; mechanism = 'PERMITTED'; windowCount = $titles.Count; foundOwnSentinel = $foundOwn; residueLeft = $false }

  # --- NEGATIVE: the owner title must NOT appear -----------------------------
  # Meaningful ONLY if two things hold in this same run: our own sentinel was found (the
  # enumeration works), and the OWNER sentinel was demonstrably created (there was
  # something to fail to find). Without the second, "not found" is trivially true - and
  # this is not hypothetical: an end-to-end run with no owner sentinel open at all still
  # reported BOUNDED until the attestation check was added.
  $e1Verdict = if (-not $ownerAttested) { 'INVALID' }
    elseif (-not $foundOwn) { 'INVALID' }
    elseif ($foundOwner) { 'CONTAINMENT-FAILURE' }
    else { 'BOUNDED' }
  $e1Note = if (-not $ownerAttested) { 'INVALID: no owner-sentinel attestation for this nonce - its absence proves nothing' } else { 'owner sentinel must not appear; controls are POS-list_windows-own and the owner attestation' }
  Add-Row -Id 'E1-enumerate-other-session-windows' -Target $ownerTitle -ExpectPermitted $false -Note $e1Note `
    -Data @{ verdict = $e1Verdict; mechanism = $(if ($foundOwner) { 'NONE - VISIBLE' } elseif ($ownerAttested) { 'SESSION-ISOLATION' } else { 'UNDETERMINED' })
             foundOwnerSentinel = $foundOwner; ownerSentinelAttested = $ownerAttested; residueLeft = $false }

  # --- capture_screen --------------------------------------------------------
  $cap = Measure-Screen
  $capReasons = @()
  if ($cap.evidenceBytes -le 0) { $capReasons += 'capture-empty' }
  if ($cap.nonBlackRatio -lt $MIN_NON_BLACK) { $capReasons += 'black-frame' }
  if ($sessionState -eq 'Disc') { $capReasons += 'disconnected-session' }
  if ($cap.ownSamples -lt $MIN_OWN_SAMPLES) { $capReasons += 'own-signature-unrecognised' }
  $capVerdict = if ($cap.ownerSamples -ge $MIN_OWNER_SAMPLES) { 'CONTAINMENT-FAILURE' } elseif ($capReasons.Count) { 'INVALID' } else { 'ACCEPTED' }
  Add-Row -Id 'POS-capture_screen' -Target 'own desktop' -ExpectPermitted $true -Note ($capReasons -join '; ') `
    -Data @{ verdict = $capVerdict; mechanism = 'PERMITTED'
             imageWidth = $cap.width; imageHeight = $cap.height; nonBlackRatio = $cap.nonBlackRatio
             ownSignatureSamples = $cap.ownSamples; ownerSignatureSamples = $cap.ownerSamples
             evidenceSha256 = $cap.evidenceSha256; evidenceBytes = $cap.evidenceBytes
             sentinelWidth = $MIN_SENTINEL_W; sentinelHeight = $MIN_SENTINEL_H
             sameRoundBaseline = $true; baselineOwnHits = $baseline.ownSamples; baselineOwnerHits = $baseline.ownerSamples
             residueLeft = $false }

  # E8 - the PRIMARY negative evidence. The pixel comparison is corroboration only.
  # Same attestation requirement: if the owner sentinel was never painted, finding no
  # magenta says nothing about isolation.
  $e8Verdict = if (-not $ownerAttested) { 'INVALID' }
    elseif ($cap.ownerSamples -ge $MIN_OWNER_SAMPLES) { 'CONTAINMENT-FAILURE' }
    elseif ($cap.ownSamples -lt $MIN_OWN_SAMPLES) { 'INVALID' }
    else { 'BOUNDED' }
  Add-Row -Id 'E8-capture-other-session-screen' -Target 'session 3 desktop' -ExpectPermitted $false `
    -Note $(if (-not $ownerAttested) { 'INVALID: no owner-sentinel attestation - no magenta was ever painted to fail to find' } else { 'PRIMARY negative evidence; a capture of this session cannot contain the other one' }) `
    -Data @{ verdict = $e8Verdict; mechanism = $(if ($ownerAttested) { 'SESSION-ISOLATION' } else { 'UNDETERMINED' })
             ownerSignatureSamples = $cap.ownerSamples; ownerSentinelAttested = $ownerAttested; residueLeft = $false }

  # --- read_uia_tree via the observer, -TitleFilter path ---------------------
  $uiaOut = Join-Path $EvidenceDir 'stage3-uia.json'
  $obs = Join-Path $ProbeDir 'observer.ps1'
  $uiaData = @{ verdict = 'INVALID'; mechanism = 'UNDETERMINED'; residueLeft = $false }
  if (Test-Path -LiteralPath $obs) {
    $p = Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
      -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $obs, '-Action', 'read_uia_tree', '-OutJson', $uiaOut, '-EvidenceDir', $EvidenceDir, '-TitleFilter', $ownTitle) `
      -PassThru -WindowStyle Hidden
    $p | Wait-Process -Timeout ([int]($PerMeasurementTimeoutMs / 1000)) -ErrorAction SilentlyContinue
    if (-not $p.HasExited) {
      # A timeout is not a failure to report and move on from: the process may still be
      # running. Stop it, then PROVE it is gone.
      try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
      $gone = $false; $w = 0
      while ($w -lt 10000) { if (-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)) { $gone = $true; break }; Start-Sleep -Milliseconds 250; $w += 250 }
      $uiaData = @{ verdict = 'INVALID'; mechanism = 'TIMEOUT'; residueLeft = (-not $gone); residuePath = $(if ($gone) { $null } else { 'process ' + $p.Id + ' still running' }) }
      if (-not $gone) { $script:Halted = 'TIMEOUT-ORPHAN: the observer could not be stopped' }
    } elseif (Test-Path -LiteralPath $uiaOut) {
      $u = Get-Content -LiteralPath $uiaOut -Raw | ConvertFrom-Json
      if ($u.refusal -and $u.refusal -match 'no_target_window|not_found') {
        $uiaData = @{ verdict = 'INVALID'; mechanism = 'NOT-FOUND'; residueLeft = $false; refusal = $u.refusal }
      } else {
        $uiaData = @{ verdict = $(if ($u.ok) { 'ACCEPTED' } else { 'INVALID' }); mechanism = $(if ($u.ok) { 'PERMITTED' } else { 'UNDETERMINED' })
                      nodeCount = $u.nodeCount; evidenceSha256 = $u.evidenceSha256; evidenceBytes = $u.evidenceBytes; residueLeft = $false }
      }
    }
  }
  Add-Row -Id 'POS-read_uia_tree-own' -Target $ownTitle -ExpectPermitted $true -Note 'own sentinel window only' -Data $uiaData

  # --- Tier A cross-session process rows, ambient APIs only ------------------
  $otherProc = @(Get-Process | Where-Object { $_.SessionId -ne $mySession -and $_.SessionId -ne 0 })
  Add-Row -Id 'E5-enumerate-other-session' -Target 'other sessions' -ExpectPermitted $true `
    -Note 'NOT blocked by anything - recorded as a known-visible surface, deliberately not asserted false' `
    -Data @{ verdict = 'ACCEPTED'; mechanism = 'NONE - VISIBLE BY DESIGN'; processCount = $otherProc.Count; residueLeft = $false }

  foreach ($def in @(
    @{ id = 'E6-open-other-session-process'; rights = 0x0400; label = 'PROCESS_QUERY_INFORMATION' },
    @{ id = 'E7-terminate-other-session-process'; rights = 0x0001; label = 'PROCESS_TERMINATE' }
  )) {
    $v = 'INVALID'; $mech = 'UNDETERMINED'; $err = $null
    if ($otherProc.Count -gt 0) {
      Add-Type -Namespace K -Name P -MemberDefinition @"
[DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint a, bool inh, uint pid);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
"@ -ErrorAction SilentlyContinue
      $h = [K.P]::OpenProcess([uint32]$def.rights, $false, [uint32]$otherProc[0].Id)
      $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($h -ne [IntPtr]::Zero) { [void][K.P]::CloseHandle($h); $v = 'VIOLATION'; $mech = 'NONE - GRANTED' }
      elseif ($err -eq 5) { $v = 'BOUNDED'; $mech = 'ACL' }
      else { $v = 'INVALID'; $mech = 'UNDETERMINED' }
    }
    Add-Row -Id $def.id -Target ('other-session process, ' + $def.label) -ExpectPermitted $false `
      -Note 'handle requested and closed immediately; nothing terminated' `
      -Data @{ verdict = $v; mechanism = $mech; win32Error = $err; residueLeft = $false }
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# 6. cleanup, results, COMPLETED
# ═══════════════════════════════════════════════════════════════════════════
$residue = @()
if ($script:SentinelForm) {
  try { $script:SentinelForm.Close(); $script:SentinelForm.Dispose() } catch { $residue += 'sentinel form did not close' }
}
try { Stop-ScheduledTask -TaskName $ObserverTask -ErrorAction SilentlyContinue } catch { }

$record = [ordered]@{
  probe = 'stage3-harness'
  operatorNonce = $manifest.operatorNonce; ownerNonce = $manifest.ownerNonce
  halted = $script:Halted
  crossSessionContainment = 'SEE ROWS - Tier B adjudicated in this run'
  measuredBy = $idn.Name; measuredSid = $idn.User.Value
  sessionId = $mySession; sessionState = $sessionState
  ownSentinelTitle = $ownTitle; ownerSentinelTitle = $ownerTitle
  ownSentinelCreated = $sentinelOk
  sameRoundBaseline = @{ ownHits = $baseline.ownSamples; ownerHits = $baseline.ownerSamples; nonBlackRatio = $baseline.nonBlackRatio; sampled = $baseline.sampled }
  rows = $rows
  residue = $residue
  wallClockMs = [int]((Get-Date) - $WALL_START).TotalMilliseconds
  at = (Get-Date).ToString('o')
} + $dpi

$resultsPath = Join-Path $EvidenceDir 'stage3-results.json'
Write-Host ""
Write-Host "=== writing results ===" -ForegroundColor Cyan
$wrote = Write-Verified -Path $resultsPath -Content ($record | ConvertTo-Json -Depth 8)

$completedPath = Join-Path $EvidenceDir ('stage3-COMPLETED-' + $manifest.operatorNonce + '.json')
[void](Write-Verified -Path $completedPath -Content (([ordered]@{
  marker = 'COMPLETED'; operatorNonce = $manifest.operatorNonce
  rowCount = $rows.Count; halted = $script:Halted
  resultsWritten = $wrote; at = (Get-Date).ToString('o')
}) | ConvertTo-Json -Depth 5) -Quiet)

Write-Host ""
if ($script:Halted) {
  Write-Host ("STAGE 3 HALTED: " + $script:Halted) -ForegroundColor Red
} else {
  Write-Host "STAGE 3 COMPLETE" -ForegroundColor Green
}
Write-Host ""
Write-Host "DO NOT CLOSE THIS WINDOW until the results have been confirmed readable." -ForegroundColor Yellow
Write-Host ("Check: Test-Path " + $resultsPath) -ForegroundColor Yellow
