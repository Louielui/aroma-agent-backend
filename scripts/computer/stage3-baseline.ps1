# stage3-baseline.ps1 - session 5 preconditions that CANNOT be inherited from session 3.
#
# Two things were verified in louis's session and do not carry over. Both would silently
# invalidate the whole measurement, and both are cheap to check first.
#
# 1. DPI IS PER-USER. Display scaling is a per-user setting and AromaOperator is a fresh
#    profile, so its scaling may differ from louis's. The entire sampling arithmetic -
#    64896 whole-screen samples, 1250 sentinel samples, the 500/20 thresholds - is stated
#    in physical pixels measured in session 3. If session 5 differs, none of it applies.
#
# 2. THE DESKTOP IS NOT NEUTRAL. A fresh profile carries the Windows 11 default wallpaper,
#    which is full of purples and pink-magentas. The negative signature is magenta with a
#    tolerance of 12 and trips on only 20 samples. A wallpaper false positive would raise a
#    CONTAINMENT-FAILURE for something that never happened - worse than a miss, because it
#    stops everything to investigate a fiction.
#
# So this captures a CLEAN DESKTOP - no sentinels open - and counts, in that image, how
# many sampled points match each signature. Both must be zero.
#
# Run in session 5, as AromaOperator, BEFORE opening any sentinel.

param(
  [string]$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence',
  [string]$OutJson = ''
)
if (-not $OutJson) { $OutJson = Join-Path $EvidenceDir 'stage3-baseline.json' }

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
Add-Type -AssemblyName System.Drawing -ErrorAction Stop

$SIG_OWN   = @{ R = 32;  G = 208; B = 64 }
$SIG_OWNER = @{ R = 208; G = 32;  B = 144 }
$TOLERANCE = 12
$GRID = 8

$idn = [Security.Principal.WindowsIdentity]::GetCurrent()
Write-Host ("measuring as : " + $idn.Name + "  SessionId=" + (Get-Process -Id $PID).SessionId)
Write-Host ""

# ---------------------------------------------------------------------------
# 1. DPI
# ---------------------------------------------------------------------------
$dc = [DPI.Aware]::GetDC([IntPtr]::Zero)
$dpiX = [DPI.Aware]::GetDeviceCaps($dc, 88)
$logW = [DPI.Aware]::GetDeviceCaps($dc, 8);   $logH = [DPI.Aware]::GetDeviceCaps($dc, 10)
$phyW = [DPI.Aware]::GetDeviceCaps($dc, 118); $phyH = [DPI.Aware]::GetDeviceCaps($dc, 117)
[void][DPI.Aware]::ReleaseDC([IntPtr]::Zero, $dc)
$scaling = if ($logW -gt 0) { [math]::Round($phyW / $logW, 3) } else { $null }
$primary = [System.Windows.Forms.Screen]::PrimaryScreen

Write-Host "=== DPI (per-user - NOT inherited from session 3) ===" -ForegroundColor Cyan
Write-Host ("  awareness : " + $dpiMode)
Write-Host ("  dpiX      : " + $dpiX)
Write-Host ("  logical   : " + $logW + " x " + $logH)
Write-Host ("  physical  : " + $phyW + " x " + $phyH)
Write-Host ("  scaling   : " + $scaling)
Write-Host ("  primary   : " + $primary.DeviceName + "  " + $primary.Bounds)

# ---------------------------------------------------------------------------
# 2. clean-desktop signature baseline
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== clean-desktop baseline (no sentinels should be open) ===" -ForegroundColor Cyan
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
$ownHits = 0; $ownerHits = 0; $sampled = 0; $nonBlack = 0
try {
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try { $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size) } finally { $g.Dispose() }
  for ($y = 0; $y -lt $bmp.Height; $y += $GRID) {
    for ($x = 0; $x -lt $bmp.Width; $x += $GRID) {
      $c = $bmp.GetPixel($x, $y); $sampled++
      if ($c.R -gt 8 -or $c.G -gt 8 -or $c.B -gt 8) { $nonBlack++ }
      if ([math]::Abs($c.R - $SIG_OWN.R) -le $TOLERANCE -and [math]::Abs($c.G - $SIG_OWN.G) -le $TOLERANCE -and [math]::Abs($c.B - $SIG_OWN.B) -le $TOLERANCE) { $ownHits++ }
      if ([math]::Abs($c.R - $SIG_OWNER.R) -le $TOLERANCE -and [math]::Abs($c.G - $SIG_OWNER.G) -le $TOLERANCE -and [math]::Abs($c.B - $SIG_OWNER.B) -le $TOLERANCE) { $ownerHits++ }
    }
  }
} finally { $bmp.Dispose() }

Write-Host ("  sampled points        : " + $sampled)
Write-Host ("  non-black ratio       : " + [math]::Round($nonBlack / [math]::Max($sampled,1), 6))
Write-Host ("  OWN signature hits    : " + $ownHits)   -ForegroundColor $(if ($ownHits -eq 0) { 'Cyan' } else { 'Red' })
Write-Host ("  OWNER signature hits  : " + $ownerHits) -ForegroundColor $(if ($ownerHits -eq 0) { 'Cyan' } else { 'Red' })

