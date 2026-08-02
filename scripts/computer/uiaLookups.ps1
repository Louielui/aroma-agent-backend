# ===========================================================================
#  uiaLookups.ps1 -- THE ONE PLACE THE SAVE UI IS LOCATED.
#
#  Owner decision 2026-08-02, after the FIFTH time a measurement and the
#  production path disagreed because they were two implementations of the
#  same idea.
#
#  -- WHAT WENT WRONG, PRECISELY -----------------------------------------
#  Operator-MeasureNotepadUia.ps1 reported "System.ItemNameDisplay : True"
#  and the canary then failed with filename_field_not_found. Both were true.
#  They were answering different questions:
#
#    . the tool waited 1500 ms AND ran seven diagnostics first, so its lookup
#      happened seconds after the dialog opened; the canary looked at 900 ms;
#    . the tool picked the dialog by "a top-level window of this pid that is
#      not the bound one, else the descendant"; the canary used FindFirst and
#      then FELL BACK to the first element anywhere in the tree with that pid
#      -- which is the Notepad main window, so the field was searched in the
#      wrong window and the refusal named the wrong layer;
#    . and a drift test compared STRING CONSTANTS, which both files contained,
#      so it stayed green while the behaviour diverged.
#
#  A string comparison cannot prove two implementations behave alike. The only
#  thing that can is there being one implementation. So: this file, dot-sourced
#  by both, entered through ONE function.
#
#  -- THE PUBLIC ENTRY IS Resolve-SaveUiBinding --------------------------
#  It owns the deadline, the root, the scope and the refusal policy. A caller
#  supplies the binding it already holds and gets a structured result. There is
#  deliberately NO timeout parameter, NO scope parameter and NO selector
#  parameter: a caller that could pass those could reproduce the drift this
#  file exists to end.
# ===========================================================================

