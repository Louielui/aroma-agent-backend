# stage3-topup.ps1 - Phase 3b Part B TOP-UP. Runs in session 5, as AromaOperator.
#
# WHY A SECOND SCRIPT AND NOT A RE-RUN
# Five Tier B assertions were OMITTED from the first harness - not skipped, not merged into
# other rows: E2, E3, E4, E7, E9 were never executed while the table looked four-of-eight
# covered. Nothing may be inferred about them from E1 and E8 holding. E1 uses window
# enumeration and E8 uses screen capture; E2 and E3 test kernel-object namespaces, E4 tests
# window-station clipboard scoping, E9 tests process-token rights. FOUR DIFFERENT
# MECHANISMS. One holding is not evidence for another.
#
# This adds those five, plus:
#   E6b  PROCESS_QUERY_LIMITED_INFORMATION (0x1000). E6's denial of 0x0400 entails denial of
#        any mask CONTAINING it, but 0x1000 is a separate, weaker right that can be granted
#        independently, so no subset argument reaches it. It is asserted on its own.
#   E10  is in the main harness, under its own id, after the E7 collision was corrected.
#
# NO FULL PART A REDO IS NEEDED. None of these depends on the owner sentinel window or the
# owner reference capture. Each needs a positive control INSIDE session 5 - own window
# station, own desktop, own clipboard, own process - and E4 additionally needs one owner-side
# seed, because a clipboard with nothing in it cannot be failed to read.
#
# EVERY ASSERTION ID COMES FROM THE REGISTER. This script may not define one. See
# assertionRegistry.ps1: an E7 collision put PROCESS_TERMINATE under the id for "read another
# session's module" and the row looked covered for a week.
#
# SIDE EFFECTS
#   . opens and closes handles to its OWN window station, desktop and processes
#   . WRITES ITS OWN SESSION'S CLIPBOARD with a nonce, reads it back, and clears it. This is
#     the E4 positive control and there is no other way to make it non-vacuous. It is a
#     write to this session's own clipboard object - not input synthesis, no keystroke, no
#     click, and it never touches another session.
#   . NOTHING is terminated, at any mask, in either direction. Handles are closed at once.

