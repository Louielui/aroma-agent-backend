# Repair the legacy conversation archive for the existing LocalService backend.
# Run elevated through the normal Windows administrator prompt. No policy override.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$EvidencePath)
$ErrorActionPreference = 'Stop'
$archiveDirectory = 'C:\Aroma\XiangxiangLab\conversation-archive'
if (-not [IO.Path]::IsPathRooted($EvidencePath) -or (Test-Path -LiteralPath $EvidencePath)) { throw 'EvidencePath must be a new absolute file path' }
$archiveItem = Get-Item -LiteralPath $archiveDirectory
if (-not $archiveItem.PSIsContainer -or ($archiveItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected a real archive directory' }
$service = Get-CimInstance Win32_Service -Filter "Name='AromaXiangXiangBackend'"
if ($service.StartName -notin @('NT AUTHORITY\LocalService', 'NT AUTHORITY\LOCAL SERVICE')) { throw 'Unexpected service identity' }
$archiveFiles = @('archive.jsonl', 'audit.jsonl') | ForEach-Object { Join-Path $archiveDirectory $_ }
foreach ($archiveFile in $archiveFiles) {
  $item = Get-Item -LiteralPath $archiveFile
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected regular archive files' }
}
$targets = @($archiveDirectory) + $archiveFiles
$before = @($targets | ForEach-Object { @{ path=$_; sddl=(Get-Acl -LiteralPath $_).Sddl } })
# Preserve rollback evidence before changing any ACL. Archive content is not copied.
@{ before=$before; applied=$false } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
$identity = [Security.Principal.SecurityIdentifier]::new('S-1-5-19')
foreach ($target in $targets) {
  $acl = Get-Acl -LiteralPath $target
  $rights = if ($target -eq $archiveDirectory) { [Security.AccessControl.FileSystemRights]'ReadAndExecute,Write' } else { [Security.AccessControl.FileSystemRights]'Read,Write' }
  # Explicit grants to these three objects only. No inheritance or recursive grant.
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity,$rights,[Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $target -AclObject $acl
}
$after = @($targets | ForEach-Object { @{ path=$_; sddl=(Get-Acl -LiteralPath $_).Sddl } })
@{ before=$before; after=$after; applied=$true; at=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
