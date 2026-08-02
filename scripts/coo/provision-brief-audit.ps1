#requires -Version 5.1
# ===========================================================================
#  provision-brief-audit.ps1 -- the Morning Briefing audit store's own ACL.
#
#  SAME MODEL AS THE CONVERSATION ARCHIVE, deliberately, because the reasoning
#  is the same: a record about the Owner's day should be readable by the Owner
#  and by the machine's administrators, and by nobody else.
#
#    SYSTEM          FullControl
#    Administrators  FullControl
#    <Owner account> FullControl
#
#  AromaOperator is deliberately ABSENT. The Computer Operator account exists to
#  drive a UI under a sealed work order; it has no business reading what the
#  Owner was briefed about, or when, or how many items were withheld. Inheritance
#  is BROKEN (not copied) so nothing arrives from the parent by accident.
#
#  The store holds audit METADATA ONLY -- ids, counts, durations, a content hash
#  and an outcome enum. No brief text, no third-party content. The ACL is the
#  second line, not the first.
#
#  Run elevated. READ-ONLY except for creating the folder and setting its ACL.
# ===========================================================================

param(
  [string] $Dir       = 'C:\Aroma\BriefAudit',
  [string] $OwnerAcct = "$env:COMPUTERNAME\louis"
)

$ErrorActionPreference = 'Stop'

# AromaOperator -- must NOT appear in the resulting ACL.
$OperatorSid = 'S-1-5-21-2042659270-2029498691-2127769412-1009'

function Say ($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

Say ''
Say '  BRIEF AUDIT STORE -- PROVISION' 'Cyan'
Say ("  directory : " + $Dir)
Say ("  owner     : " + $OwnerAcct)
Say ''

if (-not (Test-Path -LiteralPath $Dir)) {
  New-Item -ItemType Directory -Path $Dir -Force | Out-Null
  Say '  created.' 'Green'
} else {
  Say '  already exists.' 'Yellow'
}

$acl = Get-Acl -LiteralPath $Dir

# BREAK inheritance and do NOT copy the inherited rules. Copying them would keep
# whatever the parent granted, which is the thing being removed.
$acl.SetAccessRuleProtection($true, $false)
foreach ($r in @($acl.Access)) { [void] $acl.RemoveAccessRule($r) }

$inherit = 'ContainerInherit, ObjectInherit'
$none    = 'None'
$allow   = 'Allow'

foreach ($rule in @(
  (New-Object Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM', 'FullControl', $inherit, $none, $allow)),
  (New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators', 'FullControl', $inherit, $none, $allow)),
  (New-Object Security.AccessControl.FileSystemAccessRule($OwnerAcct, 'FullControl', $inherit, $none, $allow))
)) { $acl.AddAccessRule($rule) }

Set-Acl -LiteralPath $Dir -AclObject $acl
Say '  ACL applied.' 'Green'

# -- VERIFY, rather than assume the Set worked ------------------------------
Say ''
Say '  VERIFY' 'Cyan'
$after = Get-Acl -LiteralPath $Dir
Say ("  inheritance protected : " + $after.AreAccessRulesProtected)
foreach ($r in $after.Access) {
  Say ('    ' + $r.IdentityReference.Value.PadRight(34) + $r.FileSystemRights)
}

$operatorPresent = $false
foreach ($r in $after.Access) {
  try {
    $sid = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -eq $OperatorSid) { $operatorPresent = $true }
  } catch { }
}

Say ''
if ($operatorPresent) {
  Say '  AromaOperator CAN READ THIS. That is wrong - remove it.' 'Red'
  exit 1
}
Say '  AromaOperator: no access (correct)' 'Green'
Say ''
Say '  The audit file is brief-audit.jsonl, appended one line per delivered brief.' 'Gray'
Say '  Metadata only: ids, counts, durationMs, contentHash, outcome. No brief text.' 'Gray'
Say ''
