param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')][string]$RunId)
$ErrorActionPreference = 'Stop'
$adoptionRepository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$adoptionStore = Join-Path $env:LOCALAPPDATA 'AromaXiangXiang/worker-flow/adoptions'
$adoptionRecordPath = Join-Path $adoptionStore ($RunId + '.json')
$adoptionProofPath = Join-Path $adoptionStore ($RunId + '.restart.json')
try {
  $adoptionPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $adoptionPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'WindowsAdministratorRequired' }
  $adoptionRecord = Get-Content -LiteralPath $adoptionRecordPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($adoptionRecord.id -ne $RunId -or $adoptionRecord.workflow -ne 'project_adoption' -or $adoptionRecord.state -ne 'awaiting_restart' -or $adoptionRecord.commit -notmatch '^[a-f0-9]{40}$') { throw 'AdoptionNotReady' }
  Get-ChildItem Env:GIT_* | Remove-Item
  if ((& git --no-replace-objects -C $adoptionRepository rev-parse HEAD).Trim() -ne $adoptionRecord.commit) { throw 'HeadChanged' }
  # Host-owned closed registry, never caller/model-supplied paths or commands.
  $adoptionRecipe = $adoptionRecord.source.evidence.recipe
  if (-not $adoptionRecipe) { $adoptionRecipe = 'context-fields-snapshot-v1' }
  switch ($adoptionRecipe) {
    'context-fields-snapshot-v1' { $adoptionNames = @('src/context/contextResult.js') }
    'context-provenance-snapshot-v2' { $adoptionNames = @('src/context/contextResult.js','src/context/toolGateway.js') }
    'context-coverage-snapshot-v3' { $adoptionNames = @('src/context/contextResult.js','src/context/toolGateway.js') }
    default { throw 'UnknownRecipe' }
  }
  if ($adoptionRecipe -ne 'context-fields-snapshot-v1' -and (($adoptionRecord.after.PSObject.Properties.Name | Sort-Object) -join ',') -cne (($adoptionNames | Sort-Object) -join ',')) { throw 'UnexpectedSourceSet' }
  foreach ($adoptionName in $adoptionNames) {
    $adoptionExpectedSource = if ($adoptionRecipe -eq 'context-fields-snapshot-v1') { $adoptionRecord.after } else { $adoptionRecord.after.$adoptionName }
    $adoptionSource = (Get-Content -LiteralPath (Join-Path $adoptionRepository $adoptionName) -Raw -Encoding UTF8).Replace("`r`n","`n")
    if ($adoptionSource -cne $adoptionExpectedSource -or (& git --no-replace-objects -c core.fsmonitor=false -C $adoptionRepository status --porcelain=v1 -- $adoptionName)) { throw 'SourceChanged' }
  }
  Restart-Service -Name 'AromaXiangXiangBackend' -ErrorAction Stop
  $adoptionHealth = $null
  for ($adoptionAttempt = 0; $adoptionAttempt -lt 40; $adoptionAttempt++) {
    try {
      $adoptionProbe = Invoke-RestMethod -Uri 'http://127.0.0.1:8090/health' -TimeoutSec 2
      if ($adoptionProbe.status -eq 'ok' -and $adoptionProbe.bootCommit -eq $adoptionRecord.commit) { $adoptionHealth = $adoptionProbe; break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $adoptionHealth) { throw 'NewBootNotVerified' }
  @{ state='new_boot_verified';runId=$RunId;bootCommit=$adoptionHealth.bootCommit;bootedAt=$adoptionHealth.bootedAt;checkedAt=[DateTime]::UtcNow.ToString('o');protectionBypassed=$false } | ConvertTo-Json | Set-Content -LiteralPath $adoptionProofPath -Encoding utf8
  # Reload only the existing Owner bridge child; its supervisor owns replacement.
  $adoptionListener = @(Get-NetTCPConnection -State Listen -LocalPort 8091)
  if ($adoptionListener.Count -ne 1) { throw 'UnexpectedBridgeListener' }
  $adoptionBridge = Get-CimInstance Win32_Process -Filter "ProcessId=$($adoptionListener[0].OwningProcess)"
  $adoptionParent = Get-CimInstance Win32_Process -Filter "ProcessId=$($adoptionBridge.ParentProcessId)"
  $adoptionOwner = $adoptionBridge | Invoke-CimMethod -MethodName GetOwner
  if ($adoptionOwner.ReturnValue -ne 0 -or ($adoptionOwner.Domain + '\' + $adoptionOwner.User) -ine [Security.Principal.WindowsIdentity]::GetCurrent().Name -or $adoptionBridge.CommandLine -notmatch 'aroma-agent-backend[\\/]scripts[\\/]subscription[\\/]startBridge\.js' -or $adoptionParent.CommandLine -notmatch 'aroma-agent-backend[\\/]scripts[\\/]memory[\\/]serviceSupervisor\.cjs"? bridge$') { throw 'UnexpectedBridgeProcess' }
  Stop-Process -Id $adoptionBridge.ProcessId -Force -ErrorAction Stop
} catch {
  @{ state='reload_unconfirmed';runId=$RunId;errorClass=$_.Exception.GetType().Name;checkedAt=[DateTime]::UtcNow.ToString('o');protectionBypassed=$false } | ConvertTo-Json | Set-Content -LiteralPath $adoptionProofPath -Encoding utf8
  throw
}
