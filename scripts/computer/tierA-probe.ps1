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

# ── THE ASSERTION REGISTER ───────────────────────────────────────────────────
# This probe may not DEFINE an assertion. expectedPermitted comes from the register, and the
# target it measures is CHECKED against the register rather than trusted. See
# assertionRegistry.ps1 for why: an id whose meaning can change unnoticed makes every other
# id unverified too.
. (Join-Path $PSScriptRoot 'probeIdentityGate.ps1')
. (Join-Path $PSScriptRoot 'assertionRegistry.ps1')
try { [void](Import-AssertionRegistry) } catch {
  Write-Host ("HALTED: " + $_.Exception.Message) -ForegroundColor Red
  exit 13
}

# ── GATE A: IDENTITY ─────────────────────────────────────────────────────────
# This probe deliberately attempts writes, registers scheduled tasks and touches the
# SessionGate definition. Running it as the Owner would do all of that in the Owner's own
# profile and hive. It may only run as the Companion account.
if (-not (Test-ProbeIdentity -Script 'tierA-probe.ps1' -EvidenceDir 'C:\Aroma\ComputerOperator-Evidence')) { exit 15 }

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
    [string]$Note,
    [scriptblock]$ExistsCheck,
    [scriptblock]$Action,
    [scriptblock]$Cleanup
  )
  # expectedPermitted is NOT a parameter. It is the register's, so a call site cannot flip
  # what an assertion claims without the register saying so.
  $reg = Resolve-AssertionRow -Id $Id -Target $Target
  $ExpectPermitted = $reg.expectedPermitted
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

  # A row that disagrees with the register is REFUSED, not tidied into a passing one. It is
  # kept and marked, because the fact that something tried to emit it is the evidence.
  if (-not $reg.known -or @($reg.drift).Count -gt 0) { $verdict = 'INVALID'; $mech = 'REGISTRY-DRIFT' }

  $rows.Add([ordered]@{
    id = $Id; target = $Target; permitted = $result; expectedPermitted = $ExpectPermitted
    accessMask = $reg.accessMask
    verdict = $verdict; mechanism = $mech; targetExists = $exists
    errorType = $(if ($err) { $err.GetType().Name } else { $null })
    residueLeft = $residue; residuePath = $residuePath; note = $Note
    registryDrift = @($reg.drift)
    implies = $reg.implies; doesNotImply = $reg.doesNotImply
  })
}

# ===========================================================================
# C GROUP - scheduled tasks. C4 FIRST, by Owner ruling.
# SHA pinning protects the file the task points at; it does not protect the pointer.
# ===========================================================================

# The SessionGate task is the ONLY approved route into session 5. Damaging it does not
# just fail a row, it removes 3b's only mechanism. So C4 is wrapped in a full
# export / compare / restore / re-verify cycle, and the probe HALTS if it cannot prove the
# task was left exactly as it was found.
#
# Backing up only the action was not enough: an overwrite can disturb triggers, principal
# or settings too, and restoring one field would leave the others silently changed.
# The unit of backup is therefore the complete task XML, compared byte for byte.

function HashString {
  param([string]$s)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)) | ForEach-Object { $_.ToString('x2') }) -join '' }
  finally { $sha.Dispose() }
}
function ExportGate {
  try { (Export-ScheduledTask -TaskName $GateTask -ErrorAction Stop | Out-String) } catch { $null }
}

$EvidenceDir      = 'C:\Aroma\ComputerOperator-Evidence'
$gateBackupPath   = Join-Path $EvidenceDir ('sessiongate-backup-' + $nonce + '.xml')
$gateXmlBefore    = ExportGate
$gateHashBefore   = if ($gateXmlBefore) { HashString $gateXmlBefore } else { $null }
$gateBackupWritten = $false
$script:Incident  = $null

