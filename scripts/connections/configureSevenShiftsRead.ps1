param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedCommit)
$ErrorActionPreference = 'Stop'
$setupRoot = 'C:\Aroma\aroma-agent-backend'
$setupEnvPath = Join-Path $setupRoot '.env'
$setupSecretsRoot = 'C:\Aroma\secrets'
$setupReceiptRoot = Join-Path $env:LOCALAPPDATA 'AromaXiangXiang\connection-setup'
$setupReceiptPath = Join-Path $setupReceiptRoot 'seven-shifts.json'
$setupState = 'not_configured'
$setupBackup = $null
$setupToken = $null
$setupBstr = [IntPtr]::Zero
try {
  $setupPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $setupPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'AdministratorRequired' }
  foreach ($setupPath in @('C:\Aroma',$setupRoot,$setupEnvPath,$setupSecretsRoot)) {
    $setupItem = Get-Item -LiteralPath $setupPath
    if (($setupItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'UnexpectedPath' }
  }
  if ((& git --no-replace-objects -C $setupRoot rev-parse HEAD).Trim() -cne $ExpectedCommit) { throw 'VersionChanged' }
  if ((Get-Item -LiteralPath $setupEnvPath).Length -gt 131072) { throw 'ConfigurationTooLarge' }
  $setupOriginal = [IO.File]::ReadAllText($setupEnvPath)
  $setupAcl = Get-Acl -LiteralPath $setupEnvPath
  $setupCompany = Read-Host '7shifts company ID (digits only)'
  if ($setupCompany -notmatch '^[1-9][0-9]{0,14}$' -or [double]$setupCompany -gt 9007199254740991) { throw 'InvalidCompanyId' }
  $setupSecureToken = Read-Host '7shifts API token (hidden; never paste into chat)' -AsSecureString
  $setupBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($setupSecureToken)
  $setupToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($setupBstr)
  if ($setupToken -notmatch '^[A-Za-z0-9._~+/=-]{10,4096}$') { throw 'InvalidBearerToken' }
  $setupNames = @('SEVEN_SHIFTS_COMPANY_ID','SEVEN_SHIFTS_ACCESS_TOKEN','CONTEXT_SEVEN_SHIFTS')
  foreach ($setupName in $setupNames) {
    if ([regex]::Matches($setupOriginal,'(?m)^\s*(?:export\s+)?' + $setupName + '\s*=').Count -gt 1) { throw 'DuplicateConnectionSetting' }
  }
  # Update only these three connection keys. No model, provider, master flag,
  # credential ACL, payroll setting or existing credential is changed.
  $setupUpdated = [regex]::Replace($setupOriginal,'(?m)^[ \t]*(?:export[ \t]+)?(?:SEVEN_SHIFTS_COMPANY_ID|SEVEN_SHIFTS_ACCESS_TOKEN|CONTEXT_SEVEN_SHIFTS)[ \t]*=.*(?:\r?\n|$)','')
  $setupUpdated = $setupUpdated.TrimEnd("`r","`n") + "`r`nSEVEN_SHIFTS_COMPANY_ID=$setupCompany`r`nSEVEN_SHIFTS_ACCESS_TOKEN=$setupToken`r`nCONTEXT_SEVEN_SHIFTS=on`r`n"
  $setupReadiness = (& node (Join-Path $setupRoot 'scripts/connections/setupReadiness.cjs')) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $setupReadiness.state -ne 'idle_verified') { throw 'WorkNotIdle' }
  $setupListener = @(Get-NetTCPConnection -State Listen -LocalPort 8091)
  if ($setupListener.Count -ne 1 -or $setupListener[0].OwningProcess -ne $setupReadiness.pid) { throw 'UnexpectedBridgeListener' }
  $setupBridge = Get-CimInstance Win32_Process -Filter "ProcessId=$($setupReadiness.pid)"
  $setupParent = Get-CimInstance Win32_Process -Filter "ProcessId=$($setupBridge.ParentProcessId)"
  $setupOwner = $setupBridge | Invoke-CimMethod -MethodName GetOwner
  if ($setupOwner.ReturnValue -ne 0 -or ($setupOwner.Domain + '\' + $setupOwner.User) -ine [Security.Principal.WindowsIdentity]::GetCurrent().Name -or $setupBridge.CommandLine -notmatch 'aroma-agent-backend[\\/]scripts[\\/]subscription[\\/]startBridge\.js' -or $setupParent.CommandLine -notmatch 'aroma-agent-backend[\\/]scripts[\\/]memory[\\/]serviceSupervisor\.cjs"? bridge$') { throw 'UnexpectedBridgeProcess' }
  if ([IO.File]::ReadAllText($setupEnvPath) -cne $setupOriginal -or (& git --no-replace-objects -C $setupRoot rev-parse HEAD).Trim() -cne $ExpectedCommit) { throw 'ConfigurationChanged' }
  $setupBackup = Join-Path $setupSecretsRoot ('seven-shifts-before-' + [guid]::NewGuid().ToString() + '.creds')
  $setupBackupStream = [IO.File]::Open($setupBackup,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
  $setupBackupStream.Dispose()
  Set-Acl -LiteralPath $setupBackup -AclObject $setupAcl
  [IO.File]::WriteAllText($setupBackup,$setupOriginal,(New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText($setupEnvPath,$setupUpdated,(New-Object Text.UTF8Encoding($false)))
  if ([IO.File]::ReadAllText($setupEnvPath) -cne $setupUpdated -or (Get-Acl -LiteralPath $setupEnvPath).Sddl -cne $setupAcl.Sddl) { throw 'ConfigurationWriteUnconfirmed' }
  $setupState = 'configured_restart_pending'
  Restart-Service -Name 'AromaXiangXiangBackend'
  $setupHealth = $null
  for ($setupAttempt=0; $setupAttempt -lt 40; $setupAttempt++) {
    try {
      $setupProbe = Invoke-RestMethod -Uri 'http://127.0.0.1:8090/health' -TimeoutSec 2
      if ($setupProbe.status -eq 'ok' -and $setupProbe.bootCommit -ceq $ExpectedCommit) { $setupHealth=$setupProbe; break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $setupHealth) { throw 'LoadedVersionUnconfirmed' }
  # Reload only this verified idle child. Its existing supervisor replaces it;
  # no scheduled task, account, model setting or unrelated process is changed.
  $setupFinalReadiness = (& node (Join-Path $setupRoot 'scripts/connections/setupReadiness.cjs')) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $setupFinalReadiness.state -ne 'idle_verified' -or $setupFinalReadiness.pid -ne $setupBridge.ProcessId) { throw 'WorkNotIdle' }
  $setupFinalBridge = Get-CimInstance Win32_Process -Filter "ProcessId=$($setupBridge.ProcessId)"
  if (-not $setupFinalBridge -or $setupFinalBridge.CreationDate -ne $setupBridge.CreationDate -or $setupFinalBridge.CommandLine -cne $setupBridge.CommandLine) { throw 'UnexpectedBridgeProcess' }
  Stop-Process -Id $setupBridge.ProcessId -Force
  $setupBridgeLoaded=$false
  for ($setupAttempt=0; $setupAttempt -lt 20; $setupAttempt++) {
    try {
      $setupFresh = (& node (Join-Path $setupRoot 'scripts/connections/setupReadiness.cjs')) | ConvertFrom-Json
      if ($LASTEXITCODE -eq 0 -and $setupFresh.bootCommit -ceq $ExpectedCommit) { $setupBridgeLoaded=$true; break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $setupBridgeLoaded) { throw 'BridgeVersionUnconfirmed' }
  $setupState = 'configured_loaded'
  New-Item -ItemType Directory -Path $setupReceiptRoot -Force | Out-Null
  @{state=$setupState;companyId=$setupCompany;bootCommit=$setupHealth.bootCommit;bridgeBootCommit=$setupFresh.bootCommit;checkedAt=[DateTime]::UtcNow.ToString('o');backup=$setupBackup;tokenPrinted=$false;permissionsGranted=$false;liveReadVerified=$false} | ConvertTo-Json | Set-Content -LiteralPath $setupReceiptPath -Encoding UTF8
  Write-Host 'Connection saved and Imagine restarted. Live read acceptance is still required.'
} catch {
  $setupSafeFailures = @('AdministratorRequired','UnexpectedPath','VersionChanged','ConfigurationTooLarge','InvalidCompanyId','InvalidBearerToken','DuplicateConnectionSetting','WorkNotIdle','UnexpectedBridgeListener','UnexpectedBridgeProcess','ConfigurationChanged','ConfigurationWriteUnconfirmed','LoadedVersionUnconfirmed','BridgeVersionUnconfirmed')
  $setupFailure = if ($setupSafeFailures -ccontains $_.Exception.Message) { $_.Exception.Message } else { 'setup_unconfirmed' }
  New-Item -ItemType Directory -Path $setupReceiptRoot -Force | Out-Null
  @{state=$setupState;failure=$setupFailure;errorClass=$_.Exception.GetType().Name;checkedAt=[DateTime]::UtcNow.ToString('o');backup=$setupBackup;tokenPrinted=$false;permissionsGranted=$false;liveReadVerified=$false} | ConvertTo-Json | Set-Content -LiteralPath $setupReceiptPath -Encoding UTF8
  Write-Host 'Setup was not confirmed. The saved receipt contains no token. Please tell Codex setup did not finish.'
} finally {
  if ($setupBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($setupBstr) }
  $setupToken=$null; $setupOriginal=$null; $setupUpdated=$null
  if ($setupSecureToken) { $setupSecureToken.Dispose() }
  Read-Host 'Press Enter to close' | Out-Null
}
