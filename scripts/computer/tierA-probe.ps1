# tierA-probe.ps1 - Containment Set v2, TIER A. Run AS AromaOperator, INSIDE session 5.
#
# TIER A ONLY: everything measurable with zero observation capability. No window
# enumeration, no clipboard, no screen capture, no cross-session handle opening. Tier B is
# folded into the 3b acceptance criteria and is deliberately absent here.
#
# WHY THIS EXISTS
# The v1 set was 17 filesystem assertions. A session and a profile now exist, and they
# created surfaces the v1 set says nothing about: the account's own profile, its HKCU hive,
# its ability to register scheduled tasks, and what it can see of other sessions.
#
# WHAT IS DIFFERENT FROM v1
#   . every row records the EXCEPTION TYPE, not just true/false, so "denied" and "not
#     found" are distinguishable. v1 returned false for both, which means a target that
#     merely does not exist would have read as containment.
#   . every row records targetExists, for the same reason.
#   . every WRITE row records residueLeft and residuePath. v1 created a marker, failed to
#     delete it, ignored that, and returned true - leaving C:\Aroma\w-8cee...tmp on disk
#     unnoticed for a day.
#   . the record carries its own identity and session, plus the token's group SIDs.
#   . rows are CLASSIFIED, not pass/failed. Several are expected to be permitted; those are
#     accepted surfaces to be signed off, not holes.
#
# MECHANISM CLASSES - the most important field
#   ACL               DACL on a securable object.            durable
#   PRIVILEGE         token lacks a required privilege.      durable
#   SESSION-ISOLATION separate namespace per session.        durable
#   ABSENT-EXISTENCE  target does not exist.                 EVAPORATES once created
#   ABSENT-CAPABILITY probe has no code to do it.            EVAPORATES once 3b ships
#   NOT-A-MECHANISM   e.g. ExecutionPolicy. Never counts.
#   UNDETERMINED      could not be classified. Never counts as containment.
#
# A row resting on ABSENT-* is a DEFERRED assertion, not containment.
#
# SIDE EFFECTS - read before running. This probe deliberately attempts writes:
#   . creates and deletes files under the account's own profile
#   . creates and deletes values under HKCU (never HKLM)
#   . registers and unregisters temporary scheduled tasks named AromaProbeTemp-<nonce>
#   . attempts, and expects to fail, one modification of the SessionGate task definition
# Everything created is uniquely named and cleaned up; anything that survives cleanup is
# reported as residue rather than silently left behind.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$nonce  = [guid]::NewGuid().ToString('N').Substring(0, 8)
$rows   = New-Object System.Collections.Generic.List[object]
$GateTask = 'AromaComputerOperator-SessionGate'
# initialised so the C4 cleanup can reference it even when the attempt threw first -
# under Set-StrictMode an unset variable is an error, not $null
$script:C4OriginalAction = $null