if ($gateXmlBefore) {
  try {
    Set-Content -LiteralPath $gateBackupPath -Value $gateXmlBefore -Encoding UTF8 -ErrorAction Stop
    $gateBackupWritten = $true
  } catch { $gateBackupWritten = $false }
}

# NO BASELINE, NO ATTEMPT. Attempting a destructive write with nothing to restore from is
# how a measurement becomes an outage. If the export or its backup failed, C4 is recorded
# as INVALID and skipped rather than risked.
$c4Safe = ($null -ne $gateXmlBefore) -and $gateBackupWritten

if (-not $c4Safe) {
  # Even the skipped row takes its expectation from the register - a hand-written $false
  # here would be a second definition of C4, which is the thing this register exists to stop.
  $c4reg = Resolve-AssertionRow -Id 'C4-modify-gate-task' -Target $GateTask
  $rows.Add([ordered]@{
    id = 'C4-modify-gate-task'; target = $GateTask; permitted = $false; expectedPermitted = $c4reg.expectedPermitted
    accessMask = $c4reg.accessMask
    verdict = 'INVALID'; mechanism = 'NO-BASELINE'; targetExists = ($null -ne $gateXmlBefore)
    errorType = $null; residueLeft = $false; residuePath = $null
    note = 'SKIPPED - could not export the task and write a backup, so a failed restore would be unrecoverable. Not attempted by design.'
  })
} else {
  Probe -Id 'C4-modify-gate-task' -Target $GateTask `
    -Note 'rewrite the pinned SessionGate task definition - if permitted, the SHA pin is defeated because the pin binds the FILE, not the pointer to it' `
    -ExistsCheck { $null -ne (Get-ScheduledTask -TaskName $GateTask -ErrorAction SilentlyContinue) } `
    -Action {
      $a = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
           -Argument '-NoProfile -File C:\AromaOperator-Probe\NOT-THE-PINNED-SCRIPT.ps1'
      Set-ScheduledTask -TaskName $GateTask -Action $a -ErrorAction Stop | Out-Null
      $true
    } `
    -Cleanup {
      # Runs whether the attempt succeeded or failed - "it threw, so nothing changed" is an
      # assumption, and this is exactly the place not to make one.
      $after = ExportGate
      if ($null -ne $after -and (HashString $after) -eq $gateHashBefore) { return $null }

      # differs: restore the WHOLE definition from the backup XML, not one field
      try { Register-ScheduledTask -TaskName $GateTask -Xml $gateXmlBefore -Force -ErrorAction Stop | Out-Null } catch { }

      $third = ExportGate
      if ($null -ne $third -and (HashString $third) -eq $gateHashBefore) {
        return ('task was modified and was RESTORED from ' + $gateBackupPath)
      }
      $script:Incident = 'C4 modified the SessionGate task and the restore did not reproduce the original XML'
      ('CONTAINMENT-INCIDENT - restore failed. Backup XML: ' + $gateBackupPath)
    }
}

# ---------------------------------------------------------------------------
# C4a / C4b - re-verify the gate immediately, whatever C4 returned.
# The SHA pin binds the FILE; C4 measures the POINTER. Both have to line up, so both are
# checked here rather than one being inferred from the other.
# ---------------------------------------------------------------------------
$StagedGateScript = 'C:\Aroma\ComputerOperator-Companion\session-identity.ps1'
$StagedGateSha    = '98A474BC6EC12F2E16D235098C8B323750225FE0BACF23CCBF340632CBF31C67'

