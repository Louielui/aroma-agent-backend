# assertionRegistry.ps1 - Phase 3b. The PowerShell side of the assertion register.
#
# WHY
# Three assertion-id drifts were found by reading code and register together. The worst was
# an E7 COLLISION: the register said "read another session's MainModule", the harness ran
# PROCESS_TERMINATE, and the row looked covered while the registered assertion had never
# run. A fourth was structural - every POS-* positive control existed only in the harness,
# in no register at all, so nothing constrained what it meant.
#
# THE RULE THIS FILE ENFORCES
# A probe may not DEFINE an assertion. It looks the id up here and takes expectedPermitted,
# the access mask and the target from the register. A row that disagrees with the register
# is REFUSED - recorded as INVALID with mechanism REGISTRY-DRIFT - not quietly written.
#
# Refuse, do not trim: a drifted row is not tidied up into a passing one. It is kept, marked
# and counted, because the fact that something tried to emit it is the evidence.
#
# SOURCE OF TRUTH is src/computer/assertionRegistry.js. This reads assertion-registry.json,
# which is a checked-in PROJECTION of that module, guarded by a test that fails if the two
# ever disagree. Regenerate with:  node scripts/computer/generate-assertion-registry.js
#
# Dot-source it:   . (Join-Path $PSScriptRoot 'assertionRegistry.ps1')
# Self-test it:    powershell -NoProfile -File assertionRegistry.ps1 -SelfTest

param([switch]$SelfTest, [string]$RegistryPath)

# THE SAME STRICTNESS AS EVERY CALLER. This was missing, and it is why the self-test below
# passed while stage3-topup.ps1 crashed on the identical code: the probes all run
# Set-StrictMode -Version Latest, the self-test did not, and a `.Count` on an unrolled empty
# array is silently 0 in one mode and a terminating error in the other. A self-test that runs
# under weaker rules than production is not a test of production.
Set-StrictMode -Version Latest

$script:AR_Entries     = $null
$script:AR_Fingerprint = $null
$script:AR_Drift       = New-Object System.Collections.Generic.List[string]

function Import-AssertionRegistry {
  param([string]$Path)
  if (-not $Path) { $Path = Join-Path $PSScriptRoot 'assertion-registry.json' }
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "assertion register not found at $Path - a probe cannot run without it, because without it nothing constrains what its ids mean"
  }
  $doc = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  if ($doc.schema -ne 'aroma.assertionRegistry.v1') { throw "unexpected register schema: $($doc.schema)" }
  $map = @{}
  foreach ($a in $doc.assertions) { $map[$a.id] = $a }
  $script:AR_Entries = $map
  $script:AR_Fingerprint = $doc.fingerprint
  $script:AR_Drift.Clear()
  $map.Count
}

function Get-Assertion {
  param([Parameter(Mandatory = $true)][string]$Id)
  if ($null -eq $script:AR_Entries) { [void](Import-AssertionRegistry) }
  if ($script:AR_Entries.ContainsKey($Id)) { $script:AR_Entries[$Id] } else { $null }
}

function Get-AssertionsByTier {
  param([Parameter(Mandatory = $true)][ValidateSet('A', 'B')][string]$Tier)
  if ($null -eq $script:AR_Entries) { [void](Import-AssertionRegistry) }
  , @($script:AR_Entries.Values | Where-Object { $_.tier -eq $Tier } | Sort-Object id)
}

function Get-AssertionRegistryFingerprint { $script:AR_Fingerprint }

# LEADING COMMA, DELIBERATELY. A function that returns @() emits ZERO objects, so the caller's
# variable becomes $null - and under Set-StrictMode `$null.Count` is a TERMINATING error, not
# 0. That is exactly what killed stage3-topup.ps1 on its first real run, on the clean path:
# no drift, no control problems, empty arrays everywhere, and the reporting section died
# before writing anything. The comma wraps the array so an empty one survives the return.
function Get-AssertionRegistryDrift { , @($script:AR_Drift) }

# Does an emitted target agree with the register? Exact string, or the declared pattern for
# ids whose target carries a per-run nonce.
function Test-AssertionTarget {
  param($Entry, [string]$Target)
  if ($Entry.targetPattern) { return [bool]([regex]::IsMatch([string]$Target, $Entry.targetPattern)) }
  return ([string]$Entry.target -ceq [string]$Target)
}