# ---------------------------------------------------------------------------
# identity - emitted with the rows so scope travels with the result
# ---------------------------------------------------------------------------
Add-Type -Namespace W -Name S -MemberDefinition @"
[DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
[DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint t);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformationW(IntPtr h,int i,System.Text.StringBuilder p,uint n,out uint l);
"@ -ErrorAction SilentlyContinue

function ObjName { param($h) $sb = New-Object System.Text.StringBuilder 256; $n = 0; if ([W.S]::GetUserObjectInformationW($h,2,$sb,256,[ref]$n)) { $sb.ToString() } else { $null } }
function SafeWinSta  { try { ObjName ([W.S]::GetProcessWindowStation()) } catch { $null } }
function SafeDesktop { try { ObjName ([W.S]::GetThreadDesktop([W.S]::GetCurrentThreadId())) } catch { $null } }

$idn = [Security.Principal.WindowsIdentity]::GetCurrent()

# Group SIDs answer, by measurement, whether this token carries S-1-5-4 INTERACTIVE.
# That was previously argued from documentation because the 3a token no longer exists.
$groups = @()
try { $groups = @($idn.Groups | ForEach-Object { $_.Value }) } catch { }

# ---------------------------------------------------------------------------
# classification helper
# ---------------------------------------------------------------------------
function Classify {
  param($Exception)
  # NO-EXCEPTION is NOT 'no mechanism blocked it'. It means the call returned a falsy
  # value without saying why, and an unexplained block must never be counted as
  # containment - that is the vacuous-pass trap this whole set exists to avoid.
  if (-not $Exception) { return 'NO-EXCEPTION' }

  # walk inner exceptions: CIM and ScheduledTasks wrap the real cause
  $e = $Exception
  for ($depth = 0; $e -and $depth -lt 5; $depth++) {
    $t = $e.GetType().Name
    $m = [string]$e.Message
    if ($t -match 'UnauthorizedAccess|Security')                 { return 'ACL' }
    if ($t -match 'PrivilegeNotHeld')                            { return 'PRIVILEGE' }
    if ($t -match 'ItemNotFound|FileNotFound|DirectoryNotFound') { return 'ABSENT-EXISTENCE' }
    if ($e.PSObject.Properties.Name -contains 'NativeErrorCode' -and $e.NativeErrorCode -eq 5) { return 'ACL' }
    if ($m -match 'Access is denied|access denied|is denied')    { return 'ACL' }
    if ($m -match 'cannot find|does not exist|No mapping')       { return 'ABSENT-EXISTENCE' }
    if ($m -match 'privilege|not held')                          { return 'PRIVILEGE' }
    $e = $e.InnerException
  }
  return 'UNDETERMINED'
}

# Records one row. $Action returns $true on success; any throw is captured and classified.
function Probe {
  param(
    [string]$Id,
    [string]$Target,
    [bool]$ExpectPermitted,
    [string]$Note,
    [scriptblock]$ExistsCheck,
    [scriptblock]$Action,
    [scriptblock]$Cleanup
  )
  $exists = $null
  if ($ExistsCheck) { try { $exists = [bool](& $ExistsCheck) } catch { $exists = $null } }

  $result = $false; $err = $null
  try { $result = [bool](& $Action) } catch { $err = $_.Exception }

  $residue = $false; $residuePath = $null
  if ($Cleanup) {
    try { $rp = & $Cleanup; if ($rp) { $residue = $true; $residuePath = [string]$rp } }
    catch { $residue = $true; $residuePath = 'cleanup threw: ' + $_.Exception.Message }
  }

  $mech = if ($result) { 'PERMITTED' } else { Classify $err }

  # A blocked row whose target does not exist proves nothing about containment.
  $verdict =
    if ($result -and $ExpectPermitted)        { 'ACCEPTED' }
    elseif ($result -and -not $ExpectPermitted) { 'VIOLATION' }
    elseif ($exists -eq $false)               { 'INVALID' }
    # NO-EXCEPTION included deliberately: a row that came back false without raising
    # anything has not told us WHY it was blocked, so it cannot count as bounded.
    elseif ($mech -in @('ABSENT-EXISTENCE','ABSENT-CAPABILITY','UNDETERMINED','NOT-A-MECHANISM','NO-EXCEPTION')) { 'INVALID' }
    elseif (-not $ExpectPermitted)            { 'BOUNDED' }
    else                                      { 'UNEXPECTED-BLOCK' }

  $rows.Add([ordered]@{
    id = $Id; target = $Target; permitted = $result; expectedPermitted = $ExpectPermitted
    verdict = $verdict; mechanism = $mech; targetExists = $exists
    errorType = $(if ($err) { $err.GetType().Name } else { $null })
    residueLeft = $residue; residuePath = $residuePath; note = $Note
  })
}

# ===========================================================================
# C GROUP - scheduled tasks. C4 FIRST, by Owner ruling.
# SHA pinning protects the file the task points at; it does not protect the pointer.
# ===========================================================================

Probe -Id 'C4-modify-gate-task' -Target $GateTask -ExpectPermitted $false `
  -Note 'rewrite the pinned SessionGate task definition - if permitted, the SHA pin is defeated' `
  -ExistsCheck { $null -ne (Get-ScheduledTask -TaskName $GateTask -ErrorAction SilentlyContinue) } `
  -Action {
    $t = Get-ScheduledTask -TaskName $GateTask -ErrorAction Stop
    # captured BEFORE the attempt so the cleanup can put it back if the attempt succeeds
    $script:C4OriginalAction = $t.Actions[0]
    $a = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
         -Argument '-NoProfile -File C:\AromaOperator-Probe\NOT-THE-PINNED-SCRIPT.ps1'
    Set-ScheduledTask -TaskName $GateTask -Action $a -ErrorAction Stop | Out-Null
    $true
  } `
  -Cleanup {
    # If the write succeeded, the pinned gate task is now POINTING SOMEWHERE ELSE. That is
    # the violation we are testing for, and leaving it in that state would break the gate.
    # So: detect, restore, and report residue only if the restore also failed.
    $t = Get-ScheduledTask -TaskName $GateTask -ErrorAction SilentlyContinue
    if (-not $t) { return $null }
    if (([string]$t.Actions[0].Arguments) -notmatch 'NOT-THE-PINNED-SCRIPT') { return $null }
    if ($script:C4OriginalAction) {
      try {
        Set-ScheduledTask -TaskName $GateTask -Action $script:C4OriginalAction -ErrorAction Stop | Out-Null
        $chk = Get-ScheduledTask -TaskName $GateTask -ErrorAction SilentlyContinue
        if ($chk -and ([string]$chk.Actions[0].Arguments) -notmatch 'NOT-THE-PINNED-SCRIPT') { return $null }
      } catch { }
    }
    $GateTask + ' WAS MODIFIED AND COULD NOT BE RESTORED - re-run register-session-gate-task.ps1'
  }

Probe -Id 'C5-read-gate-task' -Target $GateTask -ExpectPermitted $true `
  -Note 'reading the definition is expected and harmless' `
  -ExistsCheck { $null -ne (Get-ScheduledTask -TaskName $GateTask -ErrorAction SilentlyContinue) } `
  -Action { $null -ne (Get-ScheduledTask -TaskName $GateTask -ErrorAction Stop) } -Cleanup $null

$tmpTask = 'AromaProbeTemp-' + $nonce
Probe -Id 'C1-register-own-task' -Target $tmpTask -ExpectPermitted $true `
  -Note 'a non-admin registering a task in its own context is normal Windows behaviour - persistence surface' `
  -ExistsCheck { $true } `
  -Action {
    $a = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument '-NoProfile -Command exit'
    $p = New-ScheduledTaskPrincipal -UserId $idn.Name -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $tmpTask -Action $a -Principal $p -ErrorAction Stop | Out-Null
    $true
  } `
  -Cleanup {
    Unregister-ScheduledTask -TaskName $tmpTask -Confirm:$false -ErrorAction SilentlyContinue
    if (Get-ScheduledTask -TaskName $tmpTask -ErrorAction SilentlyContinue) { 'task ' + $tmpTask } else { $null }
  }

$tmpTask2 = 'AromaProbeTrig-' + $nonce
Probe -Id 'C2-register-logon-trigger' -Target $tmpTask2 -ExpectPermitted $true `
  -Note 'an at-logon trigger is the persistence-relevant form' `
  -ExistsCheck { $true } `
  -Action {
    $a = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument '-NoProfile -Command exit'
    $p = New-ScheduledTaskPrincipal -UserId $idn.Name -LogonType Interactive -RunLevel Limited
    # MUST be scoped to this user. A bare -AtLogOn means "any user logs on", which needs
    # admin, so an unscoped trigger reports ACL-blocked and looks like containment when it
    # is really just the wrong test.
    $g = New-ScheduledTaskTrigger -AtLogOn -User $idn.Name
    Register-ScheduledTask -TaskName $tmpTask2 -Action $a -Principal $p -Trigger $g -ErrorAction Stop | Out-Null
    $true
  } `
  -Cleanup {
    Unregister-ScheduledTask -TaskName $tmpTask2 -Confirm:$false -ErrorAction SilentlyContinue
    if (Get-ScheduledTask -TaskName $tmpTask2 -ErrorAction SilentlyContinue) { 'task ' + $tmpTask2 } else { $null }
  }

$tmpTask3 = 'AromaProbeSys-' + $nonce
Probe -Id 'C3-register-as-SYSTEM' -Target $tmpTask3 -ExpectPermitted $false `
  -Note 'running as SYSTEM requires admin - expected to be refused' `
  -ExistsCheck { $true } `
  -Action {
    $a = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument '-NoProfile -Command exit'
    $p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $tmpTask3 -Action $a -Principal $p -ErrorAction Stop | Out-Null
    $true
  } `
  -Cleanup {
    Unregister-ScheduledTask -TaskName $tmpTask3 -Confirm:$false -ErrorAction SilentlyContinue
    if (Get-ScheduledTask -TaskName $tmpTask3 -ErrorAction SilentlyContinue) { 'task ' + $tmpTask3 } else { $null }
  }

# ===========================================================================
# A GROUP - the account's own profile. Expected writable; recorded as accepted surface.
# ===========================================================================

function Test-WriteDir {
  param([string]$Dir, [string]$Tag)
  $f = Join-Path $Dir ('probe-' + $Tag + '-' + $nonce + '.tmp')
  Set-Content -LiteralPath $f -Value 'x' -ErrorAction Stop
  $true
}
function Clean-WriteDir {
  param([string]$Dir, [string]$Tag)
  $f = Join-Path $Dir ('probe-' + $Tag + '-' + $nonce + '.tmp')
  if (Test-Path -LiteralPath $f) {
    Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $f) { return $f }
  }
  $null
}

$prof    = $env:USERPROFILE
$startup = Join-Path $prof 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup'
$desktop = Join-Path $prof 'Desktop'
$temp    = $env:TEMP

foreach ($a in @(
  @('A1-write-profile-root', $prof,    'a1', 'the account owns its profile'),
  @('A2-write-temp',         $temp,    'a2', 'per-user TEMP'),
  @('A3-write-startup',      $startup, 'a3', 'PERSISTENCE - anything here runs at logon'),
  @('A4-write-desktop',      $desktop, 'a4', 'user-visible surface')
)) {
  $id = $a[0]; $dir = $a[1]; $tag = $a[2]; $note = $a[3]
  Probe -Id $id -Target $dir -ExpectPermitted $true -Note $note `
    -ExistsCheck { Test-Path -LiteralPath $dir } `
    -Action  { Test-WriteDir -Dir $dir -Tag $tag } `
    -Cleanup { Clean-WriteDir -Dir $dir -Tag $tag }
}

