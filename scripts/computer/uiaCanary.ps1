# uiaCanary.ps1 - the canary's hands. UI Automation only.
#
# ===========================================================================
#  WHAT THIS SCRIPT MAY DO, AND WHAT IT MUST NEVER DO
# ===========================================================================
#  MAY : launch 'notepad'; resolve a control from a binding; set text through
#        ValuePattern; invoke menu items and buttons through InvokePattern;
#        confirm identity; close the process it opened.
#
#  NEVER: touch the clipboard. Call SendKeys, SendInput, keybd_event or any
#        other keystroke synthesis. Type into "whatever has focus". Write a
#        file through PowerShell instead of through the application. Create a
#        directory. Overwrite an existing file. Act on a window it did not
#        open, or in another session.
#
#  There is deliberately NO fallback path. Every lookup that fails returns a
#  refusal. The case where the control cannot be found is precisely the case
#  where acting anyway means acting on something unknown, so "try the other
#  way" is the one thing that must not be added here.
#
# ===========================================================================
#  UNVERIFIED, AND KNOWN TO BE UNVERIFIED
# ===========================================================================
#  This machine runs the newer Windows App Notepad. Its UIA tree, its element
#  names, and whether a launch produces a NEW WINDOW or a NEW TAB in an
#  existing process, are all DIFFERENT from the legacy notepad.exe and have
#  NOT been measured - PREPARE forbade opening it. Every name looked up below
#  is therefore an assumption, and every one of them refuses rather than
#  guesses when it does not match. If EXECUTE shows the tree is different, the
#  fix is to measure it and update these lookups, NOT to loosen them.
#
#  In particular: if the launch matches more than one candidate window, this
#  script REFUSES. It does not pick the first one.
# ===========================================================================

# No command-line payload: the shared transport reads base64 from stdin.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'aromaJsonTransport.ps1')

function Emit-Result {
  param([hashtable] $Result)
  Write-AromaEnvelope $Result
  exit 0
}

function Emit-Refusal {
  param([string] $Reason, [string] $Detail = $null)
  Write-AromaRefusal $Reason $Detail
}

# --- UIA ------------------------------------------------------------------
try {
  Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
  Add-Type -AssemblyName UIAutomationTypes  -ErrorAction Stop
} catch {
  Emit-Refusal 'uia_unavailable' $_.Exception.Message
}

$payload = Read-AromaPayload
if (-not $payload.PSObject.Properties.Match('op').Count) { Emit-Refusal 'bad_payload' 'no op' }
$op = [string] $payload.op

$AUTO = [System.Windows.Automation.AutomationElement]
$COND = [System.Windows.Automation.Condition]
$SCOPE_CHILD = [System.Windows.Automation.TreeScope]::Children
$SCOPE_DESC = [System.Windows.Automation.TreeScope]::Descendants

function New-PropCondition {
  param($Property, $Value)
  New-Object System.Windows.Automation.PropertyCondition($Property, $Value)
}

# Find the ONE window belonging to a process id. More than one is a refusal,
# because choosing between them would mean guessing which one is ours.
function Get-SoleWindowForProcess {
  param([int] $ProcessId)
  $cond = New-PropCondition $AUTO::ProcessIdProperty $ProcessId
  $found = $AUTO::RootElement.FindAll($SCOPE_CHILD, $cond)
  if ($found.Count -eq 0) { return $null }
  if ($found.Count -gt 1) { return 'ambiguous' }
  return $found[0]
}

# Every top-level window belonging to a Notepad process, as a list.
#
# Matched by the OWNING PROCESS NAME, not by window title. A title is text the
# document can change - "Untitled" becomes the filename the moment anything is
# saved, and a title match would then silently stop matching. The process name is
# a property of the program.
#
# 'Notepad' covers the packaged app (Executable = Notepad\Notepad.exe) and the
# classic binary alike; the comparison is case-insensitive.
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

# The editable surface. Notepad's document area is the only control this
# script will ever set text on.
function Get-EditControl {
  param($Window)
  $cond = New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Document)
  $el = $Window.FindFirst($SCOPE_DESC, $cond)
  if ($null -eq $el) {
    $cond2 = New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit)
    $el = $Window.FindFirst($SCOPE_DESC, $cond2)
  }
  return $el
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

function Invoke-Element {
  param($Element, [string] $What)
  try {
    $p = $Element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $p.Invoke()
  } catch {
    Emit-Refusal 'invoke_unsupported' "$What does not support InvokePattern"
  }
}