param(
  [string]$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence',
  [string]$ClipNonce,
  [int]$WallClockMs = 300000,
  [string]$RegistryPath,
  # SELF-TEST. Takes no measurements and touches no clipboard: it injects synthetic rows and
  # runs the REAL reporting section, because that is the part that failed. See the block at
  # the end of this file for why the clean path specifically.
  [switch]$SelfTest,
  [ValidateSet('clean', 'pending', 'dirty')][string]$SelfTestMode = 'clean'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'
$WALL_START = Get-Date

# ── EVERY CROSS-BLOCK VARIABLE, INITIALISED BEFORE ANY BRANCH CAN SKIP IT ────
# The measurement section is inside `if (-not $script:Halted)`. Anything it defines is
# therefore UNDEFINED on the halt path, and under Set-StrictMode reading an unset variable is
# a terminating error - so a halt would have crashed the reporting section that exists to
# record the halt. That is the same defect that lost the first real run, on a second path.
$clipAtt = $null
$rowArray = @()
$registryDrift = @()
$controlProblems = @()
$pendingRows = @()
$otherSession = $null

# ── SNAPSHOT THE PARAMETERS BEFORE DOT-SOURCING ANYTHING ────────────────────
# DOT-SOURCING A SCRIPT RUNS ITS param() BLOCK IN THIS SCOPE. assertionRegistry.ps1 declares
# `param([switch]$SelfTest, [string]$RegistryPath)`, so the dot-source below SILENTLY
# OVERWRITES both of ours with its defaults - $false and $null.
#
# MEASURED, not theorised: `stage3-topup.ps1 -SelfTest` ran the FULL REAL MEASUREMENT PATH,
# twice, because $SelfTest was $false by the time the branch was reached. `-RegistryPath` was
# being discarded the same way, here and in stage3-harness.ps1 - that parameter never worked.
#
# THE FIRST ATTEMPTED FIX ALSO FAILED, and instructively: the snapshot was named $SELFTEST,
# which PowerShell treats as THE SAME VARIABLE as $SelfTest because variable names are
# CASE-INSENSITIVE. A name that looks different and is not - exactly the disease this whole
# phase keeps finding, in a new place.
#
# So the source of truth is $PSBoundParameters, which is captured at binding time and cannot
# be reached by a later dot-source at all, and the local is named with an underscore so it is
# genuinely a different name.
$SELF_TEST = ($PSBoundParameters.ContainsKey('SelfTest') -and [bool]$PSBoundParameters['SelfTest'])
$SELF_TEST_MODE = $SelfTestMode
$REGISTRY_PATH = $RegistryPath

. (Join-Path $PSScriptRoot 'assertionRegistry.ps1')
try {
  $regCount = Import-AssertionRegistry -Path $REGISTRY_PATH
} catch {
  Write-Host ("HALTED: " + $_.Exception.Message) -ForegroundColor Red
  exit 13
}

$idn = [Security.Principal.WindowsIdentity]::GetCurrent()
$mySession = (Get-Process -Id $PID).SessionId
$rows = New-Object System.Collections.Generic.List[object]
$nonce = [guid]::NewGuid().ToString('N').Substring(0, 12)
$script:Halted = $null

if ($SELF_TEST) {
  $EvidenceDir = Join-Path ([IO.Path]::GetTempPath()) ('topup-selftest-' + $nonce)
  New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
  Write-Host "=== stage3-topup.ps1 SELF-TEST ($SELF_TEST_MODE) ===" -ForegroundColor Magenta
  Write-Host ("  evidence dir : " + $EvidenceDir)
  Write-Host "  no measurements, no clipboard, no handles - the REPORTING path only"
  Write-Host ""
}

Write-Host "=== Phase 3b Part B TOP-UP ===" -ForegroundColor Cyan
Write-Host ("running as        : " + $idn.Name + "  SessionId=" + $mySession)
Write-Host ("assertion register: " + $regCount + " entries  " + (Get-AssertionRegistryFingerprint))
Write-Host ""

# ── the other session, named by measurement rather than assumed ──────────────
$otherProc = @(Get-Process | Where-Object { $_.SessionId -ne $mySession -and $_.SessionId -ne 0 } | Sort-Object SessionId)
$ownProc = @(Get-Process | Where-Object { $_.SessionId -eq $mySession -and $_.Id -ne $PID })
$otherSession = if (@($otherProc).Count -gt 0) { $otherProc[0].SessionId } else { $null }
Write-Host ("other session     : " + $(if ($null -ne $otherSession) { $otherSession } else { 'NONE VISIBLE' }))
if ($SELF_TEST) {
  # The self-test asserts the reporting path, not the environment. Halting here because this
  # machine has one session would mean the clean path is never exercised - and the clean path
  # is exactly the one that broke.
  $otherSession = 3
} elseif ($null -eq $otherSession) {
  # Not a pass. With no other session running there is nothing to be isolated FROM, and
  # every negative below would be trivially true.
  $script:Halted = 'no other interactive session is present - every cross-session negative would be vacuous'
  Write-Host ("HALTED: " + $script:Halted) -ForegroundColor Red
}
if (-not $SELF_TEST -and @($ownProc).Count -eq 0 -and -not $script:Halted) {
  $script:Halted = 'no other own-session process to use as a positive control'
  Write-Host ("HALTED: " + $script:Halted) -ForegroundColor Red
}

# ── P/Invoke ─────────────────────────────────────────────────────────────────
Add-Type -Namespace T -Name U -MemberDefinition @"
[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr OpenWindowStationW(string name, bool inherit, uint access);
[DllImport("user32.dll", SetLastError=true)] public static extern bool CloseWindowStation(IntPtr h);
[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr OpenDesktopW(string name, uint flags, bool inherit, uint access);
[DllImport("user32.dll", SetLastError=true)] public static extern bool CloseDesktop(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformationW(IntPtr h,int i,System.Text.StringBuilder p,uint n,out uint l);
[DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint a, bool inh, uint pid);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
"@ -ErrorAction SilentlyContinue

# ── THE OBJECT-MANAGER ROUTE, AND WHY THE WIN32 ONE IS NOT USED ──────────────
# E2 was first written against Win32 OpenWindowStation with the path
# \Sessions\N\Windows\WinSta0. That was RUN, and it is INCAPABLE:
#
#   'WinSta0'                      -> opened, and it is OUR OWN station, in every session
#   '\Sessions\<OWN>\Windows\...'  -> ERROR_BAD_PATHNAME (161)   <- our own, still refused
#   '\Sessions\<ABSENT>\Windows\..'-> ERROR_BAD_PATHNAME (161)   <- identical
#
# The call does not accept qualified paths at all, so it cannot tell "isolated" from
# "absent" from "wrong API", and a negative from it would have been vacuous while looking
# like containment. The object manager DOES discriminate - measured:
#
#   \Sessions\<own>\Windows   -> STATUS_SUCCESS
#   \Sessions\<absent>\Windows-> STATUS_OBJECT_PATH_NOT_FOUND   <- ABSENT, never containment
#   \Sessions\<own>           -> STATUS_ACCESS_DENIED           <- a nameable ACL
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NtObj {
  [StructLayout(LayoutKind.Sequential)]
  public struct UNICODE_STRING { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }
  [StructLayout(LayoutKind.Sequential)]
  public struct OBJECT_ATTRIBUTES {
    public int Length; public IntPtr RootDirectory; public IntPtr ObjectName;
    public uint Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService;
  }
  [DllImport("ntdll.dll")] public static extern int NtOpenDirectoryObject(out IntPtr h, uint access, ref OBJECT_ATTRIBUTES oa);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);

  // Returns the raw NTSTATUS. On success the handle is CLOSED IMMEDIATELY - nothing is held.
  public static int TryOpenDirectory(string path, uint access, out bool opened) {
    opened = false;
    UNICODE_STRING us = new UNICODE_STRING();
    us.Length = (ushort)(path.Length * 2);
    us.MaximumLength = (ushort)(us.Length + 2);
    us.Buffer = Marshal.StringToHGlobalUni(path);
    IntPtr pus = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UNICODE_STRING)));
    Marshal.StructureToPtr(us, pus, false);
    OBJECT_ATTRIBUTES oa = new OBJECT_ATTRIBUTES();
    oa.Length = Marshal.SizeOf(typeof(OBJECT_ATTRIBUTES));
    oa.ObjectName = pus;
    oa.Attributes = 0x00000040; // OBJ_CASE_INSENSITIVE
    IntPtr h;
    int st = NtOpenDirectoryObject(out h, access, ref oa);
    if (st == 0) { opened = true; CloseHandle(h); }
    Marshal.FreeHGlobal(pus);
    Marshal.FreeHGlobal(us.Buffer);
    return st;
  }
}
"@ -ErrorAction SilentlyContinue

function ObjName { param($h) $sb = New-Object System.Text.StringBuilder 256; $n = 0; if ([T.U]::GetUserObjectInformationW($h,2,$sb,256,[ref]$n)) { $sb.ToString() } else { $null } }

