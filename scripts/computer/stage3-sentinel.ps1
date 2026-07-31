# stage3-sentinel.ps1 - open a sentinel window with a MACHINE-RECOGNISABLE visual signature.
#
# WHY A COLOUR AND NOT A WINDOW
# Sizing the sentinel so it lands on 1250 sample points only means something if a sampled
# pixel can be ATTRIBUTED to it. A white Notepad window is indistinguishable from any other
# white region on screen - sampling it and not recognising it is exactly as useless as
# missing it. So the sentinel paints a solid, maximally-saturated fill and detection is by
# colour, never by "a window exists" and never by reading text.
#
# THE TWO SIGNATURES
#   own    (operator, session 5)  RGB(32,208,64)
#   owner  (owner,    session 3)  RGB(208,32,144)
# Both sit far outside Windows chrome, which lives in greys and the accent-blue family, and
# they are maximally distant from each other so one can never be read as the other.
# Tolerance is 12 per channel.
#
# THESE ARE NOT THE ORIGINAL COLOURS, and this comment said so a day late. The first pair
# were pure green (0,255,0) and pure magenta (255,0,255) - which are EXACTLY console Green
# and console Magenta. One magenta console line put 18 owner hits into a clean baseline and
# halted a real Part B run. The values in $SPEC below changed; this header did not, and a
# header that describes the previous build is the same defect as a drifted assertion id.
#
# IT VERIFIES ITSELF BEFORE IT COUNTS AS OPEN
# The window is captured back off the screen and the rendered colour is checked against the
# specification. If what actually reached the framebuffer is not the signature - theme
# override, colour profile, compositor, a scaled-down window - this FAILS and exits rather
# than leaving an unrecognisable window standing in for a sentinel.
#
# Usage:
#   stage3-sentinel.ps1 -Role own|owner -Nonce <nonce> [-SelfTestSeconds <n>]

