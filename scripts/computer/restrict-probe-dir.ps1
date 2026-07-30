# restrict-probe-dir.ps1 - Phase 3b. GATE B: the Owner's account cannot READ the probe
# directory, so it cannot run a measurement script there at all.
#
# RUN ELEVATED. Changing an ACL on a system-level directory is a system change.
#
# ── WHY AN EXPLICIT DENY, AND NOT JUST REMOVING AN ALLOW ────────────────────
# The Owner is a member of Administrators, and Administrators has inherited Full Control on
# C:\. Removing a grant therefore achieves nothing: the inherited one still applies. Only an
# EXPLICIT DENY on the Owner's own account changes the outcome, because explicit ACEs are
# evaluated before inherited ones and deny before allow.
#
# ── THE LIMIT, STATED PLAINLY. THIS IS NOT AN ABSOLUTE BOUNDARY ─────────────
# An elevated shell can still take ownership of the directory and rewrite the DACL. The Owner
# holds SeTakeOwnershipPrivilege and SeRestorePrivilege; nothing here removes them, and
# nothing here could. So:
#
#   B PREVENTS ACCIDENTS. IT DOES NOT PREVENT THE OWNER.
#
# That is the honest scope and it must not be written up as anything wider. What it does buy
# is that reaching the scripts becomes a DELIBERATE, VISIBLE ACT - taking ownership is not
# something anyone does by mistake, and it leaves an ACL that no longer matches this script's
# expectation, which -Status will report.
#
# ── WHAT STILL WORKS UNDER THE DENY, AND WHAT DOES NOT ──────────────────────
# MEASURED SEMANTICS, not assumed - verify with -Status after applying:
#
#   Copy-Item INTO the directory   WORKS.  Creating a file needs CreateFiles/WriteData on the
#                                          DIRECTORY, which Administrators still holds. The
#                                          deny is on reading, not on writing.
#   Get-FileHash on a staged file  FAILS.  It needs ReadData on the file. This is deliberate.
#   powershell -File <staged>      FAILS.  PowerShell reads a script as DATA, so denying read
#                                          is what stops execution. Denying only "execute"
#                                          would not have.
#
# So hash verification MOVES: hash the REPO copy before staging - the Owner can always read
# the repo - and let the probe report the hashes of what it actually loaded, from inside
# session 5. stage3-harness.ps1 and stage3-topup.ps1 both print a staged-file table at
# startup for exactly this reason.
#
# Usage:
#   .\restrict-probe-dir.ps1 -Status
#   .\restrict-probe-dir.ps1 -Apply
#   .\restrict-probe-dir.ps1 -Revert