# NTSTATUS -> mechanism class. ONLY access-denied is containment. Path-not-found means the
# object is not there, and a target that does not exist proves nothing - that is the
# ABSENT-EXISTENCE trap the whole containment set was rebuilt to avoid.
function Classify-Ntstatus {
  param([int]$Status)
  switch ([uint32]$Status) {
    0xC0000022 { 'ACL' }               # STATUS_ACCESS_DENIED
    0xC000003A { 'ABSENT-EXISTENCE' }  # STATUS_OBJECT_PATH_NOT_FOUND
    0xC0000034 { 'ABSENT-EXISTENCE' }  # STATUS_OBJECT_NAME_NOT_FOUND
    default    { 'UNDETERMINED' }
  }
}

function Add-Row {
  param([string]$Id, [string]$Target, $AccessMask = $null, [hashtable]$Data, [string]$Note)
  $reg = Resolve-AssertionRow -Id $Id -Target $Target -AccessMask $AccessMask
  $r = [ordered]@{ id = $Id; target = $Target; expectedPermitted = $reg.expectedPermitted
                   accessMask = $reg.accessMask; note = $Note }
  foreach ($k in $Data.Keys) { $r[$k] = $Data[$k] }
  if (-not $reg.known -or @($reg.drift).Count -gt 0) {
    $r['verdict'] = 'INVALID'; $r['mechanism'] = 'REGISTRY-DRIFT'; $r['registryDrift'] = @($reg.drift)
  }
  $r['implies'] = $reg.implies
  $r['doesNotImply'] = $reg.doesNotImply
  $rows.Add($r)
  $v = if ($r.Contains('verdict')) { $r.verdict } else { '?' }
  $c = switch ($v) { 'BOUNDED' { 'Cyan' } 'ACCEPTED' { 'Cyan' } 'CONTAINMENT-FAILURE' { 'Red' } 'VIOLATION' { 'Red' } default { 'Yellow' } }
  Write-Host ("  {0,-42} {1,-20} {2}" -f $Id, $v, $(if ($r.Contains('mechanism')) { $r.mechanism } else { '' })) -ForegroundColor $c
}

# A negative is only worth recording as BOUNDED when its own control held IN THIS RUN.
function Gate-OnControl {
  param([string]$Verdict, [string]$ControlVerdict)
  if ($Verdict -eq 'BOUNDED' -and $ControlVerdict -ne 'ACCEPTED') { 'INVALID' } else { $Verdict }
}

function Get-Sha256 {
  param([string]$Text)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) | ForEach-Object { $_.ToString('x2') }) -join '') }
  finally { $sha.Dispose() }
}

$startedPath = Join-Path $EvidenceDir ('stage3-topup-STARTED-' + $nonce + '.json')
try {
  Set-Content -LiteralPath $startedPath -Encoding UTF8 -ErrorAction Stop -Value (([ordered]@{
    marker = 'TOPUP-STARTED'; nonce = $nonce; at = (Get-Date).ToString('o')
    measuredBy = $idn.Name; measuredSid = $idn.User.Value
    sessionId = $mySession; otherSession = $otherSession
  }) | ConvertTo-Json -Depth 4)
} catch { Write-Host ("  could not write STARTED marker: " + $_.Exception.Message) -ForegroundColor Yellow }