# ---------------------------------------------------------------------------
# 3. verdict
# ---------------------------------------------------------------------------
$problems = @()
if ($ownHits -ne 0)   { $problems += "clean desktop already contains $ownHits OWN-signature points" }
if ($ownerHits -ne 0) { $problems += "clean desktop already contains $ownerHits OWNER-signature points" }

# ---------------------------------------------------------------------------
# THE AUTHORITATIVE BASELINE - exactly one, found by fixed name, never auto-selected
#
# Two session-3 baselines existed on disk with no declared authority. Picking "the newest"
# is the kind of convenience that turns a stale reading into a false pass, so more than one
# candidate is a HALT rather than a choice.
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== authoritative session-3 baseline ===" -ForegroundColor Cyan
$candidates = @()
try { $candidates = @(Get-ChildItem -LiteralPath $EvidenceDir -Filter 'stage3-authoritative-baseline*.json' -ErrorAction Stop) } catch { }
Write-Host ("  candidates found : " + $candidates.Count)
$candidates | ForEach-Object { Write-Host ("    " + $_.Name) }

if ($candidates.Count -gt 1) {
  # Deliberately NOT resolved by picking one.
  $problems += ('MULTIPLE authoritative baselines found (' + $candidates.Count + ') - refusing to choose. Quarantine the superseded ones.')
} elseif ($candidates.Count -eq 0) {
  $problems += 'NO authoritative baseline found - run stage3-console-check.ps1 at the console first'
} else {
  $s3 = $null
  try { $s3 = Get-Content -LiteralPath $candidates[0].FullName -Raw | ConvertFrom-Json } catch { }
  if (-not $s3) {
    $problems += 'the authoritative baseline could not be parsed'
  } else {
    $myConn = 'unknown'
    try {
      $l = @(quser 2>$null) | Where-Object { $_ -match ('\s' + [regex]::Escape([string](Get-Process -Id $PID).SessionId) + '\s') } | Select-Object -First 1
      if ($l -match '\bconsole\b') { $myConn = 'console' } elseif ($l -match 'rdp-tcp') { $myConn = 'rdp' } elseif ($l) { $myConn = 'disconnected-or-other' }
    } catch { }
    Write-Host ("  baseline connectionType : " + $s3.connectionType)
    Write-Host ("  this session            : " + $myConn)
    Write-Host ("  baseline : dpiX " + $s3.dpiX + "  physical " + $s3.physicalWidth + "x" + $s3.physicalHeight)
    Write-Host ("  now      : dpiX " + $dpiX + "  physical " + $phyW + "x" + $phyH)

    # Connection type first. Comparing a console reading against an RDP one is the failure
    # that matters, and it can produce EITHER a false halt or a false pass - the second is
    # worse. Numbers agreeing across connection types would be a coincidence, not a check.
    if ($s3.connectionType -ne $myConn) {
      $problems += ("connectionType differs: baseline = '" + $s3.connectionType + "', this session = '" + $myConn + "'. Numbers are not comparable across connection types.")
    }
    if ($s3.dpiX -ne $dpiX) { $problems += "dpiX differs: baseline = $($s3.dpiX), now = $dpiX" }
    if ($s3.physicalWidth -ne $phyW -or $s3.physicalHeight -ne $phyH) { $problems += 'physical resolution differs from the authoritative baseline' }
  }
}

$record = [ordered]@{
  probe = 'stage3-baseline'
  measuredBy = $idn.Name; measuredSid = $idn.User.Value
  sessionId = (Get-Process -Id $PID).SessionId
  dpiAwareness = $dpiMode; dpiX = $dpiX; scalingFactor = $scaling
  logicalWidth = $logW; logicalHeight = $logH
  physicalWidth = $phyW; physicalHeight = $phyH
  primaryScreen = $primary.DeviceName
  sampledPoints = $sampled; nonBlackRatio = [math]::Round($nonBlack / [math]::Max($sampled,1), 6)
  ownSignatureHits = $ownHits; ownerSignatureHits = $ownerHits
  ok = ($problems.Count -eq 0); problems = $problems
  at = (Get-Date).ToString('o')
}
$json = ($record | ConvertTo-Json -Depth 5)
try { Set-Content -LiteralPath $OutJson -Value $json -Encoding UTF8 -ErrorAction Stop; Write-Host ""; Write-Host ("WROTE: " + $OutJson) -ForegroundColor Cyan }
catch { Write-Host ""; Write-Host ("COULD NOT WRITE: " + $_.Exception.Message) -ForegroundColor Red; Write-Output $json }

Write-Host ""
if ($problems.Count -eq 0) {
  Write-Host "BASELINE OK - both signatures are absent from a clean desktop, DPI consistent." -ForegroundColor Cyan
} else {
  Write-Host "BASELINE FAILED - do NOT open sentinels or run the harness:" -ForegroundColor Red
  $problems | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Red }
  Write-Host ""
  Write-Host "If a signature colour is present, set this account's desktop background to a" -ForegroundColor Yellow
  Write-Host "solid neutral (black or mid grey), remove the wallpaper, and re-run this." -ForegroundColor Yellow
  Write-Host "Do NOT loosen the tolerance or raise the threshold to make it pass - that" -ForegroundColor Yellow
  Write-Host "would trade a false alarm for a real miss." -ForegroundColor Yellow
  exit 8
}
