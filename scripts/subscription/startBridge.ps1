$ErrorActionPreference = 'Stop'
$subscriptionRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$subscriptionEntry = Join-Path $PSScriptRoot 'startBridge.js'
$subscriptionNode = (Get-Command node.exe -ErrorAction Stop).Source
$subscriptionLogDir = Join-Path $env:LOCALAPPDATA 'AromaXiangXiang/subscription-bridge'
[IO.Directory]::CreateDirectory($subscriptionLogDir) | Out-Null
# One user-session supervisor; restart the bridge after an unexpected exit.
$subscriptionMutex = New-Object Threading.Mutex($false, 'Local\AromaXiangXiangSubscriptionBridge')
if (-not $subscriptionMutex.WaitOne(0)) { exit 0 }
try {
  while ($true) {
    $subscriptionProcess = Start-Process -FilePath $subscriptionNode -ArgumentList ('"' + $subscriptionEntry + '"') -WorkingDirectory $subscriptionRepo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $subscriptionLogDir 'stdout.log') -RedirectStandardError (Join-Path $subscriptionLogDir 'stderr.log')
    $subscriptionProcess.WaitForExit()
    Start-Sleep -Seconds 10
  }
} finally {
  $subscriptionMutex.ReleaseMutex()
  $subscriptionMutex.Dispose()
}