# Re-resolve a binding and confirm it is still the same thing. Used before
# every acting op, so a stale handle refuses instead of hitting a stranger.
function Resolve-Binding {
  param($Bind)
  # NOT $pid - that is a read-only automatic variable, and assigning to it is a
  # hard error under StrictMode. Same trap as $args; it has cost us a run before.
  $procId = [int] $Bind.processId
  $proc = $null
  try { $proc = Get-Process -Id $procId -ErrorAction Stop } catch { return @{ ok = $false; reason = 'process_gone' } }
  if ($proc.SessionId -ne [int] $Bind.sessionId) { return @{ ok = $false; reason = 'session_changed' } }

  $win = Get-SoleWindowForProcess -ProcessId $procId
  if ($null -eq $win) { return @{ ok = $false; reason = 'window_gone' } }
  if ($win -is [string]) { return @{ ok = $false; reason = 'window_ambiguous' } }

  $handle = [string] $win.Current.NativeWindowHandle
  if ($handle -ne [string] $Bind.windowHandle) { return @{ ok = $false; reason = 'window_changed' } }

  $edit = Get-EditControl -Window $win
  if ($null -eq $edit) { return @{ ok = $false; reason = 'uia_control_missing' } }

  return @{ ok = $true; window = $win; edit = $edit; processId = $procId; sessionId = $proc.SessionId; windowHandle = $handle }
}

# --- ops ------------------------------------------------------------------
# ===========================================================================
#  FIELD VALIDATION, BEFORE ANY PROPERTY IS TOUCHED
#
#  A type_text payload with no `bind` used to reach $payload.bind.processId and
#  die with PropertyNotFoundStrict. That was still fail-closed - the runner saw
#  a non-zero exit and refused, and no desktop action happened - but it is the
#  wrong KIND of safe. A crash says "something went wrong somewhere"; a refusal
#  says which field was missing, and the difference matters at 2am.
#
#  Relying on a crash also makes the safety accidental. It holds only while
#  every path happens to touch a missing property before it touches a desktop,
#  and nothing enforces that ordering. This does.
#
#  VALIDATION ONLY. No action logic is changed here, and nothing is added that
#  could act without a validated order.
# ===========================================================================
$REQUIRED_FIELDS = @{
  'open_app'       = @('appId')
  'type_text'      = @('bind', 'text')
  'save_as'        = @('bind', 'dir', 'fileName')
  'verify_binding' = @('bind')
  'cleanup'        = @('bind')
}
$BIND_FIELDS = @('processId', 'sessionId', 'windowHandle', 'uiaControlId')

if (-not $REQUIRED_FIELDS.ContainsKey($op)) { Emit-Refusal 'unknown_op' $op }

foreach ($f in $REQUIRED_FIELDS[$op]) {
  if (-not $payload.PSObject.Properties.Match($f).Count) { Emit-Refusal 'missing_field' $f }
  if ($null -eq $payload.$f) { Emit-Refusal 'missing_field' $f }
}

# A binding is all four fields or it is not a binding - a partial identity is a
# guess, and a guess is what types into the wrong window.
if ($REQUIRED_FIELDS[$op] -contains 'bind') {
  foreach ($bf in $BIND_FIELDS) {
    if (-not $payload.bind.PSObject.Properties.Match($bf).Count) { Emit-Refusal 'missing_field' ('bind.' + $bf) }
    if ($null -eq $payload.bind.$bf -or '' -eq [string] $payload.bind.$bf) { Emit-Refusal 'missing_field' ('bind.' + $bf) }
  }
}

