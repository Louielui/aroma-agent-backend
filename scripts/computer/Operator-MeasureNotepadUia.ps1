# ===========================================================================
#  Operator-MeasureNotepadUia.ps1
#
#  THE SECOND MEASUREMENT. It answers the two hard blockers the first one could
#  not reach, in ONE session, because every measurement costs the Owner an
#  account switch.
#
#  -- WHAT THE FIRST MEASUREMENT LEFT OPEN --------------------------------
#  Operator-MeasureNotepadLaunch.ps1 proved the launch and the binding: the
#  stub pid dies, the window carries its own pid, exactly one window, ~403 ms.
#  It stopped at the window. Two things past that point are HARD blockers, and
#  both would fail AFTER Notepad is already open -- burning an approval:
#
#    (a) uiaControlId. open_app reads $edit.Current.AutomationId, and the Node
#        side refuses any binding whose uiaControlId is empty:
#            if (typeof bind[f] !== 'string' || bind[f].trim() === '')
#                -> bad_binding
#        Nobody has ever seen that value on this machine. If the WinUI document
#        has no AutomationId, the canary refuses every time, after opening.
#
#    (c) The Save As dialog. uiaCanary looks for it as a DESCENDANT of the
#        Notepad window, then falls back to the first element in the whole tree
#        with Notepad's pid. A modal dialog is normally a top-level SIBLING, so
#        the fallback may well return the Notepad window itself, and the
#        filename box would then be searched for inside the wrong window.
#        And Get-SoleWindowForProcess returns 'ambiguous' when one pid owns more
#        than one top-level window -- which is what a dialog makes it do.
#
#  -- WHAT THIS TOOL IS NOT ------------------------------------------------
#  It judges nothing and approves nothing. It reads no receipt, no request and
#  no approval. It writes NOTHING into C:\Aroma\ComputerOperator-Test -- the
#  Save As dialog is opened to be LOOKED AT and is then cancelled. It types a
#  probe string that is deliberately not the canary's sealed text, so nothing
#  it does can be mistaken for a canary run.
#
#  HOW TO RUN IT. In the AromaOperator session, from the STAGED folder:
#      C:\Aroma\ComputerOperator-Companion\scripts\computer\
#  There is no desktop shortcut. Install-OperatorShortcuts.ps1 creates exactly
#  three icons -- identity, machine, companion -- and the measurement tools are
#  not among them, which is how the first one was run too. Right-click the file
#  and choose "Run with PowerShell".
# ===========================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AUTO = [System.Windows.Automation.AutomationElement]
$SCOPE_CHILD = [System.Windows.Automation.TreeScope]::Children
$SCOPE_DESC = [System.Windows.Automation.TreeScope]::Descendants

$EXPECTED_SID = 'S-1-5-21-2042659270-2029498691-2127769412-1009'
$EXPECTED_NAME = 'AromaOperator'

# NOT the canary's sealed text, and the sealed text is deliberately not quoted
# anywhere in this file -- so "the sealed text does not appear here" is a property
# a test can check, rather than a promise a comment makes. A measurement must
# never be mistakable for the run it exists to de-risk.
$PROBE_TEXT = 'UIA probe 12345'

function Say ([string]$T, [string]$C = 'Gray') { if ($C -eq 'Gray') { Write-Host $T } else { Write-Host $T -ForegroundColor $C } }

# Print a value so that ABSENT is never rendered as blank. An empty AutomationId
# is the single most important answer this tool can return, and "" printed at the
# end of a line looks exactly like a value nobody bothered to read.
function Fmt ($v) {
  if ($null -eq $v) { return '<null>' }
  $s = [string] $v
  if ($s -eq '') { return '<empty>' }
  if ($s.Trim() -eq '') { return "<whitespace only, length $($s.Length)>" }
  return "'" + $s + "'"
}

function New-PropCondition ($prop, $value) { New-Object System.Windows.Automation.PropertyCondition($prop, $value) }

# Deliberately the SAME logic as uiaCanary.ps1, copied rather than approximated:
# the point is to measure what the canary will do, not what something like it
# would do.
function Get-NotepadProcs { @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -ieq 'notepad' }) }

