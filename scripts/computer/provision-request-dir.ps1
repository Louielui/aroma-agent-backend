# ===========================================================================
#  provision-request-dir.ps1 - the one directory a request ever crosses.
#
#  WHY IT NEEDS ITS OWN PERMISSIONS
#  C:\Aroma carries an INHERIT-ONLY DENY FullControl for AromaOperator. That
#  Deny is correct and deliberate - the operator account must not roam the tree.
#  But it propagates to children, so a request directory created there is a
#  directory the claimer cannot read. Measured, not assumed:
#
#    Deny AromaBrain\AromaOperator FullControl
#         flags=ContainerInherit, ObjectInherit / InheritOnly
#
#  So this folder is PROTECTED (inheritance off) and given an explicit set.
#
#  THE MODEL: OWNER CREATES, OPERATOR CLAIMS
#    louis          Modify   writes a request, and can clear one that expired
#    AromaOperator  Modify   claims it - and a claim is a RENAME, which needs
#                            delete on the source name plus create in the
#                            directory. Read-only would make claiming
#                            impossible; this is the smallest right that works.
#    SYSTEM         Full     service account
#    Administrators Full     recovery
#    everyone else  NOTHING  - no Users ACE, no Authenticated Users ACE
#
#  WHY OPERATOR WRITE IS SAFE HERE
#  It means AromaOperator could FORGE a CREATED__ file. That forgery authorises
#  nothing: the Companion re-verifies every request against a receipt it reads
#  for itself, and the receipt lives in the repo, which this account is denied.
#  A request is a pointer with an expiry, never a permission - so the worst a
#  forged one achieves is its own refusal.
#
#  Run as louis. No elevation: the folder is created by, and therefore owned by,
#  the account that runs this, and an owner may set its permissions.
# ===========================================================================

[CmdletBinding()]
param([switch] $ShowOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RequestDir   = 'C:\Aroma\ComputerOperator-Requests'
$OperatorSid  = 'S-1-5-21-2042659270-2029498691-2127769412-1009'
$OwnerAccount = 'AROMABRAIN\louis'

function Say ([string]$T, [string]$C = 'Gray') { if ($C -eq 'Gray') { Write-Host $T } else { Write-Host $T -ForegroundColor $C } }

Say ""
Say "  REQUEST DIRECTORY" 'Cyan'
Say ""

if (-not $ShowOnly) {
  if (-not (Test-Path -LiteralPath $RequestDir)) {
    New-Item -ItemType Directory -Path $RequestDir -Force | Out-Null
    Say "  Created." 'DarkGray'
  } else {
    Say "  Already there." 'DarkGray'
  }

  $acl = Get-Acl -LiteralPath $RequestDir
  # Protect, and do NOT copy the inherited rules across: copying them would
  # bring the C:\Aroma Deny with us, which is the whole reason for doing this.
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($r in @($acl.Access)) { $null = $acl.RemoveAccessRule($r) }

  $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $none    = [Security.AccessControl.PropagationFlags]::None
  $allow   = [Security.AccessControl.AccessControlType]::Allow

  $rules = @(
    (New-Object Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM', 'FullControl', $inherit, $none, $allow)),
    (New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators', 'FullControl', $inherit, $none, $allow)),
    (New-Object Security.AccessControl.FileSystemAccessRule($OwnerAccount, 'Modify', $inherit, $none, $allow)),
    (New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($OperatorSid)), 'Modify', $inherit, $none, $allow))
  )
  foreach ($r in $rules) { $acl.AddAccessRule($r) }
  Set-Acl -LiteralPath $RequestDir -AclObject $acl
}

# ── report what is actually there, by reading it back ──────────────────────
$acl = Get-Acl -LiteralPath $RequestDir
Say ""
Say ("  Path      : " + $RequestDir)
Say ("  Owner     : " + $acl.Owner)
Say ("  Protected : " + $acl.AreAccessRulesProtected + "   (inheritance off - the C:\Aroma Deny does not reach here)")
Say ""
Say "  Permissions:" 'Cyan'
$sawOperator = $false
$sawDeny = $false
$strangers = @()
foreach ($r in @($acl.Access)) {
  $sid = '?'
  try { $sid = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { }
  $note = ''
  if ($sid -eq $OperatorSid) { $sawOperator = $true; $note = '   <-- claimer: rename needs create + delete' }
  if ($r.AccessControlType -eq 'Deny') { $sawDeny = $true }
  if ($sid -notin @($OperatorSid, 'S-1-5-18', 'S-1-5-32-544') -and $r.IdentityReference.Value -ne $OwnerAccount) {
    $strangers += ($r.IdentityReference.Value + ' (' + $sid + ')')
  }
  Say ("    " + $r.AccessControlType + "  " + $r.IdentityReference.Value.PadRight(34) + $r.FileSystemRights + $note)
}
Say ""
Say ("  inherited rules : " + @($acl.Access | Where-Object { $_.IsInherited }).Count + "   (must be 0)")
Say ("  claimer present : " + $sawOperator)
Say ("  deny rules      : " + $sawDeny + "   (a Deny here would break the claim)")
if ($strangers.Count -gt 0) {
  Say ""
  Say "  UNKNOWN IDENTITIES WITH ACCESS:" 'Red'
  foreach ($s in $strangers) { Say ("    " + $s) 'Red' }
} else {
  Say "  unknown ids     : none - nobody outside the four named principals can read or write"
}
Say ""
# "0 files" and "I could not read the folder" must not print the same way.
# -ErrorAction SilentlyContinue made them identical here, and a report that
# cannot tell absence from blindness is how a containment number gets quoted
# for several rounds before anyone notices it was never measured.
$present = $null
try { $present = @(Get-ChildItem -LiteralPath $RequestDir -File -ErrorAction Stop).Count } catch { $present = $null }
Say ("  files present   : " + $(if ($null -eq $present) { 'COULD NOT BE READ' } else { [string]$present }))
Say ""
exit 0