# THE CROSS-CHECK, applied to one row before it is recorded.
#
# Returns a hashtable of the fields the register OWNS (expectedPermitted, accessMask) plus a
# drift list. The caller must merge these into the row rather than supplying its own, which
# is what makes the register the definition instead of a second opinion.
function Resolve-AssertionRow {
  param(
    [Parameter(Mandatory = $true)][string]$Id,
    [string]$Target,
    $AccessMask = $null
  )
  $e = Get-Assertion -Id $Id
  $drift = New-Object System.Collections.Generic.List[string]

  if ($null -eq $e) {
    $drift.Add("$Id is not in the register - nothing constrains what it means")
    $script:AR_Drift.Add($drift[0])
    return @{
      known = $false; drift = @($drift)
      expectedPermitted = $false; accessMask = $null
      title = $null; mechanismClasses = @(); tier = $null
      implies = $null; doesNotImply = $null; positiveControlId = $null
    }
  }

  if ($PSBoundParameters.ContainsKey('Target') -and -not (Test-AssertionTarget -Entry $e -Target $Target)) {
    $expect = if ($e.targetPattern) { "/$($e.targetPattern)/" } else { "'$($e.target)'" }
    $drift.Add("$Id target drift - register $expect, row '$Target'")
  }
  $regMask = $e.accessMask
  $rowMask = $AccessMask
  if (($null -eq $regMask) -ne ($null -eq $rowMask)) {
    $drift.Add("$Id accessMask drift - register '$regMask', row '$rowMask'")
  } elseif ($null -ne $regMask -and [int]$regMask -ne [int]$rowMask) {
    $drift.Add(("{0} accessMask drift - register 0x{1:X4}, row 0x{2:X4}" -f $Id, [int]$regMask, [int]$rowMask))
  }

  foreach ($d in $drift) { $script:AR_Drift.Add($d) }

  @{
    known = $true
    drift = @($drift)
    expectedPermitted = [bool]$e.expectedPermitted
    accessMask = $e.accessMask
    title = $e.title
    mechanismClasses = @($e.mechanism)
    tier = $e.tier
    implies = $e.implies
    doesNotImply = $e.doesNotImply
    positiveControlId = $e.positiveControlId
  }
}

# Every expectedPermitted:false row must name a positive control that is PRESENT IN THE SAME
# RUN and ACCEPTED. A negative whose control failed proves nothing, and a control from some
# other run is not a control. Returns the list of violations; empty is the only good result.
function Test-PositiveControls {
  param([object[]]$Rows)
  $problems = New-Object System.Collections.Generic.List[string]
  $byId = @{}
  foreach ($r in $Rows) { if ($r.id) { $byId[[string]$r.id] = $r } }
  foreach ($r in $Rows) {
    $e = Get-Assertion -Id ([string]$r.id)
    if ($null -eq $e -or $e.expectedPermitted) { continue }
    if (-not $e.positiveControlId) { $problems.Add("$($r.id): register defect - negative with no positive control"); continue }
    if (-not $byId.ContainsKey([string]$e.positiveControlId)) {
      $problems.Add("$($r.id): positive control $($e.positiveControlId) ABSENT from this run - the negative proves nothing")
    } elseif ([string]$byId[[string]$e.positiveControlId].verdict -ne 'ACCEPTED') {
      $problems.Add("$($r.id): positive control $($e.positiveControlId) is $($byId[[string]$e.positiveControlId].verdict), not ACCEPTED - the negative proves nothing")
    }
  }
  , @($problems)   # leading comma - see Get-AssertionRegistryDrift
}