Probe -Id 'C4a-gate-action-intact' -Target $GateTask `
  -Note 'the task action must still point at session-identity.ps1' `
  -ExistsCheck { $null -ne (Get-ScheduledTask -TaskName $GateTask -ErrorAction SilentlyContinue) } `
  -Action {
    $t = Get-ScheduledTask -TaskName $GateTask -ErrorAction Stop
    ([string]$t.Actions[0].Arguments) -match 'session-identity\.ps1'
  } -Cleanup $null

Probe -Id 'C4b-gate-script-sha' -Target $StagedGateScript `
  -Note 'and the file it points at must still hash to the pinned value' `
  -ExistsCheck { Test-Path -LiteralPath $StagedGateScript } `
  -Action { (Get-FileHash -LiteralPath $StagedGateScript -Algorithm SHA256 -ErrorAction Stop).Hash -eq $StagedGateSha } `
  -Cleanup $null

# ---------------------------------------------------------------------------
# HALT if the gate could not be put back. The remaining 23 rows are not worth the risk of
# operating against a task whose state is unknown.
# ---------------------------------------------------------------------------
# "cannot read it" is NOT "it is broken". Only treat a gate row as breakage when the
# target demonstrably exists and the check still came back false; an unreadable task is
# unknown state, which is INVALID, not an incident.
$gateIntact = @($rows | Where-Object {
  $_.id -in @('C4a-gate-action-intact','C4b-gate-script-sha') -and
  $_.targetExists -eq $true -and -not $_.permitted
})
if ($script:Incident -or $gateIntact.Count -gt 0) {
  $reason = if ($script:Incident) { $script:Incident } else { 'gate re-verification failed after C4' }
  Write-Host ''
  Write-Host '*** CONTAINMENT-INCIDENT - PROBE HALTED ***' -ForegroundColor Red
  Write-Host ("  " + $reason) -ForegroundColor Red
  Write-Host ("  backup XML : " + $gateBackupPath) -ForegroundColor Yellow
  Write-Host '  Remaining rows were NOT run. Re-run register-session-gate-task.ps1 elevated.' -ForegroundColor Yellow
  $incidentRecord = [ordered]@{
    probe = 'containment-v2-tierA'; nonce = $nonce; HALTED = $true
    incident = $reason
    gateBackupPath = $gateBackupPath; gateHashBefore = $gateHashBefore
    MEASURED_BY = $idn.Name; MEASURED_SID = $idn.User.Value
    MEASURED_SESSIONID = (Get-Process -Id $PID).SessionId
    MEASURED_AT = (Get-Date).ToString('o')
    rows = $rows
  }
  $ij = ($incidentRecord | ConvertTo-Json -Depth 6)
  Write-Output $ij
  try { Set-Content -LiteralPath (Join-Path $EvidenceDir ('tierA-INCIDENT-' + $nonce + '.json')) -Value $ij -Encoding UTF8 -ErrorAction Stop } catch { }
  exit 9
}

Probe -Id 'C5-read-gate-task' -Target $GateTask `
  -Note 'reading the definition is expected and harmless' `
  -ExistsCheck { $null -ne (Get-ScheduledTask -TaskName $GateTask -ErrorAction SilentlyContinue) } `
  -Action { $null -ne (Get-ScheduledTask -TaskName $GateTask -ErrorAction Stop) } -Cleanup $null

# ===========================================================================
# THE OBSERVER TASK - C6 / C7 / C8 / C9
#
# ADDED 2026-07-29, AND IT SHOULD HAVE EXISTED ALREADY. register-observer-task.ps1 exports
# observer-task-baseline.xml and its own closing note asks for "an observer-task row in the
# Tier A probe to diff against this". That row was never added, so the baseline was written
# and NOTHING EVER READ IT. The write-up at the time said the C4 gap was "now covered for
# this task too". It was not. A baseline with no reader is a file, not a control.
#
# C8 is the row that would have caught the stale pin: the observer SHA lives in the task
# DESCRIPTION, Task Scheduler verifies nothing, and observer.ps1 changed underneath it.
# ===========================================================================
$ObserverTask = 'AromaComputerOperator-Observer'
# $PSScriptRoot, not a hardcoded path: this probe RUNS FROM the probe directory, so the
# staged observer is its own sibling. A literal would be a second definition of where the
# staged copy lives, and would silently measure the wrong file if the directory ever moved.
$ObserverScript = Join-Path $PSScriptRoot 'observer.ps1'
$ObserverBaseline = Join-Path $EvidenceDir 'observer-task-baseline.xml'

