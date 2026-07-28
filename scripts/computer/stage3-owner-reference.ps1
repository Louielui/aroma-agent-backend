# stage3-owner-reference.ps1 - Part A step A4. The Owner-session reference capture.
#
# Taken in session 3 WHILE IT IS STILL ACTIVE. It cannot be taken later: the moment the
# Owner switches to session 5, session 3 stops being composited and any capture of it is
# black. This is the only window in which it exists.
#
# WHAT IT IS FOR, AND WHAT IT IS NOT
# It is the byte-comparison reference for "the operator's capture is not the Owner's
# screen". It is SUPPORTING evidence only. A pixel comparison never on its own constitutes
# isolation - it has two independent ways of being trivially true (the other session was
# not composited, and the sampling grid can miss a small feature). E8 is the primary
# negative evidence. This exists to corroborate, or it is nothing.

param(
  [string]$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence',
  [string]$ManifestPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# DPI awareness FIRST - see observer.ps1. Without it the capture comes back at logical
# size and any later comparison is against the wrong pixels.
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

$idn = [Security.Principal.WindowsIdentity]::GetCurrent()
$mySession = (Get-Process -Id $PID).SessionId
Write-Host ("running as : " + $idn.Name + "  SessionId=" + $mySession)

# The session must be Active. A reference taken from a disconnected session is black, and a
# black reference makes every later comparison meaningless - it would "differ" from
# anything, which is not evidence of anything.
$sessionState = 'Unknown'
try {
  $line = @(quser 2>$null) | Where-Object { $_ -match ('\s' + [regex]::Escape([string]$mySession) + '\s') } | Select-Object -First 1
  if ($line -match '\bActive\b') { $sessionState = 'Active' } elseif ($line -match '\bDisc\b') { $sessionState = 'Disc' }
} catch { }
Write-Host ("session state : " + $sessionState)
if ($sessionState -ne 'Active') {
  Write-Host ""
  Write-Host "REFUSING - this session is not Active, so the capture would be black and the" -ForegroundColor Red
  Write-Host "comparison it exists for would be meaningless. Nothing written." -ForegroundColor Red
  exit 5
}

$ownerNonce = 'noref'
if ($ManifestPath -and (Test-Path -LiteralPath $ManifestPath)) {
  try { $ownerNonce = (Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json).ownerNonce } catch { }
}

$dc = [DPI.Aware]::GetDC([IntPtr]::Zero)
$dpiX = [DPI.Aware]::GetDeviceCaps($dc, 88)
$logW = [DPI.Aware]::GetDeviceCaps($dc, 8);   $logH = [DPI.Aware]::GetDeviceCaps($dc, 10)
$phyW = [DPI.Aware]::GetDeviceCaps($dc, 118); $phyH = [DPI.Aware]::GetDeviceCaps($dc, 117)
[void][DPI.Aware]::ReleaseDC([IntPtr]::Zero, $dc)

$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
$nonBlack = 0; $sampled = 0
$imgPath = Join-Path $EvidenceDir ('stage3-owner-reference-' + $ownerNonce + '.png')
try {
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try { $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size) } finally { $g.Dispose() }
  for ($y = 0; $y -lt $bmp.Height; $y += 8) {
    for ($x = 0; $x -lt $bmp.Width; $x += 8) {
      $c = $bmp.GetPixel($x, $y); $sampled++
      if ($c.R -gt 8 -or $c.G -gt 8 -or $c.B -gt 8) { $nonBlack++ }
    }
  }
  if (-not (Test-Path -LiteralPath $EvidenceDir)) { New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null }
  $bmp.Save($imgPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $bmp.Dispose() }

$ratio = if ($sampled -gt 0) { [math]::Round($nonBlack / $sampled, 6) } else { 0 }
$hash = (Get-FileHash -LiteralPath $imgPath -Algorithm SHA256).Hash.ToLower()
$bytes = (Get-Item -LiteralPath $imgPath).Length

Write-Host ""
Write-Host "=== owner reference ===" -ForegroundColor Cyan
Write-Host ("  path           : " + $imgPath)
Write-Host ("  SHA-256        : " + $hash)
Write-Host ("  bytes          : " + $bytes)
Write-Host ("  image          : " + $vs.Width + "x" + $vs.Height)
Write-Host ("  dpi            : " + $dpiX + "  awareness " + $dpiMode)
Write-Host ("  logical        : " + $logW + "x" + $logH + "   physical " + $phyW + "x" + $phyH)
Write-Host ("  nonBlackRatio  : " + $ratio) -ForegroundColor $(if ($ratio -ge 0.01) { 'Green' } else { 'Red' })

$record = [ordered]@{
  probe = 'stage3-owner-reference'; ownerNonce = $ownerNonce
  imagePath = $imgPath; sha256 = $hash; bytes = $bytes
  imageWidth = $vs.Width; imageHeight = $vs.Height
  dpiAwareness = $dpiMode; dpiX = $dpiX
  logicalWidth = $logW; logicalHeight = $logH
  physicalWidth = $phyW; physicalHeight = $phyH
  sampledPoints = $sampled; nonBlackRatio = $ratio
  sessionId = $mySession; sessionState = $sessionState
  measuredBy = $idn.Name; measuredSid = $idn.User.Value
  at = (Get-Date).ToString('o')
}
$jsonPath = Join-Path $EvidenceDir ('stage3-owner-reference-' + $ownerNonce + '.json')
Set-Content -LiteralPath $jsonPath -Value ($record | ConvertTo-Json -Depth 5) -Encoding UTF8

Write-Host ""
if ($ratio -lt 0.01) {
  Write-Host "FAILED - the reference is black or near-black. It would 'differ' from any" -ForegroundColor Red
  Write-Host "capture, which is not evidence of anything. Do not proceed to A5." -ForegroundColor Red
  exit 6
}
Write-Host ("WROTE: " + $jsonPath) -ForegroundColor Green
Write-Host "Reference captured. Note: this is SUPPORTING evidence only - E8 is primary." -ForegroundColor Yellow