# ---------------------------------------------------------------------------
# SELF-TEST. Run it; do not parse-check it. This exercises the real loader against the real
# checked-in file and is safe on any machine: it reads, resolves and reports, and touches
# nothing else.
# ---------------------------------------------------------------------------
if ($SelfTest) {
  $n = Import-AssertionRegistry -Path $RegistryPath
  Write-Host "=== assertionRegistry.ps1 self-test ===" -ForegroundColor Cyan
  Write-Host ("  entries     : " + $n)
  Write-Host ("  fingerprint : " + (Get-AssertionRegistryFingerprint))

  # THE CLEAN PATH IS THE PATH PRODUCTION TAKES. Asserted first, and under StrictMode, because
  # every empty-collection defect only shows up when nothing is wrong.
  $emptyDrift = Get-AssertionRegistryDrift
  $emptyProblems = Test-PositiveControls -Rows @()
  $emptyTierless = Get-AssertionsByTier -Tier 'A'
  $survivesEmpty = $true
  foreach ($probe in @(@{ n = 'Get-AssertionRegistryDrift'; v = $emptyDrift },
                       @{ n = 'Test-PositiveControls'; v = $emptyProblems },
                       @{ n = 'Get-AssertionsByTier'; v = $emptyTierless })) {
    try {
      $null = $probe.v.Count
      if ($null -eq $probe.v) { throw 'returned $null' }
    } catch {
      $survivesEmpty = $false
      Write-Host ("  EMPTY-RETURN DEFECT in " + $probe.n + " : " + $_.Exception.Message) -ForegroundColor Red
    }
  }
  Write-Host ("  empty returns keep .Count : " + $survivesEmpty) -ForegroundColor $(if ($survivesEmpty) { 'Green' } else { 'Red' })

  $bad = 0
  foreach ($id in ($script:AR_Entries.Keys | Sort-Object)) {
    $e = Get-Assertion -Id $id
    $probe = if ($e.targetPattern) {
      switch -Regex ($e.targetPattern) {
        'WinSta0..Default'      { '\Sessions\3\Windows\WinSta0\Default'; break }
        'Sessions'              { '\Sessions\3\Windows'; break }
        'AROMA-OWN-'            { 'AROMA-OWN-deadbeef'; break }
        'AROMA-OWNER-SENTINEL-' { 'AROMA-OWNER-SENTINEL-deadbeef'; break }
        'AromaProbeTemp'        { 'AromaProbeTemp-0123abcd'; break }
        'AromaProbeTrig'        { 'AromaProbeTrig-0123abcd'; break }
        'AromaProbeSys'         { 'AromaProbeSys-0123abcd'; break }
        'session '              { 'session 5'; break }
        'Startup\$'             { 'C:\Users\AromaOperator\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup'; break }
        'Desktop\$'             { 'C:\Users\AromaOperator\Desktop'; break }
        'Temp'                  { 'C:\Users\AromaOperator\AppData\Local\Temp'; break }
        default                 { 'C:\Users\AromaOperator' }
      }
    } else { $e.target }

    $r = Resolve-AssertionRow -Id $id -Target $probe -AccessMask $e.accessMask
    if (-not $r.known -or @($r.drift).Count -gt 0) {
      $bad++
      Write-Host ("  DRIFT " + $id + " : " + ($r.drift -join '; ')) -ForegroundColor Red
    }
  }

  # and the checker must be capable of FAILING, or a clean pass above means nothing
  $neg = Resolve-AssertionRow -Id 'E6-open-other-session-process' -Target 'other-session process' -AccessMask 0x1000
  $unknown = Resolve-AssertionRow -Id 'E99-does-not-exist' -Target 'x'
  $controlOk = ($neg.drift.Count -gt 0) -and (-not $unknown.known)

  # positive-control enforcement, both directions
  $missingCtl = Test-PositiveControls -Rows @(
    @{ id = 'E6-open-other-session-process'; verdict = 'BOUNDED' }
  )
  $failedCtl = Test-PositiveControls -Rows @(
    @{ id = 'E6-open-other-session-process'; verdict = 'BOUNDED' },
    @{ id = 'POS-open-own-process-query';    verdict = 'INVALID' }
  )
  $goodCtl = Test-PositiveControls -Rows @(
    @{ id = 'E6-open-other-session-process'; verdict = 'BOUNDED' },
    @{ id = 'POS-open-own-process-query';    verdict = 'ACCEPTED' }
  )

  Write-Host ""
  Write-Host ("  resolved with no drift   : " + ($n - $bad) + " / " + $n) -ForegroundColor $(if ($bad -eq 0) { 'Green' } else { 'Red' })
  Write-Host ("  detects a wrong mask     : " + ($neg.drift.Count -gt 0))
  Write-Host ("  detects an unknown id    : " + (-not $unknown.known))
  Write-Host ("  detects a MISSING control: " + (@($missingCtl).Count -eq 1))
  Write-Host ("  detects a FAILED control : " + (@($failedCtl).Count -eq 1))
  Write-Host ("  passes a good control    : " + (@($goodCtl).Count -eq 0))

  $pass = ($bad -eq 0) -and $survivesEmpty -and $controlOk -and
          (@($missingCtl).Count -eq 1) -and (@($failedCtl).Count -eq 1) -and (@($goodCtl).Count -eq 0)
  Write-Host ""
  if ($pass) { Write-Host "SELF-TEST PASS" -ForegroundColor Green; exit 0 }
  Write-Host "SELF-TEST FAIL" -ForegroundColor Red
  exit 1
}
