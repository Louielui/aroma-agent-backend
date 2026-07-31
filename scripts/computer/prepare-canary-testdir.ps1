# prepare-canary-testdir.ps1  -  SCRIPT A
#
# ===========================================================================
#  ONE PURPOSE: create and permission C:\Aroma\ComputerOperator-Test.
#
#  IT DOES NOT: stage anything, copy any closure, start the Companion, call
#  deploy-companion.ps1, set COMPUTER_OPERATOR, open Notepad, or delete
#  anything. Re-staging the Companion is SCRIPT B, a separate file and a
#  separate Owner GO. This script does not know B exists.
#
#  THE ACL RULE THIS FILE IS BUILT AROUND
#  Exactly ONE path is ever written: the new child. The parent and every
#  existing child are READ ONLY here - Get-Acl for verification, never Set-Acl.
#  There is no code path, including every failure and rerun path, that writes
#  an ACL anywhere else. Search this file for Set-Acl: there is one call, on
#  line marked THE ONLY WRITE, and its target is $TestDir.
#
#  WHY THE PARENT IS NEVER RELAXED
#  C:\Aroma carries (D;OICIIO;FA;;;<operator>) - a Deny FullControl that every
#  new child inherits. The wrong fix is to weaken that Deny so the child is
#  writable. The right fix is to break inheritance ON THE CHILD and grant it
#  explicitly, which is what happens below. The parent keeps every ACE it has.
#
#  NO SELF-REPAIR
#  If the target already exists and anything about it is not exactly as
#  specified, this script STOPS. It does not fix, trim, re-assert or adjust.
#  A directory that is nearly right is a directory nobody has looked at.
# ===========================================================================

#Requires -RunAsAdministrator

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# SPECIFICATION - the whole contract, as data, so the checks and the report
# read from one place and cannot disagree with each other.
# ---------------------------------------------------------------------------
$TestDir     = 'C:\Aroma\ComputerOperator-Test'
$AromaRoot   = 'C:\Aroma'
$AccountName = 'AromaOperator'

# Pinned from the read-only survey of 2026-07-31. A different SID means a
# different account with the same name - a rebuilt account is not this one.
$ExpectedOperatorSid = 'S-1-5-21-2042659270-2029498691-2127769412-1009'
$ExpectedParentOwner = 'S-1-5-21-2042659270-2029498691-2127769412-1002'

$SID_ADMINS = 'S-1-5-32-544'
$SID_SYSTEM = 'S-1-5-18'

# Windows sets the owner of a newly created directory either to the creating
# user or to Administrators, depending on the "default owner" policy. Both are
# acceptable; anything else is not.
$AcceptableOwnerSids = @($ExpectedParentOwner, $SID_ADMINS)

# Access masks as they appear AFTER .NET builds an Allow rule - measured, not
# assumed: an Allow rule has SYNCHRONIZE (0x100000) OR-ed in, a Deny rule does
# not, so the constant alone would not have matched the read-back.
$MASK_OPERATOR = 0x1201BF   # ReadAndExecute + Write, +SYNCHRONIZE
$MASK_FULL     = 0x1F01FF   # FullControl,            +SYNCHRONIZE

# The rights AromaOperator must NOT hold, checked individually with -band.
$FORBIDDEN_RIGHTS = [ordered]@{
  'Delete'            = 0x10000
  'ChangePermissions' = 0x40000
  'TakeOwnership'     = 0x80000
  'FullControl'       = 0x1F01FF
}

# Principals that must never receive a new Allow here.
$FORBIDDEN_PRINCIPALS = @('S-1-1-0', 'S-1-5-32-545', 'S-1-5-11')  # Everyone, Users, Authenticated Users

$stop = {
  param([string] $Message)
  Write-Host ""
  Write-Host ("STOPPED: " + $Message) -ForegroundColor Red
  exit 1
}

Write-Host "=== SCRIPT A - create and permission the canary test directory ===" -ForegroundColor Cyan
Write-Host ("  target : " + $TestDir) -ForegroundColor Gray
Write-Host ""

# ===========================================================================
# PREFLIGHT - every check runs BEFORE anything is created or written.
# ===========================================================================
Write-Host "PREFLIGHT" -ForegroundColor Cyan

# --- the account -----------------------------------------------------------
$user = Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue
if (-not $user) { & $stop "$AccountName does not exist" }
$userSid = $user.SID
if ($userSid.Value -ne $ExpectedOperatorSid) {
  & $stop ("$AccountName SID is " + $userSid.Value + ", expected " + $ExpectedOperatorSid + " - not the same account")
}
Write-Host ("  account OK        : " + $AccountName + " " + $userSid.Value) -ForegroundColor Green