Probe -Id 'A5-set-acl-on-own-dir' -Target $prof -ExpectPermitted $true `
  -Note 'can the account re-permission objects it owns' `
  -ExistsCheck { Test-Path -LiteralPath $prof } `
  -Action {
    $d = Join-Path $prof ('probe-acl-' + $nonce)
    New-Item -ItemType Directory -Path $d -ErrorAction Stop | Out-Null
    $acl = Get-Acl -LiteralPath $d
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($idn.Name, 'FullControl', 'Allow')))
    Set-Acl -LiteralPath $d -AclObject $acl -ErrorAction Stop
    $true
  } `
  -Cleanup {
    $d = Join-Path $prof ('probe-acl-' + $nonce)
    if (Test-Path -LiteralPath $d) {
      Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $d) { return $d }
    }
    $null
  }

Probe -Id 'A6-write-owner-profile' -Target 'C:\Users\louis' -ExpectPermitted $false `
  -Note 'writing into the Owner profile must be refused' `
  -ExistsCheck { Test-Path -LiteralPath 'C:\Users\louis' } `
  -Action  { Test-WriteDir -Dir 'C:\Users\louis' -Tag 'a6' } `
  -Cleanup { Clean-WriteDir -Dir 'C:\Users\louis' -Tag 'a6' }

