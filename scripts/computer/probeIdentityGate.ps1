# probeIdentityGate.ps1 - Phase 3b. GATE A: a measurement path refuses to run as anyone but
# the Companion account.
#
# WHY THIS EXISTS
# The assistant ran the real measurement path twice inside the OWNER's session, destroying a
# live clipboard sentinel. The proximate cause was a switch that failed to bind. The actual
# problem was that the path COULD run there at all.
#
# This is the BELT, not the boundary. It is script-internal, so it only protects against the
# failure modes its author anticipated - and the author is the party that keeps getting this
# wrong. The boundary is restrict-probe-dir.ps1, which removes the ability to read the
# scripts at all. Both are in place because either alone has a gap the other covers.
#
# NO param() BLOCK, DELIBERATELY. Dot-sourcing runs the other script's param() block in the
# CALLER's scope: assertionRegistry.ps1 declaring -SelfTest and -RegistryPath silently reset
# both in every probe, which is how -RegistryPath came to have never worked and how a bound
# -SelfTest became $false. A file that is dot-sourced must declare no parameters.

$script:PROBE_EXPECTED_ACCOUNT = 'AromaOperator'

# The refusal is RECORDED, not just printed. A console line vanishes with the window, and the
# whole point is that a refusal must be reviewable afterwards - who, which session, when.
function Write-ProbeRefusal {
  param([string]$Script, [string]$Actual, [int]$SessionId, [string]$Reason, [string]$EvidenceDir)
  $line = ([ordered]@{
    marker = 'PROBE-REFUSED'
    script = $Script
    reason = $Reason
    expectedAccount = $script:PROBE_EXPECTED_ACCOUNT
    actualIdentity = $Actual
    sessionId = $SessionId
    at = (Get-Date).ToString('o')
  } | ConvertTo-Json -Compress)

  Write-Host ""
  Write-Host "*** REFUSED - WRONG IDENTITY. NOTHING WAS MEASURED. ***" -ForegroundColor Red
  Write-Host ("  script   : " + $Script) -ForegroundColor Red
  Write-Host ("  expected : " + $script:PROBE_EXPECTED_ACCOUNT) -ForegroundColor Red
  Write-Host ("  actual   : " + $Actual + "   session " + $SessionId) -ForegroundColor Red
  Write-Host ("  reason   : " + $Reason) -ForegroundColor Red

  # TEMP first: it is the one location writable by whoever is running, including the Owner in
  # their own session, which is exactly the case this gate exists to catch. The evidence
  # directory is attempted too but must never be required - a refusal that cannot be written
  # must still be a refusal.
  $written = @()
  foreach ($dir in @($env:TEMP, $EvidenceDir)) {
    if (-not $dir) { continue }
    try {
      $p = Join-Path $dir 'probe-refusals.log'
      Add-Content -LiteralPath $p -Value $line -Encoding UTF8 -ErrorAction Stop
      $written += $p
    } catch { }
  }
  if (@($written).Count) { Write-Host ("  recorded : " + (@($written) -join ', ')) -ForegroundColor Yellow }
  else { Write-Host "  COULD NOT RECORD THE REFUSAL ANYWHERE - the console is the only trace." -ForegroundColor Yellow }
}

# Returns $true when the caller may measure. Never throws; the caller decides how to stop, so
# a probe that must write a HALTED record can still do so.
function Test-ProbeIdentity {
  param([string]$Script, [string]$EvidenceDir)
  $idn = [Security.Principal.WindowsIdentity]::GetCurrent()
  $sid = (Get-Process -Id $PID).SessionId
  # Compare the SAM account, not the full NAME: the domain/machine prefix varies and a
  # substring match would pass for an account merely CONTAINING the expected name.
  $sam = ([string]$idn.Name -split '\\')[-1]
  if ($sam -eq $script:PROBE_EXPECTED_ACCOUNT) { return $true }
  Write-ProbeRefusal -Script $Script -Actual $idn.Name -SessionId $sid `
    -Reason 'a measurement path may only run as the Companion account' -EvidenceDir $EvidenceDir
  $false
}
