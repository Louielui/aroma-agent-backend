$ErrorActionPreference = 'Stop'
$memoryRepo = 'C:\Aroma\aroma-agent-backend'
$memoryLog = 'C:\Aroma\hindsight-runtime'
$memoryMutex = [System.Threading.Mutex]::new($false, 'Local\AromaXiangXiangHindsight')
if (-not $memoryMutex.WaitOne(0)) { exit 0 }
try {
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    if (Get-NetTCPConnection -State Listen -LocalPort 8888 -ErrorAction SilentlyContinue) { exit 0 }
    $memoryChild = Start-Process node -WindowStyle Hidden -PassThru -ArgumentList "$memoryRepo\scripts\memory\startHindsight.cjs" -WorkingDirectory $memoryLog -RedirectStandardOutput "$memoryLog\service.log" -RedirectStandardError "$memoryLog\service.err"
    $memoryChild.WaitForExit()
    Start-Sleep -Seconds 10
  }
} finally { $memoryMutex.ReleaseMutex(); $memoryMutex.Dispose() }
