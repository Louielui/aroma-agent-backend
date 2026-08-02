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
# THE SHARED SAVE-UI LOOKUPS. Package-local, dot-sourced by the exact same path the
# measurement tool uses. Not a copy: the same file, entered through the same function, so
# production and measurement cannot answer different questions about the same dialog.
. (Join-Path $PSScriptRoot 'uiaLookups.ps1')

function Emit-Result {
  param([hashtable] $Result)
  Write-AromaEnvelope $Result
  exit 0
}

function Emit-Refusal {
  param([string] $Reason, [string] $Detail = $null, [hashtable] $Evidence = $null)
  Write-AromaRefusal $Reason $Detail $Evidence
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
# THE EDITABLE SURFACE, AND WHY IT IS FOUND BY UNIQUENESS RATHER THAN BY ID.
#
# It used to be FindFirst - "the first Document in this window" - and its
# AutomationId was the binding's identity. Measured 2026-08-02 on this machine:
#
#     ControlType  ControlType.Document
#     AutomationId <empty>
#     Name         'Text editor'
#     ClassName    'RichEditD2DPT'
#
# The AutomationId is empty because Windows does not give it one, so requiring
# it non-empty would refuse every run. And FindFirst is not identity either: it
# answers "a Document", not "the Document".
#
# So the rule is EXACTLY ONE. The window is already pinned by pid and native
# handle; inside it there must be exactly one Document, or failing that exactly
# one Edit. Two is a refusal, never a choice. That makes "the editable control
# of THAT window" a description with one referent - an invariant we impose,
# rather than a property we hope Windows supplies.
function Get-SoleEditControl {
  param($Window)
  $docs = $Window.FindAll($SCOPE_DESC, (New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Document)))
  if ($docs.Count -eq 1) { return @{ ok = $true; element = $docs[0]; matchedAs = 'Document' } }
  if ($docs.Count -gt 1) { return @{ ok = $false; reason = 'uia_control_ambiguous'; detail = "$($docs.Count) Document controls" } }
  $edits = $Window.FindAll($SCOPE_DESC, (New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit)))
  if ($edits.Count -eq 1) { return @{ ok = $true; element = $edits[0]; matchedAs = 'Edit' } }
  if ($edits.Count -gt 1) { return @{ ok = $false; reason = 'uia_control_ambiguous'; detail = "$($edits.Count) Edit controls" } }
  return @{ ok = $false; reason = 'uia_control_missing'; detail = 'no Document or Edit control' }
}