if ($SELF_TEST) {
  # Synthetic rows in the exact shape Add-Row produces, so the reporting section sees what it
  # sees in production. Ids and targets come from the register, so a rename breaks this too.
  $clipAtt = [pscustomobject]@{ nonce = 'selftestclip'; digest = ('0' * 64); seeded = $true }
  $mk = {
    param([string]$Id, [string]$Target, $Mask, [string]$Verdict, [string]$Mech, [hashtable]$Extra)
    $d = @{ verdict = $Verdict; mechanism = $Mech; residueLeft = $false }
    if ($Extra) { foreach ($k in $Extra.Keys) { $d[$k] = $Extra[$k] } }
    Add-Row -Id $Id -Target $Target -AccessMask $Mask -Note 'self-test synthetic row' -Data $d
  }
  & $mk 'POS-open-own-winsta'  ('\Sessions\' + $mySession + '\Windows') 0x0001 'ACCEPTED' 'PERMITTED' $null
  & $mk 'E2a-open-other-session-winsta-directory' '\Sessions\3\Windows' 0x0001 'ACCEPTED' 'NONE' $null
  & $mk 'POS-read-own-clipboard' 'own session clipboard' $null 'ACCEPTED' 'PERMITTED' $null

  switch ($SELF_TEST_MODE) {
    'clean'   { & $mk 'E4-read-other-session-clipboard' 'session 3 clipboard' $null 'BOUNDED' 'ACL' @{ postRunVerified = $true } }
    'pending' { & $mk 'E4-read-other-session-clipboard' 'session 3 clipboard' $null 'PENDING-VERIFY' 'ACL' @{ pendingVerdict = 'BOUNDED'; requiresPostRunVerify = $true } }
    'dirty'   {
      & $mk 'E4-read-other-session-clipboard' 'session 3 clipboard' $null 'BOUNDED' 'ACL' $null
      # a negative whose control is absent, and a target that disagrees with the register
      & $mk 'E7-read-other-session-module' 'the wrong object entirely' 0x0410 'BOUNDED' 'ACL' $null
    }
  }
} elseif (-not $script:Halted) {
# ── THE BACKSTOP ────────────────────────────────────────────────────────────
# Independent of every variable above. If -SelfTest was bound and control still reached the
# measurement path, something in the flag plumbing is wrong and the correct response is to
# measure NOTHING - not to press on. Twice now, a broken flag let this path run for real in
# the OWNER's session and overwrite the clipboard sentinel. $PSBoundParameters is captured at
# parameter binding and cannot be reached by a dot-source, so it is the one thing here that
# cannot be clobbered.
if ($PSBoundParameters.ContainsKey('SelfTest')) {
  Write-Host ""
  Write-Host "*** REFUSED: -SelfTest was bound, yet the MEASUREMENT path was reached. ***" -ForegroundColor Red
  Write-Host "*** The self-test flag is not plumbed correctly. NOTHING was measured.  ***" -ForegroundColor Red
  exit 14
}
Write-Host "=== measurements ===" -ForegroundColor Cyan

# ═══════════════════════════════════════════════════════════════════════════
# E2 - another session's window-station container
#
# The positive control is THE SAME CALL against our own session's container. That is the
# whole point: the Win32 route failed identically on our own station, which is exactly what
# a vacuous negative looks like from the outside if nobody checks.
# ═══════════════════════════════════════════════════════════════════════════
$DIRECTORY_QUERY     = 0x0001
$DESKTOP_READOBJECTS = 0x0001

$ownStationName = ObjName ([T.U]::GetProcessWindowStation())
$ownDirPath = '\Sessions\' + $mySession + '\Windows'
$pOpened = $false
$pSt = [NtObj]::TryOpenDirectory($ownDirPath, [uint32]$DIRECTORY_QUERY, [ref]$pOpened)
$pv = if ($pOpened) { 'ACCEPTED' } else { 'INVALID' }
Add-Row -Id 'POS-open-own-winsta' -Target $ownDirPath -AccessMask $DIRECTORY_QUERY `
  -Note 'the object-manager route works for this token at this mask' `
  -Data @{ verdict = $pv; mechanism = $(if ($pOpened) { 'PERMITTED' } else { 'UNDETERMINED' })
           ntStatus = ('0x{0:X8}' -f $pSt); ownStationName = $ownStationName; residueLeft = $false }

# ── E2a, AN ACCEPTED SURFACE - NOT A NEGATIVE ───────────────────────────────
# This opens the CONTAINING DIRECTORY, and that directory grants Everyone
# QUERY|TRAVERSE|READ_CONTROL by design. Measured DACL, identical for sessions 0, 3 and 5 and
# for the global \Windows:
#
#   D:(A;;CCDCRC;;;WD)(A;;CCDCLCSWSDRCWDWO;;;SY)(A;;CCDCLCSWSDRCWDWO;;;S-1-5-90-0-N)
#        ^^^^^^ ^^ Everyone
#
# A NON-ADMINISTRATOR token opened another session's copy. That is the ACE working as
# specified. Asserting this false would report a VIOLATION every run against a documented
# world-readable object, and a boundary that cries wolf is worse than no boundary. So it is
# recorded and signed off, exactly like E5 - and the registered E2, the window station
# ITSELF, stays NOT PROVEN because no route to it exists. See the register.
$e2Target = '\Sessions\' + $otherSession + '\Windows'
$e2Opened = $false
$e2St = [NtObj]::TryOpenDirectory($e2Target, [uint32]$DIRECTORY_QUERY, [ref]$e2Opened)
$e2v = if ($e2Opened) { 'ACCEPTED' } else { 'INVALID' }
$e2mech = if ($e2Opened) { 'NONE' } else { Classify-Ntstatus -Status $e2St }
Add-Row -Id 'E2a-open-other-session-winsta-directory' -Target $e2Target -AccessMask $DIRECTORY_QUERY `
  -Note 'ACCEPTED SURFACE, not a negative: Everyone holds QUERY|TRAVERSE|READ_CONTROL on this directory by design. The WinSta0 leaf is NOT reached - see E2, which is registered UNMEASURABLE.' `
  -Data @{ verdict = $e2v; mechanism = $e2mech; ntStatus = ('0x{0:X8}' -f $e2St)
           controlVerdict = $pv; ownStationName = $ownStationName
           leafObjectReached = $false
           leafNtStatus = '0xC0000034 STATUS_OBJECT_NAME_NOT_FOUND - a window station is not a Directory, so this lookup can never find it'
           residueLeft = $false }
# E2 itself is deliberately NOT emitted. The register marks it unmeasurable and crossCheck
# refuses a row under it, because a row would claim a measurement that did not happen.
$e2v = 'NOT-EMITTED'

# ═══════════════════════════════════════════════════════════════════════════
# E3 - a desktop inside that window station
# OpenDesktop operates within the CALLER'S OWN window station, so a desktop in another
# session cannot be named at all by any API this probe has. The row therefore records WHERE
# it stopped and claims nothing about the desktop DACL. A precise NOT-PROVEN is worth more
# than a BOUNDED that would not survive a question.
# ═══════════════════════════════════════════════════════════════════════════
$dname = $null
$hd = [T.U]::OpenDesktopW('Default', 0, $false, [uint32]$DESKTOP_READOBJECTS)
$derr = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
$dv = 'INVALID'; $dmech = 'UNDETERMINED'
if ($hd -ne [IntPtr]::Zero) { $dname = ObjName $hd; [void][T.U]::CloseDesktop($hd); $dv = 'ACCEPTED'; $dmech = 'PERMITTED' }
Add-Row -Id 'POS-open-own-desktop' -Target 'Default (own window station)' -AccessMask $DESKTOP_READOBJECTS `
  -Note 'the call itself works at this mask for this token' `
  -Data @{ verdict = $dv; mechanism = $dmech; resolvedTo = $dname; win32Error = $derr; residueLeft = $false }

$e3Target = '\Sessions\' + $otherSession + '\Windows\WinSta0\Default'
$hd2 = [T.U]::OpenDesktopW($e3Target, 0, $false, [uint32]$DESKTOP_READOBJECTS)
$e3err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
$e3v = 'INVALID'; $e3mech = 'UNDETERMINED'; $e3step = $null
if ($hd2 -ne [IntPtr]::Zero) { [void][T.U]::CloseDesktop($hd2); $e3v = 'VIOLATION'; $e3mech = 'NONE' }
else {
  # 161 ERROR_BAD_PATHNAME is the API refusing the NAME, not the object refusing US. It is
  # not containment and it is not scored as any.
  $e3step = if ($e3err -eq 161) {
    'name - OpenDesktop does not accept a qualified path, so the desktop object was never reached. NOT PROVEN, and not scoreable by this route.'
  } else { 'desktop' }
  if ($e3err -eq 5) { $e3v = 'BOUNDED'; $e3mech = 'ACL' }
}
$e3v = Gate-OnControl -Verdict $e3v -ControlVerdict $dv
Add-Row -Id 'E3-open-other-session-desktop' -Target $e3Target -AccessMask $DESKTOP_READOBJECTS `
  -Note 'blocked-at-step is recorded; a name-level or container-level block says nothing about the desktop object' `
  -Data @{ verdict = $e3v; mechanism = $e3mech; win32Error = $e3err; blockedAtStep = $e3step
           controlVerdict = $dv; residueLeft = $false }

# ═══════════════════════════════════════════════════════════════════════════
# E4 - another session's clipboard
# The positive control WRITES THIS SESSION'S OWN CLIPBOARD and reads it back. There is no
# other way to prove the reader is not blind: a reader that returns nothing from an empty
# clipboard is indistinguishable from one that cannot read at all.
# The negative compares a DIGEST against the owner's attestation. The owner's plaintext is
# never in any file this account can read, so a digest match is unambiguous proof of a leak.
# ═══════════════════════════════════════════════════════════════════════════
$clipAtt = $null
if (-not $ClipNonce) {
  $cands = @(Get-ChildItem -LiteralPath $EvidenceDir -Filter 'stage3-clip-owner-*.json' -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending)
  if ($cands.Count -gt 0) { try { $clipAtt = Get-Content -LiteralPath $cands[0].FullName -Raw | ConvertFrom-Json } catch { } }
} else {
  $p = Join-Path $EvidenceDir ('stage3-clip-owner-' + $ClipNonce + '.json')
  if (Test-Path -LiteralPath $p) { try { $clipAtt = Get-Content -LiteralPath $p -Raw | ConvertFrom-Json } catch { } }
}
$clipAttested = ($null -ne $clipAtt -and $clipAtt.seeded -eq $true -and $clipAtt.digest)

$ownClipNonce = 'AROMA-OWN-CLIP-' + $nonce + '-' + [guid]::NewGuid().ToString('N')
$cv = 'INVALID'; $cmech = 'UNDETERMINED'; $clipBack = $null
try {
  Set-Clipboard -Value $ownClipNonce -ErrorAction Stop
  Start-Sleep -Milliseconds 200
  $clipBack = Get-Clipboard -Raw -ErrorAction Stop
  if ($clipBack -ceq $ownClipNonce) { $cv = 'ACCEPTED'; $cmech = 'PERMITTED' }
} catch { }
Add-Row -Id 'POS-read-own-clipboard' -Target 'own session clipboard' `
  -Note 'seeded and read back in this session; cleared at the end of the run' `
  -Data @{ verdict = $cv; mechanism = $cmech; readBack = ($clipBack -ceq $ownClipNonce); residueLeft = $false }

# The negative: with our own nonce sitting on OUR clipboard, does anything the owner seeded
# reach us?
#
# ── THIS ROW CANNOT SETTLE ITSELF (Owner ruling, 2026-07-29) ─────────────────
# The seed lives on the OWNER's clipboard. Any copy in session 3 between the seed and this
# moment silently replaces it - and THIS PROCESS CANNOT DETECT THAT, because checking would
# mean reading the owner's clipboard, which is the exact thing being tested. So "not found"
# would be true by construction and would score as containment.
#
# Therefore a not-found NEVER becomes BOUNDED here. It is recorded PENDING-VERIFY, carrying
# the verdict it WOULD earn, and only stage3-owner-clip.ps1 -Verify - a second reading of
# the owner clipboard, AFTER this run - can release it. If that step never happens, the row
# stays PENDING-VERIFY, which is visibly unfinished rather than quietly green.
#
# A LEAK is the one thing this row may settle on its own: if we produce the owner's digest,
# we could only have got it from session 3, and nothing later undoes that.
$e4v = 'INVALID'; $e4mech = 'UNDETERMINED'; $e4digest = $null; $e4step = $null; $e4pending = $null
if (-not $clipAttested) {
  $e4v = 'INVALID'; $e4mech = 'UNDETERMINED'
  $e4step = 'no owner clip attestation for this run - nothing was seeded, so failing to find it proves nothing'
} else {
  try { $e4digest = Get-Sha256 -Text ([string](Get-Clipboard -Raw -ErrorAction Stop)) } catch { }
  if ($e4digest -and $e4digest -eq [string]$clipAtt.digest) {
    $e4v = 'CONTAINMENT-FAILURE'; $e4mech = 'NONE'
    $e4step = 'the owner-seeded clipboard string reached this session'
  } else {
    # We did not get it - but nothing here can NAME why. The clipboard is per-window-station,
    # and no route to another session's window station exists (E2 is registered unmeasurable),
    # so there is no measured mechanism to attribute this to. An unexplained block is not
    # containment: UNDETERMINED, and the pending verdict is INVALID rather than BOUNDED.
    $e4mech = 'UNDETERMINED'
    $e4pending = 'INVALID'
    $e4pending = Gate-OnControl -Verdict $e4pending -ControlVerdict $cv
    $e4v = 'PENDING-VERIFY'
    $e4step = 'window-station - the clipboard is per-window-station, so this is E2 mechanism reported again, NOT independent evidence about the clipboard object'
  }
}
if ($e4v -ne 'PENDING-VERIFY') { $e4v = Gate-OnControl -Verdict $e4v -ControlVerdict $cv }
Add-Row -Id 'E4-read-other-session-clipboard' -Target 'session 3 clipboard' `
  -Note 'PENDING-VERIFY until stage3-owner-clip.ps1 -Verify confirms the sentinel was still on the owner clipboard; this process cannot check that without doing the thing E4 forbids' `
  -Data @{ verdict = $e4v; pendingVerdict = $e4pending; mechanism = $e4mech
           requiresPostRunVerify = $true
           resolveWith = '.\stage3-owner-clip.ps1 -Verify -Nonce ' + $(if ($clipAtt) { $clipAtt.nonce } else { '<nonce>' })
           ownerClipAttested = $clipAttested
           ownerNonce = $(if ($clipAtt) { $clipAtt.nonce } else { $null })
           blockedAtStep = $e4step; controlVerdict = $cv; residueLeft = $false }

try { Set-Clipboard -Value ' ' -ErrorAction SilentlyContinue } catch { }

# ═══════════════════════════════════════════════════════════════════════════
# E6b - PROCESS_QUERY_LIMITED_INFORMATION (0x1000)
# E6 denied 0x0400, which entails denial of any mask containing it. 0x1000 is NOT such a
# mask - it is a separate, weaker right - so it is measured, not inferred. And it is measured
# in the OPERATOR -> OWNER direction: the earlier all-four-denied probe ran louis -> session
# 5, the directions are not symmetric, and the ACLs need not be.
# ═══════════════════════════════════════════════════════════════════════════
function Try-OpenProcess {
  param([int]$ProcessId, [uint32]$Rights)
  $h = [T.U]::OpenProcess($Rights, $false, [uint32]$ProcessId)
  $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  if ($h -ne [IntPtr]::Zero) { [void][T.U]::CloseHandle($h); return @{ opened = $true; win32Error = 0 } }
  @{ opened = $false; win32Error = $err }
}

$LIMITED = 0x1000
$QI_VM   = 0x0410   # PROCESS_QUERY_INFORMATION | PROCESS_VM_READ

$lp = Try-OpenProcess -ProcessId $ownProc[0].Id -Rights ([uint32]$LIMITED)
$lpv = if ($lp.opened) { 'ACCEPTED' } else { 'INVALID' }
Add-Row -Id 'POS-open-own-process-limited' -Target 'own-session process' -AccessMask $LIMITED `
  -Note 'mask-matched control; handle closed immediately, nothing terminated' `
  -Data @{ verdict = $lpv; mechanism = $(if ($lp.opened) { 'PERMITTED' } else { 'UNDETERMINED' }); win32Error = $lp.win32Error; residueLeft = $false }

$ln = Try-OpenProcess -ProcessId $otherProc[0].Id -Rights ([uint32]$LIMITED)
$lnv = 'INVALID'; $lnmech = 'UNDETERMINED'
if ($ln.opened) { $lnv = 'VIOLATION'; $lnmech = 'NONE' }
elseif ($ln.win32Error -eq 5) { $lnv = 'BOUNDED'; $lnmech = 'ACL' }
$lnv = Gate-OnControl -Verdict $lnv -ControlVerdict $lpv
Add-Row -Id 'E6b-open-other-session-process-limited' -Target 'other-session process' -AccessMask $LIMITED `
  -Note 'operator -> owner direction; the earlier louis -> session 5 probe was corroboration, not this measurement' `
  -Data @{ verdict = $lnv; mechanism = $lnmech; win32Error = $ln.win32Error; controlVerdict = $lpv
           targetPid = $otherProc[0].Id; targetSession = $otherProc[0].SessionId; residueLeft = $false }

# ═══════════════════════════════════════════════════════════════════════════
# E7 - the REGISTERED E7: read another session's MainModule file name.
# This is the assertion the collision hid. The harness ran PROCESS_TERMINATE under this id;
# the module read had never been executed at all.
# ═══════════════════════════════════════════════════════════════════════════
$mp = 'INVALID'; $mpmech = 'UNDETERMINED'; $mpLen = $null
try {
  $own = (Get-Process -Id $PID).MainModule.FileName
  if ($own) { $mp = 'ACCEPTED'; $mpmech = 'PERMITTED'; $mpLen = $own.Length }
} catch { }
Add-Row -Id 'POS-read-own-module' -Target 'own process MainModule.FileName' -AccessMask $QI_VM `
  -Note 'only the LENGTH is recorded; the path itself is not evidence and does not travel' `
  -Data @{ verdict = $mp; mechanism = $mpmech; pathLength = $mpLen; residueLeft = $false }

$e7v = 'INVALID'; $e7mech = 'UNDETERMINED'; $e7err = $null; $e7got = $false
try {
  $om = (Get-Process -Id $otherProc[0].Id -ErrorAction Stop).MainModule
  if ($om -and $om.FileName) { $e7got = $true }
} catch { $e7err = $_.Exception.Message }
# A null WITHOUT a raised error names no mechanism, and that is exactly how E7 came back
# UNDETERMINED in Tier A. So the underlying access decision is measured directly and
# recorded WITH the row - the row is BOUNDED only when a mechanism can be named.
$e7probe = Try-OpenProcess -ProcessId $otherProc[0].Id -Rights ([uint32]$QI_VM)
if ($e7got) { $e7v = 'VIOLATION'; $e7mech = 'NONE' }
elseif ($e7probe.win32Error -eq 5) { $e7v = 'BOUNDED'; $e7mech = 'ACL' }
$e7v = Gate-OnControl -Verdict $e7v -ControlVerdict $mp
Add-Row -Id 'E7-read-other-session-module' -Target 'other-session process MainModule.FileName' -AccessMask $QI_VM `
  -Note 'THE REGISTERED E7, executed for the first time. The row that used to carry this id was PROCESS_TERMINATE, now E10.' `
  -Data @{ verdict = $e7v; mechanism = $e7mech; moduleObtained = $e7got
           openProcessWin32Error = $e7probe.win32Error; exceptionSeen = ($null -ne $e7err)
           controlVerdict = $mp; targetPid = $otherProc[0].Id; targetSession = $otherProc[0].SessionId; residueLeft = $false }

# ═══════════════════════════════════════════════════════════════════════════
# E9 - another session's command line
# Same discipline as E7: the query API returning null is not a mechanism. The row is BOUNDED
# only when the underlying denial is measured alongside it.
# ═══════════════════════════════════════════════════════════════════════════
$cp = 'INVALID'; $cpmech = 'UNDETERMINED'; $cpLen = $null
try {
  $ownCmd = (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $PID) -ErrorAction Stop).CommandLine
  if ($ownCmd) { $cp = 'ACCEPTED'; $cpmech = 'PERMITTED'; $cpLen = $ownCmd.Length }
} catch { }
Add-Row -Id 'POS-read-own-cmdline' -Target 'own process CommandLine' `
  -Note 'only the LENGTH is recorded; a command line can carry arguments and does not travel' `
  -Data @{ verdict = $cp; mechanism = $cpmech; commandLineLength = $cpLen; residueLeft = $false }

$e9v = 'INVALID'; $e9mech = 'UNDETERMINED'; $e9got = $false
try {
  $oc = (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $otherProc[0].Id) -ErrorAction Stop).CommandLine
  if ($oc) { $e9got = $true }
} catch { }
$e9probe = Try-OpenProcess -ProcessId $otherProc[0].Id -Rights ([uint32]$QI_VM)
if ($e9got) { $e9v = 'VIOLATION'; $e9mech = 'NONE' }
elseif ($e9probe.win32Error -eq 5) { $e9v = 'BOUNDED'; $e9mech = 'ACL' }
$e9v = Gate-OnControl -Verdict $e9v -ControlVerdict $cp
Add-Row -Id 'E9-read-other-session-cmdline' -Target 'other-session process CommandLine' -AccessMask $QI_VM `
  -Note 'a null from the query API alone names no mechanism; the OpenProcess denial is recorded with it' `
  -Data @{ verdict = $e9v; mechanism = $e9mech; commandLineObtained = $e9got
           openProcessWin32Error = $e9probe.win32Error; controlVerdict = $cp
           targetPid = $otherProc[0].Id; targetSession = $otherProc[0].SessionId; residueLeft = $false }
}

