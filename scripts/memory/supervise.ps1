$ErrorActionPreference = 'Stop'
# Compatibility only. User Startup shortcuts target the Node supervisor directly.
$memoryEntry = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'serviceSupervisor.cjs'))
& (Get-Command node.exe -ErrorAction Stop).Source $memoryEntry hindsight
exit $LASTEXITCODE