# --- the parent, READ ONLY -------------------------------------------------
# Get-Acl is a read. This script never calls Set-Acl on the parent, and the
# only reason it looks at all is to confirm it is the tree we surveyed.
if (-not (Test-Path -LiteralPath $AromaRoot -PathType Container)) { & $stop "$AromaRoot does not exist" }
$parentAcl = Get-Acl -LiteralPath $AromaRoot
$parentOwnerSid = (New-Object Security.Principal.NTAccount($parentAcl.Owner)).Translate([Security.Principal.SecurityIdentifier]).Value
if ($parentOwnerSid -ne $ExpectedParentOwner) {
  & $stop ("$AromaRoot owner is " + $parentOwnerSid + ", expected " + $ExpectedParentOwner)
}
Write-Host ("  parent owner OK   : " + $parentAcl.Owner + " (" + $parentOwnerSid + ")") -ForegroundColor Green
Write-Host ("  parent SDDL (read only, will NOT be modified):") -ForegroundColor Gray
Write-Host ("    " + $parentAcl.Sddl) -ForegroundColor DarkGray

# --- the target ------------------------------------------------------------
# Three lawful states: absent (create it), or present-empty-and-exactly-right
# (nothing to do), or anything else (stop). There is no fourth.
$targetExists = Test-Path -LiteralPath $TestDir
$mustCreate = $true

if ($targetExists) {
  Write-Host "  target exists - verifying it is EXACTLY as specified" -ForegroundColor Yellow
  if (-not (Test-Path -LiteralPath $TestDir -PathType Container)) { & $stop "$TestDir exists but is not a directory" }

  $contents = @(Get-ChildItem -LiteralPath $TestDir -Force -ErrorAction SilentlyContinue)
  if ($contents.Count -gt 0) {
    Write-Host ("  it contains " + $contents.Count + " item(s):") -ForegroundColor Red
    $contents | ForEach-Object { Write-Host ("    " + $_.Name) -ForegroundColor Red }
    & $stop "$TestDir is not empty. The canary refuses to overwrite, so a leftover file would fail the run. Inspect and clear it deliberately."
  }

  $existingAcl = Get-Acl -LiteralPath $TestDir
  $existingOwnerSid = (New-Object Security.Principal.NTAccount($existingAcl.Owner)).Translate([Security.Principal.SecurityIdentifier]).Value
  if ($AcceptableOwnerSids -notcontains $existingOwnerSid) {
    & $stop ("$TestDir owner is " + $existingOwnerSid + ", which is not an acceptable owner")
  }
  # ACL is verified by the same read-back used after a fresh create, below.
  $mustCreate = $false
  Write-Host "  empty and owned correctly - will verify the ACL and change nothing" -ForegroundColor Green
} else {
  Write-Host "  target absent - will create it" -ForegroundColor Green
}

# ===========================================================================
# APPLY - the only mutation in this file, and only on a directory this run
# just created. An existing directory is NEVER written to; it is only checked.
# ===========================================================================
Write-Host ""
Write-Host "APPLY" -ForegroundColor Cyan

if ($mustCreate) {
  New-Item -ItemType Directory -Path $TestDir | Out-Null
  Write-Host "  created $TestDir" -ForegroundColor Green

  $acl = Get-Acl -LiteralPath $TestDir

  # ($true, $false): protect from inheritance, and DO NOT copy the inherited
  # ACEs down. Copying them would keep the parent's Deny FullControl for the
  # operator, and a Deny always beats an Allow - the folder would look
  # permitted and behave denied.
  $acl.SetAccessRuleProtection($true, $false)

  # ReadAndExecute + Write: enough for Notepad to create and write ONE new
  # file. Deliberately NOT Modify, because Modify carries Delete, and an
  # account that can delete from the evidence directory can remove the
  # evidence.
  $acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    $userSid, 'ReadAndExecute, Write', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))

  # Administrators AND SYSTEM both keep full management. Breaking inheritance
  # without re-granting these is how a directory ends up administrable by
  # nobody - and backup, AV and servicing all run as SYSTEM.
  $acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($SID_ADMINS)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  $acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($SID_SYSTEM)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))

  Set-Acl -LiteralPath $TestDir -AclObject $acl   # <<< THE ONLY WRITE >>>
  Write-Host "  ACL applied" -ForegroundColor Green
} else {
  Write-Host "  nothing applied - the directory already existed" -ForegroundColor Yellow
}

# ===========================================================================
# VERIFY - read back. An ACL that was set is not the same as an ACL in force.
# Every failure here STOPS. Nothing below repairs anything.
# ===========================================================================
Write-Host ""
Write-Host "VERIFY" -ForegroundColor Cyan

$final = Get-Acl -LiteralPath $TestDir
$rules = @($final.Access)

if (-not $final.AreAccessRulesProtected) { & $stop "inheritance is not protected on $TestDir" }
Write-Host "  protected            : True" -ForegroundColor Green

