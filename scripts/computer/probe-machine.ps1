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
    # ── THE ALLOWED PATH IS NOT PROBED BY WRITING. MEASURED, NOT PREFERRED ──
    #
    # It used to be. Every run left a file behind, and the file then failed the
    # NEXT run's "folder is empty" check - a probe that broke the check after
    # it. Two runs on the operator's first real login left two .tmp files and
    # the canary could not start.
    #
    # The reason is structural, not a bug to patch: AromaOperator's mask on
    # ComputerOperator-Test is 0x1201BF. That is Modify MINUS 0x10000, and
    # 0x10000 is DELETE. FILE_DELETE_CHILD (0x40) is absent too. So the account
    # can create a file there and can NEVER remove it, by either route.
    #
    # And that is deliberate: FORBIDDEN_RIGHTS in companionCanaryRunner refuses
    # the run if the operator holds Delete, because the account that performs
    # the canary must not be able to delete its own evidence. The write-then-
    # delete measurement was therefore impossible from the day the ACL was set.
    #
    # So the paths split by what a success would MEAN:
    #
    #   in scope      a successful write proves nothing new - the exact mask is
    #                 already asserted bit by bit against EXPECTED_ACES, Delete
    #                 included - and is the only case that can leave residue.
    #                 Not written to.
    #   out of scope  a write is EXPECTED TO FAIL, and a failure creates
    #                 nothing. If one succeeds, that is the finding this op
    #                 exists for, and its residue is evidence rather than
    #                 litter - reported, not silently cleaned.
    $outOfScope = @('C:\Aroma', 'C:\Aroma\ComputerOperator-Companion', 'C:\Windows\Temp', $env:USERPROFILE)
    $out = @()
    $residue = @()
    foreach ($dir in $outOfScope) {
      $writable = $false
      $probe = Join-Path $dir ('.aroma-probe-' + [Guid]::NewGuid().ToString('N') + '.tmp')
      try {
        [IO.File]::WriteAllText($probe, 'probe')
        # Reaching this line IS the finding: the operator wrote outside its
        # scope. Removal is attempted, and a failure is recorded rather than
        # swallowed - but either way the caller is told the path is writable.
        $writable = $true
        try { Remove-Item -LiteralPath $probe -Force -ErrorAction Stop }
        catch { $residue += $probe }
      } catch { $writable = $false }
      $out += @{ path = $dir; writable = $writable }
    }
    Emit @{
      ok        = $true
      paths     = $out
      notProbed = @(@{ path = $TestDir; reason = 'in_scope_mask_asserted_by_acl_check' })
      residue   = $residue
    }
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
    # THE VACUOUS ZERO, and the most expensive place in this file to have it.
    #
    # This line was:
    #     @(Get-Process -Name 'notepad' -ErrorAction SilentlyContinue).Count
    #
    # -ErrorAction SilentlyContinue was there for a real reason: Get-Process
    # -Name errors when NOTHING matches, so without it a clean machine looks
    # like a failure. But it swallows every other error the same way, and the
    # result of a swallowed error is COUNT = 0 - "no Notepad is open", the
    # exact answer that lets a canary proceed.
    #
    # So the two cases are separated instead of merged. Get-Process with no
    # -Name never errors on "none found", so an empty list means empty and a
    # thrown error means the question could not be answered. The caller's
    # notepadCount() already returns -1 on transport failure precisely so that
    # "unknown" can never equal 0; this closes the same hole one layer down,
    # where the -1 could not reach.
    $all = $null
    try { $all = @(Get-Process -ErrorAction Stop) }
    catch { Fail 'notepad_count_unavailable' $_.Exception.Message }
    Emit @{ ok = $true; count = @($all | Where-Object { $_.ProcessName -eq 'notepad' }).Count }
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
