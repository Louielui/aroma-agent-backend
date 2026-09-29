# Create only the dedicated local mailbox credential directory.
# Run elevated; do not change the existing Owner credential directory.
$ErrorActionPreference = 'Stop'
$mailStorePath = 'C:\ProgramData\AromaXiangXiang\admin-mail-secrets'
[IO.Directory]::CreateDirectory($mailStorePath) | Out-Null
$mailAcl = New-Object Security.AccessControl.DirectorySecurity
$mailAcl.SetAccessRuleProtection($true, $false)
foreach ($mailSid in @('S-1-5-18', 'S-1-5-19', 'S-1-5-32-544')) {
  $mailIdentity = New-Object Security.Principal.SecurityIdentifier($mailSid)
  $mailRule = New-Object Security.AccessControl.FileSystemAccessRule($mailIdentity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $mailAcl.AddAccessRule($mailRule)
}
Set-Acl -LiteralPath $mailStorePath -AclObject $mailAcl
Write-Output 'Dedicated mailbox credential store prepared.'
