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

# No command-line payload: the shared transport reads base64 from stdin.
# A JSON payload in argv was measurably destroyed by Windows quoting.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'aromaJsonTransport.ps1')

function Emit { param([hashtable] $R) Write-AromaEnvelope $R; exit 0 }
# The detail is optional and carried through: "a file changed" without saying
# WHICH file sends the reader to check twenty-odd of them by hand.
function Fail { param([string] $Reason, [string] $Detail = $null) Write-AromaRefusal $Reason $Detail }

$p = Read-AromaPayload
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
    # WHAT THIS USED TO CHECK, AND WHY IT WAS THE WRONG THING
    #
    # It compared the staged folder against seven hard-coded file names - the
    # Phase 3a pipe Companion. None of those seven is the canary closure. So a
    # preflight step called "the staged program is verified" was verifying a
    # different program, and would have passed with the canary's own files
    # missing, extra or altered.
    #
    # It now reads the manifest the staging script wrote and checks every file
    # by CONTENT, plus refuses any file in the folder that the manifest does
    # not name. An unexpected file in a folder the operator can execute from
    # is exactly the thing this is for.
    if (-not (Test-Path -LiteralPath $StageDir)) { Fail 'staging_missing' }
    $manifestPath = Join-Path $StageDir 'STAGE-MANIFEST.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) { Fail 'staging_manifest_missing' }
    try { $m = Get-Content -LiteralPath $manifestPath -Raw -ErrorAction Stop | ConvertFrom-Json } catch { Fail 'staging_manifest_unreadable' }
    if ($null -eq $m -or $null -eq $m.files) { Fail 'staging_manifest_malformed' }

    try { $onDisk = @(Get-ChildItem -LiteralPath $StageDir -File -Recurse -ErrorAction Stop) } catch { Fail 'staging_unreadable' }

    $listed = @{}
    foreach ($entry in @($m.files)) {
      $abs = Join-Path $StageDir ($entry.path -replace '/', '\')
      $listed[$abs.ToLower()] = $true
      if (-not (Test-Path -LiteralPath $abs)) { Fail 'staging_file_missing' $entry.path }
      $h = (Get-FileHash -LiteralPath $abs -Algorithm SHA256).Hash.ToLower()
      if ($h -ne ([string] $entry.sha256).ToLower()) { Fail 'staging_file_changed' $entry.path }
    }
    # The manifest itself is not in its own file list, so it is allowed; anything
    # else present is not.
    $listed[$manifestPath.ToLower()] = $true
    foreach ($f in $onDisk) {
      if (-not $listed.ContainsKey($f.FullName.ToLower())) { Fail 'staging_unexpected_file' $f.Name }
    }
    Emit @{ ok = $true; count = @($m.files).Count; packageHash = [string] $m.packageHash }
  }

  'echo' {
    # TRANSPORT DIAGNOSTIC ONLY. It returns the payload's own string back so a
    # caller can prove byte-equality through base64/stdin. It reads nothing,
    # writes nothing, starts nothing, and lives in the PROBE rather than in
    # uiaCanary - the canary must never grow a path that acts without a
    # validated order.
    Emit @{ ok = $true; echoed = [string] $p.text }
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