switch ($op) {

  'open_app' {
    if ([string] $payload.appId -ne 'notepad') { Emit-Refusal 'app_not_allowed' ([string] $payload.appId) }

    # ── ABSOLUTE PATH, NOT A BARE NAME ───────────────────────────────────
    # This was 'notepad', and the reasoning behind that was half right: no path
    # assembled from DATA, because a command line built from a work order is the
    # shape this design refuses. But a bare name is not "no path" - it is a path
    # chosen by PATH, and PATH belongs to whoever started the Companion.
    #
    # The same exposure was measured for real one file over: a bare 'whoami'
    # resolved to Git's Unix whoami and returned nothing. Here the consequence
    # would be worse - a different 'notepad' earlier on PATH would be LAUNCHED,
    # and every check upstream would still pass, because the order, the hashes
    # and the attestation all describe the INTENT to open Notepad and none of
    # them describes WHICH notepad.
    #
    # The path is built from $env:SystemRoot and is not derived from the payload
    # in any way, so nothing a caller sends can influence it.
    $notepadExe = Join-Path $env:SystemRoot 'System32\notepad.exe'
    if (-not (Test-Path -LiteralPath $notepadExe)) {
      # NO FALLBACK to the bare name. If the known-good binary is absent, that is
      # a machine nobody has looked at, and guessing is exactly what this fixes.
      Emit-Refusal 'app_binary_missing' $notepadExe
    }
    # ── THE STUB PID IS NOT THE APP. MEASURED FROM THE REGISTRY. ────────────
    #
    # On this machine Microsoft.WindowsNotepad 11.2605.34.0 is installed, and
    # HKLM\...\Image File Execution Options\notepad.exe carries UseFilter=1 with
    # three filter subkeys, each holding:
    #
    #     AppExecutionAliasRedirect         : 1
    #     AppExecutionAliasRedirectPackages : *
    #     FilterFullPath                    : C:\Windows\System32\notepad.exe
    #
    # So launching System32\notepad.exe is REDIRECTED to the packaged app, whose
    # manifest declares Executable = Notepad\Notepad.exe - a different binary
    # (3,298,152 bytes) from the 360,448-byte stub we start.
    #
    # The first real canary proved the consequence: Notepad opened on screen and
    # FindAll(ProcessIdProperty == $proc.Id) returned nothing, so the run refused
    # with window_not_found while a Notepad window sat there.
    #
    # THE STUB PID THEREFORE CANNOT IDENTIFY THE WINDOW, and this no longer tries.
    #
    # ── HOW "THE ONE WE STARTED" IS ESTABLISHED WITHOUT IT ──────────────────
    # By difference, with refusals at both ends:
    #
    #   1. the Companion preflight has already proved notepadCount() == 0;
    #   2. this re-measures immediately before launching, and REFUSES if it is
    #      not still 0 - a window that appeared in between is not ours;
    #   3. it launches, then waits for the set of Notepad top-level windows to
    #      become EXACTLY ONE;
    #   4. zero at timeout -> window_not_found. More than one -> window_ambiguous.
    #
    # That is not "find any Notepad window". The before-set is proven empty, and
    # any count other than one is a refusal - it never chooses among candidates
    # and never falls back to the focused window. What it binds to is the only
    # Notepad window that came into existence between our own measurement and
    # our own launch.
    $before = @(Get-NotepadWindows)
    if ($before.Count -ne 0) {
      Emit-Refusal 'notepad_already_open' ("$($before.Count) Notepad window(s) existed before launch - refusing to guess which is ours")
    }

    $proc = Start-Process -FilePath $notepadExe -PassThru

    $deadline = (Get-Date).AddMilliseconds(8000)
    $after = @()
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 250
      $after = @(Get-NotepadWindows)
      if ($after.Count -ge 1) { break }
    }

    if ($after.Count -eq 0) {
      Emit-Refusal 'window_not_found' 'no Notepad window appeared within 8s of launching'
    }
    if ($after.Count -gt 1) {
      Emit-Refusal 'window_ambiguous' ("$($after.Count) Notepad windows appeared - refusing to choose between them")
    }

    $win = $after[0]
    # The window's OWN process, read from the window rather than from what we
    # started. Under the redirect these are different, and the window's answer is
    # the one that describes what we are about to type into.
    $realPid = [int] $win.Current.ProcessId
    $realProc = $null
    try { $realProc = Get-Process -Id $realPid -ErrorAction Stop } catch {
      Emit-Refusal 'window_process_gone' "the window's process $realPid could not be read"
    }

    $edit = Get-EditControl -Window $win
    if ($null -eq $edit) { Emit-Refusal 'uia_control_missing' 'no Document or Edit control in the new window' }

    Emit-Result @{
      ok = $true
      processId = $realPid
      sessionId = $realProc.SessionId
      windowHandle = [string] $win.Current.NativeWindowHandle
      uiaControlId = [string] $edit.Current.AutomationId
      # Recorded so the first real run MEASURES the redirect instead of assuming
      # it. If these are equal on some machine, the stub was not redirected there
      # and that is worth knowing rather than silently depending on.
      launchedStubPid = $proc.Id
      stubPidWasTheWindow = ($proc.Id -eq $realPid)
    }
  }

  'verify_binding' {
    $r = Resolve-Binding -Bind $payload.bind
    # Refuse with the REAL reason. Returning a success-shaped answer with
    # sentinel values would let the caller report 'process changed' when what
    # actually happened was 'the control is gone'.
    if (-not $r.ok) { Emit-Refusal $r.reason 'binding no longer resolves' }
    Emit-Result @{ ok = $true; processId = $r.processId; sessionId = $r.sessionId; windowHandle = $r.windowHandle; uiaControlPresent = $true }
  }

  'type_text' {
    $r = Resolve-Binding -Bind $payload.bind
    if (-not $r.ok) { Emit-Refusal 'stale_binding' $r.reason }

    # ValuePattern, on the resolved control. This is the whole prohibition,
    # in one statement: the text goes to THIS element, not to the focus.
    try {
      $vp = $r.edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    } catch {
      Emit-Refusal 'valuepattern_unsupported' 'the control does not support ValuePattern - refusing rather than using keystrokes'
    }
    if ($vp.Current.IsReadOnly) { Emit-Refusal 'control_read_only' 'the control is read-only' }

    $vp.SetValue([string] $payload.text)

    $readBack = [string] $vp.Current.Value
    if ($readBack -ne [string] $payload.text) { Emit-Refusal 'text_not_set' 'read-back did not match what was set' }

    Emit-Result @{ ok = $true; method = 'ValuePattern'; chars = ([string] $payload.text).Length }
  }

  'save_as' {
    $r = Resolve-Binding -Bind $payload.bind
    if (-not $r.ok) { Emit-Refusal 'stale_binding' $r.reason }

    $dir = [string] $payload.dir
    $name = [string] $payload.fileName
    $target = Join-Path $dir $name

    # The directory is NOT created here. Its existence is a precondition set
    # by the Owner in advance, not something this run may arrange for itself.
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { Emit-Refusal 'allowed_dir_missing' $dir }
    if (Test-Path -LiteralPath $target) { Emit-Refusal 'refuse_overwrite' $target }

    # File > Save as, through the menu. No Ctrl+S: a keystroke goes to the
    # focused window, and focus is not ours to guarantee.
    $fileMenu = Get-ByName -Root $r.window -Name 'File'
    if ($null -eq $fileMenu) { Emit-Refusal 'menu_not_found' 'File' }
    Invoke-Element -Element $fileMenu -What 'File menu'
    Start-Sleep -Milliseconds 350

    $saveAs = Get-ByName -Root $r.window -Name 'Save as'
    if ($null -eq $saveAs) { $saveAs = Get-ByName -Root $r.window -Name 'Save As' }
    if ($null -eq $saveAs) { Emit-Refusal 'menu_item_not_found' 'Save as' }
    Invoke-Element -Element $saveAs -What 'Save as item'
    Start-Sleep -Milliseconds 900

    $dlgCond = New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Window)
    $dlg = $r.window.FindFirst($SCOPE_DESC, $dlgCond)
    if ($null -eq $dlg) { $dlg = $AUTO::RootElement.FindFirst($SCOPE_DESC, (New-PropCondition $AUTO::ProcessIdProperty $r.processId)) }
    if ($null -eq $dlg) { Emit-Refusal 'save_dialog_not_found' 'no Save As dialog' }

    # The filename box: set by ValuePattern, same rule as the document.
    $nameBox = Get-ByName -Root $dlg -Name 'File name:' ([System.Windows.Automation.ControlType]::Edit)
    if ($null -eq $nameBox) {
      $nameBox = $dlg.FindFirst($SCOPE_DESC, (New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit)))
    }
    if ($null -eq $nameBox) { Emit-Refusal 'filename_field_not_found' 'no Edit control in the dialog' }

    try {
      $nvp = $nameBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    } catch {
      Emit-Refusal 'valuepattern_unsupported' 'the filename field does not support ValuePattern'
    }
    # The FULL path, so the dialog cannot save into whatever directory it
    # happens to be showing.
    $nvp.SetValue($target)

    $saveBtn = Get-ByName -Root $dlg -Name 'Save' ([System.Windows.Automation.ControlType]::Button)
    if ($null -eq $saveBtn) { Emit-Refusal 'save_button_not_found' 'Save' }
    Invoke-Element -Element $saveBtn -What 'Save button'
    Start-Sleep -Milliseconds 900

    if (-not (Test-Path -LiteralPath $target)) { Emit-Refusal 'save_not_confirmed' $target }
    Emit-Result @{ ok = $true; method = 'SaveAsDialog'; created = $true; path = $target }
  }

  'cleanup' {
    # Bounded to the process we recorded. A cleanup that could close anything
    # else would be a worse failure than the one it is cleaning up after.
    $procId = [int] $payload.bind.processId
    try {
      $proc = Get-Process -Id $procId -ErrorAction Stop
      if ($proc.SessionId -ne [int] $payload.bind.sessionId) { Emit-Refusal 'session_changed' 'refusing to close a process in another session' }
      $proc.CloseMainWindow() | Out-Null
      Start-Sleep -Milliseconds 500
      Emit-Result @{ ok = $true; closed = $true }
    } catch {
      Emit-Result @{ ok = $true; closed = $false; note = 'process already gone' }
    }
  }

  default { Emit-Refusal 'unknown_op' $op }
}