function ExportTask { param([string]$Name) try { (Export-ScheduledTask -TaskName $Name -ErrorAction Stop | Out-String) } catch { $null } }

Probe -Id 'C6-observer-task-pointer' -Target $ObserverTask `
  -Note 'the task action must still name observer.ps1 - a SHA pin binds the FILE, not the pointer to it' `
  -ExistsCheck { $null -ne (Get-ScheduledTask -TaskName $ObserverTask -ErrorAction SilentlyContinue) } `
  -Action {
    $t = Get-ScheduledTask -TaskName $ObserverTask -ErrorAction Stop
    ([string]$t.Actions[0].Arguments) -match 'observer\.ps1'
  } -Cleanup $null

# A MISSING baseline is not a pass. ExistsCheck false makes the row INVALID, which is the
# correct reading of "there was nothing to compare against".
Probe -Id 'C7-observer-task-xml-baseline' -Target 'observer-task-baseline.xml' `
  -Note 'the WHOLE definition, not just the action: an overwrite can disturb triggers, principal or settings silently' `
  -ExistsCheck { Test-Path -LiteralPath $ObserverBaseline } `
  -Action {
    $now = ExportTask -Name $ObserverTask
    if (-not $now) { return $false }
    $was = Get-Content -LiteralPath $ObserverBaseline -Raw -ErrorAction Stop
    (HashString $now) -eq (HashString $was)
  } -Cleanup $null

