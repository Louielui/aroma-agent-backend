# ===========================================================================
#  Operator-MeasureNotepadLaunch.ps1
#
#  THE ONE MEASUREMENT THAT ONLY A REAL LAUNCH CAN GIVE.
#
#  It opens Notepad ONCE, records what happened, closes it, and prints the
#  answer. It runs no canary, reads no approval, needs no request, touches no
#  receipt and writes nothing into ComputerOperator-Test.
#
#  -- WHAT IS ALREADY PROVEN, WITHOUT RUNNING ANYTHING --------------------
#  Microsoft.WindowsNotepad 11.2605.34.0 is installed, and
#  HKLM\...\Image File Execution Options\notepad.exe carries UseFilter=1 with
#  three filter subkeys, each holding AppExecutionAliasRedirect=1 and
#  FilterFullPath pointing at a notepad.exe. The packaged manifest declares
#  Executable = Notepad\Notepad.exe, a 3,298,152-byte binary; the thing we
#  launch is the 360,448-byte stub in System32.
#
#  So the redirect is certain. What is NOT certain from the registry alone:
#
#    . whether Start-Process -PassThru returns the STUB's pid or the app's
#    . whether that pid still exists a second later
#    . how many processes named Notepad one launch produces
#    . how long the window takes to appear
#    . what the window's own UIA ProcessId is
#    . whether one launch makes one WINDOW or a tab in an existing one
#
#  The canary's new binding logic refuses on "not exactly one window", so if a
#  launch produces two the canary will refuse and burn an approval finding that
#  out. This answers it for free, first.
#
#  Run it in the operator session, from the desktop, like the other tools.
# ===========================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AUTO = [System.Windows.Automation.AutomationElement]
$SCOPE_CHILD = [System.Windows.Automation.TreeScope]::Children

function Say ([string]$T, [string]$C = 'Gray') { if ($C -eq 'Gray') { Write-Host $T } else { Write-Host $T -ForegroundColor $C } }

# ---- THE @() GOES AT THE CALL SITE, NOT IN HERE -------------------------
# Both of these already wrapped their result in @(), and it made no difference: PowerShell
# UNROLLS a function's output on the way out, so the array does not survive the return.
#
#   0 results -> $x is $null   -> $x.Count THROWS under StrictMode
#   1 result  -> $x is scalar  -> $x.Count THROWS under StrictMode
#   2+        -> $x is Object[] -> $x.Count works
#
# Only 2+ worked, and for a measurement whose whole job is to tell nothing from one window from
# two, 2+ is the case that would have been wrong anyway. Every caller below therefore writes
# @(Get-NotepadProcs), and that is the only form that is safe for all three cases.
function Get-NotepadProcs { @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -ieq 'notepad' }) }
function Get-NotepadWins {
  $out = @()
  foreach ($el in $AUTO::RootElement.FindAll($SCOPE_CHILD, [System.Windows.Automation.Condition]::TrueCondition)) {
    $procId = 0
    try { $procId = [int] $el.Current.ProcessId } catch { continue }
    if ($procId -le 0) { continue }
    try { $n = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { continue }
    if ($n -ieq 'notepad') { $out += $el }
  }
  return $out
}

# ===========================================================================
#  IDENTITY GATE -- refuse to measure the wrong session
# ===========================================================================
#  The last attempt was run in the louis session by mistake. That is worse than not running at
#  all: every number this tool prints is a property OF THE SESSION IT RUNS IN -- which pid the
#  launcher gets back, how many windows appear, what the window's UIA ProcessId is. Measured in
#  louis and applied to AromaOperator, they are confident and wrong, and the canary would be
#  tuned against a machine that does not exist.
#
#  Compared by SID, not by name: an account can be renamed, a SID cannot.
$EXPECTED_SID  = 'S-1-5-21-2042659270-2029498691-2127769412-1009'
$EXPECTED_NAME = 'AromaOperator'

$me = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($me.User.Value -ne $EXPECTED_SID) {
  Say ""
  Say "  WRONG SESSION -- NOTHING WAS MEASURED" 'Red'
  Say ""
  Say ("    running as : " + $me.Name)
  Say ("    its SID    : " + $me.User.Value)
  Say ("    expected   : " + $EXPECTED_NAME + "  (" + $EXPECTED_SID + ")")
  Say ""
  Say "  Everything this tool measures belongs to the session it runs in: which pid" 'Yellow'
  Say "  Start-Process returns, how many Notepad windows a launch produces, what the" 'Yellow'
  Say "  window's UIA ProcessId is. Numbers from this session would look like answers" 'Yellow'
  Say "  and would describe the wrong machine." 'Yellow'
  Say ""
  Say ("  Sign in as " + $EXPECTED_NAME + " and run it from the desktop shortcut there.") 'White'
  Say ""
  $null = Read-Host "  Press Enter to close"
  exit 1
}

Say ""
Say "  MEASURE NOTEPAD LAUNCH" 'Cyan'
Say ""
Say ("  Running as : " + [Security.Principal.WindowsIdentity]::GetCurrent().Name)
Say ""

$pre = @(Get-NotepadProcs)
$preWins = @(Get-NotepadWins)
Say ("  BEFORE  processes: " + $pre.Count + "   windows: " + $preWins.Count)
if ($pre.Count -ne 0 -or $preWins.Count -ne 0) {
  Say ""
  Say "  Notepad is already open. Close it first -- this measurement needs a clean start." 'Yellow'
  Say ""
  $null = Read-Host "  Press Enter to close"
  exit 1
}

$exe = Join-Path $env:SystemRoot 'System32\notepad.exe'
Say ("  Launching  : " + $exe)
$proc = Start-Process -FilePath $exe -PassThru
# -PassThru returning NOTHING is one of the things being measured, not something to assume away.
# `$proc.Id` on a null would throw here and take the measurement with it -- the same family as
# the .Count failure, in the one place where the null is an actual finding worth printing.
if ($null -eq $proc) {
  Say "  Start-Process -PassThru returned NOTHING." 'Yellow'
  Say "  That is itself an answer: the canary cannot get a pid from the launch." 'Yellow'
  $stubPid = 0
} else {
  $stubPid = $proc.Id
}
Say ("  Start-Process returned pid : " + $(if ($stubPid -eq 0) { '(none)' } else { $stubPid }))
Say ""

# Watch for up to 8 seconds, sampling as it goes.
$deadline = (Get-Date).AddSeconds(8)
$firstSeen = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 250
  $wins = @(Get-NotepadWins)
  if ($wins.Count -ge 1 -and $null -eq $firstSeen) {
    $firstSeen = (Get-Date)
    break
  }
}