function Get-NotepadWindows {
  $out = @()
  $children = $AUTO::RootElement.FindAll($SCOPE_CHILD, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($el in $children) {
    $procId = 0
    try { $procId = [int] $el.Current.ProcessId } catch { continue }
    if ($procId -le 0) { continue }
    $name = $null
    try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { continue }
    if ($name -and $name.ToLowerInvariant() -eq 'notepad') { $out += $el }
  }
  return $out
}

function Get-EditControl {
  param($Window)
  $cond = New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Document)
  $el = $Window.FindFirst($SCOPE_DESC, $cond)
  $kind = 'Document'
  if ($null -eq $el) {
    $cond2 = New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit)
    $el = $Window.FindFirst($SCOPE_DESC, $cond2)
    $kind = 'Edit'
  }
  if ($null -eq $el) { $kind = 'NONE' }
  return @{ element = $el; matchedAs = $kind }
}

# The canary's own sole-window rule, verbatim in behaviour, so section 4 measures
# the real thing rather than a paraphrase of it.
function Get-SoleWindowForProcess {
  param([int] $ProcessId)
  $cond = New-PropCondition $AUTO::ProcessIdProperty $ProcessId
  $hits = $AUTO::RootElement.FindAll($SCOPE_CHILD, $cond)
  if ($hits.Count -eq 0) { return 'NULL (no window)' }
  if ($hits.Count -gt 1) { return "'ambiguous' ($($hits.Count) top-level windows)" }
  return 'the single window'
}

function Get-ByName {
  param($Root, [string] $Name, $ControlType = $null)
  if ($null -eq $ControlType) {
    $cond = New-PropCondition $AUTO::NameProperty $Name
  } else {
    $cond = New-Object System.Windows.Automation.AndCondition(
      (New-PropCondition $AUTO::NameProperty $Name),
      (New-PropCondition $AUTO::ControlTypeProperty $ControlType))
  }
  return $Root.FindFirst($SCOPE_DESC, $cond)
}

function Show-Element {
  param($El, [string]$Label, [string]$Indent = '      ')
  if ($null -eq $El) { Say ($Indent + $Label + ' : <not found>') 'Red'; return }
  $ct = '<unreadable>'
  try { $ct = $El.Current.ControlType.ProgrammaticName } catch { }
  $auto = $null; try { $auto = $El.Current.AutomationId } catch { }
  $nm = $null;   try { $nm = $El.Current.Name } catch { }
  $cls = $null;  try { $cls = $El.Current.ClassName } catch { }
  Say ($Indent + $Label)
  Say ($Indent + '  ControlType  : ' + $ct)
  Say ($Indent + '  AutomationId : ' + (Fmt $auto))
  Say ($Indent + '  Name         : ' + (Fmt $nm))
  Say ($Indent + '  ClassName    : ' + (Fmt $cls))
}

# RuntimeId is what the binding now uses for "is this the same control".
# Whether it SURVIVES a SetValue and a Save As has never been measured, and the
# canary depends on it across three steps, so it is captured at three points.
function Get-RuntimeIdString {
  param($El)
  if ($null -eq $El) { return '<null element>' }
  $rt = ''
  try { $rt = (@($El.GetRuntimeId()) -join '.') } catch { $rt = '' }
  if ($rt -eq '') { return '<empty>' }
  return $rt
}

