param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedCommit)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ImagineServiceAccess {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr OpenSCManager(string machine, string database, uint access);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr OpenService(IntPtr manager, string service, uint access);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool CloseServiceHandle(IntPtr handle);
}
'@
$promotionManager = [ImagineServiceAccess]::OpenSCManager($null,$null,1)
if ($promotionManager -eq [IntPtr]::Zero) { throw 'ServiceManagerUnavailable' }
$promotionHandle = [ImagineServiceAccess]::OpenService($promotionManager,'AromaXiangXiangBackend',0x30)
$promotionAccessError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
[ImagineServiceAccess]::CloseServiceHandle($promotionManager) | Out-Null
if ($promotionHandle -eq [IntPtr]::Zero) {
  if ($promotionAccessError -eq 5) { Write-Output 'administrator_required'; exit 5 }
  throw 'ServiceAccessUnavailable'
}
[ImagineServiceAccess]::CloseServiceHandle($promotionHandle) | Out-Null
$promotionRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if ($promotionRoot.TrimEnd('\') -ine 'C:\Aroma\aroma-agent-backend') { throw 'RepositoryIdentityMismatch' }
if ((& git -c "safe.directory=$promotionRoot" -C $promotionRoot remote get-url origin).Trim() -cne 'https://github.com/Louielui/aroma-agent-backend.git') { throw 'RemoteIdentityMismatch' }
if ((& git -c "safe.directory=$promotionRoot" -C $promotionRoot rev-parse HEAD).Trim() -cne $ExpectedCommit) { throw 'ExpectedCommitMismatch' }
if ((& git -c "safe.directory=$promotionRoot" -C $promotionRoot symbolic-ref --quiet --short HEAD).Trim() -cne 'main') { throw 'RuntimeBranchMismatch' }
$promotionService = Get-CimInstance Win32_Service -Filter "Name = 'AromaXiangXiangBackend'"
if ($promotionService.StartName -ine 'NT AUTHORITY\LocalService' -or $promotionService.PathName -notmatch 'AromaXiangXiang[\\/]service-v2[\\/]AromaXiangXiangBackend\.exe') { throw 'ServiceIdentityMismatch' }
$promotionListener = @(Get-NetTCPConnection -State Listen -LocalPort 8091)
if ($promotionListener.Count -ne 1 -or $promotionListener[0].LocalAddress -ne '127.0.0.1') { throw 'BridgeIdentityMismatch' }
$promotionBridge = Get-CimInstance Win32_Process -Filter "ProcessId=$($promotionListener[0].OwningProcess)"
$promotionParent = Get-CimInstance Win32_Process -Filter "ProcessId=$($promotionBridge.ParentProcessId)"
$promotionOwner = $promotionBridge | Invoke-CimMethod -MethodName GetOwner
if ($promotionOwner.ReturnValue -ne 0 -or ($promotionOwner.Domain + '\' + $promotionOwner.User) -ine [Security.Principal.WindowsIdentity]::GetCurrent().Name -or $promotionBridge.CommandLine -notmatch 'C:[\\/]Aroma[\\/]aroma-agent-backend[\\/]scripts[\\/]subscription[\\/]startBridge\.js' -or $promotionParent.CommandLine -notmatch 'aroma-agent-backend[\\/]scripts[\\/]memory[\\/]serviceSupervisor\.cjs"? bridge$') { throw 'BridgeOwnerMismatch' }
# Only the existing registered service and the exact owned bridge child are touched.
# No new service, scheduled elevation task, ACL change, credential copy or broad kill.
Restart-Service -Name AromaXiangXiangBackend
Stop-Process -Id $promotionBridge.ProcessId -Force -ErrorAction Stop
Write-Output 'restart_requested'
