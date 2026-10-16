# Owner must separately authorize running this exact hashed script elevated.
# Never self-elevates; emits sanitized JSON to stdout. No service/config changes.
$ErrorActionPreference = 'Stop'
$serviceName = 'AromaXiangXiangBackend'
$xmlPath = 'C:\ProgramData\AromaXiangXiang\service-v2\AromaXiangXiangBackend.xml'
$rows = [ordered]@{ schema = 'imagine-maintenance-read-only-v1'; capturedAt = [DateTime]::UtcNow.ToString('o'); service = $null; winsw = $null; processes = @(); jobs = @(); limitations = @('A membership boolean is not containment proof.', 'Discovered handles do not establish complete nested Job hierarchy or effective ancestor restrictions. Unresolved controlling Jobs remain BLOCKED.') }
$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
$rows.service = @{ name = $service.Name; state = $service.State; pid = $service.ProcessId; account = $service.StartName; startMode = $service.StartMode; imagePathSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($service.PathName))).ToLowerInvariant() }
try {
  $bytes = [IO.File]::ReadAllBytes($xmlPath)
  $settings = [Xml.XmlReaderSettings]::new(); $settings.DtdProcessing = 'Prohibit'; $settings.XmlResolver = $null
  $reader = [Xml.XmlReader]::Create([IO.MemoryStream]::new($bytes), $settings)
  $document = [Xml.XmlDocument]::new(); $document.XmlResolver = $null
  try { $document.Load($reader) } finally { $reader.Dispose() }
  $safe = [ordered]@{}
  foreach ($field in @('executable','workingdirectory','stoptimeout','stopparentprocessfirst','startmode')) {
    $node = $document.SelectSingleNode('/service/' + $field)
    if ($node) { $safe[$field] = $node.InnerText }
  }
  # Arguments and environment values can contain credentials: hash, never print.
  $rows.winsw = @{ path = $xmlPath; sha256 = (Get-FileHash -LiteralPath $xmlPath -Algorithm SHA256).Hash.ToLowerInvariant(); fields = $safe; argumentsDisclosure = 'withheld; exact XML bound by SHA256' }
} catch { $rows.winsw = @{ path = $xmlPath; status = 'unavailable'; errorType = $_.Exception.GetType().Name } }
$all = @(Get-CimInstance Win32_Process)
$selected = @($all | Where-Object { $_.ProcessId -eq $service.ProcessId -or $_.ExecutablePath -like 'C:\Aroma\hindsight-runtime\*' -or $_.ExecutablePath -like 'C:\Users\louis\.pg0\installation\*\postgres.exe' -or ($_.Name -in @('node.exe','powershell.exe','pwsh.exe','ImagineBrowserReadHost.exe') -and $_.CommandLine -match 'aroma-agent-backend|serviceSupervisor|ImagineBrowserReadHost') })
$ids = @($selected | ForEach-Object { [uint32]$_.ProcessId })
# Include immediate controlling parents, but never dump their command lines.
$ids = @($ids + @($selected | ForEach-Object { [uint32]$_.ParentProcessId }) | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
foreach ($item in @($all | Where-Object { $_.ProcessId -in $ids })) {
  $hash = $null
  if ($item.ExecutablePath) { try { $hash = (Get-FileHash -LiteralPath $item.ExecutablePath).Hash.ToLowerInvariant() } catch {} }
  $rows.processes += @{ pid = $item.ProcessId; parentPid = $item.ParentProcessId; name = $item.Name; executable = $item.ExecutablePath; executableSha256 = $hash; createdAt = $item.CreationDate }
}
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'InspectMaintenanceJobs.cs')))
$rows.jobs = [InspectMaintenanceJobs]::Capture([uint32[]]$ids) | ConvertFrom-Json
$rows | ConvertTo-Json -Depth 12
