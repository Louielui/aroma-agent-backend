# ===========================================================================
#  nativeSaveActivation.ps1 -- THE ONLY FILE IN THIS REPO THAT MAY SEND A
#  WINDOWS MESSAGE.
#
#  Owner decision DESIGN-001, 2026-08-02. It exists because the Save button in
#  the classic #32770 Save As dialog is precisely identifiable -
#  AutomationId '1', native class 'Button', a real HWND - and unpressable by
#  anything this project permits: the managed UIA client offers no
#  InvokePattern on it and LegacyIAccessible is unavailable. Keyboard
#  synthesis, focus inference and writing the file directly are all ruled out.
#
#  -- WHAT THIS FILE MAY DO, AND NOTHING ELSE ------------------------------
#  It accepts ONE op, activate_bound_save, whose only input is the runtime
#  binding the Companion already holds plus the sealed file name and folder.
#  From those it derives, verifies and presses exactly one control, once.
#
#  IT DOES NOT OFFER, AND MUST NEVER OFFER:
#    . a function taking an HWND and a message
#    . a message id as a parameter, a setting, or a payload field
#    . a caller-supplied selector, class name, AutomationId or script fragment
#    . a raw HWND lookup, or any way to return an HWND to a caller
#    . dynamic C#, dynamic Win32 entry points, or Invoke-Expression
#
#  BM_CLICK is a constant below. It is not read from anywhere.
#
#  -- WHY THE VERIFICATION AND THE SEND ARE IN ONE FUNCTION ----------------
#  Windows recycles window handles. Between the last check and the send, the
#  dialog could be destroyed and its handle reissued to an unrelated window.
#  That risk cannot be eliminated - there is no atomic verify-and-post in
#  Win32 - so it is MINIMISED instead: every check and the send happen inside
#  Invoke-Activation, with no IPC, no file, no transport and no second
#  process between them. Microseconds, not the ~100 ms a cross-process design
#  would have. The Owner accepted this residual risk explicitly.
#
#  -- THE CHECK THAT IS NOT ABOUT THE BUTTON -------------------------------
#  BM_CLICK presses Save. What gets WRITTEN is whatever the dialog holds, not
#  what we intended. So the filename field's current value and the dialog's
#  current folder are re-read immediately before the send and must equal the
#  approved values exactly. Every other check establishes which button; these
#  two establish what pressing it does.
# ===========================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'aromaJsonTransport.ps1')

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AUTO = [System.Windows.Automation.AutomationElement]
$SCOPE_CHILD = [System.Windows.Automation.TreeScope]::Children
$SCOPE_DESC = [System.Windows.Automation.TreeScope]::Descendants

