# session-identity.ps1 - Computer Operator v0, Phase 3b. THE SESSION GATE PROBE.
#
# READ-ONLY. It reports who and where a process is, and does nothing else. No window
# enumeration, no UI Automation, no screen capture, no input, no network, no file writes
# other than its own JSON output.
#
# WHY THIS EXISTS BEFORE ANY CAPABILITY
# Owner ruling 3b item 6: an Observer result is only accepted if its user SID, session ID,
# window station and desktop match the Companion's proven session identity. Item 10: if
# the fixed Scheduled Task cannot be proven to run in the SAME AromaOperator interactive
# session as the Companion, stop and fall back to option C - no credentials, no token
# manipulation, no privilege escalation.
#
# So this is the measurement that decides whether 3b can proceed at all. It is run in BOTH
# places - as the Companion, and as the Scheduled Task - and the two outputs are compared.
# Nothing is built on top until they match.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File session-identity.ps1 [outJsonPath]

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$OutPath = if ($args.Count -ge 1) { $args[0] } else { $null }

# Window station and desktop are not exposed by any cmdlet, so they come from user32.
# These four calls are READS: they return the handle this process already has and its
# name. Nothing is created, attached, switched or opened.
$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WinSta {
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetThreadDesktop(uint dwThreadId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool GetUserObjectInformationW(IntPtr hObj, int nIndex, StringBuilder pvInfo, uint nLength, out uint lpnLengthNeeded);
  public static string NameOf(IntPtr h) {
    if (h == IntPtr.Zero) return null;
    uint needed = 0;
    StringBuilder sb = new StringBuilder(256);
    if (GetUserObjectInformationW(h, 2 /* UOI_NAME */, sb, 256, out needed)) return sb.ToString();
    return null;
  }
}
'@
try { Add-Type -TypeDefinition $sig -ErrorAction Stop } catch { }

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$proc = Get-Process -Id $PID

$winsta = $null
$desktop = $null
try { $winsta  = [WinSta]::NameOf([WinSta]::GetProcessWindowStation()) } catch { }
try { $desktop = [WinSta]::NameOf([WinSta]::GetThreadDesktop([WinSta]::GetCurrentThreadId())) } catch { }

# Is this session an actual interactive console/RDP session, or a logon session created
# by CreateProcessWithLogonW (which has no visible desktop)? quser lists only the former.
$interactiveSessions = @()
try { $interactiveSessions = @(quser 2>$null) } catch { }
$userName = $id.Name.Split('\')[-1]
$listedInQuser = [bool](($interactiveSessions | Select-String -Pattern ([regex]::Escape($userName)) -Quiet))

$result = [ordered]@{
  probe            = 'session-identity'
  at               = (Get-Date).ToString('o')
  userName         = $id.Name
  userSid          = $id.User.Value
  sessionId        = $proc.SessionId
  windowStation    = $winsta
  desktop          = $desktop
  # WinSta0\Default is the one and only interactive desktop. Anything else - a
  # Service-0x0-... station - has no visible desktop, so there are no windows to
  # enumerate and nothing to capture.
  isInteractiveStation = ($winsta -eq 'WinSta0')
  listedAsLoggedOn = $listedInQuser
  processId        = $PID
}

$json = ($result | ConvertTo-Json -Compress)
Write-Output $json
if ($OutPath) {
  try { Set-Content -LiteralPath $OutPath -Value $json -Encoding UTF8 } catch { }
}
