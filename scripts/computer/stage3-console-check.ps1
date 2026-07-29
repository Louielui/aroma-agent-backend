# stage3-console-check.ps1 - STEP 0. Who and where am I, and is session 5 still there.
#
# A script rather than a one-liner. The one-liner this replaces embedded a C# member
# definition inside a -Command string and the quote escaping did not survive; it failed at
# runtime with a compiler error while still printing a plausible-looking whoami, which is
# the worst kind of broken. Found by running it.
#
# Everything measured in session 3 so far was measured over RDP. At the console the session
# may reconnect with the same id or be new, and the display may not be the same size.
# Neither has been measured, so neither is assumed.

# It also WRITES THE AUTHORITATIVE session-3 baseline. There is exactly one, it is the one
# taken at the console, and it records connectionType so a reading taken over RDP can never
# be silently compared against one taken at the console.
param(
  [string]$CompareTo = '',
  [string]$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence',
  [switch]$NoWrite
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

Add-Type -Namespace Q -Name G -MemberDefinition @"
[DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr h, int i);
[DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr w);
[DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr w, IntPtr h);
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
"@ -ErrorAction SilentlyContinue

$dpiMode = 'none'
try { if ([Q.G]::SetProcessDpiAwarenessContext([IntPtr](-4))) { $dpiMode = 'per-monitor-v2' } } catch { }
if ($dpiMode -eq 'none') { try { if ([Q.G]::SetProcessDPIAware()) { $dpiMode = 'system' } } catch { } }

$h = [Q.G]::GetDC([IntPtr]::Zero)
$dpiX = [Q.G]::GetDeviceCaps($h, 88)
$logW = [Q.G]::GetDeviceCaps($h, 8);   $logH = [Q.G]::GetDeviceCaps($h, 10)
$phyW = [Q.G]::GetDeviceCaps($h, 118); $phyH = [Q.G]::GetDeviceCaps($h, 117)
[void][Q.G]::ReleaseDC([IntPtr]::Zero, $h)

$mySession = (Get-Process -Id $PID).SessionId
$sessions = @()
try { $sessions = @(quser 2>$null) } catch { }
$mine = $sessions | Where-Object { $_ -match ('\s' + [regex]::Escape([string]$mySession) + '\s') } | Select-Object -First 1
$connection = 'unknown'
if ($mine -match '\bconsole\b') { $connection = 'console' }
elseif ($mine -match 'rdp-tcp') { $connection = 'rdp' }
elseif ($mine) { $connection = 'disconnected-or-other' }
$operatorPresent = [bool]($sessions | Select-String -Pattern 'aromaoperator' -Quiet)

Write-Host "=== STEP 0 - identity and display ===" -ForegroundColor Cyan
Write-Host ("  whoami      : " + (whoami))
Write-Host ("  SessionId   : " + $mySession)
Write-Host ("  connection  : " + $connection) -ForegroundColor $(if ($connection -eq 'console') { 'Green' } else { 'Yellow' })
Write-Host ("  dpi mode    : " + $dpiMode)
Write-Host ("  dpiX        : " + $dpiX)
Write-Host ("  logical     : " + $logW + " x " + $logH)
Write-Host ("  physical    : " + $phyW + " x " + $phyH)
Write-Host ""
Write-Host "=== sessions ===" -ForegroundColor Cyan
$sessions | ForEach-Object { Write-Host ("  " + $_) }
Write-Host ""
Write-Host ("  AromaOperator still signed in : " + $operatorPresent) -ForegroundColor $(if ($operatorPresent) { 'Green' } else { 'Red' })

# ---------------------------------------------------------------------------
# rulings - stated here so nothing has to be decided at the machine
# ---------------------------------------------------------------------------
Write-Host ""
if (-not $operatorPresent) {
  Write-Host "*** STOP ***" -ForegroundColor Red
  Write-Host "Session 5 is gone. The gate task, the escape-hatch verification and the A4b" -ForegroundColor Red
  Write-Host "baseline are all bound to that session id and must be redone. Report before" -ForegroundColor Red
  Write-Host "touching anything else." -ForegroundColor Red
  exit 20
}
if ($connection -ne 'console') {
  Write-Host "NOT AT THE CONSOLE." -ForegroundColor Yellow
  Write-Host "Steps 2-4 (manifest, owner reference, owner sentinel) must be done at the" -ForegroundColor Yellow
  Write-Host "physical console: RDP and console can differ in resolution and DPI, and the" -ForegroundColor Yellow
  Write-Host "sampling arithmetic is stated in physical pixels measured there." -ForegroundColor Yellow
  exit 21
}

if ($CompareTo -and (Test-Path -LiteralPath $CompareTo)) {
  try {
    $ref = Get-Content -LiteralPath $CompareTo -Raw | ConvertFrom-Json
    Write-Host "=== comparison ===" -ForegroundColor Cyan
    Write-Host ("  recorded : dpiX " + $ref.dpiX + "  physical " + $ref.physicalWidth + "x" + $ref.physicalHeight)
    Write-Host ("  now      : dpiX " + $dpiX + "  physical " + $phyW + "x" + $phyH)
    if ($ref.dpiX -ne $dpiX -or $ref.physicalWidth -ne $phyW -or $ref.physicalHeight -ne $phyH) {
      Write-Host ""
      Write-Host "DISPLAY DIFFERS from the recorded measurement." -ForegroundColor Yellow
      Write-Host "This is NOT fatal: the sentinel is sized in PHYSICAL pixels, so the 1250" -ForegroundColor Yellow
      Write-Host "sample figure and the 500/20 thresholds are unaffected - only the" -ForegroundColor Yellow
      Write-Host "whole-screen total changes. Record both numbers and carry on." -ForegroundColor Yellow
    } else {
      Write-Host "  match    : yes" -ForegroundColor Green
    }
  } catch { }
}

# ---------------------------------------------------------------------------
# WRITE THE AUTHORITATIVE BASELINE
#
# Exactly one file, at a fixed name, carrying connectionType. Two baselines existed on disk
# with no declared authority - one from RDP (dpiX 144, 2496x1664) and one from the console
# (dpiX 120, 1920x1080) - and every downstream comparison would have picked whichever it
# happened to find. Comparing DPI numbers alone is not enough: the failure that matters is
# comparing across connection types at all.
# ---------------------------------------------------------------------------
if (-not $NoWrite) {
  $authPath = Join-Path $EvidenceDir 'stage3-authoritative-baseline.json'
  $record = [ordered]@{
    baseline = 'session3-authoritative'
    connectionType = $connection
    sessionId = $mySession
    dpiAwareness = $dpiMode; dpiX = $dpiX
    logicalWidth = $logW; logicalHeight = $logH
    physicalWidth = $phyW; physicalHeight = $phyH
    gridStep = 8
    wholeScreenSamples = ([math]::Floor($phyW / 8) * [math]::Floor($phyH / 8))
    sentinelSamples = 1250
    minOwnSignatureSamples = 500
    minOwnerSignatureSamples = 20
    measuredBy = (whoami)
    at = (Get-Date).ToString('o')
  }
  try {
    if (-not (Test-Path -LiteralPath $EvidenceDir)) { New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null }
    Set-Content -LiteralPath $authPath -Value ($record | ConvertTo-Json -Depth 5) -Encoding UTF8 -ErrorAction Stop
    Write-Host ""
    Write-Host "=== authoritative baseline written ===" -ForegroundColor Green
    Write-Host ("  path               : " + $authPath)
    Write-Host ("  connectionType     : " + $connection)
    Write-Host ("  wholeScreenSamples : " + $record.wholeScreenSamples)
    Write-Host ("  sentinelSamples    : 1250   (unchanged - sized in PHYSICAL px)")
  } catch {
    Write-Host ""
    Write-Host ("COULD NOT WRITE THE AUTHORITATIVE BASELINE: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host "Downstream steps will HALT rather than guess. Fix this before continuing." -ForegroundColor Red
    exit 22
  }
}

Write-Host ""
Write-Host "STEP 0 OK - at the console, session 5 present. Continue to STEP 1." -ForegroundColor Green
