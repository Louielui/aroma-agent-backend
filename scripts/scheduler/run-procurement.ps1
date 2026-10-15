# Fixed loopback trigger. No business data, commands, identity or URLs are accepted as input.
$ErrorActionPreference='Stop'
$token=[Environment]::GetEnvironmentVariable('HUB_TOKEN','User')
if([string]::IsNullOrWhiteSpace($token)){$token=[Environment]::GetEnvironmentVariable('HUB_TOKEN','Machine')}
if([string]::IsNullOrWhiteSpace($token)){Write-Output 'procurement_authentication_unavailable';exit 3}
try {
  $health=Invoke-RestMethod 'http://127.0.0.1:8090/health' -TimeoutSec 10
  if($health.service -cne 'aroma-hub'){throw 'wrong_service'}
  $result=Invoke-RestMethod 'http://127.0.0.1:8090/api/v1/procurement/tick' -Method Post -Headers @{Authorization='Bearer '+$token} -ContentType 'application/json' -Body '{}' -TimeoutSec 180
  if($result.run -and $result.run.state -in @('COMPLETE','PARTIAL')){Write-Output ('procurement_recorded_'+$result.run.state);exit 0}
  if($result.due -eq $false){Write-Output 'procurement_not_due';exit 0}
  throw 'procurement_failed'
}catch{Write-Output 'procurement_unavailable';exit 5}
