$ErrorActionPreference = 'Stop'
# Compatibility only. User Startup shortcuts target the Node supervisor directly.
$subscriptionEntry = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../memory/serviceSupervisor.cjs'))
& (Get-Command node.exe -ErrorAction Stop).Source $subscriptionEntry bridge
exit $LASTEXITCODE