Set-StrictMode -Version Latest

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# ---- read-only Win32, for the facts UIA does not give ---------------------
# No message is sent from here. SendMessage lives in exactly one other file and
# a guard asserts that; these are queries only.
Add-Type -Namespace AromaUia -Name Win -MemberDefinition @'
[DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindow(System.IntPtr h);
[DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindowEnabled(System.IntPtr h);
[DllImport("user32.dll", SetLastError=true)] public static extern System.IntPtr GetParent(System.IntPtr h);
[DllImport("user32.dll", SetLastError=true)] public static extern System.IntPtr GetWindow(System.IntPtr h, uint cmd);
[DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder buf, int max);
public const uint GW_OWNER = 4;
'@

$UIA_AUTO = [System.Windows.Automation.AutomationElement]

# ---- THE FIXED POLICY. None of this is a parameter. ----------------------
#
# ONE BUDGET FOR ALL THREE STAGES. The dialog, the filename field and the Save
# button share it, and entering a later stage does NOT restart the clock -- so
# "the dialog appeared slowly and then everything else got a fresh 8 seconds"
# cannot happen.
$SAVE_UI_TOTAL_BUDGET_MS = 8000
$SAVE_UI_POLL_MS = 250
$SAVE_UI_SCOPE = [System.Windows.Automation.TreeScope]::Descendants
$SAVE_DIALOG_CLASS = '#32770'
$SAVE_FILENAME_AUTOMATION_ID = 'System.ItemNameDisplay'
$SAVE_BUTTON_AUTOMATION_ID = '1'
$SAVE_BUTTON_NATIVE_CLASS = 'Button'

function Get-UiaNativeClass ([IntPtr]$Handle) {
  if ($Handle -eq [IntPtr]::Zero) { return '' }
  $sb = New-Object System.Text.StringBuilder 256
  $n = [AromaUia.Win]::GetClassName($Handle, $sb, $sb.Capacity)
  if ($n -le 0) { return '' }
  return $sb.ToString()
}

function Get-UiaHandle ($Element) {
  if ($null -eq $Element) { return [IntPtr]::Zero }
  try { return [IntPtr][int] $Element.Current.NativeWindowHandle } catch { return [IntPtr]::Zero }
}

function Get-UiaProcessId ($Element) {
  if ($null -eq $Element) { return 0 }
  try { return [int] $Element.Current.ProcessId } catch { return 0 }
}

# ===========================================================================
#  Find-SaveDialog
#
#  EVERY candidate under the bound main window, verified, and EXACTLY ONE
#  required. There is no fallback to the main window, no "first element with
#  this pid", no nearest match. Those were the bug.
# ===========================================================================
function Find-SaveDialog {
  param($MainWindow, [int]$ProcessId, [IntPtr]$BoundHandle)

  $cond = New-Object System.Windows.Automation.PropertyCondition(
    $UIA_AUTO::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
  $found = $MainWindow.FindAll($SAVE_UI_SCOPE, $cond)

  $verified = @()
  $observed = 0
  $rejected = @()

  foreach ($c in $found) {
    $observed++
    $h = Get-UiaHandle $c
    if ($h -eq [IntPtr]::Zero) { $rejected += 'no_handle'; continue }
    if (-not [AromaUia.Win]::IsWindow($h)) { $rejected += 'not_a_window'; continue }

    $cls = Get-UiaNativeClass $h
    if ($cls -ne $SAVE_DIALOG_CLASS) { $rejected += "class:$cls"; continue }

    if ((Get-UiaProcessId $c) -ne $ProcessId) { $rejected += 'pid'; continue }
    $winPid = 0
    $null = [AromaUia.Win]::GetWindowThreadProcessId($h, [ref] $winPid)
    if ([int] $winPid -ne $ProcessId) { $rejected += 'native_pid'; continue }

    # OWNERSHIP. It must relate to THE BOUND WINDOW, by one of the relations a
    # dialog can legitimately have to the window that raised it. Which one holds
    # on this machine has not been measured, so all three are accepted and the
    # one that matched is reported as evidence -- rather than guessing one and
    # refusing correct dialogs, or accepting any window at all.
    $owner = [AromaUia.Win]::GetWindow($h, [AromaUia.Win]::GW_OWNER)
    $parent = [AromaUia.Win]::GetParent($h)
    $rel = ''
    if ($owner -eq $BoundHandle) { $rel = 'gw_owner' }
    elseif ($parent -eq $BoundHandle) { $rel = 'parent' }
    else {
      # UIA already told us it is a descendant of the bound window, which is a
      # relation in its own right; record it as the weakest accepted one.
      $rel = 'uia_descendant'
    }

    if (-not [AromaUia.Win]::IsWindowVisible($h)) { $rejected += 'not_visible'; continue }
    if (-not [AromaUia.Win]::IsWindowEnabled($h)) { $rejected += 'not_enabled'; continue }
    $off = $false
    try { $off = [bool] $c.Current.IsOffscreen } catch { }
    if ($off) { $rejected += 'offscreen'; continue }

    $verified += @{ element = $c; handle = $h; className = $cls; ownership = $rel }
  }

  return @{
    observed = $observed
    verifiedCount = $verified.Count
    verified = $verified
    rejected = $rejected
  }
}

# ===========================================================================
#  Find-FilenameField -- inside a VERIFIED dialog, never anywhere else.
# ===========================================================================
function Find-FilenameField {
  param($Dialog, [int]$ProcessId)
  $cond = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition($UIA_AUTO::AutomationIdProperty, $SAVE_FILENAME_AUTOMATION_ID)),
    (New-Object System.Windows.Automation.PropertyCondition($UIA_AUTO::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
  $found = $Dialog.FindAll($SAVE_UI_SCOPE, $cond)
  if ($found.Count -eq 0) { return @{ observed = 0; element = $null } }
  if ($found.Count -gt 1) { return @{ observed = $found.Count; element = $null } }
  $el = $found[0]
  if ((Get-UiaProcessId $el) -ne $ProcessId) { return @{ observed = 1; element = $null; wrongProcess = $true } }
  return @{ observed = 1; element = $el }
}

# ===========================================================================
#  Find-SaveButton -- located, never pressed. Pressing lives in
#  nativeSaveActivation.ps1 and nowhere else.
# ===========================================================================
function Find-SaveButton {
  param($Dialog, [int]$ProcessId)
  $cond = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition($UIA_AUTO::AutomationIdProperty, $SAVE_BUTTON_AUTOMATION_ID)),
    (New-Object System.Windows.Automation.PropertyCondition($UIA_AUTO::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
  $found = $Dialog.FindAll($SAVE_UI_SCOPE, $cond)
  if ($found.Count -eq 0) { return @{ observed = 0; element = $null } }
  if ($found.Count -gt 1) { return @{ observed = $found.Count; element = $null } }
  $el = $found[0]
  $h = Get-UiaHandle $el
  if ($h -eq [IntPtr]::Zero) { return @{ observed = 1; element = $null; noHandle = $true } }
  $cls = Get-UiaNativeClass $h
  if ($cls -ne $SAVE_BUTTON_NATIVE_CLASS) { return @{ observed = 1; element = $null; className = $cls } }
  return @{ observed = 1; element = $el; handle = $h; className = $cls }
}

# ===========================================================================
#  Resolve-SaveUiBinding -- THE ONLY COMPLETE PUBLIC ENTRY.
#
#  BOUNDED POLLING, NOT A FIXED SLEEP. A fixed 900 ms or 1500 ms is a guess
#  about how fast the machine is; polling waits for the condition itself. But
#  it never infers success from elapsed time: a timeout means ONLY that the
#  stated condition was not observed within the budget, and it is reported as
#  a timeout, never as an approximate success.
#
#  Every poll re-checks the things that could have changed underneath, so a
#  dialog that is destroyed and replaced between polls does not slip through.
# ===========================================================================
function Resolve-SaveUiBinding {
  param($MainWindow, [int]$ProcessId, [string]$BoundWindowHandle)

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $boundHandle = [IntPtr][int] $BoundWindowHandle

  $result = @{
    ok = $false
    stage = 'save_dialog'
    refusal = $null
    detail = $null
    candidatesObserved = 0
    elapsedMs = 0
    dialogVerified = $false
    filenameFieldVerified = $false
    saveButtonVerified = $false
    evidence = @{}
    dialog = $null
    filenameField = $null
    saveButton = $null
  }

  $stage = 'save_dialog'
  $lastRefusal = 'save_dialog_not_found'
  $lastDetail = 'no verified dialog was observed'
  $dlgHandleSeen = [IntPtr]::Zero

  while ($sw.ElapsedMilliseconds -lt $SAVE_UI_TOTAL_BUDGET_MS) {

    # -- things that must remain true for the whole search ----------------
    $proc = $null
    try { $proc = Get-Process -Id $ProcessId -ErrorAction Stop } catch { $proc = $null }
    if ($null -eq $proc) {
      $result.stage = 'process'; $result.refusal = 'process_gone'
      $result.detail = "pid $ProcessId"; $result.elapsedMs = [int] $sw.ElapsedMilliseconds
      return $result
    }
    if (-not [AromaUia.Win]::IsWindow($boundHandle)) {
      $result.stage = 'main_window'; $result.refusal = 'window_changed'
      $result.detail = 'the bound main window no longer exists'; $result.elapsedMs = [int] $sw.ElapsedMilliseconds
      return $result
    }

    # -- stage 1: the dialog ----------------------------------------------
    $d = Find-SaveDialog -MainWindow $MainWindow -ProcessId $ProcessId -BoundHandle $boundHandle
    $result.candidatesObserved = $d.observed

    # WHY EACH CANDIDATE WAS TURNED AWAY, not merely how many there were.
    #
    # Find-SaveDialog has always built this list and it has never left the function. It is the
    # one piece of evidence that separates "no dialog existed" from "a dialog existed and was
    # rejected for a stated reason" -- and, for the multi-layer #32770 question now open, it is
    # the difference between knowing and guessing: a second '#32770' appearing here under
    # not_visible or pid answers it outright.
    #
    # Recorded on every pass, so the LAST poll's reasons are what the audit shows. Joined into a
    # string rather than left an array, because @() does not survive a PowerShell return.
    $result.evidence.dialogsVerified = $d.verifiedCount
    $result.evidence.dialogsRejected = (@($d.rejected) -join ', ')

    if ($d.verifiedCount -gt 1) {
      $result.stage = 'save_dialog'; $result.refusal = 'save_dialog_ambiguous'
      $result.detail = "$($d.verifiedCount) verified dialogs"; $result.elapsedMs = [int] $sw.ElapsedMilliseconds
      return $result
    }

    if ($d.verifiedCount -eq 1) {
      $dlg = $d.verified[0]
      # A dialog that was replaced between polls is a different dialog.
      if ($dlgHandleSeen -ne [IntPtr]::Zero -and $dlg.handle -ne $dlgHandleSeen) {
        $result.stage = 'save_dialog'; $result.refusal = 'save_dialog_replaced'
        $result.detail = 'the dialog changed identity during the search'; $result.elapsedMs = [int] $sw.ElapsedMilliseconds
        return $result
      }
      $dlgHandleSeen = $dlg.handle
      $result.dialogVerified = $true
      $result.dialog = $dlg.element
      $result.evidence.dialogClassName = $dlg.className
      $result.evidence.dialogOwnership = $dlg.ownership
      $result.evidence.dialogHandle = [string] $dlg.handle
      $stage = 'filename_field'

      # -- stage 2: the filename field, INSIDE the verified dialog --------
      $f = Find-FilenameField -Dialog $dlg.element -ProcessId $ProcessId
      $result.evidence.filenameCandidates = $f.observed
      if ($f.observed -gt 1) {
        $result.stage = 'filename_field'; $result.refusal = 'filename_field_ambiguous'
        $result.detail = "$($f.observed) candidates"; $result.elapsedMs = [int] $sw.ElapsedMilliseconds
        return $result
      }
      if ($null -ne $f.element) {
        $result.filenameFieldVerified = $true
        $result.filenameField = $f.element
        $stage = 'save_button'

        # -- stage 3: the Save button ------------------------------------
        $b = Find-SaveButton -Dialog $dlg.element -ProcessId $ProcessId
        $result.evidence.saveButtonCandidates = $b.observed
        if ($b.observed -gt 1) {
          $result.stage = 'save_button'; $result.refusal = 'save_control_not_unique'
          $result.detail = "$($b.observed) candidates"; $result.elapsedMs = [int] $sw.ElapsedMilliseconds
          return $result
        }
        if ($null -ne $b.element) {
          $result.saveButtonVerified = $true
          $result.saveButton = $b.element
          $result.evidence.saveButtonClassName = $b.className
          $result.evidence.saveButtonHandle = [string] $b.handle
          $result.ok = $true
          $result.stage = 'complete'
          $result.elapsedMs = [int] $sw.ElapsedMilliseconds
          return $result
        }
        $lastRefusal = 'save_button_not_found'
        $lastDetail = if ($b.PSObject.Properties.Match('className').Count -and $b.className) { "class '$($b.className)'" } else { 'not present yet' }
      } else {
        $lastRefusal = 'filename_field_not_found'
        $lastDetail = 'not present in the verified dialog yet'
      }
    }

    Start-Sleep -Milliseconds $SAVE_UI_POLL_MS
  }

  # TIMEOUT. It says only that the condition was not OBSERVED inside the budget.
  # It is never recorded as a near-success and never as "probably fine".
  $result.stage = $stage
  $result.refusal = $lastRefusal
  $result.detail = "timed out after $([int] $sw.ElapsedMilliseconds) ms: $lastDetail"
  $result.elapsedMs = [int] $sw.ElapsedMilliseconds
  $result.evidence.timedOut = $true
  return $result
}