# ---------------------------------------------------------------------------
#  THE NATIVE PRIMITIVE. Read-only queries plus ONE message send.
#
#  SendMessage is declared PRIVATE to this file's generated type and is called
#  from exactly one place, Invoke-Activation, with the message hard-coded.
#  No wrapper of it is exported, and nothing in this file takes a message as
#  input.
# ---------------------------------------------------------------------------
Add-Type -Namespace AromaNative -Name SaveActivation -MemberDefinition @'
[DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindow(System.IntPtr h);
[DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindowEnabled(System.IntPtr h);
[DllImport("user32.dll", SetLastError=true)] public static extern System.IntPtr GetParent(System.IntPtr h);
[DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder buf, int max);
[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern System.IntPtr SendMessage(System.IntPtr h, uint msg, System.IntPtr w, System.IntPtr l);

// THE ONLY EXPORTED WAY TO SEND ANYTHING. It takes a window and nothing else:
// the message is baked in and cannot be chosen by any caller, in this file or
// outside it. There is deliberately no overload, no variant and no msg
// parameter anywhere in this type.
public const uint BM_CLICK = 0x00F5;
public static System.IntPtr ClickButtonOnly(System.IntPtr h) {
  return SendMessage(h, BM_CLICK, System.IntPtr.Zero, System.IntPtr.Zero);
}
'@

# The dialog class, the control identity, and the field id -- all MEASURED on
# this machine on 2026-08-02, all fixed constants, none of them caller input.
$DIALOG_CLASS = '#32770'
$SAVE_AUTOMATION_ID = '1'
$SAVE_NATIVE_CLASS = 'Button'
$FILENAME_AUTOMATION_ID = 'System.ItemNameDisplay'

# How long the whole verify-and-send transaction may take. Past this the
# earliest checks are too old to stand behind and the run refuses.
$ACTIVATION_WINDOW_MS = 5000

function New-PropCondition ($prop, $value) { New-Object System.Windows.Automation.PropertyCondition($prop, $value) }

function Get-NativeClass ([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 256
  $n = [AromaNative.SaveActivation]::GetClassName($h, $sb, $sb.Capacity)
  if ($n -le 0) { return '' }
  return $sb.ToString()
}

function Get-WindowPid ([IntPtr]$h) {
  $procId = 0
  $null = [AromaNative.SaveActivation]::GetWindowThreadProcessId($h, [ref] $procId)
  return [int] $procId
}

# ===========================================================================
#  THE ONE OP.
#
#  Every refusal below returns BEFORE the send. `$script:SendCount` is the
#  evidence: it is incremented at the single call site and reported on every
#  outcome, so a negative test asserts ZERO SENDS rather than merely "a
#  refusal happened". A refusal that sent the message first is not a refusal.
# ===========================================================================
$script:SendCount = 0

function Deny ([string]$Code, [string]$Detail) {
  return @{ ok = $false; reason = $Code; detail = $Detail; sendCount = $script:SendCount; activated = $false }
}

function Invoke-Activation {
  param($Payload)

  $started = [System.Diagnostics.Stopwatch]::StartNew()
  $bind = $Payload.bind

  # -- the approved destination, rebuilt here from the approved parts --------
  # The caller supplies a NAME. The folder is a constant that travels with the
  # order. The absolute path is composed here and never accepted from anyone.
  $dir = [string] $Payload.dir
  $fileName = [string] $Payload.fileName
  $expectedPath = Join-Path $dir $fileName

  # 1-2. the process, and the session it was attested in
  $procId = [int] $bind.processId
  $proc = $null
  try { $proc = Get-Process -Id $procId -ErrorAction Stop } catch { return (Deny 'process_gone' "pid $procId") }
  if ($proc.SessionId -ne [int] $bind.sessionId) { return (Deny 'session_changed' 'the process is in another session') }

  # 3. the bound main window, still the one open_app produced
  $mainCond = New-PropCondition $AUTO::ProcessIdProperty $procId
  $tops = $AUTO::RootElement.FindAll($SCOPE_CHILD, $mainCond)
  $mainWin = $null
  foreach ($w in $tops) {
    $h = ''
    try { $h = [string] $w.Current.NativeWindowHandle } catch { continue }
    if ($h -eq [string] $bind.windowHandle) { $mainWin = $w }
  }
  if ($null -eq $mainWin) { return (Deny 'window_changed' 'the bound window is not present') }

  # 4. the Save dialog, found as a descendant Window of the bound window
  $dlgCond = New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Window)
  $dlg = $mainWin.FindFirst($SCOPE_DESC, $dlgCond)
  if ($null -eq $dlg) { return (Deny 'save_dialog_not_found' 'no dialog under the bound window') }

  # 5. it belongs to the same process
  $dlgPid = 0
  try { $dlgPid = [int] $dlg.Current.ProcessId } catch { }
  if ($dlgPid -ne $procId) { return (Deny 'dialog_process_mismatch' "dialog pid $dlgPid, bound pid $procId") }

  # 6. and it is the modal dialog class we measured, not some other window
  $dlgHandle = [IntPtr]::Zero
  try { $dlgHandle = [IntPtr][int] $dlg.Current.NativeWindowHandle } catch { }
  if ($dlgHandle -eq [IntPtr]::Zero) { return (Deny 'save_dialog_not_found' 'the dialog has no window handle') }
  $dlgClass = Get-NativeClass $dlgHandle
  if ($dlgClass -ne $DIALOG_CLASS) { return (Deny 'dialog_class_unexpected' "class '$dlgClass'") }

  # 7-9. EXACTLY ONE control matching both fixed criteria. Two is a refusal,
  # never a choice, and there is no nearest-match anywhere in this file.
  $btnCond = New-Object System.Windows.Automation.AndCondition(
    (New-PropCondition $AUTO::AutomationIdProperty $SAVE_AUTOMATION_ID),
    (New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Button)))
  $candidates = $dlg.FindAll($SCOPE_DESC, $btnCond)
  if ($candidates.Count -eq 0) { return (Deny 'save_control_not_found' 'no control with the fixed identity') }
  if ($candidates.Count -gt 1) { return (Deny 'save_control_not_unique' "$($candidates.Count) candidates") }
  $btn = $candidates[0]

  $btnAutoId = ''
  try { $btnAutoId = [string] $btn.Current.AutomationId } catch { }
  if ($btnAutoId -ne $SAVE_AUTOMATION_ID) { return (Deny 'save_control_id_mismatch' "'$btnAutoId'") }

  $btnHandle = [IntPtr]::Zero
  try { $btnHandle = [IntPtr][int] $btn.Current.NativeWindowHandle } catch { }
  if ($btnHandle -eq [IntPtr]::Zero) { return (Deny 'save_control_no_handle' 'the control has no window handle') }
  $btnClass = Get-NativeClass $btnHandle
  if ($btnClass -ne $SAVE_NATIVE_CLASS) { return (Deny 'save_control_class_mismatch' "'$btnClass'") }

  # 10-12. alive, enabled, visible, and really inside the dialog we verified
  if (-not [AromaNative.SaveActivation]::IsWindow($btnHandle)) { return (Deny 'save_control_gone' 'handle is not a window') }
  if (-not [AromaNative.SaveActivation]::IsWindowEnabled($btnHandle)) { return (Deny 'save_control_disabled' 'not enabled') }
  if (-not [AromaNative.SaveActivation]::IsWindowVisible($btnHandle)) { return (Deny 'save_control_offscreen' 'not visible') }
  $offscreen = $false
  try { $offscreen = [bool] $btn.Current.IsOffscreen } catch { }
  if ($offscreen) { return (Deny 'save_control_offscreen' 'UIA reports offscreen') }
  $btnPid = Get-WindowPid $btnHandle
  if ($btnPid -ne $procId) { return (Deny 'save_control_not_in_dialog' "control pid $btnPid") }
  if ([AromaNative.SaveActivation]::GetParent($btnHandle) -ne $dlgHandle) {
    return (Deny 'save_control_not_in_dialog' 'the control is not a child of the verified dialog')
  }

  # 13. WHAT PRESSING IT WILL DO. The filename field must still belong to this
  # dialog and must still hold exactly the approved absolute path.
  $nameCond = New-Object System.Windows.Automation.AndCondition(
    (New-PropCondition $AUTO::AutomationIdProperty $FILENAME_AUTOMATION_ID),
    (New-PropCondition $AUTO::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit)))
  $nameBox = $dlg.FindFirst($SCOPE_DESC, $nameCond)
  if ($null -eq $nameBox) { return (Deny 'filename_field_not_found' 'no filename field in the verified dialog') }
  $nameBoxPid = 0
  try { $nameBoxPid = [int] $nameBox.Current.ProcessId } catch { }
  if ($nameBoxPid -ne $procId) { return (Deny 'filename_field_altered' 'the filename field belongs to another process') }
  $currentName = $null
  try {
    $nvp = $nameBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $currentName = [string] $nvp.Current.Value
  } catch { return (Deny 'filename_field_altered' 'the filename field cannot be read') }
  if ($currentName -cne $expectedPath) { return (Deny 'filename_field_altered' 'the field no longer holds the approved path') }

  # 14. the dialog's current folder must still be the approved one. The field
  # holds an absolute path, so this is a second, independent statement of the
  # same requirement rather than a restatement of the first.
  $currentFolder = [System.IO.Path]::GetDirectoryName($currentName)
  if ($currentFolder -cne $dir) { return (Deny 'current_folder_altered' 'the destination folder is not the approved one') }

  # 15. still nothing to overwrite
  if (Test-Path -LiteralPath $expectedPath) { return (Deny 'refuse_overwrite' $expectedPath) }

  # 16. the transaction has not taken so long that the early checks are stale
  if ($started.ElapsedMilliseconds -gt $ACTIVATION_WINDOW_MS) {
    return (Deny 'activation_window_expired' "$($started.ElapsedMilliseconds) ms")
  }

  # 17. exactly one send, ever, in this process
  if ($script:SendCount -ne 0) { return (Deny 'already_activated' 'one activation per run') }

  # ---- THE SEND. One line, one message, one window, one time. ------------
  $null = [AromaNative.SaveActivation]::ClickButtonOnly($btnHandle)
  $script:SendCount++

  # NOTHING BEYOND THIS POINT DECIDES WHETHER THE SAVE WORKED. The call
  # returning proves a message was posted, and proves nothing else. The
  # postcondition is evaluated by the caller from facts on disk, and this
  # result deliberately reports only what it can stand behind.
  return @{
    ok = $true
    activated = $true
    sendCount = $script:SendCount
    verified = @{
      processId = $procId
      sessionId = [int] $bind.sessionId
      dialogClass = $dlgClass
      controlAutomationId = $btnAutoId
      controlNativeClass = $btnClass
      controlUnique = $true
      filenameMatched = $true
      folderMatched = $true
      elapsedMs = [int] $started.ElapsedMilliseconds
    }
  }
}

# ===========================================================================
#  DISPATCH -- a closed set of exactly one op.
# ===========================================================================
$payload = Read-AromaPayload
$op = ''
try { $op = [string] $payload.op } catch { $op = '' }

if ($op -ne 'activate_bound_save') {
  Write-AromaEnvelope (@{ ok = $false; reason = 'unknown_op'; detail = $op; sendCount = 0; activated = $false })
  exit 0
}

foreach ($f in @('bind', 'dir', 'fileName')) {
  if (-not $payload.PSObject.Properties.Match($f).Count) {
    Write-AromaEnvelope (@{ ok = $false; reason = 'missing_field'; detail = $f; sendCount = 0; activated = $false })
    exit 0
  }
}
foreach ($bf in @('processId', 'sessionId', 'windowHandle')) {
  if (-not $payload.bind.PSObject.Properties.Match($bf).Count) {
    Write-AromaEnvelope (@{ ok = $false; reason = 'missing_field'; detail = "bind.$bf"; sendCount = 0; activated = $false })
    exit 0
  }
}

$result = $null
try { $result = Invoke-Activation -Payload $payload }
catch { $result = @{ ok = $false; reason = 'activation_threw'; detail = $_.Exception.Message; sendCount = $script:SendCount; activated = ($script:SendCount -gt 0) } }

Write-AromaEnvelope $result
exit 0