# ═══════════════════════════════════════════════════════════════════════════
# results
# ═══════════════════════════════════════════════════════════════════════════
# ── .ToArray(), NOT @() ──────────────────────────────────────────────────────
# MEASURED on PowerShell 5.1.26100: `@($x)` where $x is a List[object] throws
# "Argument types do not match" - EVEN WHEN THE LIST IS EMPTY. List[string] is fine, which is
# why the existing Get-TopLevelTitles never showed it. This is what actually killed the first
# real run: the reporting section threw at the `Test-PositiveControls -Rows @($rows)` line,
# so $controlProblems and then $record were never set, and nothing was written at all.
$rowArray = $rows.ToArray()
$registryDrift = Get-AssertionRegistryDrift
$controlProblems = (Test-PositiveControls -Rows $rowArray)

# PENDING-VERIFY rows are unfinished, not passing. Named at the top level so a reader of the
# results file cannot miss that this run does not stand on its own.
$pendingRows = @($rowArray | Where-Object { $_.Contains('verdict') -and $_.verdict -eq 'PENDING-VERIFY' } | ForEach-Object { $_.id })

$record = [ordered]@{
  probe = 'stage3-topup'
  nonce = $nonce
  # The seed this run measured against. -Verify matches on it, so a verification cannot be
  # credited to a different seed than the one that was actually in place.
  clipNonce = $(if ($clipAtt) { [string]$clipAtt.nonce } else { $null })
  pendingVerification = $pendingRows
  halted = $script:Halted
  registryFingerprint = (Get-AssertionRegistryFingerprint)
  registryDrift = @($registryDrift)
  positiveControlProblems = @($controlProblems)
  measuredBy = $idn.Name; measuredSid = $idn.User.Value
  sessionId = $mySession; otherSession = $otherSession
  rows = $rows
  wallClockMs = [int]((Get-Date) - $WALL_START).TotalMilliseconds
  at = (Get-Date).ToString('o')
}

