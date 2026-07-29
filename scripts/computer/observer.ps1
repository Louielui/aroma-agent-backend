# observer.ps1 - Computer Operator v0, Phase 3b. THE OBSERVER. READ-ONLY.
#
# Single-shot: it performs ONE observation and exits. It is started by a fixed, pre-
# registered scheduled task and never by the Companion, which holds no process-starting
# ability of any kind.
#
# WHAT IT CANNOT DO, STRUCTURALLY
#   no input synthesis   - no mouse, no keys, nothing is sent anywhere
#   no app launch        - it starts no process
#   no network           - it opens no socket
#   no clipboard         - it neither reads nor writes it
#   no file operations   - beyond writing its own evidence and metadata
#
# RAW CONTENT NEVER LEAVES THIS PROCESS AS A RETURN VALUE
# Pixels and UIA text are written to the Companion-local evidence store. What crosses back
# to Node is metadata only: a SHA-256, a byte count, dimensions, counts, and - for the OWN
# session only - window titles. That is Lock 1 as a shape rather than a rule: the process
# that assembles prompts never holds a pixel, so there is no path by which one could reach
# a model even by mistake.
#
# Usage:
#   observer.ps1 -Action list_windows|read_uia_tree|capture_screen -OutJson <path> [-EvidenceDir <path>]