# THE STALE-PIN ROW. Compares the staged file against the SHA recorded in the description.
# It is a RECORD check and says so: nothing reads that string at run time, so a mismatch does
# not stop the task - it only means the record has stopped describing the file.
Probe -Id 'C8-observer-script-sha-matches-pin' -Target $ObserverScript `
  -Note 'RECORD check, not enforcement: Task Scheduler verifies no hash. This catches the pin going stale, which it did, unnoticed.' `
  -ExistsCheck { (Test-Path -LiteralPath $ObserverScript) -and ($null -ne (Get-ScheduledTask -TaskName $ObserverTask -ErrorAction SilentlyContinue)) } `
  -Action {
    $t = Get-ScheduledTask -TaskName $ObserverTask -ErrorAction Stop
    $desc = [string]$t.Description
    if ($desc -notmatch '([A-Fa-f0-9]{64})') { return $false }
    $pinned = $Matches[1]
    $actual = (Get-FileHash -LiteralPath $ObserverScript -Algorithm SHA256 -ErrorAction Stop).Hash
    $actual -eq $pinned
  } -Cleanup $null

# C9 - the destructive one, with the SAME discipline as C4: export, back up, attempt,
# compare, restore, re-verify. NO BASELINE, NO ATTEMPT.
$obsXmlBefore = ExportTask -Name $ObserverTask
$obsBackupPath = Join-Path $EvidenceDir ('observertask-backup-' + $nonce + '.xml')
$obsHashBefore = if ($obsXmlBefore) { HashString $obsXmlBefore } else { $null }
$obsBackupWritten = $false
if ($obsXmlBefore) {
  try { Set-Content -LiteralPath $obsBackupPath -Value $obsXmlBefore -Encoding UTF8 -ErrorAction Stop; $obsBackupWritten = $true } catch { $obsBackupWritten = $false }
}

if (-not ($obsXmlBefore -and $obsBackupWritten)) {
  $c9reg = Resolve-AssertionRow -Id 'C9-modify-observer-task' -Target $ObserverTask
  $rows.Add([ordered]@{
    id = 'C9-modify-observer-task'; target = $ObserverTask; permitted = $false
    expectedPermitted = $c9reg.expectedPermitted; accessMask = $c9reg.accessMask
    verdict = 'INVALID'; mechanism = 'NO-BASELINE'; targetExists = ($null -ne $obsXmlBefore)
    errorType = $null; residueLeft = $false; residuePath = $null
    note = 'SKIPPED - could not export the task and write a backup, so a failed restore would be unrecoverable. Not attempted by design.'
    registryDrift = @($c9reg.drift); implies = $c9reg.implies; doesNotImply = $c9reg.doesNotImply
  })
} else {
  Probe -Id 'C9-modify-observer-task' -Target $ObserverTask `
    -Note 'repoint the Observer task at another script - C4 proved this for the SessionGate task, and that result does NOT transfer to a task that did not exist when C4 was measured' `
    -ExistsCheck { $null -ne (Get-ScheduledTask -TaskName $ObserverTask -ErrorAction SilentlyContinue) } `
    -Action {
      $a = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
           -Argument '-NoProfile -File C:\AromaOperator-Probe\NOT-THE-PINNED-OBSERVER.ps1'
      Set-ScheduledTask -TaskName $ObserverTask -Action $a -ErrorAction Stop | Out-Null
      $true
    } `
    -Cleanup {
      # Runs whether the attempt succeeded or failed - "it threw, so nothing changed" is an
      # assumption, and this is exactly the place not to make one.
      $after = ExportTask -Name $ObserverTask
      if ($null -ne $after -and (HashString $after) -eq $obsHashBefore) { return $null }
      try { Register-ScheduledTask -TaskName $ObserverTask -Xml $obsXmlBefore -Force -ErrorAction Stop | Out-Null } catch { }
      $third = ExportTask -Name $ObserverTask
      if ($null -ne $third -and (HashString $third) -eq $obsHashBefore) {
        return ('observer task was modified and was RESTORED from ' + $obsBackupPath)
      }
      $script:Incident = 'C9 modified the Observer task and the restore did not reproduce the original XML'
      ('CONTAINMENT-INCIDENT - restore failed. Backup XML: ' + $obsBackupPath)
    }
}

$tmpTask = 'AromaProbeTemp-' + $nonce
Probe -Id 'C1-register-own-task' -Target $tmpTask `
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
Probe -Id 'C2-register-logon-trigger' -Target $tmpTask2 `
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
Probe -Id 'C3-register-as-SYSTEM' -Target $tmpTask3 `
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
  Probe -Id $id -Target $dir -Note $note `
    -ExistsCheck { Test-Path -LiteralPath $dir } `
    -Action  { Test-WriteDir -Dir $dir -Tag $tag } `
    -Cleanup { Clean-WriteDir -Dir $dir -Tag $tag }
}

Probe -Id 'A5-set-acl-on-own-dir' -Target $prof `
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

Probe -Id 'A6-write-owner-profile' -Target 'C:\Users\louis' `
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
  @('B5-winnt-windows',   'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows',           'legacy Load/Run autostart')
)) {
  $id = $b[0]; $key = $b[1]; $note = $b[2]
  Probe -Id $id -Target $key -Note $note `
    -ExistsCheck { $true } `
    -Action  { Test-WriteReg -Key $key } `
    -Cleanup { Clean-WriteReg -Key $key }
}

