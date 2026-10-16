param([Parameter(Mandatory=$true)][ValidateSet('protect','unprotect')][string]$Operation)
$ErrorActionPreference='Stop'
try {
  # Trusted host pipe only. No paths, credentials, file writes or elevation.
  $builder=[Text.StringBuilder]::new()
  $buffer=[char[]]::new(8192)
  while (($count=[Console]::In.Read($buffer,0,$buffer.Length)) -gt 0) {
    if ($builder.Length+$count -gt 67108864) { throw 'snapshot_size_limit' }
    $null=$builder.Append($buffer,0,$count)
  }
  $bytes=[Convert]::FromBase64String($builder.ToString())
  if ($Operation -eq 'protect') {
    $result=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  } else {
    $result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch {
  [Console]::Error.Write('offline_snapshot_crypto_failed')
  exit 3
}
