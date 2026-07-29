# check-evidence-signatures.ps1 - does any stored evidence contain OWNER-session colour?
#
# RUN ELEVATED, in session 3. The assistant cannot read the evidence directory.
#
# OUTPUT IS DELIBERATELY NARROW. Per file: the filename, its SHA-256, its dimensions, and
# TWO COUNTS - how many sampled points match each signature. Nothing else. No pixels, no
# crops, no colour histograms, no thumbnails, no UIA text. The whole point of the evidence
# store is that raw content stays on the box, and a checking tool that printed content
# would be the leak it exists to rule out.
#
# A non-zero OWNER count is a CONTAINMENT FAILURE, not a logging defect. It would mean
# owner-session colour reached an operator-session capture.

#Requires -RunAsAdministrator
param(
  [string]$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence',
  [int]$GridStep = 8
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

Add-Type -AssemblyName System.Drawing -ErrorAction Stop

# Kept in step with src/computer/observation.js. These are the CURRENT signatures - the
# earlier pair sat on the Windows console palette and were replaced.
$SIG_OWN   = @{ R = 32;  G = 208; B = 64 }
$SIG_OWNER = @{ R = 208; G = 32;  B = 144 }
$TOL = 12

Write-Host ("running as : " + (whoami) + "  SessionId=" + (Get-Process -Id $PID).SessionId)
Write-Host ("own   signature : RGB(" + $SIG_OWN.R + "," + $SIG_OWN.G + "," + $SIG_OWN.B + ")  tolerance " + $TOL)
Write-Host ("owner signature : RGB(" + $SIG_OWNER.R + "," + $SIG_OWNER.G + "," + $SIG_OWNER.B + ")  tolerance " + $TOL)
Write-Host ""

if (-not (Test-Path -LiteralPath $EvidenceDir)) {
  Write-Host ("evidence directory not found: " + $EvidenceDir) -ForegroundColor Red
  exit 2
}

# Filtered by EXTENSION, not by -Include. -Include is a no-op against a -LiteralPath with
# no wildcard, so the first version silently matched every file in the directory and tried
# to open each one as a bitmap. Found by running it.
$images = @(Get-ChildItem -LiteralPath $EvidenceDir -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -eq '.png' })

Write-Host ("images found : " + $images.Count) -ForegroundColor Cyan
Write-Host ""

$violations = @()
foreach ($img in $images) {
  $own = 0; $owner = 0; $sampled = 0; $w = 0; $h = 0
  try {
    $bmp = New-Object System.Drawing.Bitmap($img.FullName)
    try {
      $w = $bmp.Width; $h = $bmp.Height
      for ($y = 0; $y -lt $h; $y += $GridStep) {
        for ($x = 0; $x -lt $w; $x += $GridStep) {
          $c = $bmp.GetPixel($x, $y); $sampled++
          if ([math]::Abs($c.R - $SIG_OWN.R) -le $TOL -and [math]::Abs($c.G - $SIG_OWN.G) -le $TOL -and [math]::Abs($c.B - $SIG_OWN.B) -le $TOL) { $own++ }
          if ([math]::Abs($c.R - $SIG_OWNER.R) -le $TOL -and [math]::Abs($c.G - $SIG_OWNER.G) -le $TOL -and [math]::Abs($c.B - $SIG_OWNER.B) -le $TOL) { $owner++ }
        }
      }
    } finally { $bmp.Dispose() }
  } catch {
    Write-Host ("  {0,-44} COULD NOT READ: {1}" -f $img.Name, $_.Exception.GetType().Name) -ForegroundColor Yellow
    continue
  }
  $sha = (Get-FileHash -LiteralPath $img.FullName -Algorithm SHA256).Hash.ToLower().Substring(0, 16)
  $colour = if ($owner -gt 0) { 'Red' } else { 'Gray' }
  Write-Host ("  {0,-44} {1}  {2,5}x{3,-5} sampled {4,6}  OWN {5,5}  OWNER {6,5}" -f $img.Name, $sha, $w, $h, $sampled, $own, $owner) -ForegroundColor $colour
  if ($owner -gt 0) { $violations += ($img.Name + ' : ' + $owner + ' owner-signature samples') }
}

Write-Host ""
if ($violations.Count -eq 0) {
  Write-Host "NO OWNER-SIGNATURE CONTENT IN ANY STORED IMAGE." -ForegroundColor Cyan
  Write-Host "Note the scope: this checks for the owner SENTINEL COLOUR. It does not, and" -ForegroundColor Yellow
  Write-Host "cannot, prove the absence of all owner-session content - only that the one" -ForegroundColor Yellow
  Write-Host "marker deliberately made detectable is absent." -ForegroundColor Yellow
} else {
  Write-Host "*** CONTAINMENT FAILURE ***" -ForegroundColor Red
  $violations | ForEach-Object { Write-Host ("  " + $_) -ForegroundColor Red }
  Write-Host "Owner-session colour is present in operator evidence. Stop and report." -ForegroundColor Red
  exit 9
}

# UIA text files: counted, never printed.
$uia = @(Get-ChildItem -LiteralPath $EvidenceDir -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like '*.uia.txt' -or $_.Name -eq 'stage3-uia.json' })
Write-Host ""
Write-Host ("UIA artefacts present : " + $uia.Count + "   (counted only - contents are never printed by this tool)") -ForegroundColor Cyan
$uia | ForEach-Object { Write-Host ("  {0,-44} {1} bytes  age {2:N1} days" -f $_.Name, $_.Length, ((Get-Date) - $_.LastWriteTime).TotalDays) }