function Test-ValuePattern {
  param($El)
  if ($null -eq $El) { return @{ supported = $false; readOnly = $null; value = $null; pattern = $null } }
  $vp = $null
  try { $vp = $El.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch { $vp = $null }
  if ($null -eq $vp) { return @{ supported = $false; readOnly = $null; value = $null; pattern = $null } }
  $ro = $null; try { $ro = $vp.Current.IsReadOnly } catch { }
  $val = $null; try { $val = $vp.Current.Value } catch { }
  return @{ supported = $true; readOnly = $ro; value = $val; pattern = $vp }
}

function Close-Everything {
  param([int]$NotepadPid)
  Say ''
  Say '  CLEANUP' 'Cyan'
  # CloseMainWindow on a DIRTY document raises a save-confirmation dialog and the
  # process does NOT exit. That is measured below rather than assumed, because the
  # canary's own cleanup does exactly this and would report closed:true with
  # Notepad still on screen. Stop-Process is the guaranteed fallback: it is our own
  # pid, in our own session, and it cannot write a file.
  if ($NotepadPid -gt 0) {
    $p = $null
    try { $p = Get-Process -Id $NotepadPid -ErrorAction Stop } catch { $p = $null }
    if ($null -ne $p) {
      $null = $p.CloseMainWindow()
      Start-Sleep -Milliseconds 1200
      $stillThere = $null
      try { $stillThere = Get-Process -Id $NotepadPid -ErrorAction Stop } catch { $stillThere = $null }
      if ($null -ne $stillThere) {
        Say '    CloseMainWindow did NOT end the process -- a confirmation dialog is up.' 'Yellow'
        Say '    THIS IS A REAL FINDING: the canary cleanup does the same thing and would' 'Yellow'
        Say '    report closed:true while Notepad is still open.' 'Yellow'
        $confirm = Get-SoleWindowForProcess -ProcessId $NotepadPid
        Say ('    Get-SoleWindowForProcess now returns : ' + $confirm)
        Stop-Process -Id $NotepadPid -Force
        Start-Sleep -Milliseconds 800
      } else {
        Say '    CloseMainWindow ended the process cleanly.' 'Green'
      }
    }
  }
  $left = @(Get-NotepadProcs)
  $leftWins = @(Get-NotepadWindows)
  Say ('    Notepad processes left : ' + $left.Count)
  Say ('    Notepad windows left   : ' + $leftWins.Count)
  if ($left.Count -eq 0 -and $leftWins.Count -eq 0) { Say '    Nothing left open.' 'Green' }
  else { Say '    SOMETHING IS STILL OPEN -- please close it by hand.' 'Red' }
}

# ===========================================================================
#  IDENTITY GATE
# ===========================================================================
#  Every property below is a property of the session it is read in. Measured in
#  louis and applied to AromaOperator they are confident and wrong, which is
#  worse than not measuring at all. Compared by SID: an account can be renamed,
#  a SID cannot.
$me = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($me.User.Value -ne $EXPECTED_SID) {
  Say ''
  Say '  WRONG SESSION -- NOTHING WAS MEASURED' 'Red'
  Say ''
  Say ('    running as : ' + $me.Name)
  Say ('    its SID    : ' + $me.User.Value)
  Say ('    expected   : ' + $EXPECTED_NAME + '  (' + $EXPECTED_SID + ')')
  Say ''
  Say ('  Sign in as ' + $EXPECTED_NAME + ' and run it from the desktop shortcut there.') 'White'
  Say ''
  $null = Read-Host '  Press Enter to close'
  exit 1
}

Say ''
Say '  MEASURE NOTEPAD UIA -- controls, ValuePattern, Save As structure' 'Cyan'
Say ''
Say ('  Running as  : ' + $me.Name)
Say ('  Probe text  : ' + (Fmt $PROBE_TEXT) + '   (deliberately NOT the canary sealed text)')
Say '  Writes nothing to ComputerOperator-Test. The Save As dialog is cancelled.'
Say ''

# ===========================================================================
#  0. CLEAN START
# ===========================================================================
$pre = @(Get-NotepadProcs)
$preWins = @(Get-NotepadWindows)
Say ('  BEFORE  processes: ' + $pre.Count + '   windows: ' + $preWins.Count)
if ($pre.Count -ne 0 -or $preWins.Count -ne 0) {
  Say ''
  Say '  Notepad is already open. Close it first -- this measurement needs a clean start.' 'Yellow'
  Say ''
  $null = Read-Host '  Press Enter to close'
  exit 1
}

$exe = Join-Path $env:SystemRoot 'System32\notepad.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  Say ('  notepad.exe not found at ' + $exe) 'Red'
  $null = Read-Host '  Press Enter to close'
  exit 1
}

# ===========================================================================
#  5. THE FULL TIME SERIES  (done first: it must start at the launch)
# ===========================================================================
Say ''
Say '  5. WINDOW COUNT OVER 5 SECONDS' 'Cyan'
Say '     The previous run decided "exactly one" at the FIRST sample that saw >= 1.'
Say '     A second window appearing later would not have been seen. This samples'
Say '     the whole 5 seconds and prints every sample.'
Say ''

$proc = Start-Process -FilePath $exe -PassThru
$stubPid = 0
if ($null -ne $proc) { $stubPid = $proc.Id }
Say ('     launched, Start-Process returned pid : ' + $(if ($stubPid -eq 0) { '(none)' } else { $stubPid }))

