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

# The two shared folders the Companion needs at run time. Fixed absolute paths,
# outside the staged tree because the operator has ReadAndExecute there.
$AuditDir    = 'C:\Aroma\ComputerOperator-Audit'
$ReceiptsDir = 'C:\Aroma\ComputerOperator-Receipts'

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
    # ── ENFORCED vs OBSERVED ────────────────────────────────────────────────
    #
    # ENFORCED means WE set the permission, we can say when and with what
    # script, and a violation is a real finding. OBSERVED means we measured it
    # and have no standing to demand anything - it is printed, never blocking.
    #
    # C:\Windows\Temp and the operator's own profile were ENFORCED until
    # 2026-08-01 and should never have been. Both are writable by design on
    # every Windows machine; nobody had ever verified otherwise; and the
    # expectation contradicted this same script twice over - `auditwritable`
    # probes %TEMP%, which IS the profile, and Install-OperatorShortcuts writes
    # the desktop icons into it. A preflight that demands the profile be
    # unwritable cannot pass on a machine where the operator can log in.
    #
    # The rule that replaces the guesswork: ONLY ENFORCE AN ACL YOU SET
    # YOURSELF. Microsoft's defaults are not ours to assert.
    $enforced = @(
      @{ path = 'C:\Aroma'
         provenance = 'deploy-companion.ps1:119 - inherit-only DENY FullControl for the operator'
         expect = $false },
      @{ path = $StageDir
         provenance = 'stage-canary-closure.ps1 / Owner ACL - operator ReadAndExecute only'
         expect = $false }
    )
    # Measured for the record and for the commissioning baseline. Never blocks.
    $observed = @('C:\Windows\Temp', $env:USERPROFILE)

    $out = @()
    $residue = @()
    foreach ($e in $enforced) {
      $dir = $e.path
      $writable = $false
      $probe = Join-Path $dir ('.aroma-probe-' + [Guid]::NewGuid().ToString('N') + '.tmp')
      try {
        [IO.File]::WriteAllText($probe, 'probe')
        $writable = $true
        try { Remove-Item -LiteralPath $probe -Force -ErrorAction Stop } catch { $residue += $probe }
      } catch { $writable = $false }
      $out += @{ path = $dir; writable = $writable; class = 'enforced'; provenance = $e.provenance; expect = $e.expect }
    }
    foreach ($dir in $observed) {
      $writable = $false
      $probe = Join-Path $dir ('.aroma-probe-' + [Guid]::NewGuid().ToString('N') + '.tmp')
      try {
        [IO.File]::WriteAllText($probe, 'probe')
        $writable = $true
        try { Remove-Item -LiteralPath $probe -Force -ErrorAction Stop }
        catch { $residue += $probe }
      } catch { $writable = $false }
      # No `expect`. Nothing here is being asserted - the value is recorded so a
      # commissioning baseline has real numbers in it instead of guesses.
      $out += @{ path = $dir; writable = $writable; class = 'observed' }
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
    # ── IT WAS CHECKING A DIRECTORY NOTHING WRITES TO ───────────────────────
    #
    # This probed %TEMP%. The Companion's artifact store writes to $AuditDir.
    # Those are different places, so the preflight was confirming that a folder
    # nobody uses was writable, and saying nothing about the folder every audit
    # record actually goes to.
    #
    # Same shape as the staging check that verified the Phase 3a program: a
    # green answer about the wrong object. And it would have failed LATE - past
    # every other check, inside the executor's first admission write, with the
    # flag already on.
    #
    # Note it also cannot use the staged tree: the operator has ReadAndExecute
    # there, by design, so <stage>\.aroma is unwritable to it. Hence a separate
    # folder with its own ACL.
    # ── AND IT IS READ, NOT WRITTEN ─────────────────────────────────────────
    # The operator has Write and NOT Delete here, for the same reason it has no
    # Delete on the canary folder: it may create evidence and must never be able
    # to destroy it. So a write-probe could not clean up after itself and would
    # accumulate one file per run, forever - the exact defect just removed from
    # the `writable` op.
    #
    # We set this ACL, so we assert it by reading it. That is the same rule the
    # in-scope path now follows: only enforce what you established, and a
    # permission you established is a fact you can read.
    if (-not (Test-Path -LiteralPath $AuditDir)) {
      Emit @{ ok = $true; writable = $false; reason = 'audit_dir_missing'; path = $AuditDir }
    } else {
      try {
        $acl = Get-Acl -LiteralPath $AuditDir -ErrorAction Stop
        $me = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
        $write = [int][Security.AccessControl.FileSystemRights]::Write
        $can = $false
        $denied = $false
        foreach ($r in @($acl.Access)) {
          $sid = ''
          try { $sid = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { continue }
          if ($sid -ne $me) { continue }
          if ($r.AccessControlType -eq 'Deny' -and (([int]$r.FileSystemRights) -band $write) -ne 0) { $denied = $true }
          if ($r.AccessControlType -eq 'Allow' -and (([int]$r.FileSystemRights) -band $write) -eq $write) { $can = $true }
        }
        Emit @{ ok = $true; writable = ($can -and -not $denied); path = $AuditDir }
      } catch {
        Emit @{ ok = $true; writable = $false; reason = 'audit_dir_acl_unreadable'; path = $AuditDir }
      }
    }
  }

  default { Fail ('unknown_op:' + $op) }
}