$inherited = @($rules | Where-Object { $_.IsInherited })
if ($inherited.Count -gt 0) {
  $inherited | ForEach-Object { Write-Host ("    " + $_.IdentityReference.Value + " " + $_.AccessControlType) -ForegroundColor Red }
  & $stop "inherited ACEs survived on $TestDir"
}
Write-Host "  inherited ACEs       : none" -ForegroundColor Green

$denies = @($rules | Where-Object { $_.AccessControlType -eq 'Deny' })
if ($denies.Count -gt 0) {
  $denies | ForEach-Object { Write-Host ("    DENY " + $_.IdentityReference.Value) -ForegroundColor Red }
  & $stop "a Deny ACE is present on $TestDir - it would beat the Allow"
}
Write-Host "  Deny ACEs            : none" -ForegroundColor Green

# Exactly three ACEs, no more. An extra Allow nobody specified is a finding.
if ($rules.Count -ne 3) {
  $rules | ForEach-Object { Write-Host ("    " + $_.IdentityReference.Value + " " + $_.AccessControlType + " " + $_.FileSystemRights) -ForegroundColor Red }
  & $stop ("expected exactly 3 ACEs, found " + $rules.Count)
}

function Get-AceFor {
  param([string] $Sid)
  return @($rules | Where-Object {
    $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $Sid
  })
}

foreach ($p in $FORBIDDEN_PRINCIPALS) {
  if ((Get-AceFor -Sid $p).Count -gt 0) { & $stop ("a rule exists for a forbidden principal: " + $p) }
}
Write-Host "  Everyone/Users/AuthU : no Allow" -ForegroundColor Green

foreach ($spec in @(
  @{ Sid = $ExpectedOperatorSid; Mask = $MASK_OPERATOR; Label = $AccountName },
  @{ Sid = $SID_ADMINS;          Mask = $MASK_FULL;     Label = 'BUILTIN\Administrators' },
  @{ Sid = $SID_SYSTEM;          Mask = $MASK_FULL;     Label = 'NT AUTHORITY\SYSTEM' }
)) {
  $ace = Get-AceFor -Sid $spec.Sid
  if ($ace.Count -ne 1) { & $stop ("expected exactly one ACE for " + $spec.Label + ", found " + $ace.Count) }
  $a = $ace[0]
  if ($a.AccessControlType -ne 'Allow') { & $stop ($spec.Label + " ACE is not an Allow") }
  if ([int]$a.FileSystemRights -ne $spec.Mask) {
    & $stop ($spec.Label + " mask is 0x{0:X}, expected 0x{1:X}" -f [int]$a.FileSystemRights, $spec.Mask)
  }
  if ($a.InheritanceFlags -ne 'ContainerInherit, ObjectInherit') { & $stop ($spec.Label + " inheritance flags are " + $a.InheritanceFlags) }
  if ($a.PropagationFlags -ne 'None') { & $stop ($spec.Label + " propagation flags are " + $a.PropagationFlags) }
  Write-Host ("  ACE OK               : {0,-28} 0x{1:X} OICI" -f $spec.Label, [int]$a.FileSystemRights) -ForegroundColor Green
}

# The least-privilege claim, checked right by right rather than asserted.
$opMask = [int](Get-AceFor -Sid $ExpectedOperatorSid)[0].FileSystemRights
Write-Host ""
Write-Host ("  least-privilege check for " + $AccountName + " (mask 0x{0:X}):" -f $opMask) -ForegroundColor Cyan
foreach ($name in $FORBIDDEN_RIGHTS.Keys) {
  $bit = $FORBIDDEN_RIGHTS[$name]
  $held = if ($name -eq 'FullControl') { ($opMask -band $bit) -eq $bit } else { ($opMask -band $bit) -ne 0 }
  if ($held) { & $stop ($AccountName + " holds a forbidden right: " + $name) }
  Write-Host ("    {0,-18} 0x{1:X6}  held = False" -f $name, $bit) -ForegroundColor Green
}

# ===========================================================================
# REPORT
# ===========================================================================
$ownerSid = (New-Object Security.Principal.NTAccount($final.Owner)).Translate([Security.Principal.SecurityIdentifier]).Value
Write-Host ""
Write-Host "=== SCRIPT A COMPLETE ===" -ForegroundColor Green
Write-Host ("  path        : " + $TestDir)
Write-Host ("  owner       : " + $final.Owner + " (" + $ownerSid + ")")
Write-Host ("  SDDL        : " + $final.Sddl)
Write-Host ("  contents    : " + @(Get-ChildItem -LiteralPath $TestDir -Force).Count + " item(s)")
Write-Host ""
Write-Host "  ACL writes to C:\Aroma and every existing child: 0" -ForegroundColor Green
Write-Host "  COMPUTER_OPERATOR was not set. Nothing was staged. No Notepad was opened." -ForegroundColor Gray
Write-Host ""
Write-Host "  rollback:  Remove-Item -LiteralPath '$TestDir' -Recurse -Force" -ForegroundColor Gray
Write-Host "             The parent was never written, so it needs no restoration." -ForegroundColor Gray
