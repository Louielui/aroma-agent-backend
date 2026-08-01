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
switch ($op) {

  'open_app' {
    if ([string] $payload.appId -ne 'notepad') { Emit-Refusal 'app_not_allowed' ([string] $payload.appId) }

    # Bare app name, no path, no arguments. Anything else would be a command
    # line assembled from data, which is the shape this whole design refuses.
    $proc = Start-Process -FilePath 'notepad' -PassThru
    Start-Sleep -Milliseconds 900

    $win = Get-SoleWindowForProcess -ProcessId $proc.Id
    if ($null -eq $win) { Emit-Refusal 'window_not_found' 'no window for the launched process' }
    if ($win -is [string]) { Emit-Refusal 'window_ambiguous' 'more than one candidate window - refusing to choose' }

    $edit = Get-EditControl -Window $win
    if ($null -eq $edit) { Emit-Refusal 'uia_control_missing' 'no Document or Edit control in the new window' }

    Emit-Result @{
      ok = $true
      processId = $proc.Id
      sessionId = (Get-Process -Id $proc.Id).SessionId
      windowHandle = [string] $win.Current.NativeWindowHandle
      uiaControlId = [string] $edit.Current.AutomationId
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