$series = @()
$firstSeenMs = -1
$sw = [System.Diagnostics.Stopwatch]::StartNew()
for ($i = 1; $i -le 20; $i++) {
  Start-Sleep -Milliseconds 250
  $ms = [int] $sw.ElapsedMilliseconds
  $w = @(Get-NotepadWindows)
  $p = @(Get-NotepadProcs)
  if ($w.Count -ge 1 -and $firstSeenMs -lt 0) { $firstSeenMs = $ms }
  $series += ('       t=' + ([string]$ms).PadLeft(5) + ' ms   windows=' + $w.Count + '   processes=' + $p.Count)
}
$sw.Stop()
foreach ($line in $series) { Say $line }

$wins = @(Get-NotepadWindows)
$procs = @(Get-NotepadProcs)
Say ''
Say ('     first window seen at : ' + $(if ($firstSeenMs -lt 0) { 'NEVER' } else { [string]$firstSeenMs + ' ms' }))
Say ('     after 5s -- windows  : ' + $wins.Count + '   processes: ' + $procs.Count)
Say ('     count stayed at ONE for the whole 5s : ' + ($wins.Count -eq 1 -and $procs.Count -eq 1))

if ($wins.Count -ne 1) {
  Say ''
  Say ('  Cannot continue: expected exactly one window, found ' + $wins.Count) 'Red'
  Close-Everything -NotepadPid $(if ($procs.Count -ge 1) { $procs[0].Id } else { 0 })
  $null = Read-Host '  Press Enter to close'
  exit 1
}

$win = $wins[0]
$realPid = [int] $win.Current.ProcessId
Say ('     window pid : ' + $realPid + '   handle : ' + $win.Current.NativeWindowHandle)

# ===========================================================================
#  1. THE DOCUMENT / EDIT CONTROL  -- blocker (a)
# ===========================================================================
Say ''
Say '  1. THE EDITABLE CONTROL' 'Cyan'
$editFound = Get-EditControl -Window $win
$edit = $editFound.element
Say ('     Get-EditControl found it : ' + ($null -ne $edit))
Say ('     matched as               : ' + $editFound.matchedAs + '   (Document is tried first, then Edit)')
Show-Element -El $edit -Label 'the control:' -Indent '     '

$vpInfo = Test-ValuePattern -El $edit
Say ('       RuntimeId    : ' + (Get-RuntimeIdString -El $edit))
Say ('       ValuePattern : ' + $vpInfo.supported)
Say ('       IsReadOnly   : ' + $(if ($null -eq $vpInfo.readOnly) { '<n/a>' } else { [string]$vpInfo.readOnly }))
Say ''
$autoId = $null
if ($null -ne $edit) { try { $autoId = $edit.Current.AutomationId } catch { } }
$autoOk = ($null -ne $autoId) -and ([string]$autoId).Trim() -ne ''
Say '     *** THE BLOCKER ***' 'Yellow'
Say ('     uiaControlId would be : ' + (Fmt $autoId))
if ($autoOk) {
  Say '     NON-EMPTY -- the Node side accepts this binding.' 'Green'
} else {
  Say '     EMPTY -- validateRuntimeBinding rejects it as bad_binding, and the' 'Red'
  Say '     canary would refuse AFTER opening Notepad, every single time.' 'Red'
}

# ===========================================================================
#  2. SetValue ROUND TRIP
# ===========================================================================
Say ''
Say '  2. SetValue ROUND TRIP' 'Cyan'
$roundTripOk = $false
if (-not $vpInfo.supported) {
  Say '     ValuePattern not supported -- type_text would refuse (valuepattern_unsupported).' 'Red'
} elseif ($vpInfo.readOnly -eq $true) {
  Say '     the control is read-only -- type_text would refuse (control_read_only).' 'Red'
} else {
  $rtBefore = Get-RuntimeIdString -El $edit
  $vpInfo.pattern.SetValue($PROBE_TEXT)
  Start-Sleep -Milliseconds 250
  $rtAfter = Get-RuntimeIdString -El $edit
  Say ('     RuntimeId before SetValue : ' + $rtBefore)
  Say ('     RuntimeId after  SetValue : ' + $rtAfter)
  Say ('     RuntimeId SURVIVED        : ' + ($rtBefore -eq $rtAfter)) $(if ($rtBefore -eq $rtAfter) { 'Green' } else { 'Red' })
  $readBack = $null
  try { $readBack = [string] $vpInfo.pattern.Current.Value } catch { $readBack = $null }
  Say ('     wrote     : ' + (Fmt $PROBE_TEXT) + '   (' + $PROBE_TEXT.Length + ' chars)')
  Say ('     read back : ' + (Fmt $readBack) + '   (' + $(if ($null -eq $readBack) { '<null>' } else { [string]$readBack.Length }) + ' chars)')
  $roundTripOk = ($readBack -ceq $PROBE_TEXT)
  Say ('     IDENTICAL : ' + $roundTripOk) $(if ($roundTripOk) { 'Green' } else { 'Red' })
  if (-not $roundTripOk -and $null -ne $readBack) {
    # Where exactly they diverge, so a trailing newline is distinguishable from
    # mangled text. type_text refuses on any mismatch, so the reason matters.
    $n = [Math]::Min($readBack.Length, $PROBE_TEXT.Length)
    $firstDiff = -1
    for ($i = 0; $i -lt $n; $i++) { if ($readBack[$i] -cne $PROBE_TEXT[$i]) { $firstDiff = $i; break } }
    if ($firstDiff -lt 0 -and $readBack.Length -ne $PROBE_TEXT.Length) { $firstDiff = $n }
    Say ('     first difference at index : ' + $firstDiff) 'Yellow'
    Say ('     length difference         : ' + ($readBack.Length - $PROBE_TEXT.Length)) 'Yellow'
  }
}