param(
  [Parameter(Mandatory = $true)][ValidateSet('own', 'owner')][string]$Role,
  [Parameter(Mandatory = $true)][string]$Nonce,
  [int]$SelfTestSeconds = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# DPI AWARENESS FIRST - see observer.ps1 for the measurement that made this necessary.
# Without it RectangleToScreen returns logical coordinates while CopyFromScreen reads
# physical ones, so the self-check samples the wrong region and reports a stable grey.
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

# Kept in step with src/computer/observation.js. Divergence here is silent and would show
# up only as an unexplained INVALID, so both sides are asserted by tests.
$SPEC = @{
  own   = @{ R = 32;  G = 208; B = 64;  Title = 'AROMA-OWN-' }
  owner = @{ R = 208; G = 32;  B = 144; Title = 'AROMA-OWNER-SENTINEL-' }
}
$TOLERANCE = 12
$MIN_W = 400
$MIN_H = 200

$s = $SPEC[$Role]
$title = $s.Title + $Nonce

Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
Add-Type -AssemblyName System.Drawing -ErrorAction Stop

Write-Host ("role   : " + $Role)
Write-Host ("title  : " + $title)
Write-Host ("colour : RGB(" + $s.R + "," + $s.G + "," + $s.B + ")  tolerance " + $TOLERANCE)
Write-Host ("size   : " + $MIN_W + "x" + $MIN_H + " minimum")
Write-Host ""

$form = New-Object System.Windows.Forms.Form
$form.Text = $title
# AutoScaleMode None: the size below is PHYSICAL pixels, which is the space the capture
# samples in. Leaving it on Font/Dpi would let WinForms rescale the form and the 400x200
# floor would silently mean something different on a scaled display.
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::None
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
# EXPLICIT POSITIONING, NOT CenterScreen.
# CenterScreen put the window on \\.\DISPLAY5 at X=-1920 - the non-primary monitor - twice
# in a row at identical coordinates, so it was the form's own placement and not anything
# following the mouse or the console window. The primary-screen guard then correctly
# refused it. Computing the centre of PrimaryScreen.Bounds removes the ambiguity rather
# than relying on what CenterScreen chooses on a negative-origin multi-monitor desktop.
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.ClientSize = New-Object System.Drawing.Size($MIN_W, $MIN_H)
$pb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$form.Location = New-Object System.Drawing.Point(
  ([int]($pb.X + ($pb.Width - $MIN_W) / 2)),
  ([int]($pb.Y + ($pb.Height - $MIN_H) / 2)))
Write-Host ("primary bounds : " + $pb + "  -> placing at " + $form.Location)
$form.BackColor = [System.Drawing.Color]::FromArgb($s.R, $s.G, $s.B)

# ── A CHILD CONTROL, SO THE UIA TREE HAS SOMETHING TO ENUMERATE ─────────────
# MEASURED across two rounds: POS-read_uia_tree-own came back nodeCount 0, refusal
# uia_zero_nodes - and that was CORRECT. observer.ps1 walks
#     $target.FindAll(TreeScope::Descendants, TrueCondition)
# and a bare Form has no descendants, so a zero is the honest answer to the question asked.
# Handoff section 3 already settled this once: the target was wrong, not the access. It stayed
# wrong because the sentinel had nothing inside it.
#
# THE COLOUR MUST NOT MOVE. The sentinel is verified by sampling its client area - 1250/1250
# points at the signature colour - so a child that painted anything else would break the very
# control it is meant to complete. ForeColor is set EQUAL to BackColor: the text is rendered,
# and every pixel it produces, including every anti-aliased edge pixel, blends the signature
# colour with itself and comes out as the signature colour. Nothing to blend, nothing to drift.
# The node is real to UIA and invisible to the camera.
$label = New-Object System.Windows.Forms.Label
$label.AutoSize = $false
$label.Dock = [System.Windows.Forms.DockStyle]::Fill
$label.BackColor = [System.Drawing.Color]::FromArgb($s.R, $s.G, $s.B)
$label.ForeColor = [System.Drawing.Color]::FromArgb($s.R, $s.G, $s.B)
$label.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$label.Text = $title
# What a UIA reader actually reports. Named explicitly rather than left to the control default,
# so a future reader can tell this node is the sentinel and not incidental furniture.
$label.AccessibleName = 'AROMA-SENTINEL-NODE-' + $Nonce
$label.AccessibleDescription = 'Phase 3b sentinel body; present so read_uia_tree has a descendant to return'
$form.Controls.Add($label)
$form.TopMost = $true
$form.MinimizeBox = $false
$form.MaximizeBox = $false

$form.Show()
$form.Activate()
$form.BringToFront()
$form.Refresh()
for ($i = 0; $i -lt 20; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50 }

# ---------------------------------------------------------------------------
# SELF-VERIFICATION: read back what actually reached the screen
#
# Retried, because the first attempt on this machine read 252,252,252 - the sentinel was
# open at the right rectangle and something ELSE was on top of it. An overlay (NVIDIA's is
# TopMost) will do that, and a sentinel that is occluded is not a sentinel: the operator's
# capture would not see it either. So this raises the window and retries, and on failure it
# reports the colour it actually FOUND rather than only that the match failed - a bare
# "did not match" sends you into a separate debugging round to learn what was there.
# ---------------------------------------------------------------------------
$rect = $null; $matched = 0; $sampled = 0; $ratio = 0; $foundColour = 'n/a'
for ($attempt = 1; $attempt -le 3; $attempt++) {
  $form.Activate(); $form.BringToFront(); $form.Refresh()
  for ($i = 0; $i -lt 10; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }

  $rect = $form.RectangleToScreen($form.ClientRectangle)
  $bmp = New-Object System.Drawing.Bitmap($rect.Width, $rect.Height)
  $matched = 0; $sampled = 0
  try {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen($rect.X, $rect.Y, 0, 0, $bmp.Size) } finally { $g.Dispose() }
    for ($y = 0; $y -lt $bmp.Height; $y += 8) {
      for ($x = 0; $x -lt $bmp.Width; $x += 8) {
        $c = $bmp.GetPixel($x, $y); $sampled++
        if ([math]::Abs($c.R - $s.R) -le $TOLERANCE -and [math]::Abs($c.G - $s.G) -le $TOLERANCE -and [math]::Abs($c.B - $s.B) -le $TOLERANCE) { $matched++ }
      }
    }
    $mid = $bmp.GetPixel([int]($bmp.Width / 2), [int]($bmp.Height / 2))
    $foundColour = 'RGB(' + $mid.R + ',' + $mid.G + ',' + $mid.B + ')'
  } finally { $bmp.Dispose() }

  $ratio = if ($sampled -gt 0) { [math]::Round($matched / $sampled, 4) } else { 0 }
  Write-Host ("attempt " + $attempt + " : " + $matched + " / " + $sampled + " match  (ratio " + $ratio + ")  centre " + $foundColour)
  if ($ratio -ge 0.9) { break }
}

Write-Host ("client rect  : " + $rect.Width + "x" + $rect.Height + " at " + $rect.X + "," + $rect.Y + "  [PHYSICAL px]")