# B6 EXPECTATION CORRECTED. It was first written as expect-permitted and came back
# UNEXPECTED-BLOCK, which meant the model of the system was wrong somewhere - so it was
# measured rather than left as an unexplained green:
#
#   HKCU\Software\Microsoft\Windows\CurrentVersion\Policies
#     owner : BUILTIN\Administrators
#     user  : ReadKey  (read only)
#   creating the Explorer subkey -> UnauthorizedAccessException, "access ... is denied"
#
# Windows deliberately makes the per-user Policies key admin-owned and read-only to the
# user, precisely so a user cannot set their own policy. That is a real ACL boundary and
# durable, so the correct expectation is NOT permitted.
Probe -Id 'B6-policies-explorer' -Target 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer' `
  -Note 'per-user Policies key is Administrators-owned and read-only to the user by Windows design - creating a subkey is refused' `
  -ExistsCheck { Test-Path -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies' } `
  -Action  { Test-WriteReg -Key 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer' } `
  -Cleanup { Clean-WriteReg -Key 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer' }

Probe -Id 'B7-hklm-run' -Target 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' `
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

Probe -Id 'D5-enumerate-own-session' -Target ('session ' + $mySession) `
  -Note 'positive control for E5' -ExistsCheck { $true } `
  -Action { $ownProc.Count -gt 0 } -Cleanup $null

Probe -Id 'D6-open-own-session-process' -Target 'own-session process handle' `
  -Note 'POSITIVE CONTROL for E6 - if this fails, E6 proves nothing' `
  -ExistsCheck { $ownProc.Count -gt 0 } `
  -Action { $null -ne $ownProc[0].Handle } -Cleanup $null

Probe -Id 'E5-enumerate-other-session' -Target 'other sessions' `
  -Note 'NOT blocked by anything - process names and PIDs in other sessions are visible machine-wide. Recorded as a known-visible surface, deliberately NOT asserted false.' `
  -ExistsCheck { $true } `
  -Action { $otherProc.Count -gt 0 } -Cleanup $null

# E6 / E7 / E9 ARE NOT MEASURED HERE - Owner ruling, 2026-07-28.
#
# They were attempted in the first Tier A build and came back INVALID with mechanism
# NO-EXCEPTION or UNDETERMINED: .Handle and Win32_Process return null for another
# session's process WITHOUT raising anything, so the probe learned that it was blocked but
# not WHY. "Blocked, reason unknown" is not containment, and a row that cannot name its
# mechanism must never be scored as one.
#
# They join E1/E2/E3/E4/E8 in Tier B, to be verified during 3b acceptance with a real
# capability present and BOTH a positive and a negative sentinel - a negative result alone
# proves nothing when the prober may simply be incapable.
# DERIVED FROM THE REGISTER, not hand-written. The previous hand-written list is how a
# ninth Tier B assertion (E10) and a tenth (E6b) could exist in the harness while this list
# still said eight - the same class of defect as the row count that was quoted as 24, 26 and
# 23 on three different days. Each entry carries the positive control the register demands,
# so "deferred" cannot quietly mean "deferred and uncontrolled".
$DeferredToTierB = @(
  Get-AssertionsByTier -Tier 'B' | Where-Object { -not $_.expectedPermitted } | ForEach-Object {
    @{ id = $_.id; why = 'Tier B: needs real capability in session 5'; positiveControlId = $_.positiveControlId
       accessMask = $_.accessMask; doesNotImply = $_.doesNotImply }
  }
)

# ===========================================================================
# emit
# ===========================================================================
# ===========================================================================
# COMPOSITE SURFACES
#
# Every contributing row below is individually ACCEPTED and individually unremarkable.
# Combined they describe a capability that NO SINGLE ROW NAMES, which is exactly how a
# per-row report can be complete and still miss the point. Computed here, in the probe, so
# it cannot be left out of a future write-up.
# ===========================================================================
function RowPermitted {
  param([string]$Id)
  $r = @($rows | Where-Object { $_.id -eq $Id })
  ($r.Count -gt 0 -and $r[0].permitted -eq $true)
}
function RowsPermitted { param([string[]]$Ids) @($Ids | Where-Object { RowPermitted $_ }) }

$storageHave   = RowsPermitted @('A1-write-profile-root','A2-write-temp','A3-write-startup','A4-write-desktop')
$autostartHave = RowsPermitted @('A3-write-startup','C1-register-own-task','C2-register-logon-trigger','B1-hkcu-run','B2-hkcu-runonce','B4-hkcu-environment','B5-winnt-windows')
$boundedIds    = @('A6-write-owner-profile','C3-register-as-SYSTEM','B7-hklm-run','B6-policies-explorer')
$boundsHold    = @($boundedIds | Where-Object { -not (RowPermitted $_) })

$composites = @(
  [ordered]@{
    id         = 'COMPOSITE-1-logon-persistence'
    present    = (($storageHave.Count -gt 0) -and ($autostartHave.Count -gt 0))
    capability = 'store executable content and have it run automatically at its own next logon, without any further approval'
    status     = 'KNOWN AND EXPLICITLY ACCEPTED - Owner ruling 2026-07-28'
    storageVia   = $storageHave
    autostartVia = $autostartHave
    # what this composite CANNOT do. Each is a measured row, not an assurance.
    boundedBy = [ordered]@{
      cannotTouchOwnerProfile = (-not (RowPermitted 'A6-write-owner-profile'))
      cannotRunAsSYSTEM       = (-not (RowPermitted 'C3-register-as-SYSTEM'))
      cannotWriteHKLM         = (-not (RowPermitted 'B7-hklm-run'))
      cannotSetUserPolicy     = (-not (RowPermitted 'B6-policies-explorer'))
      noCredentialsReachable  = 'established by the v1 17/17 set measured in session 5 - see EVIDENCE-002'
      cannotElevate           = 'no privilege row in this set was permitted; the account is non-admin and holds no elevation path'
      crossSessionUnproven    = 'NOT PROVEN either way - see crossSessionContainment below'
    }
    boundsHolding = $boundsHold
  }
)

$registryDrift = Get-AssertionRegistryDrift
$controlProblems = (Test-PositiveControls -Rows $rows.ToArray())

$record = [ordered]@{
  probe = 'containment-v2-tierA'; nonce = $nonce
  registryFingerprint = (Get-AssertionRegistryFingerprint)
  registryDrift = @($registryDrift)
  positiveControlProblems = @($controlProblems)
  # Stated by the probe itself so no report can quietly upgrade it. Cross-session
  # containment is NOT PROVEN until Tier B runs in 3b with real capability and both
  # sentinels. Absence of evidence here is not evidence of isolation.
  crossSessionContainment = 'NOT-PROVEN'
  deferredToTierB = $DeferredToTierB
  composites = $composites
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

Write-Host ''
Write-Host '=== register cross-check ===' -ForegroundColor Cyan
Write-Host ('  fingerprint : ' + (Get-AssertionRegistryFingerprint))
Write-Host ('  id/target/mask drift  : ' + @($registryDrift).Count) -ForegroundColor $(if (@($registryDrift).Count) { 'Red' } else { 'Green' })
Write-Host ('  positive-control gaps : ' + @($controlProblems).Count) -ForegroundColor $(if (@($controlProblems).Count) { 'Red' } else { 'Green' })
foreach ($d in $registryDrift)   { Write-Host ('    DRIFT   : ' + $d) -ForegroundColor Red }
foreach ($c in $controlProblems) { Write-Host ('    CONTROL : ' + $c) -ForegroundColor Red }

Write-Host ''
Write-Host '=== composite surfaces (no single row names these) ===' -ForegroundColor Cyan
foreach ($c in $composites) {
  Write-Host ("  " + $c.id + " : present=" + $c.present) -ForegroundColor $(if ($c.present) { 'Yellow' } else { 'Green' })
  Write-Host ("    capability   : " + $c.capability)
  Write-Host ("    status       : " + $c.status)
  Write-Host ("    storage via  : " + ($c.storageVia -join ', '))
  Write-Host ("    autostart via: " + ($c.autostartVia -join ', '))
  Write-Host ("    bounds holding: " + ($c.boundsHolding -join ', '))
}

Write-Host ''
Write-Host ('cross-session containment : ' + $record.crossSessionContainment) -ForegroundColor Yellow
Write-Host ('  ' + $DeferredToTierB.Count + ' assertions deferred to Tier B / 3b acceptance. Until then this') -ForegroundColor Yellow
Write-Host '  must be reported as NOT PROVEN - never as proven, and never omitted.' -ForegroundColor Yellow

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