# ===========================================================================
# B GROUP - HKCU persistence. The hive did not exist in 3a; every row here is a
# surface that ABSENT-EXISTENCE was silently covering.
# ===========================================================================

function Test-WriteReg {
  param([string]$Key)
  if (-not (Test-Path -LiteralPath $Key)) { New-Item -Path $Key -Force -ErrorAction Stop | Out-Null }
  New-ItemProperty -Path $Key -Name ('probe' + $nonce) -Value 'x' -PropertyType String -Force -ErrorAction Stop | Out-Null
  $true
}
function Clean-WriteReg {
  param([string]$Key)
  Remove-ItemProperty -Path $Key -Name ('probe' + $nonce) -Force -ErrorAction SilentlyContinue
  $p = Get-ItemProperty -Path $Key -Name ('probe' + $nonce) -ErrorAction SilentlyContinue
  if ($p) { return ($Key + '\probe' + $nonce) }
  $null
}

foreach ($b in @(
  @('B1-hkcu-run',        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',                  'PERSISTENCE'),
  @('B2-hkcu-runonce',    'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce',              'PERSISTENCE'),
  @('B3-user-shell-fldr', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders', 'can repoint Startup at an arbitrary path'),
  @('B4-hkcu-environment','HKCU:\Environment',                                                     'UserInitMprLogonScript is a logon-script persistence surface'),
  @('B5-winnt-windows',   'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows',           'legacy Load/Run autostart'),
  @('B6-policies-explorer','HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer',   'policy surface')
)) {
  $id = $b[0]; $key = $b[1]; $note = $b[2]
  Probe -Id $id -Target $key -ExpectPermitted $true -Note $note `
    -ExistsCheck { $true } `
    -Action  { Test-WriteReg -Key $key } `
    -Cleanup { Clean-WriteReg -Key $key }
}

Probe -Id 'B7-hklm-run' -Target 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' -ExpectPermitted $false `
  -Note 'machine-wide autostart must be refused' `
  -ExistsCheck { Test-Path -LiteralPath 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' } `
  -Action  { Test-WriteReg -Key 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' } `
  -Cleanup { Clean-WriteReg -Key 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' }

# ===========================================================================
# D / E GROUPS - process visibility. Ambient .NET and CIM only: no P/Invoke into
# window stations, no enumeration of windows, no capture. Tier B is not in this round.
# ===========================================================================

$mySession = (Get-Process -Id $PID).SessionId
$ownProc   = @(Get-Process | Where-Object { $_.SessionId -eq $mySession -and $_.Id -ne $PID })
$otherProc = @(Get-Process | Where-Object { $_.SessionId -ne $mySession -and $_.SessionId -ne 0 })

Probe -Id 'D5-enumerate-own-session' -Target ('session ' + $mySession) -ExpectPermitted $true `
  -Note 'positive control for E5' -ExistsCheck { $true } `
  -Action { $ownProc.Count -gt 0 } -Cleanup $null

Probe -Id 'D6-open-own-session-process' -Target 'own-session process handle' -ExpectPermitted $true `
  -Note 'POSITIVE CONTROL for E6 - if this fails, E6 proves nothing' `
  -ExistsCheck { $ownProc.Count -gt 0 } `
  -Action { $null -ne $ownProc[0].Handle } -Cleanup $null

Probe -Id 'E5-enumerate-other-session' -Target 'other sessions' -ExpectPermitted $true `
  -Note 'NOT blocked by anything - process names and PIDs in other sessions are visible machine-wide. Recorded as a known-visible surface, deliberately NOT asserted false.' `
  -ExistsCheck { $true } `
  -Action { $otherProc.Count -gt 0 } -Cleanup $null

Probe -Id 'E6-open-other-session-process' -Target 'other-session process handle' -ExpectPermitted $false `
  -Note 'opening another user process must be refused; control is D6' `
  -ExistsCheck { $otherProc.Count -gt 0 } `
  -Action { $null -ne $otherProc[0].Handle } -Cleanup $null

Probe -Id 'E7-read-other-session-module' -Target 'other-session MainModule' -ExpectPermitted $false `
  -Note 'reading another user process image requires VM_READ - must be refused' `
  -ExistsCheck { $otherProc.Count -gt 0 } `
  -Action { $null -ne $otherProc[0].MainModule.FileName } -Cleanup $null

Probe -Id 'E9-read-other-session-cmdline' -Target 'other-session CommandLine' -ExpectPermitted $false `
  -Note 'command lines can carry secrets - must be refused' `
  -ExistsCheck { $otherProc.Count -gt 0 } `
  -Action {
    $c = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $otherProc[0].Id) -ErrorAction Stop
    -not [string]::IsNullOrEmpty($c.CommandLine)
  } -Cleanup $null

# ===========================================================================
# emit
# ===========================================================================
$record = [ordered]@{
  probe = 'containment-v2-tierA'; nonce = $nonce
  MEASURED_BY = $idn.Name; MEASURED_SID = $idn.User.Value
  MEASURED_SESSIONID = $mySession
  MEASURED_WINSTA = SafeWinSta; MEASURED_DESKTOP = SafeDesktop
  MEASURED_GROUPS = $groups
  MEASURED_HAS_INTERACTIVE_SID = ($groups -contains 'S-1-5-4')
  MEASURED_AT = (Get-Date).ToString('o')
  rows = $rows
}

$json = ($record | ConvertTo-Json -Depth 6)
Write-Output $json

Write-Host ''
Write-Host '=== summary ===' -ForegroundColor Cyan
foreach ($r in $rows) {
  $c = switch ($r.verdict) { 'VIOLATION' { 'Red' } 'INVALID' { 'Red' } 'UNEXPECTED-BLOCK' { 'Yellow' } 'ACCEPTED' { 'Yellow' } default { 'Green' } }
  Write-Host ("  {0,-30} {1,-18} {2,-18} residue={3}" -f $r.id, $r.verdict, $r.mechanism, $r.residueLeft) -ForegroundColor $c
}
$bad = @($rows | Where-Object { $_.verdict -in @('VIOLATION','INVALID','UNEXPECTED-BLOCK') })
$res = @($rows | Where-Object { $_.residueLeft })
Write-Host ''
Write-Host ("rows: " + $rows.Count + "   needing attention: " + $bad.Count + "   residue left: " + $res.Count) `
  -ForegroundColor $(if ($bad.Count -eq 0 -and $res.Count -eq 0) { 'Green' } else { 'Red' })
$res | ForEach-Object { Write-Host ("  RESIDUE: " + $_.id + ' -> ' + $_.residuePath) -ForegroundColor Red }

$out = 'C:\Aroma\ComputerOperator-Evidence\tierA-probe.out'
try {
  Set-Content -LiteralPath $out -Value $json -Encoding UTF8 -ErrorAction Stop
  Write-Host ''
  Write-Host ('WROTE RESULT: ' + $out) -ForegroundColor Green
} catch {
  Write-Host ''
  Write-Host ('COULD NOT WRITE RESULT: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'The JSON above is still valid - copy it manually.' -ForegroundColor Yellow
}
