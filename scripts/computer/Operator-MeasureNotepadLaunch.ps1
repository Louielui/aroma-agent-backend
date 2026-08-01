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

Say ""
Say "  MEASURE NOTEPAD LAUNCH" 'Cyan'
Say ""
Say ("  Running as : " + [Security.Principal.WindowsIdentity]::GetCurrent().Name)
Say ""

$pre = Get-NotepadProcs
$preWins = Get-NotepadWins
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
$stubPid = $proc.Id
Say ("  Start-Process returned pid : " + $stubPid)
Say ""

# Watch for up to 8 seconds, sampling as it goes.
$deadline = (Get-Date).AddSeconds(8)
$firstSeen = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 250
  $wins = Get-NotepadWins
  if ($wins.Count -ge 1 -and $null -eq $firstSeen) {
    $firstSeen = (Get-Date)
    break
  }
}

$procs = Get-NotepadProcs
$wins = Get-NotepadWins

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
try { $null = Get-Process -Id $stubPid -ErrorAction Stop; $stubAlive = $true } catch { $stubAlive = $false }

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
$left = Get-NotepadProcs
if ($left.Count -eq 0) { Say "  Closed. Nothing left open." 'Green' }
else { Say ("  " + $left.Count + " Notepad process(es) STILL OPEN -- please close them by hand.") 'Yellow' }

Say ""
Say "  Show this output to the Owner before the next canary." 'White'
Say ""
$null = Read-Host "  Press Enter to close"
exit 0
