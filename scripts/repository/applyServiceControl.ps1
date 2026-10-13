param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9-]{36}$')][string]$PlanId,[Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$OwnerApprovedPlanHash,[switch]$Revoke)
$ErrorActionPreference = 'Stop'
$serviceControlPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $serviceControlPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'WindowsAdministratorRequired' }
$serviceControlDirectory = Join-Path $env:LOCALAPPDATA 'AromaXiangXiang/repository-promotion/permission-plans'
$serviceControlFile = Join-Path $serviceControlDirectory ($PlanId+'.json')
if (((Get-Item -LiteralPath $serviceControlFile).Attributes -band [IO.FileAttributes]::ReparsePoint) -or ((Get-Item -LiteralPath $serviceControlDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'UnsafePlan' }
$serviceControlBytes=[IO.File]::ReadAllBytes($serviceControlFile)
$serviceControlHasher=[Security.Cryptography.SHA256]::Create()
try { $serviceControlHash=([BitConverter]::ToString($serviceControlHasher.ComputeHash($serviceControlBytes))).Replace('-','').ToLowerInvariant() } finally { $serviceControlHasher.Dispose() }
if ($serviceControlHash -cne $OwnerApprovedPlanHash) { throw 'OwnerApprovedPlanChanged' }
$serviceControlPlan = [Text.Encoding]::UTF8.GetString($serviceControlBytes).TrimStart([char]0xfeff) | ConvertFrom-Json
function DescriptorHash([string]$value) { $sha=[Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() } }
if ($serviceControlPlan.id -ne $PlanId -or $serviceControlPlan.service -cne 'AromaXiangXiangBackend' -or $serviceControlPlan.accessMask -ne 0x30 -or $serviceControlPlan.scope -cne 'start_stop_existing_local_service' -or $serviceControlPlan.ownerSid -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -or (DescriptorHash $serviceControlPlan.before) -cne $serviceControlPlan.beforeHash -or (DescriptorHash $serviceControlPlan.after) -cne $serviceControlPlan.afterHash) { throw 'UnapprovedOrChangedPlan' }
# Reconstruct the only allowed difference rather than trusting an arbitrary SDDL.
$serviceControlExpected = New-Object Security.AccessControl.RawSecurityDescriptor($serviceControlPlan.before)
$serviceControlSid = New-Object Security.Principal.SecurityIdentifier($serviceControlPlan.ownerSid)
$serviceControlExpected.DiscretionaryAcl.InsertAce($serviceControlExpected.DiscretionaryAcl.Count,(New-Object Security.AccessControl.CommonAce([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,0x30,$serviceControlSid,$false,$null)))
if ($serviceControlExpected.GetSddlForm([Security.AccessControl.AccessControlSections]::All) -cne $serviceControlPlan.after) { throw 'UnexpectedPermissionDifference' }
$serviceControlObserved = ((& sc.exe sdshow AromaXiangXiangBackend) | Where-Object { $_ -match '^D:' }) -join ''
$serviceControlExpectedCurrent = if ($Revoke) { $serviceControlPlan.after } else { $serviceControlPlan.before }
if ($serviceControlObserved -cne $serviceControlExpectedCurrent) { throw 'ServiceDescriptorChanged' }
$serviceControlTarget = if ($Revoke) { $serviceControlPlan.before } else { $serviceControlPlan.after }
# Write only DACL_SECURITY_INFORMATION (0x4). Owner, group and audit/SACL are
# not writable through this call, including audit entries hidden by sdshow.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ImagineDaclWriter {
  [DllImport("advapi32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern IntPtr OpenSCManager(string machine,string database,uint access);
  [DllImport("advapi32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern IntPtr OpenService(IntPtr manager,string service,uint access);
  [DllImport("advapi32.dll",SetLastError=true)] public static extern bool SetServiceObjectSecurity(IntPtr service,uint information,IntPtr descriptor);
  [DllImport("advapi32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,uint revision,out IntPtr descriptor,out uint size);
  [DllImport("advapi32.dll",SetLastError=true)] public static extern bool CloseServiceHandle(IntPtr handle);
  [DllImport("kernel32.dll")] public static extern IntPtr LocalFree(IntPtr memory);
  public static IntPtr OpenLocalManager(){return OpenSCManager(null,null,1);}
}
'@
$serviceControlManager=[ImagineDaclWriter]::OpenLocalManager()
if ($serviceControlManager -eq [IntPtr]::Zero) { throw 'ServicePermissionWriteFailed' }
$serviceControlHandle=[IntPtr]::Zero;$serviceControlNative=[IntPtr]::Zero
try {
  $serviceControlHandle=[ImagineDaclWriter]::OpenService($serviceControlManager,'AromaXiangXiangBackend',0x60000)
  if ($serviceControlHandle -eq [IntPtr]::Zero) { throw 'ServicePermissionWriteFailed' }
  $serviceControlSize=[uint32]0
  if (-not [ImagineDaclWriter]::ConvertStringSecurityDescriptorToSecurityDescriptor($serviceControlTarget,1,[ref]$serviceControlNative,[ref]$serviceControlSize)) { throw 'ServicePermissionWriteFailed' }
  if (-not [ImagineDaclWriter]::SetServiceObjectSecurity($serviceControlHandle,0x4,$serviceControlNative)) { throw 'ServicePermissionWriteFailed' }
} finally {
  if ($serviceControlNative -ne [IntPtr]::Zero) { [ImagineDaclWriter]::LocalFree($serviceControlNative) | Out-Null }
  if ($serviceControlHandle -ne [IntPtr]::Zero) { [ImagineDaclWriter]::CloseServiceHandle($serviceControlHandle) | Out-Null }
  [ImagineDaclWriter]::CloseServiceHandle($serviceControlManager) | Out-Null
}
$serviceControlReadBack = ((& sc.exe sdshow AromaXiangXiangBackend) | Where-Object { $_ -match '^D:' }) -join ''
if ($serviceControlReadBack -cne $serviceControlTarget) { throw 'ServicePermissionReadBackFailed' }
@{ id=$PlanId;state=$(if($Revoke){'revoked'}else{'granted'});scope=$serviceControlPlan.scope;accessMask=0x30;checkedAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $serviceControlDirectory ($PlanId+'.result.json')) -Encoding UTF8