# The control's identity, as UIA itself expresses it.
#
# RuntimeId is what UIA uses for "is this the same element": produced by the
# framework, not localised, and - unlike AutomationId - always present.
# ControlType and ClassName travel alongside so that a mismatch is DIAGNOSABLE:
# "the RuntimeId changed and it is still a RichEditD2DPT Document" is a
# different problem from "the control is now something else".
#
# AutomationId is recorded and never depended on. Writing down what Windows says
# is how the next machine's difference becomes visible instead of fatal.
function Get-ControlIdentity {
  param($El)
  $rt = ''
  try { $rt = (@($El.GetRuntimeId()) -join '.') } catch { $rt = '' }
  $ct = ''; try { $ct = [string] $El.Current.ControlType.ProgrammaticName } catch { }
  $cn = ''; try { $cn = [string] $El.Current.ClassName } catch { }
  $ai = ''; try { $ai = [string] $El.Current.AutomationId } catch { }
  return @{ runtimeId = $rt; controlType = $ct; className = $cn; automationId = $ai }
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

  $sole = Get-SoleEditControl -Window $win
  if (-not $sole.ok) { return @{ ok = $false; reason = $sole.reason } }

  # THE CONTROL MUST BE THE SAME CONTROL, not merely the same kind of control.
  # Uniqueness above says there is only one candidate; this says the candidate is
  # the one open_app bound. Without it, a window that rebuilt its document would
  # be typed into as though nothing had happened.
  $id = Get-ControlIdentity -El $sole.element
  if ($id.runtimeId -ne [string] $Bind.uiaRuntimeId) { return @{ ok = $false; reason = 'uia_control_changed' } }
  if ($id.controlType -ne [string] $Bind.uiaControlType) { return @{ ok = $false; reason = 'uia_control_changed' } }
  if ($id.className -ne [string] $Bind.uiaClassName) { return @{ ok = $false; reason = 'uia_control_changed' } }

  return @{ ok = $true; window = $win; edit = $sole.element; processId = $procId; sessionId = $proc.SessionId; windowHandle = $handle }
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
  'save_outcome'   = @('bind')
  'verify_binding' = @('bind')
  'cleanup'        = @('bind')
}
# uiaAutomationId is NOT here: it is carried in the binding and may be empty,
# because the packaged Notepad's document has none. Required fields only.
$BIND_FIELDS = @('processId', 'sessionId', 'windowHandle', 'uiaRuntimeId', 'uiaControlType', 'uiaClassName')

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

    $sole = Get-SoleEditControl -Window $win
    if (-not $sole.ok) { Emit-Refusal $sole.reason $sole.detail }
    $ctlId = Get-ControlIdentity -El $sole.element
    if ($ctlId.runtimeId -eq '') { Emit-Refusal 'uia_runtime_id_missing' 'UIA returned no RuntimeId for the document control' }

    Emit-Result @{
      ok = $true
      processId = $realPid
      sessionId = $realProc.SessionId
      windowHandle = [string] $win.Current.NativeWindowHandle
      uiaRuntimeId = $ctlId.runtimeId
      uiaControlType = $ctlId.controlType
      uiaClassName = $ctlId.className
      # Recorded, never required. <empty> on this machine, and that is a fact
      # about Windows rather than a fault to refuse on.
      uiaAutomationId = $ctlId.automationId
      uiaControlMatchedAs = $sole.matchedAs
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

    # ---- ONE RESOLVER, ONE DEADLINE, ONE POLICY -------------------------
    # This used to be: sleep 900 ms, FindFirst a descendant Window, and IF THAT
    # FAILED fall back to "the first element anywhere in the tree with this pid"
    # -- which is the Notepad main window. The filename field was then searched
    # inside the wrong window and the run refused with filename_field_not_found:
    # technically true, and about the wrong layer entirely.
    #
    # Both the fallback and the fixed sleep are gone. Resolve-SaveUiBinding owns
    # the deadline, the root, the scope and the refusal policy, and the
    # measurement tool calls this same function so the two cannot drift again.
    $ui = Resolve-SaveUiBinding -MainWindow $r.window -ProcessId $r.processId -BoundWindowHandle $r.windowHandle
    if (-not $ui.ok) {
      # THE WHOLE STRUCTURED RESULT, not a sentence made out of four of its fields.
      #
      # The first version built a string from stage/elapsedMs/candidates and left the evidence
      # hashtable behind entirely -- so dialogOwnership and dialogHandle, the two values that
      # would have told us WHICH dialog was verified, never existed outside this function. The
      # run then failed with a refusal that named a layer and explained nothing.
      #
      # Elements are dropped (they are live UIA objects and cannot be serialised); every
      # measured field goes.
      $ev = @{
        stage = $ui.stage
        candidatesObserved = $ui.candidatesObserved
        elapsedMs = $ui.elapsedMs
        dialogVerified = $ui.dialogVerified
        filenameFieldVerified = $ui.filenameFieldVerified
        saveButtonVerified = $ui.saveButtonVerified
      }
      foreach ($k in $ui.evidence.Keys) { $ev[$k] = $ui.evidence[$k] }
      Emit-Refusal $ui.refusal $ui.detail $ev
    }
    $dlg = $ui.dialog
    $nameBox = $ui.filenameField

    try {
      $nvp = $nameBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    } catch {
      Emit-Refusal 'valuepattern_unsupported' 'the filename field does not support ValuePattern'
    }
    # The FULL path, so the dialog cannot save into whatever directory it
    # happens to be showing.
    $nvp.SetValue($target)

    # ---- THIS OP PREPARES. IT DOES NOT PRESS. ---------------------------
    # It used to look for a Save button here and Invoke it. That lookup was
    # MEASURED TO FAIL - the control has no InvokePattern and no
    # LegacyIAccessible - so pressing it moved to nativeSaveActivation.ps1,
    # the one file allowed a native message.
    #
    # The split is not only mechanical. It keeps each helper single-purpose:
    # this one opens the dialog and sets the destination, and CANNOT press
    # anything; the other verifies and presses, and CANNOT choose a target.
    # Neither file alone can save a file.
    #
    # Read back what was actually set, so the caller knows the exact string the
    # dialog now holds rather than the string we hoped it would.
    $setTo = ''
    try { $setTo = [string] $nvp.Current.Value } catch { $setTo = '' }
    if ($setTo -cne $target) { Emit-Refusal 'filename_not_set' 'the field did not take the approved path' }

    Emit-Result @{
      ok = $true
      method = 'SaveAsDialogPrepared'
      prepared = $true
      dialogOpen = $true
      filenameSet = $setTo
      path = $target
    }
  }

  # ---- WHAT HAPPENED AFTER THE ACTIVATION -----------------------------
  # Observations only. This op decides NOTHING: it reports whether the dialog
  # is still there and whether an error surface appeared, and the caller
  # combines that with facts on disk. Putting the judgement here would let one
  # UIA reading declare a save that no file supports.
  'save_outcome' {
    $r = Resolve-Binding -Bind $payload.bind
    if (-not $r.ok) {
      # The window going away is itself an observation, not a failure of this op.
      Emit-Result @{ ok = $true; observed = $true; windowResolvable = $false; dialogPresent = $false; errorTextSeen = $null; note = $r.reason }
    }

    $dlgCond = New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Window)
    $dlg = $r.window.FindFirst($SCOPE_DESC, $dlgCond)
    $dialogPresent = ($null -ne $dlg)

    # If a dialog is still up, is it saying something? Only a NAMED, readable
    # message counts as evidence of rejection; silence is not evidence.
    $errorText = $null
    if ($dialogPresent) {
      $textCond = New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)
      $texts = $dlg.FindAll($SCOPE_DESC, $textCond)
      foreach ($t in $texts) {
        $tn = ''
        try { $tn = [string] $t.Current.Name } catch { }
        if ($tn -and $tn.Length -gt 8) { $errorText = $tn; break }
      }
    }

    Emit-Result @{
      ok = $true
      observed = $true
      windowResolvable = $true
      dialogPresent = $dialogPresent
      errorTextSeen = $errorText
    }
  }

  'cleanup' {
    # Bounded to the process we recorded. A cleanup that could close anything
    # else would be a worse failure than the one it is cleaning up after.
    #
    # ---- WHY THIS NO LONGER JUST SAYS closed = true -------------------
    # It used to call CloseMainWindow and report closed:true without looking.
    # MEASURED 2026-08-02: on a DIRTY document CloseMainWindow raises a save
    # confirmation dialog and the process does NOT exit. type_text makes the
    # document dirty, so in the two-step canary that is the NORMAL case, not an
    # edge one - the old code would have reported a clean shutdown with Notepad
    # still on screen, a dialog open, and the Owner told it was finished.
    #
    # So every claim below is measured after the fact, and Stop-Process is the
    # bounded guarantee: our own pid, session checked twice, and it cannot write
    # a file or press anything.
    $procId = [int] $payload.bind.processId
    $sessionId = [int] $payload.bind.sessionId

    $proc = $null
    try { $proc = Get-Process -Id $procId -ErrorAction Stop } catch { $proc = $null }
    if ($null -eq $proc) {
      Emit-Result @{ ok = $true; closed = $true; method = 'already_gone'; processExited = $true; notepadWindowsAfter = @(Get-NotepadWindows).Count; forced = $false }
    }
    if ($proc.SessionId -ne $sessionId) { Emit-Refusal 'session_changed' 'refusing to close a process in another session' }

    $method = 'CloseMainWindow'
    $forced = $false
    $null = $proc.CloseMainWindow()
    Start-Sleep -Milliseconds 1200

    $still = $null
    try { $still = Get-Process -Id $procId -ErrorAction Stop } catch { $still = $null }

    if ($null -ne $still) {
      # The confirmation dialog is up, or the app declined to close. NOTHING is
      # pressed to get past it: a "Don't save" button is exactly as unreachable
      # as the Save button was, and guessing at one would be the same mistake.
      # Terminate the bound process instead. It cannot save, and it is ours.
      if ($still.SessionId -ne $sessionId) { Emit-Refusal 'session_changed' 'process changed session during cleanup' }
      Stop-Process -Id $procId -Force
      $forced = $true
      $method = 'Stop-Process after CloseMainWindow did not exit'
      Start-Sleep -Milliseconds 800
    }

    $exited = $false
    try { $null = Get-Process -Id $procId -ErrorAction Stop } catch { $exited = $true }

    # MEASURED, not asserted. Every one of these is read after the fact, and a
    # cleanup that did not clean up reports ok = false.
    $winsAfter = @(Get-NotepadWindows).Count
    $procsAfter = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -ieq 'notepad' }).Count
    Emit-Result @{
      ok = ($exited -and $winsAfter -eq 0)
      closed = $exited
      processExited = $exited
      forced = $forced
      method = $method
      notepadWindowsAfter = $winsAfter
      notepadProcessesAfter = $procsAfter
    }
  }

  default { Emit-Refusal 'unknown_op' $op }
}