$resultsPath = Join-Path $EvidenceDir ('stage3-topup-results-' + $nonce + '.json')
$wrote = $false
try {
  Set-Content -LiteralPath $resultsPath -Value ($record | ConvertTo-Json -Depth 8) -Encoding UTF8 -ErrorAction Stop
  $wrote = $true
  Write-Host ""
  Write-Host ("wrote results: " + $resultsPath) -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host "*** COULD NOT WRITE RESULTS. THE CONSOLE IS NOW THE ONLY RECORD. ***" -ForegroundColor Red
  Write-Host ($record | ConvertTo-Json -Depth 8)
}

try {
  Set-Content -LiteralPath (Join-Path $EvidenceDir ('stage3-topup-COMPLETED-' + $nonce + '.json')) -Encoding UTF8 -ErrorAction Stop -Value (([ordered]@{
    marker = 'TOPUP-COMPLETED'; nonce = $nonce; rowCount = $rows.Count; halted = $script:Halted
    registryDriftCount = @($registryDrift).Count; positiveControlProblemCount = @($controlProblems).Count
    resultsWritten = $wrote; at = (Get-Date).ToString('o')
  }) | ConvertTo-Json -Depth 4)
} catch { }

Write-Host ""
Write-Host "=== register cross-check ===" -ForegroundColor Cyan
Write-Host ("  id/target/mask drift  : " + @($registryDrift).Count) -ForegroundColor $(if (@($registryDrift).Count) { 'Red' } else { 'Green' })
Write-Host ("  positive-control gaps : " + @($controlProblems).Count) -ForegroundColor $(if (@($controlProblems).Count) { 'Red' } else { 'Green' })
foreach ($d in $registryDrift)   { Write-Host ("    DRIFT   : " + $d) -ForegroundColor Red }
foreach ($c in $controlProblems) { Write-Host ("    CONTROL : " + $c) -ForegroundColor Red }

