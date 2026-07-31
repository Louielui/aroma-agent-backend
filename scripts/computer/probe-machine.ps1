# probe-machine.ps1  -  the Companion measures its own machine, as itself.
#
# ===========================================================================
#  READ ONLY. It reads ACLs, lists a directory, counts Notepads, tests one
#  write and deletes it. It opens nothing, changes no ACL, and starts no
#  application.
#
#  ── WHY IT RUNS AS THE OPERATOR ─────────────────────────────────────────
#  The Owner's side could not read the folder's ACL, and the message blamed
#  the reader. It was not wrong about the folder - the folder is correctly
#  permissioned for AromaOperator, and louis is simply not on it. A check run
#  by the wrong principal answers a question nobody asked, so these run here.
#
#  ── FAILURE IS REPORTED AS FAILURE ──────────────────────────────────────
#  Nothing returns an empty success. An unreadable ACL is ok=$false, not an
#  ACL with no Deny entries; an unlistable directory is ok=$false, not an
#  empty one. Every shape where "could not measure" could be mistaken for a
#  clean result is closed deliberately.
#
#  ── STRICTMODE HAZARDS, ALREADY PAID FOR ────────────────────────────────
#  No [0] indexing into a possibly-empty array (IndexOutOfRangeException),
#  no .Count on an unwrapped call, no $pid. Three separate runs were lost to
#  those; they are not repeated here.
# ===========================================================================

[CmdletBinding()]
param([Parameter(Mandatory = $true)][string] $PayloadJson)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Emit { param([hashtable] $R) $R | ConvertTo-Json -Depth 6 -Compress; exit 0 }
function Fail { param([string] $Reason) @{ ok = $false; reason = $Reason } | ConvertTo-Json -Compress; exit 0 }

try { $p = $PayloadJson | ConvertFrom-Json } catch { Fail 'bad_payload' }
if (-not $p.PSObject.Properties.Match('op').Count) { Fail 'no_op' }
$op = [string] $p.op

$TestDir  = 'C:\Aroma\ComputerOperator-Test'
$StageDir = 'C:\Aroma\ComputerOperator-Companion'

switch ($op) {

  'acl' {
    $path = [string] $p.path
    try { $acl = Get-Acl -LiteralPath $path -ErrorAction Stop } catch { Fail 'acl_unreadable' }
    $rules = @($acl.Access)
    $aces = @{}
    foreach ($r in $rules) {
      if ($r.AccessControlType -ne 'Allow') { continue }
      try { $sid = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { continue }
      $aces[$sid] = [int] $r.FileSystemRights
    }
    Emit @{
      ok             = $true
      protected      = [bool] $acl.AreAccessRulesProtected
      inheritedCount = @($rules | Where-Object { $_.IsInherited }).Count
      denyCount      = @($rules | Where-Object { $_.AccessControlType -eq 'Deny' }).Count
      aces           = $aces
    }
  }

  'listdir' {
    try { $items = @(Get-ChildItem -LiteralPath ([string] $p.path) -Force -ErrorAction Stop) }
    catch { Fail 'listdir_failed' }
    Emit @{ ok = $true; entries = @($items | ForEach-Object { $_.Name }) }
  }

  'fileexists' {
    Emit @{ ok = $true; exists = [bool] (Test-Path -LiteralPath ([string] $p.path)) }
  }

  'writable' {
    # Measured by trying, not by reading permissions and reasoning. Each probe
    # file is removed immediately; a probe that cannot be cleaned up reports
    # the path as writable AND says so, rather than leaving a mystery file.
    $paths = @($TestDir, 'C:\Aroma', 'C:\Aroma\ComputerOperator-Companion', 'C:\Windows\Temp', $env:USERPROFILE)
    $out = @()
    foreach ($dir in $paths) {
      $writable = $false
      $probe = Join-Path $dir ('.aroma-probe-' + [Guid]::NewGuid().ToString('N') + '.tmp')
      try {
        [IO.File]::WriteAllText($probe, 'probe')
        $writable = $true
        Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
      } catch { $writable = $false }
      $out += @{ path = $dir; writable = $writable }
    }
    Emit @{ ok = $true; paths = $out }
  }

  'staging' {
    if (-not (Test-Path -LiteralPath $StageDir)) { Fail 'staging_missing' }
    try { $files = @(Get-ChildItem -LiteralPath $StageDir -File -ErrorAction Stop) } catch { Fail 'staging_unreadable' }
    # Names only here. The closure HASHES are checked by the execution package
    # verification on the Node side, which already owns that comparison - a
    # second implementation would be a second source of truth.
    $expected = @('companion-entry.js','companion.js','computerOperatorFlag.js','ipcChannel.js','observation.js','sealedOrderGate.js','sessionBoundary.js')
    $names = @($files | ForEach-Object { $_.Name } | Sort-Object)
    $diff = Compare-Object -ReferenceObject ($expected | Sort-Object) -DifferenceObject $names
    if ($diff) { Fail 'staging_closure_mismatch' }
    Emit @{ ok = $true; count = $names.Count }
  }

  'notepads' {
    Emit @{ ok = $true; count = @(Get-Process -Name 'notepad' -ErrorAction SilentlyContinue).Count }
  }

  'auditwritable' {
    $dir = Join-Path $env:TEMP 'aroma-audit-probe'
    try {
      if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
      $f = Join-Path $dir 'probe.txt'
      [IO.File]::WriteAllText($f, 'probe')
      Remove-Item -LiteralPath $f -Force
      Emit @{ ok = $true; writable = $true }
    } catch { Emit @{ ok = $true; writable = $false } }
  }

  default { Fail ('unknown_op:' + $op) }
}