$procs = @(Get-NotepadProcs)
$wins = @(Get-NotepadWins)

Say "  AFTER" 'Cyan'
Say ("    Notepad processes : " + $procs.Count)
foreach ($p in $procs) { Say ("      pid " + $p.Id + "  session " + $p.SessionId + "  path " + $(try { $p.Path } catch { '(unreadable)' })) }
Say ("    Notepad windows   : " + $wins.Count)
foreach ($w in $wins) {
  $wp = 0; try { $wp = [int] $w.Current.ProcessId } catch { }
  Say ("      window pid " + $wp + "  handle " + $w.Current.NativeWindowHandle + "  name '" + $w.Current.Name + "'")
}
Say ""

$stubAlive = $false
# -Id 0 is the System Idle Process and always exists, so a launch that returned no pid
# would have reported its own stub as ALIVE. Guarded, because that is the exact shape of a
# measurement that looks like an answer and is not.
if ($stubPid -gt 0) {
  try { $null = Get-Process -Id $stubPid -ErrorAction Stop; $stubAlive = $true } catch { $stubAlive = $false }
}

Say "  THE ANSWERS" 'Cyan'
Say ("    stub pid still alive          : " + $stubAlive)
$windowPid = if ($wins.Count -ge 1) { [int] $wins[0].Current.ProcessId } else { 0 }
Say ("    window's own pid              : " + $windowPid)
Say ("    stub pid IS the window's pid  : " + ($stubPid -eq $windowPid) + $(if ($stubPid -ne $windowPid) { '   <-- redirect confirmed' } else { '' }))
Say ("    exactly ONE window            : " + ($wins.Count -eq 1) + $(if ($wins.Count -ne 1) { '   <-- the canary would refuse here' } else { '' }))
Say ("    exactly ONE process           : " + ($procs.Count -eq 1))
if ($firstSeen) { Say ("    window appeared within        : ~" + [int]((New-TimeSpan -Start $proc.StartTime -End $firstSeen).TotalMilliseconds) + " ms") }
else { Say "    window appeared within        : NEVER within 8s" 'Red' }
Say ""

# Close what we opened, and say honestly whether it worked.
Say "  Closing what this opened..." 'DarkGray'
foreach ($p in $procs) { try { $p.CloseMainWindow() | Out-Null } catch { } }
Start-Sleep -Milliseconds 1200
$left = @(Get-NotepadProcs)
if ($left.Count -eq 0) { Say "  Closed. Nothing left open." 'Green' }
else { Say ("  " + $left.Count + " Notepad process(es) STILL OPEN -- please close them by hand.") 'Yellow' }

Say ""
Say "  Show this output to the Owner before the next canary." 'White'
Say ""
$null = Read-Host "  Press Enter to close"
exit 0
