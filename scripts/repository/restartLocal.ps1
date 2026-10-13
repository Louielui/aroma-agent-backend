param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedCommit)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ImagineServiceAccess {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr OpenSCManager(string machine, string database, uint access);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr OpenService(IntPtr manager, string service, uint access);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool CloseServiceHandle(IntPtr handle);
  public static int CheckControlAccess() {
    var manager=OpenSCManager(null,null,1);
    if(manager==IntPtr.Zero)return Marshal.GetLastWin32Error();
    var service=OpenService(manager,"AromaXiangXiangBackend",0x30);
    var error=service==IntPtr.Zero?Marshal.GetLastWin32Error():0;
    if(service!=IntPtr.Zero)CloseServiceHandle(service);
    CloseServiceHandle(manager);
    return error;
  }
}
'@
# Preserve actual null strings and capture Win32 errors inside C#, before the
# PowerShell binder can convert null to an empty database name or reset errors.
$promotionAccessError = [ImagineServiceAccess]::CheckControlAccess()
if ($promotionAccessError -eq 5) { Write-Output 'administrator_required'; exit 5 }
if ($promotionAccessError -ne 0) { throw 'ServiceAccessUnavailable' }
$promotionRoot = 'C:\Aroma\aroma-agent-backend'
if ($promotionRoot.TrimEnd('\') -ine 'C:\Aroma\aroma-agent-backend') { throw 'RepositoryIdentityMismatch' }
if ((& git -c "safe.directory=$promotionRoot" -C $promotionRoot remote get-url origin).Trim() -cne 'https://github.com/Louielui/aroma-agent-backend.git') { throw 'RemoteIdentityMismatch' }
if ((& git -c "safe.directory=$promotionRoot" -C $promotionRoot rev-parse HEAD).Trim() -cne $ExpectedCommit) { throw 'ExpectedCommitMismatch' }
if ((& git -c "safe.directory=$promotionRoot" -C $promotionRoot symbolic-ref --quiet --short HEAD).Trim() -cne 'main') { throw 'RuntimeBranchMismatch' }
$promotionService = Get-CimInstance Win32_Service -Filter "Name = 'AromaXiangXiangBackend'"
if ($promotionService.StartName -ine 'NT AUTHORITY\LocalService' -or $promotionService.PathName -notmatch 'AromaXiangXiang[\\/]service-v2[\\/]AromaXiangXiangBackend\.exe') { throw 'ServiceIdentityMismatch' }
$promotionListener = @(Get-NetTCPConnection -State Listen -LocalPort 8091)
if ($promotionListener.Count -ne 1 -or $promotionListener[0].LocalAddress -ne '127.0.0.1') { throw 'BridgeIdentityMismatch' }
$promotionBridge = Get-CimInstance Win32_Process -Filter "ProcessId=$($promotionListener[0].OwningProcess)"
function AssertImagineBridge($Candidate) {
  $bridgeParent = Get-CimInstance Win32_Process -Filter "ProcessId=$($Candidate.ParentProcessId)"
  $bridgeOwner = $Candidate | Invoke-CimMethod -MethodName GetOwner
  if ($bridgeOwner.ReturnValue -ne 0 -or ($bridgeOwner.Domain + '\' + $bridgeOwner.User) -ine [Security.Principal.WindowsIdentity]::GetCurrent().Name -or $Candidate.CommandLine -notmatch 'C:[\\/]Aroma[\\/]aroma-agent-backend[\\/]scripts[\\/]subscription[\\/]startBridge\.js' -or $bridgeParent.CommandLine -notmatch 'aroma-agent-backend[\\/]scripts[\\/]memory[\\/]serviceSupervisor\.cjs"? bridge$') { throw 'BridgeOwnerMismatch' }
}
function StopVerifiedBridgeAfterRestart($Original,$BoundProcess) {
  if ($BoundProcess.HasExited) { return }
  $bridgeListeners = @(Get-NetTCPConnection -State Listen -LocalPort 8091 -ErrorAction SilentlyContinue)
  if ($bridgeListeners.Count -eq 0) { return }
  if ($bridgeListeners.Count -ne 1 -or $bridgeListeners[0].LocalAddress -ne '127.0.0.1') { throw 'BridgeIdentityMismatch' }
  $bridgeCurrent = Get-CimInstance Win32_Process -Filter "ProcessId=$($bridgeListeners[0].OwningProcess)"
  if (-not $bridgeCurrent) { return }
  AssertImagineBridge $bridgeCurrent
  if ($bridgeCurrent.ProcessId -ne $Original.ProcessId -or $bridgeCurrent.CreationDate -ne $Original.CreationDate -or $BoundProcess.HasExited) { return }
  # Kill uses the already opened process handle, never a newly resolved PID.
  try { $BoundProcess.Kill() } catch { if (-not $BoundProcess.HasExited) { throw } }
}
AssertImagineBridge $promotionBridge
# Only the existing registered service and the exact owned bridge child are touched.
# No new service, scheduled elevation task, ACL change, credential copy or broad kill.
$promotionBoundProcess = [Diagnostics.Process]::GetProcessById($promotionBridge.ProcessId)
try {
  [void]$promotionBoundProcess.Handle
  if ($promotionBoundProcess.StartTime.ToUniversalTime().ToString('yyyyMMddHHmmssffffff') -cne $promotionBridge.CreationDate.ToUniversalTime().ToString('yyyyMMddHHmmssffffff')) { throw 'BridgeIdentityMismatch' }
  Restart-Service -Name AromaXiangXiangBackend
  StopVerifiedBridgeAfterRestart $promotionBridge $promotionBoundProcess
} finally { $promotionBoundProcess.Dispose() }
Write-Output 'restart_requested'