Write-Host ""
if ($script:Halted) {
  Write-Host ("TOP-UP HALTED: " + $script:Halted) -ForegroundColor Red
} elseif (@($registryDrift).Count -or @($controlProblems).Count) {
  Write-Host "TOP-UP RAN - ROWS NOT CLEAN. Do not read this as a pass." -ForegroundColor Red
} elseif (@($pendingRows).Count) {
  Write-Host ("TOP-UP RAN - " + @($pendingRows).Count + " ROW(S) UNFINISHED, awaiting owner-side verification.") -ForegroundColor Yellow
} else {
  Write-Host "TOP-UP COMPLETE - rows agree with the register and every negative had a holding control" -ForegroundColor Cyan
}
if (@($pendingRows).Count) {
  Write-Host ""
  Write-Host "*** REQUIRED NEXT STEP, IN SESSION 3 ***" -ForegroundColor Yellow
  foreach ($p in $pendingRows) { Write-Host ("  " + $p + " is PENDING-VERIFY") -ForegroundColor Yellow }
  Write-Host ("  .\stage3-owner-clip.ps1 -Verify -Nonce " + $(if ($clipAtt) { $clipAtt.nonce } else { '<nonce>' })) -ForegroundColor Cyan
  Write-Host "  Without it these rows stay unfinished. They will never become a pass on their own." -ForegroundColor Yellow
}
Write-Host ""
if (-not $SELF_TEST) {
  Write-Host "DO NOT CLOSE THIS WINDOW until the results have been confirmed readable." -ForegroundColor Yellow
  return
}

