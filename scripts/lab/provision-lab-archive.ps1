# ===========================================================================
#  provision-lab-archive.ps1 - the Xiangxiang Lab archive directory.
#
#  THE ARCHIVE CONTAINS SECRETS. ASSUME IT ALWAYS.
#
#  Redaction runs before every write and is BEST-EFFORT ONLY. A password can be
#  any string; a pattern cannot recognise every one. So the directory is locked
#  to the Owner rather than trusted to be harmless:
#
#    Owner (louis)   FullControl
#    SYSTEM          FullControl
#    Administrators  FullControl
#    everyone else   NOTHING - inheritance off, no Users ACE
#
#  AromaOperator is deliberately absent. The Computer Operator account has no
#  business reading the Owner's conversations, and giving it read access
#  "because it is on the same machine" is how a containment boundary quietly
#  stops meaning anything.
#
#  WHERE IT LIVES, AND WHY NOT IN THE REPO
#  C:\Aroma\XiangxiangLab\conversation-archive - OUTSIDE the git repo, outside
#  data\, outside .aroma\. Nothing that walks the repo can pick it up, and no
#  existing backup or sync job knows about it.
#
#  NOT IN ANY BACKUP CHAIN. ON PURPOSE, FOR NOW.
#  v0.1 does no backup. The archive is therefore NOT durable storage and must
#  not be described as such until it is in a chain AND a restore has been
#  verified - the AromaTruthData-B2Sync precedent: a store is not backed up
#  until a restore has been proven.
#
#  Run as louis. No elevation needed: the directory is created by, and so owned
#  by, the account that runs this.
# ===========================================================================

[CmdletBinding()]
param([switch] $ShowOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$LabRoot     = 'C:\Aroma\XiangxiangLab'
$ArchiveDir  = 'C:\Aroma\XiangxiangLab\conversation-archive'
$OwnerAcct   = 'AROMABRAIN\louis'
$OperatorSid = 'S-1-5-21-2042659270-2029498691-2127769412-1009'   # AromaOperator - must NOT appear

function Say ([string]$T, [string]$C = 'Gray') { if ($C -eq 'Gray') { Write-Host $T } else { Write-Host $T -ForegroundColor $C } }

Say ""
Say "  XIANGXIANG LAB - CONVERSATION ARCHIVE" 'Cyan'
Say ""
Say ("  Running as : " + [Security.Principal.WindowsIdentity]::GetCurrent().Name)
Say ("  Archive    : " + $ArchiveDir)
Say ""

if (-not $ShowOnly) {
  foreach ($d in @($LabRoot, $ArchiveDir)) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null; Say ("  created: " + $d) 'DarkGray' }
    else { Say ("  exists : " + $d) 'DarkGray' }
  }

  $acl = Get-Acl -LiteralPath $ArchiveDir
  # Protect and do NOT copy inherited rules: C:\Aroma's inherited grants would
  # otherwise widen this folder to principals that must not read it.
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($r in @($acl.Access)) { $null = $acl.RemoveAccessRule($r) }

  $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $none    = [Security.AccessControl.PropagationFlags]::None
  $allow   = [Security.AccessControl.AccessControlType]::Allow
  foreach ($r in @(
    (New-Object Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM', 'FullControl', $inherit, $none, $allow)),
    (New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators', 'FullControl', $inherit, $none, $allow)),
    (New-Object Security.AccessControl.FileSystemAccessRule($OwnerAcct, 'FullControl', $inherit, $none, $allow))
  )) { $acl.AddAccessRule($r) }
  Set-Acl -LiteralPath $ArchiveDir -AclObject $acl
}

# Read it back and report what is really there.
if (Test-Path -LiteralPath $ArchiveDir) {
  $acl = Get-Acl -LiteralPath $ArchiveDir
  Say ""
  Say ("  owner      : " + $acl.Owner)
  Say ("  protected  : " + $acl.AreAccessRulesProtected + "   (inherited rules: " + @($acl.Access | Where-Object { $_.IsInherited }).Count + ")")
  $operatorPresent = $false
  foreach ($r in @($acl.Access)) {
    $sid = '?'
    try { $sid = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { }
    if ($sid -eq $OperatorSid) { $operatorPresent = $true }
    Say ("    " + $r.AccessControlType + "  " + $r.IdentityReference.Value.PadRight(30) + $r.FileSystemRights)
  }
  Say ""
  if ($operatorPresent) { Say "  AromaOperator CAN READ THIS. That is wrong - remove it." 'Red' }
  else { Say "  AromaOperator: no access (correct)" 'Green' }

  $files = @(Get-ChildItem -LiteralPath $ArchiveDir -File -ErrorAction SilentlyContinue)
  Say ("  files      : " + $files.Count)
}

Say ""
Say "  REMINDERS" 'Yellow'
Say "    . redaction is best-effort; treat this folder as containing secrets"
Say "    . not in git, and not in any backup chain"
Say "    . NOT durable storage until a restore has been verified"
Say ""
exit 0