#Requires -RunAsAdministrator
param(
  [switch]$Apply,
  [switch]$Revert,
  [switch]$Status,
  [string]$ProbeDir = 'C:\AromaOperator-Probe',
  [string]$OwnerAccount = 'louis',
  [string]$CompanionAccount = 'AromaOperator'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$modes = @(@($Apply, $Revert, $Status) | Where-Object { $_ })
if (@($modes).Count -ne 1) {
  Write-Host "choose exactly one of -Status, -Apply, -Revert" -ForegroundColor Red
  exit 2
}

if (-not (Test-Path -LiteralPath $ProbeDir)) {
  Write-Host ("probe directory not found: " + $ProbeDir) -ForegroundColor Red
  exit 1
}

$QualifiedOwner = $env:COMPUTERNAME + '\' + $OwnerAccount
$QualifiedCompanion = $env:COMPUTERNAME + '\' + $CompanionAccount

# The rights that stop a script being READ, and therefore being run. ExecuteFile alone would
# not: PowerShell opens a .ps1 as data.
$DenyRights = [Security.AccessControl.FileSystemRights]::ReadData `
  -bor [Security.AccessControl.FileSystemRights]::ReadExtendedAttributes `
  -bor [Security.AccessControl.FileSystemRights]::ExecuteFile `
  -bor [Security.AccessControl.FileSystemRights]::ListDirectory

$Inherit = [Security.AccessControl.InheritanceFlags]::ContainerInherit `
  -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit

function Show-Acl {
  param([string]$Path)
  $acl = Get-Acl -LiteralPath $Path
  Write-Host ""
  Write-Host ("=== ACL: " + $Path + " ===") -ForegroundColor Cyan
  Write-Host ("  owner : " + $acl.Owner)
  foreach ($a in $acl.Access) {
    $col = if ($a.AccessControlType -eq 'Deny') { 'Yellow' } else { 'Gray' }
    Write-Host ("  {0,-5} {1,-32} {2}  inherited={3}" -f $a.AccessControlType, $a.IdentityReference, $a.FileSystemRights, $a.IsInherited) -ForegroundColor $col
  }
  $acl
}

function Get-OwnerDeny {
  param($Acl)
  @($Acl.Access | Where-Object {
    $_.AccessControlType -eq 'Deny' -and
    ([string]$_.IdentityReference -eq $QualifiedOwner -or [string]$_.IdentityReference -like ('*\' + $OwnerAccount))
  })
}

# ═══════════════════════════════════════════════════════════════════════════
if ($Status) {
  $acl = Show-Acl -Path $ProbeDir
  $deny = Get-OwnerDeny -Acl $acl
  Write-Host ""
  Write-Host ("GATE B applied : " + (@($deny).Count -gt 0)) -ForegroundColor $(if (@($deny).Count) { 'Green' } else { 'Yellow' })

  # OWNERSHIP IS THE ESCAPE HATCH, so it is reported every time rather than mentioned once.
  # If this no longer reads as expected, someone took the directory back - deliberately.
  Write-Host ("directory owner: " + $acl.Owner)
  Write-Host ""
  Write-Host "LIMIT: an elevated shell can take ownership and rewrite this DACL. Gate B prevents" -ForegroundColor Yellow
  Write-Host "accidents, not the Owner. Treat a changed owner or a missing DENY as a deliberate act." -ForegroundColor Yellow

  # ── PROVE THE EFFECT, AND DO NOT USE ENUMERATION TO DO IT ─────────────────
  # The first version did Get-ChildItem on the directory to pick a file to test. Gate B denies
  # ListDirectory, so once applied the enumeration returned NOTHING, `@($probe).Count` was 0,
  # and the whole read test was SILENTLY SKIPPED. The one check that proves the gate works was
  # disabled by the gate working. A control that stops reporting when it succeeds is
  # indistinguishable from one that was never run.
  #
  # So the target is a KNOWN NAME, not a discovered one, and "the directory cannot be listed"
  # is itself reported as evidence rather than swallowed.
  $listable = $false
  try { $null = @(Get-ChildItem -LiteralPath $ProbeDir -Force -ErrorAction Stop); $listable = $true } catch { }
  Write-Host ("directory LISTABLE by this token : " + $listable) -ForegroundColor $(if ($listable) { 'Yellow' } else { 'Green' })

  $known = Join-Path $ProbeDir 'observer.ps1'
  $readable = $null
  try { $null = Get-FileHash -LiteralPath $known -Algorithm SHA256 -ErrorAction Stop; $readable = $true }
  catch { $readable = $false; $readErr = $_.Exception.GetType().Name }
  Write-Host ("staged file READABLE by this token: " + $readable + "   (" + $known + ")") -ForegroundColor $(if ($readable) { 'Yellow' } else { 'Green' })
  if ($readable -eq $false) { Write-Host ("  refused with: " + $readErr) -ForegroundColor Green }

  if ($readable -and $deny.Count) {
    Write-Host ""
    Write-Host "INCONSISTENT: a DENY ACE is present but the file is still readable by this token." -ForegroundColor Red
    Write-Host "Check the directory owner above - the DACL may have been rewritten." -ForegroundColor Red
  }
  exit 0
}

# ═══════════════════════════════════════════════════════════════════════════
if ($Revert) {
  $acl = Get-Acl -LiteralPath $ProbeDir
  $removed = 0
  foreach ($a in (Get-OwnerDeny -Acl $acl)) { [void]$acl.RemoveAccessRule($a); $removed++ }
  if ($removed -eq 0) {
    Write-Host "no owner DENY present - nothing to revert." -ForegroundColor Yellow
    exit 0
  }
  Set-Acl -LiteralPath $ProbeDir -AclObject $acl
  Write-Host ("removed " + $removed + " DENY ACE(s) for " + $QualifiedOwner) -ForegroundColor Yellow
  [void](Show-Acl -Path $ProbeDir)
  Write-Host ""
  Write-Host "GATE B IS OFF. The Owner can read and run the staged scripts again." -ForegroundColor Red
  exit 0
}

# ═══════════════════════════════════════════════════════════════════════════
# -Apply
# ═══════════════════════════════════════════════════════════════════════════
Write-Host "=== GATE B: deny the Owner read/execute on the probe directory ===" -ForegroundColor Cyan
Write-Host ("  probe dir : " + $ProbeDir)
Write-Host ("  deny      : " + $QualifiedOwner)
Write-Host ("  keep      : " + $QualifiedCompanion + " read+execute")

foreach ($acct in @($QualifiedOwner, $QualifiedCompanion)) {
  try { $null = New-Object Security.Principal.NTAccount($acct); $null = ([Security.Principal.NTAccount]$acct).Translate([Security.Principal.SecurityIdentifier]) }
  catch { Write-Host ("  account does not resolve: " + $acct) -ForegroundColor Red; exit 1 }
}

# BASELINE FIRST. No baseline, no destructive attempt - the same rule the Tier A probe applies
# to the SessionGate task. An ACL change without a recorded prior state is an outage waiting
# for its trigger.
$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence'
if (-not (Test-Path -LiteralPath $EvidenceDir)) { New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null }
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$backup = Join-Path $EvidenceDir ('probedir-acl-pre-gateb-' + $stamp + '.txt')
$before = (Get-Acl -LiteralPath $ProbeDir).Sddl
Set-Content -LiteralPath $backup -Value $before -Encoding UTF8
Write-Host ("  baseline  : " + $backup) -ForegroundColor Green

$acl = Get-Acl -LiteralPath $ProbeDir

# The Companion must keep read+execute EXPLICITLY. Its access must not depend on an inherited
# grant that a later change to C:\ could remove without anyone noticing here.
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
  $QualifiedCompanion, 'ReadAndExecute', $Inherit, 'None', 'Allow')))

$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
  $QualifiedOwner, $DenyRights, $Inherit, 'None', 'Deny')))

Set-Acl -LiteralPath $ProbeDir -AclObject $acl

[void](Show-Acl -Path $ProbeDir)

Write-Host ""
Write-Host "=== WHAT CHANGED FOR YOU ===" -ForegroundColor Cyan
Write-Host "  Copy-Item INTO this directory  : still works (creating a file needs write, not read)"
Write-Host "  Get-FileHash on a staged file  : NO LONGER WORKS, by design"
Write-Host "  powershell -File <staged>      : NO LONGER WORKS, by design"
Write-Host ""
Write-Host "  Verify hashes on the REPO copy before staging, and read the staged-file table" -ForegroundColor Yellow
Write-Host "  that stage3-harness.ps1 / stage3-topup.ps1 print at startup in session 5." -ForegroundColor Yellow
Write-Host ""
Write-Host "LIMIT: an elevated shell can take ownership and rewrite this DACL. GATE B PREVENTS" -ForegroundColor Yellow
Write-Host "ACCIDENTS, NOT THE OWNER. Revert with -Revert; check with -Status." -ForegroundColor Yellow