# ═══════════════════════════════════════════════════════════════════════════
# SELF-TEST ASSERTIONS
#
# THE CLEAN PATH IS THE ONE THAT BROKE. Every empty-collection defect in PowerShell only
# appears when nothing is wrong: `@()` on a List[object] throws even when the list is empty,
# a function returning an empty array assigns $null, and `$null.Count` under Set-StrictMode
# is a terminating error rather than 0. So a run with zero drift and zero control problems -
# the run that is expected to happen - is the run that dies, and it dies in the reporting
# section, AFTER every measurement, having written nothing.
#
# This asserts the reporting section actually produced files. Nothing else is proof: the
# console printing plausible output is exactly what the crashed run also did.
# ═══════════════════════════════════════════════════════════════════════════
$fails = New-Object System.Collections.Generic.List[string]
function Check {
  param([string]$What, [bool]$Ok)
  Write-Host ("  {0,-52} {1}" -f $What, $(if ($Ok) { 'ok' } else { 'FAIL' })) -ForegroundColor $(if ($Ok) { 'Green' } else { 'Red' })
  if (-not $Ok) { $fails.Add($What) }
}

Write-Host "=== self-test assertions ===" -ForegroundColor Magenta
Check 'results file was WRITTEN (not just printed)' ([bool]$wrote)
Check 'results file exists on disk' (Test-Path -LiteralPath $resultsPath)
$completedPath = Join-Path $EvidenceDir ('stage3-topup-COMPLETED-' + $nonce + '.json')
Check 'COMPLETED marker exists' (Test-Path -LiteralPath $completedPath)
Check 'STARTED marker exists' (Test-Path -LiteralPath (Join-Path $EvidenceDir ('stage3-topup-STARTED-' + $nonce + '.json')))

$doc = $null
try { $doc = Get-Content -LiteralPath $resultsPath -Raw | ConvertFrom-Json } catch { }
Check 'results file is valid JSON' ($null -ne $doc)
if ($doc) {
  Check 'rows survived into the record' (@($doc.rows).Count -eq $rows.Count)
  Check 'clipNonce recorded' ([string]$doc.clipNonce -eq 'selftestclip')
  Check 'registryFingerprint recorded' ([bool]$doc.registryFingerprint)
  switch ($SELF_TEST_MODE) {
    'clean' {
      Check 'clean run: no register drift' (@($doc.registryDrift).Count -eq 0)
      Check 'clean run: no control problems' (@($doc.positiveControlProblems).Count -eq 0)
      Check 'clean run: nothing pending' (@($doc.pendingVerification).Count -eq 0)
    }
    'pending' {
      Check 'pending run: E4 is listed as unfinished' (@($doc.pendingVerification) -contains 'E4-read-other-session-clipboard')
      Check 'pending run: still no drift' (@($doc.registryDrift).Count -eq 0)
    }
    'dirty' {
      Check 'dirty run: drift was detected' (@($doc.registryDrift).Count -gt 0)
      Check 'dirty run: a missing control was detected' (@($doc.positiveControlProblems).Count -gt 0)
      Check 'dirty run: the drifted row is INVALID/REGISTRY-DRIFT' (
        [bool](@($doc.rows) | Where-Object { $_.id -eq 'E7-read-other-session-module' -and $_.mechanism -eq 'REGISTRY-DRIFT' }))
    }
  }
}

Remove-Item -LiteralPath $EvidenceDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
if (@($fails).Count -eq 0) {
  Write-Host ("SELF-TEST PASS (" + $SELF_TEST_MODE + ")") -ForegroundColor Green
  exit 0
}
Write-Host ("SELF-TEST FAIL (" + $SELF_TEST_MODE + "): " + (@($fails) -join '; ')) -ForegroundColor Red
exit 1