param(
  [Parameter(Mandatory = $true)][ValidateSet('list_windows', 'read_uia_tree', 'capture_screen')][string]$Action,
  [Parameter(Mandatory = $true)][string]$OutJson,
  [string]$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence',
  [string]$TitleFilter = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$started = Get-Date

# ---------------------------------------------------------------------------
# DPI AWARENESS - MUST come before any window or capture call
#
# Without this the process is DPI-unaware: on a 150% display it sees a virtualised
# 1664x1109 desktop while the real framebuffer is 2496x1664, screen coordinates land in the
# wrong place, and captures come back scaled. That was measured, not guessed - a sentinel
# self-check read a stable grey because it was sampling the wrong region entirely.
#
# PER_MONITOR_AWARE_V2 (-4) first; SetProcessDPIAware() is the pre-1703 fallback. Both are
# no-ops if awareness is already set, so this is safe to call unconditionally.
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# identity - emitted with the result so scope travels with it and cannot be
# attached afterwards by whoever writes the report
# ---------------------------------------------------------------------------
Add-Type -Namespace O -Name Native -MemberDefinition @"
[DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
[DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint t);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformationW(IntPtr h,int i,System.Text.StringBuilder p,uint n,out uint l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
"@ -ErrorAction SilentlyContinue

function ObjName { param($h) $sb = New-Object System.Text.StringBuilder 256; $n = 0; if ([O.Native]::GetUserObjectInformationW($h,2,$sb,256,[ref]$n)) { $sb.ToString() } else { $null } }
function SafeWinSta  { try { ObjName ([O.Native]::GetProcessWindowStation()) } catch { $null } }
function SafeDesktop { try { ObjName ([O.Native]::GetThreadDesktop([O.Native]::GetCurrentThreadId())) } catch { $null } }

$idn       = [Security.Principal.WindowsIdentity]::GetCurrent()
$mySession = (Get-Process -Id $PID).SessionId

# Active or Disc matters: a disconnected session is not composited, so a capture taken in
# one is black for reasons that have nothing to do with isolation. Recorded, never inferred.
$sessionState = 'Unknown'
try {
  $line = @(quser 2>$null) | Where-Object { $_ -match ('\s' + [regex]::Escape([string]$mySession) + '\s') } | Select-Object -First 1
  if ($line -match '\bActive\b') { $sessionState = 'Active' } elseif ($line -match '\bDisc\b') { $sessionState = 'Disc' }
} catch { }

$result = [ordered]@{
  ok = $false; action = $Action; refusal = $null
  sessionId = $mySession; windowStation = SafeWinSta; desktop = SafeDesktop; sessionState = $sessionState
  evidenceSha256 = $null; evidenceBytes = $null
  imageWidth = $null; imageHeight = $null; nonBlackRatio = $null
  windowCount = $null; nodeCount = $null; nodeReadFailures = $null; titles = $null
  measuredBy = $idn.Name; measuredSid = $idn.User.Value
  # DPI is recorded per measurement, not once per machine: per-monitor awareness means it
  # varies by screen, so a capture without its DPI cannot be reasoned about afterwards.
  dpiAwareness = $dpiMode; dpiX = $null; scalingFactor = $null
  logicalWidth = $null; logicalHeight = $null
  physicalWidth = $null; physicalHeight = $null
  primaryScreen = $null; sentinelScreen = $null
  at = $started.ToString('o'); elapsedMs = $null
}

# measured once awareness is set, so these are the numbers that actually apply
try {
  $dc = [DPI.Aware]::GetDC([IntPtr]::Zero)
  $result.dpiX = [DPI.Aware]::GetDeviceCaps($dc, 88)          # LOGPIXELSX
  $result.logicalWidth = [DPI.Aware]::GetDeviceCaps($dc, 8)   # HORZRES
  $result.logicalHeight = [DPI.Aware]::GetDeviceCaps($dc, 10) # VERTRES
  $result.physicalWidth = [DPI.Aware]::GetDeviceCaps($dc, 118)  # DESKTOPHORZRES
  $result.physicalHeight = [DPI.Aware]::GetDeviceCaps($dc, 117) # DESKTOPVERTRES
  [void][DPI.Aware]::ReleaseDC([IntPtr]::Zero, $dc)
  if ($result.logicalWidth -gt 0) { $result.scalingFactor = [math]::Round($result.physicalWidth / $result.logicalWidth, 3) }
} catch { }

function Save-Evidence {
  param([byte[]]$Bytes, [string]$Suffix)
  if (-not (Test-Path -LiteralPath $EvidenceDir)) { New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null }
  $name = 'obs-' + $started.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8) + $Suffix
  $full = Join-Path $EvidenceDir $name
  [System.IO.File]::WriteAllBytes($full, $Bytes)
  $sha = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLower()
  @{ path = $full; sha = $sha; bytes = $Bytes.Length }
}

try {
  switch ($Action) {

    # ── list_windows ────────────────────────────────────────────────────────
    # Top-level visible windows with a title, in THIS session only. The session filter is
    # applied here rather than trusted from the caller: a title from another session must
    # never reach the audit, because its presence would be a containment failure and the
    # audit is where that has to be visible.
    'list_windows' {
      $titles = New-Object System.Collections.Generic.List[string]
      $cb = [O.Native+EnumWindowsProc]{
        param($h, $p)
        if ([O.Native]::IsWindowVisible($h)) {
          $len = [O.Native]::GetWindowTextLengthW($h)
          if ($len -gt 0) {
            $procId = [uint32]0
            [void][O.Native]::GetWindowThreadProcessId($h, [ref]$procId)
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($proc -and $proc.SessionId -eq $mySession) {
              $sb = New-Object System.Text.StringBuilder ($len + 1)
              [void][O.Native]::GetWindowTextW($h, $sb, $sb.Capacity)
              $titles.Add($sb.ToString())
            }
          }
        }
        return $true
      }
      [void][O.Native]::EnumWindows($cb, [IntPtr]::Zero)
      $result.windowCount = $titles.Count
      $result.titles = @($titles)
      $result.ok = $true
    }

    # ── capture_screen ──────────────────────────────────────────────────────
    # The virtual screen of THIS session's desktop. Bytes go to the evidence store; only a
    # hash, a size and a non-black ratio come back.
    'capture_screen' {
      Add-Type -AssemblyName System.Drawing -ErrorAction Stop
      Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
      $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
      $bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
      try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try { $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size) } finally { $g.Dispose() }

        # The non-black ratio is the evidence of WHAT WAS ACTUALLY CAPTURED. A black frame
        # is what a disconnected session yields, and "no owner pixels found" in a black
        # frame is trivially true and worth nothing. Sampled on a grid - a full scan of
        # ~2M pixels in PowerShell is slow enough to trip the harness timeout.
        $nonBlack = 0; $sampled = 0; $step = 8
        for ($y = 0; $y -lt $bmp.Height; $y += $step) {
          for ($x = 0; $x -lt $bmp.Width; $x += $step) {
            $c = $bmp.GetPixel($x, $y); $sampled++
            if ($c.R -gt 8 -or $c.G -gt 8 -or $c.B -gt 8) { $nonBlack++ }
          }
        }
        $ms = New-Object System.IO.MemoryStream
        try {
          $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
          $ev = Save-Evidence -Bytes $ms.ToArray() -Suffix '.png'
        } finally { $ms.Dispose() }

        $result.imageWidth = $bmp.Width
        $result.imageHeight = $bmp.Height
        $result.nonBlackRatio = if ($sampled -gt 0) { [math]::Round($nonBlack / $sampled, 6) } else { 0 }
        $result.evidenceSha256 = $ev.sha
        $result.evidenceBytes = $ev.bytes
        $result.ok = $true
      } finally { $bmp.Dispose() }
    }

    # ── read_uia_tree ───────────────────────────────────────────────────────
    # One window's automation tree. Node TEXT is written to the evidence store and never
    # returned - only a count crosses back.
    'read_uia_tree' {
      Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
      Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $PID)
      $target = $null
      if ($TitleFilter) {
        $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($e in $all) { if ($e.Current.Name -eq $TitleFilter) { $target = $e; break } }
      }
      if (-not $target) { $target = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond) }
      if (-not $target) { $result.refusal = 'no_target_window'; break }

      $nodes = $target.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      $lines = New-Object System.Collections.Generic.List[string]
      # COUNTED, NOT SWALLOWED. This catch block used to be empty, and that is how a run
      # produced a 0-byte artefact while reporting ok=true: every per-node property read can
      # fail independently, and discarding those failures leaves a node count that does not
      # describe what was captured. Refuse, do not trim.
      $failures = 0
      foreach ($n in $nodes) {
        try { $lines.Add(($n.Current.ControlType.ProgrammaticName + ' | ' + $n.Current.Name)) } catch { $failures++ }
      }
      $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`r`n"))
      $ev = Save-Evidence -Bytes $bytes -Suffix '.uia.txt'
      $result.nodeCount = $lines.Count
      $result.nodeReadFailures = $failures
      $result.evidenceSha256 = $ev.sha
      $result.evidenceBytes = $ev.bytes
      # A ZERO-NODE READ IS NOT A SUCCESS. The only reason a positive control exists is to
      # show the reader is not blind; one that read nothing shows the opposite. Named
      # refusals, because an unexplained falsy result is exactly what the rules forbid.
      if ($failures -gt 0) { $result.refusal = 'uia_node_read_failures'; $result.ok = $false }
      elseif ($lines.Count -le 0) { $result.refusal = 'uia_zero_nodes'; $result.ok = $false }
      elseif ($ev.bytes -le 0) { $result.refusal = 'uia_empty_evidence'; $result.ok = $false }
      else { $result.ok = $true }
    }
  }
} catch {
  # Never swallowed and never reported as success.
  $result.ok = $false
  $result.refusal = 'observer_error: ' + $_.Exception.GetType().Name + ': ' + $_.Exception.Message
}

$result.elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds
$json = ($result | ConvertTo-Json -Depth 5 -Compress)
Write-Output $json
try { Set-Content -LiteralPath $OutJson -Value $json -Encoding UTF8 -ErrorAction Stop }
catch { Write-Host ('COULD NOT WRITE RESULT: ' + $_.Exception.Message) -ForegroundColor Red; exit 3 }
if (-not $result.ok) { exit 4 }