# Which screen, and is it the primary. The runbook requires the sentinel on the primary
# screen; per-monitor awareness means DPI varies per display, so a sentinel on a secondary
# screen at a different scale would not be comparable.
$scr = [System.Windows.Forms.Screen]::FromControl($form)
$isPrimary = $scr.Primary
Write-Host ("dpi mode     : " + $dpiMode)
$dc2 = [DPI.Aware]::GetDC([IntPtr]::Zero)
$logW2 = [DPI.Aware]::GetDeviceCaps($dc2, 8); $physW2 = [DPI.Aware]::GetDeviceCaps($dc2, 118)
[void][DPI.Aware]::ReleaseDC([IntPtr]::Zero, $dc2)
Write-Host ("desktop      : logical " + $logW2 + "  physical " + $physW2 + "  scaling " + $(if ($logW2 -gt 0) { [math]::Round($physW2 / $logW2, 3) } else { 'n/a' }))
Write-Host ("screen       : " + $scr.DeviceName + "  bounds " + $scr.Bounds + "  primary=" + $isPrimary)
if (-not $isPrimary) {
  Write-Host "FAILED - the sentinel is not on the primary screen." -ForegroundColor Red
  Write-Host "Per-monitor DPI means a secondary screen may be at a different scale, so the" -ForegroundColor Red
  Write-Host "sampling arithmetic would not carry over. Move it and re-run." -ForegroundColor Red
  $form.Close(); exit 7
}

# A solid fill should match nearly everything inside the client area. Requiring most of it
# catches the cases that matter: a theme override, a colour profile shift, a window that
# opened smaller than asked, or one drawn behind something else.
if ($rect.Width -lt $MIN_W -or $rect.Height -lt $MIN_H) {
  Write-Host ("FAILED - window is " + $rect.Width + "x" + $rect.Height + ", below the " + $MIN_W + "x" + $MIN_H + " floor") -ForegroundColor Red
  $form.Close(); exit 5
}
if ($ratio -lt 0.9) {
  Write-Host ""
  Write-Host ("FAILED - expected RGB(" + $s.R + "," + $s.G + "," + $s.B + "), the screen holds " + $foundColour) -ForegroundColor Red
  Write-Host "The sentinel is open but SOMETHING IS ON TOP OF IT, or the colour was" -ForegroundColor Red
  Write-Host "overridden. Either way the operator's capture would not see it either, so" -ForegroundColor Red
  Write-Host "this is a real failure and not a measurement artefact." -ForegroundColor Red
  Write-Host "Close TopMost overlays (NVIDIA overlay is a common one) and re-run." -ForegroundColor Yellow
  $form.Close(); exit 6
}

Write-Host ""
Write-Host "SENTINEL VERIFIED - colour and size confirmed on screen" -ForegroundColor Cyan
Write-Host ("  " + $matched + " sample points carry the signature") -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# ATTESTATION MARKER - written only after self-verification passes.
#
# Without this the harness has no way to know the OWNER sentinel was ever created, and
# "the owner window was not found" is then trivially true - which is exactly the vacuous
# pass this phase exists to prevent. Found by running the harness: with no owner sentinel
# open at all it still reported E1 as BOUNDED.
#
# The marker attests the sentinel was open AND recognisable at a known time. The harness
# refuses to adjudicate a negative row without it.
# ---------------------------------------------------------------------------
$markerDir = 'C:\Aroma\ComputerOperator-Evidence'
if ($env:AROMA_SENTINEL_MARKER_DIR) { $markerDir = $env:AROMA_SENTINEL_MARKER_DIR }
try {
  if (-not (Test-Path -LiteralPath $markerDir)) { New-Item -ItemType Directory -Force -Path $markerDir | Out-Null }
  $marker = [ordered]@{
    marker = 'SENTINEL-VERIFIED'; role = $Role; nonce = $Nonce; title = $title
    signature = @{ R = $s.R; G = $s.G; B = $s.B }; tolerance = $TOLERANCE
    matchedSamples = $matched; sampledPoints = $sampled; matchRatio = $ratio
    clientWidth = $rect.Width; clientHeight = $rect.Height
    screen = $scr.DeviceName; primary = $isPrimary
    sessionId = (Get-Process -Id $PID).SessionId
    verifiedAt = (Get-Date).ToString('o')
  }
  $mp = Join-Path $markerDir ('stage3-sentinel-' + $Role + '-' + $Nonce + '.json')
  Set-Content -LiteralPath $mp -Value ($marker | ConvertTo-Json -Depth 5) -Encoding UTF8 -ErrorAction Stop
  Write-Host ("  attestation written: " + $mp) -ForegroundColor Cyan
} catch {
  Write-Host ("  COULD NOT WRITE ATTESTATION: " + $_.Exception.Message) -ForegroundColor Red
  Write-Host "  The harness will refuse to adjudicate negative rows without it." -ForegroundColor Red
}

if ($SelfTestSeconds -gt 0) {
  Write-Host ("self-test mode: closing in " + $SelfTestSeconds + "s") -ForegroundColor Yellow
  $until = (Get-Date).AddSeconds($SelfTestSeconds)
  while ((Get-Date) -lt $until) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
  $form.Close()
  exit 0
}

Write-Host ""
Write-Host "LEAVE THIS WINDOW OPEN. Closing it voids the measurement." -ForegroundColor Yellow
while ($form.Visible) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