# ===========================================================================
#  3. THE SAVE AS DIALOG  -- blocker (c)
# ===========================================================================
Say ''
Say '  3. THE SAVE AS DIALOG' 'Cyan'
$dlg = $null
$menuOpened = $false

$fileMenu = Get-ByName -Root $win -Name 'File'
Say ('     menu item named "File" found : ' + ($null -ne $fileMenu))
if ($null -ne $fileMenu) {
  try {
    $ip = $fileMenu.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $ip.Invoke()
    $menuOpened = $true
  } catch {
    Say '     File does not support InvokePattern -- save_as would refuse (invoke_unsupported).' 'Red'
  }
}

if ($menuOpened) {
  Start-Sleep -Milliseconds 500
  # The ACTUAL text, because uiaCanary tries 'Save as' then 'Save As' and a third
  # spelling would refuse as menu_item_not_found.
  Say '     menu items containing "save" (actual text):'
  $items = $win.FindAll($SCOPE_DESC, (New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::MenuItem)))
  $shown = 0
  foreach ($it in $items) {
    $nm = ''
    try { $nm = [string] $it.Current.Name } catch { }
    if ($nm -and $nm.ToLowerInvariant().Contains('save')) { Say ('       ' + (Fmt $nm)); $shown++ }
  }
  if ($shown -eq 0) { Say '       <none found by MenuItem control type>' 'Yellow' }

  $saveAs = Get-ByName -Root $win -Name 'Save as'
  $usedSpelling = 'Save as'
  if ($null -eq $saveAs) { $saveAs = Get-ByName -Root $win -Name 'Save As'; $usedSpelling = 'Save As' }
  Say ('     uiaCanary would match : ' + $(if ($null -eq $saveAs) { 'NEITHER spelling -- menu_item_not_found' } else { (Fmt $usedSpelling) }))

  if ($null -ne $saveAs) {
    try {
      $ip2 = $saveAs.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $ip2.Invoke()
      Start-Sleep -Milliseconds 1500
    } catch {
      Say '     the Save as item does not support InvokePattern.' 'Red'
    }
  }

  # ---- WHERE IS THE DIALOG, ACTUALLY? ----------------------------------
  Say ''
  Say '     WHERE THE DIALOG LIVES IN THE TREE:'

  $asDescendant = $win.FindFirst($SCOPE_DESC, (New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Window)))
  Say ('       (i)  descendant Window of the Notepad window : ' + ($null -ne $asDescendant) +
       '   <-- uiaCanary tries this FIRST')

  $topLevel = @()
  $rootKids = $AUTO::RootElement.FindAll($SCOPE_CHILD, (New-PropCondition $AUTO::ProcessIdProperty $realPid))
  foreach ($k in $rootKids) { $topLevel += $k }
  Say ('       (ii) top-level windows owned by pid ' + $realPid + ' : ' + $topLevel.Count)
  foreach ($k in $topLevel) {
    $kn = ''; try { $kn = [string] $k.Current.Name } catch { }
    $kh = ''; try { $kh = [string] $k.Current.NativeWindowHandle } catch { }
    Say ('            ' + (Fmt $kn) + '   handle ' + $kh)
  }

  $fallback = $AUTO::RootElement.FindFirst($SCOPE_DESC, (New-PropCondition $AUTO::ProcessIdProperty $realPid))
  $fallbackName = ''
  if ($null -ne $fallback) { try { $fallbackName = [string] $fallback.Current.Name } catch { } }
  Say ('       (iii) uiaCanary FALLBACK returns : ' + (Fmt $fallbackName))
  Say '             (RootElement.FindFirst by pid -- if this is the Notepad window'
  Say '              rather than the dialog, the filename box is searched in the'
  Say '              wrong window and save_as fails as filename_field_not_found)'

  # Pick the real dialog for inspection: a top-level window that is not the one we bound.
  $boundHandle = [string] $win.Current.NativeWindowHandle
  foreach ($k in $topLevel) {
    $kh = ''
    try { $kh = [string] $k.Current.NativeWindowHandle } catch { }
    if ($kh -ne $boundHandle) { $dlg = $k }
  }
  if ($null -eq $dlg -and $null -ne $asDescendant) { $dlg = $asDescendant }

  if ($null -eq $dlg) {
    Say '       NO SEPARATE DIALOG WINDOW FOUND.' 'Red'
  } else {
    $dlgPid = 0; try { $dlgPid = [int] $dlg.Current.ProcessId } catch { }
    Say ''
    Say ('       dialog ProcessId : ' + $dlgPid + '   same as Notepad : ' + ($dlgPid -eq $realPid))
    Show-Element -El $dlg -Label 'the dialog:' -Indent '       '

    $nameBox = Get-ByName -Root $dlg -Name 'File name:' ([System.Windows.Automation.ControlType]::Edit)
    $nameHow = 'by name "File name:"'
    if ($null -eq $nameBox) {
      $nameBox = $dlg.FindFirst($SCOPE_DESC, (New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit)))
      $nameHow = 'FALLBACK: first Edit in the dialog'
    }
    Say ''
    Say ('       filename field found ' + $nameHow)
    Show-Element -El $nameBox -Label 'the filename field:' -Indent '       '
    $nvp = Test-ValuePattern -El $nameBox
    Say ('         ValuePattern : ' + $nvp.supported + '   IsReadOnly : ' +
         $(if ($null -eq $nvp.readOnly) { '<n/a>' } else { [string]$nvp.readOnly }))
    Say '         (NOT set -- this tool never puts a path in this box)'

    # ---- THE UNRESOLVED QUESTION: WHAT IS THE SAVE CONTROL? -----------
    # Name='Save' + ControlType=Button found NOTHING last time. Rather than
    # guess which of the three plausible causes it is, every button-like control
    # in the dialog is listed with its real Name, ControlType and AutomationId.
    # Nothing here is invoked.
    Say ''
    Say '       EVERY BUTTON-LIKE CONTROL IN THE DIALOG:' 'Yellow'
    $btnTypes = @(
      @{ n = 'Button';      t = [System.Windows.Automation.ControlType]::Button },
      @{ n = 'SplitButton'; t = [System.Windows.Automation.ControlType]::SplitButton },
      @{ n = 'MenuItem';    t = [System.Windows.Automation.ControlType]::MenuItem },
      @{ n = 'Hyperlink';   t = [System.Windows.Automation.ControlType]::Hyperlink }
    )
    $btnTotal = 0
    foreach ($bt in $btnTypes) {
      $els = $dlg.FindAll($SCOPE_DESC, (New-PropCondition $AUTO::ControlTypeProperty $bt.t))
      if ($els.Count -eq 0) { continue }
      Say ('         -- ' + $bt.n + ' (' + $els.Count + ') --')
      foreach ($e in $els) {
        $en = ''; try { $en = [string] $e.Current.Name } catch { }
        $ea = ''; try { $ea = [string] $e.Current.AutomationId } catch { }
        $ec = ''; try { $ec = [string] $e.Current.ClassName } catch { }
        Say ('            Name ' + (Fmt $en).PadRight(28) + ' AutomationId ' + (Fmt $ea).PadRight(26) + ' Class ' + (Fmt $ec))
        $btnTotal++
      }
    }
    if ($btnTotal -eq 0) {
      Say '         NONE FOUND IN THIS SUBTREE.' 'Red'
      Say '         That points at the third cause: the dialog element being searched'
      Say '         is not the whole dialog. The top-level list below is then the place'
      Say '         to look.'
    }

    # If the buttons are not under $dlg, they are somewhere else in the tree.
    # Enumerate the WHOLE desktop for button-like controls owned by this pid, so
    # the answer exists either way and no third run is needed.
    Say ''
    Say '       BUTTON-LIKE CONTROLS ANYWHERE IN THIS PROCESS:' 'Yellow'
    $anyBtns = $AUTO::RootElement.FindAll($SCOPE_DESC, (New-Object System.Windows.Automation.AndCondition(
      (New-PropCondition $AUTO::ProcessIdProperty $realPid),
      (New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Button)))))
    Say ('         Buttons with pid ' + $realPid + ' : ' + $anyBtns.Count)
    foreach ($e in $anyBtns) {
      $en = ''; try { $en = [string] $e.Current.Name } catch { }
      $ea = ''; try { $ea = [string] $e.Current.AutomationId } catch { }
      Say ('            Name ' + (Fmt $en).PadRight(28) + ' AutomationId ' + (Fmt $ea))
    }

    $saveBtn = Get-ByName -Root $dlg -Name 'Save' ([System.Windows.Automation.ControlType]::Button)
    Say ''
    Show-Element -El $saveBtn -Label 'what uiaCanary looks for (Name=Save, ControlType=Button):' -Indent '       '
    Say '         (NOT invoked)'

    # And the filename field by the AutomationId the canary now uses, so the
    # change made this round is confirmed by the same run that motivated it.
    $byAutoId = $dlg.FindFirst($SCOPE_DESC, (New-Object System.Windows.Automation.AndCondition(
      (New-PropCondition $AUTO::AutomationIdProperty 'System.ItemNameDisplay'),
      (New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit)))))
    Say ''
    Say ('       filename field by AutomationId System.ItemNameDisplay : ' + ($null -ne $byAutoId)) $(if ($null -ne $byAutoId) { 'Green' } else { 'Red' })
    Say '         (this is what uiaCanary now uses as its ONLY lookup)'

    # ===================================================================
    #  4. Get-SoleWindowForProcess WHILE THE DIALOG IS OPEN
    # ===================================================================
    Say ''
    Say '  4. Get-SoleWindowForProcess WITH THE DIALOG OPEN' 'Cyan'
    $sole = Get-SoleWindowForProcess -ProcessId $realPid
    Say ('     returns : ' + $sole)
    if ($sole -like "*ambiguous*") {
      Say '     CONFIRMED: any Resolve-Binding while the dialog is up refuses as' 'Yellow'
      Say '     window_ambiguous -> stale_binding.' 'Yellow'
    } else {
      Say '     The conflict does NOT occur -- the dialog is not a top-level window' 'Green'
      Say '     of the same process, so re-binding still resolves.' 'Green'
    }

    # ---- CANCEL. NOTHING IS SAVED. ------------------------------------
    Say ''
    Say '     cancelling the dialog (nothing is saved)...' 'DarkGray'
    $cancelBtn = Get-ByName -Root $dlg -Name 'Cancel' ([System.Windows.Automation.ControlType]::Button)
    $cancelled = $false
    if ($null -ne $cancelBtn) {
      try {
        $cp = $cancelBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $cp.Invoke()
        $cancelled = $true
      } catch { }
    }
    if (-not $cancelled) {
      try {
        $wp = $dlg.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
        $wp.Close()
        $cancelled = $true
      } catch { }
    }
    Start-Sleep -Milliseconds 800
    Say ('     dialog cancelled : ' + $cancelled) $(if ($cancelled) { 'Green' } else { 'Red' })
    $afterCancel = Get-SoleWindowForProcess -ProcessId $realPid
    Say ('     Get-SoleWindowForProcess after cancel : ' + $afterCancel)
  }
}

# ===========================================================================
#  CLEANUP
# ===========================================================================
Close-Everything -NotepadPid $realPid

# Nothing was written, and that is checked rather than asserted.
$testDir = 'C:\Aroma\ComputerOperator-Test'
if (Test-Path -LiteralPath $testDir) {
  $inTest = @(Get-ChildItem -LiteralPath $testDir -File -ErrorAction SilentlyContinue)
  Say ('    files in ComputerOperator-Test : ' + $inTest.Count + '   (this tool writes none)')
}

Say ''
Say '  Show this output to the Owner before the next canary.' 'White'
Say ''
$null = Read-Host '  Press Enter to close'
exit 0
