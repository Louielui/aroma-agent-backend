# ===========================================================================
#  provision-shared-dirs.ps1 - the two folders the Companion needs at run time.
#
#  WHY THEY CANNOT LIVE IN THE STAGED TREE
#  The operator has ReadAndExecute on C:\Aroma\ComputerOperator-Companion, and
#  that is the property which makes the package hash mean anything: the account
#  that acts cannot rewrite the code that was approved. So neither the audit
#  sink nor the receipt can live under it - the Companion would have nowhere to
#  write, and nowhere to read the approval from.
#
#  Both were previously resolved RELATIVE to whichever tree was running:
#
#    receipts   path.join(REPO, '.aroma', 'owner-approvals')  ->  <stage>\.aroma\...
#               which staging never creates, because a receipt is not a package
#               file and must not be: it carries the package hash.
#    audit      path.join(REPO, '.aroma')                     ->  <stage>\.aroma
#               which the operator cannot write to.
#
#  On the Owner's side both resolved correctly, which is why nothing showed.
#
#  THE PERMISSIONS, AND WHY EACH ONE
#    Audit     operator ReadAndExecute + Write, NO Delete.
#              It may create evidence and must never be able to destroy it -
#              the same rule as the canary folder.
#    Receipts  operator ReadAndExecute ONLY.
#              It must be able to READ the approval it is acting under. It must
#              not be able to write one: an account that can forge its own
#              approval is not operating under an approval.
#
#  Both are PROTECTED (inheritance off). C:\Aroma carries an inherit-only DENY
#  FullControl aimed at the operator, so a folder created there without its own
#  ACL is one the operator cannot touch at all.
#
#  Run as louis. NO ELEVATION: the folders are created by, and therefore owned
#  by, the account that runs this, and an owner may set permissions.
# ===========================================================================

[CmdletBinding()]
param([switch] $ShowOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$OperatorSid  = 'S-1-5-21-2042659270-2029498691-2127769412-1009'
$OwnerAccount = 'AROMABRAIN\louis'

# ReadAndExecute + Write, WITHOUT Delete. Modify (0x1301BF) minus DELETE
# (0x10000) is 0x1201BF - the same mask the canary folder carries, arrived at
# the same way and for the same reason.
$OpAuditRights = [Security.AccessControl.FileSystemRights] 0x1201BF
$OpReadRights  = [Security.AccessControl.FileSystemRights]::ReadAndExecute

$Dirs = @(
  @{ Path = 'C:\Aroma\ComputerOperator-Audit'
     What = 'audit records written by the Companion'
     OperatorRights = $OpAuditRights
     OperatorNote = 'ReadAndExecute + Write, NO Delete - it may create evidence, never destroy it' },
  @{ Path = 'C:\Aroma\ComputerOperator-Receipts'
     What = 'approval receipts, written by the Owner and read by the Companion'
     OperatorRights = $OpReadRights
     OperatorNote = 'ReadAndExecute only - it may read the approval, never write one' }
)

function Say ([string]$T, [string]$C = 'Gray') { if ($C -eq 'Gray') { Write-Host $T } else { Write-Host $T -ForegroundColor $C } }

Say ""
Say "  SHARED DIRECTORIES" 'Cyan'
Say ""
Say ("  Running as : " + [Security.Principal.WindowsIdentity]::GetCurrent().Name)
Say ""

foreach ($d in $Dirs) {
  Say ("  " + $d.Path) 'Cyan'
  Say ("    for : " + $d.What)

  if (-not $ShowOnly) {
    if (-not (Test-Path -LiteralPath $d.Path)) {
      New-Item -ItemType Directory -Path $d.Path -Force | Out-Null
      Say "    created." 'DarkGray'
    } else {
      Say "    already there." 'DarkGray'
    }

    $acl = Get-Acl -LiteralPath $d.Path
    # Protect and do NOT copy inherited rules: copying would bring the C:\Aroma
    # Deny with us, which is the whole reason for doing this.
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($r in @($acl.Access)) { $null = $acl.RemoveAccessRule($r) }

    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $none    = [Security.AccessControl.PropagationFlags]::None
    $allow   = [Security.AccessControl.AccessControlType]::Allow

    foreach ($r in @(
      (New-Object Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM', 'FullControl', $inherit, $none, $allow)),
      (New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators', 'FullControl', $inherit, $none, $allow)),
      (New-Object Security.AccessControl.FileSystemAccessRule($OwnerAccount, 'Modify', $inherit, $none, $allow)),
      (New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($OperatorSid)), $d.OperatorRights, $inherit, $none, $allow))
    )) { $acl.AddAccessRule($r) }
    Set-Acl -LiteralPath $d.Path -AclObject $acl
  }

  # Read it back and report what is actually there.
  if (Test-Path -LiteralPath $d.Path) {
    $acl = Get-Acl -LiteralPath $d.Path
    Say ("    owner      : " + $acl.Owner)
    Say ("    protected  : " + $acl.AreAccessRulesProtected + "   (inherited rules: " + @($acl.Access | Where-Object { $_.IsInherited }).Count + ")")
    foreach ($r in @($acl.Access)) {
      $sid = '?'
      try { $sid = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { }
      $note = ''
      if ($sid -eq $OperatorSid) {
        $mask = [int]$r.FileSystemRights
        $hasDelete = ($mask -band 0x10000) -ne 0
        $note = '   <-- operator; Delete=' + $hasDelete
      }
      Say ("    " + $r.AccessControlType + "  " + $r.IdentityReference.Value.PadRight(30) + $r.FileSystemRights + $note)
    }
  } else {
    Say "    NOT CREATED (-ShowOnly)" 'Yellow'
  }
  Say ""
}

Say "  Done. Nothing was started and no switch was set." 'Green'
Say ""
exit 0
