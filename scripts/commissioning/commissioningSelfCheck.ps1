# commissioningSelfCheck.ps1 - the launcher checks its OWN machinery before it touches the
# machine. Runs against a scratch directory: no state changed, no measurement taken.
#
# WHY THIS EXISTS RATHER THAN "the executor does a dry run first"
# There is one person at this machine. Any step written as "someone else rehearses it" is a
# step Louie performs cold, on an untested path. So the rehearsal is folded in and runs on
# every press, before anything is changed.
#
# It cannot rehearse the OTHER session - that would need Louie to switch accounts twice for a
# dress rehearsal and twice again for the real run. The cross-session path is exercised once,
# live, and every branch of it ends in the same fail-safe screen.
#
# Returns @{ ok; summary; detail }.

# Dot-source the core: this script is invoked with & from the launcher, so $script:
# variables set in the LAUNCHER's scope are NOT visible here. The self-check caught this.
. (Join-Path $PSScriptRoot 'commissioningCore.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$fails = New-Object System.Collections.Generic.List[string]
$root = Join-Path ([IO.Path]::GetTempPath()) ('cx-selfcheck-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $root -Force | Out-Null
$savedRoot = $script:CX_CommissionRoot
$script:CX_CommissionRoot = $root

function T { param([string]$What, [bool]$Ok) if (-not $Ok) { $fails.Add($What) } }

try {
  $n = 'selfcheck0001'
  New-Item -ItemType Directory -Path (CX-RoundDir -Nonce $n) -Force | Out-Null

  # exact write - Set-Content's added trailing newline is what made C7 unable to pass
  $o = [ordered]@{ marker = 'SELFCHECK'; v = 1 }
  $p = CX-WriteJson -Path (CX-Marker -Nonce $n -Name 'T.json') -Object $o
  T 'exact-write' ((($o | ConvertTo-Json -Depth 10)) -ceq ([IO.File]::ReadAllText($p)))
  T 'read-back' ((CX-ReadJson -Path $p).marker -eq 'SELFCHECK')

  T 'sha256' ((CX-Sha256Text -Text 'abc') -eq 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  T 'sha256-missing-file-is-null' ($null -eq (CX-Sha256File -Path (Join-Path $root 'nope')))

  # THE FAIL-SAFE ITSELF. If this does not work, nothing else matters: it is the only screen
  # Louie is ever shown when something goes wrong.
  $f = CX-Fail -UI $null -Nonce $n -Stage 'selfcheck' -Reason 'deliberate' -Detail @('x') -Launcher 'owner'
  T 'failreport-json' (Test-Path -LiteralPath $f.json)
  T 'failreport-txt' (Test-Path -LiteralPath $f.txt)
  T 'failreport-sha' ($f.sha256 -match '^[a-f0-9]{64}$')
  $body = [IO.File]::ReadAllText($f.txt)
  T 'failreport-says-stopped-safely' ($body.Contains($script:CX_FAILSAFE_LINE1))
  T 'failreport-says-nothing-to-fix' ($body.Contains($script:CX_FAILSAFE_LINE2))
  T 'failreport-says-photo-then-stop' ($body.Contains($script:CX_FAILSAFE_LINE3))
  $banner = CX-FailSafeBanner -Path $f.txt -Sha $f.sha256
  T 'failsafe-banner-has-all-three' ($banner.Contains($script:CX_FAILSAFE_LINE1) -and $banner.Contains($script:CX_FAILSAFE_LINE2) -and $banner.Contains($script:CX_FAILSAFE_LINE3))

  # the handoff, both directions
  $mk = CX-Marker -Nonce $n -Name 'LATE.json'
  T 'marker-timeout-returns-null' ($null -eq (CX-WaitForMarker -UI $null -Path $mk -TimeoutSeconds 2 -WaitBanner 'x'))
  [void](CX-WriteJson -Path $mk -Object @{ marker = 'LATE' })
  T 'marker-pickup' (((CX-WaitForMarker -UI $null -Path $mk -TimeoutSeconds 5 -WaitBanner 'x')).marker -eq 'LATE')

  T 'session-probe-answers' ($null -ne (CX-OperatorSession))
  T 'elevation-probe-answers' ($null -ne (CX-IsElevated))
}
catch { $fails.Add('self-check threw: ' + $_.Exception.Message) }
finally {
  $script:CX_CommissionRoot = $savedRoot
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

@{
  ok = ($fails.Count -eq 0)
  summary = $(if ($fails.Count -eq 0) { 'all self-checks passed' } else { ($fails.Count.ToString() + ' self-check(s) failed') })
  detail = @($fails)
}
