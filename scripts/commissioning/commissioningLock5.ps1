# commissioningLock5.ps1 - the OWNER half of Lock 5. Elevated, Louie's session.
#
# Runs ONLY after Part B has been sealed. Owner ruling 2026-07-30: a Lock 5 result may not
# alter a Part B result that already stands, so this is called after the seal and its verdict
# is reported in a separate column.
#
# It is the SERVICE side of the three kill bindings. The Companion is started by the operator
# session (no credential needed there), this connects to the pipe it created - the direction
# ipcChannel.js was designed for, and the reason no Get-Credential prompt appears anywhere in
# the commissioning path.
#
# Returns @{ ok; verdict; summary }.

param($UI, [string]$Nonce, [switch]$DryRun)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$DRY = ($PSBoundParameters.ContainsKey('DryRun') -and [bool]$PSBoundParameters['DryRun'])
$BINDINGS = @('gate', 'abort', 'oskill')

# open the gate so the operator side may begin
[void](CX-WriteJson -Path (CX-Marker -Nonce $Nonce -Name 'LOCK5-GO.json') -Object @{
  marker='LOCK5-GO'; note='Part B is sealed; Lock 5 may begin'; dryRun=[bool]$DRY; at=(Get-Date).ToString('o') })

if ($DRY) {
  return @{ ok = $true; verdict = 'SKIPPED'; summary = 'dry run - no bindings demonstrated' }
}

$node = 'node'
foreach ($c in @('C:\Program Files\nodejs\node.exe', 'C:\Program Files (x86)\nodejs\node.exe')) {
  if (Test-Path -LiteralPath $c) { $node = $c; break }
}
$demo = Join-Path $script:CX_Scripts 'demo-killswitch.js'

# wait for the observation to be PROVEN in flight before any binding runs
$inflight = CX-WaitForMarker -UI $UI -Path (CX-Marker -Nonce $Nonce -Name 'OBSERVATION-INFLIGHT.json') -TimeoutSeconds 600 `
  -WaitBanner 'Stop-control check: waiting for the other account to start an observation.'
if (-not $inflight) {
  return @{ ok = $false; verdict = 'INVALID'; summary = 'the operator side never reported an observation in flight' }
}

$results = @()
foreach ($b in $BINDINGS) {
  if ($UI) { $UI.SetStep('lock5', 'run', ('binding ' + $b)) }
  $ready = CX-WaitForMarker -UI $UI -Path (CX-Marker -Nonce $Nonce -Name ('COMPANION-READY-' + $b + '.json')) -TimeoutSeconds 600 `
    -WaitBanner ('Stop-control check: waiting for a fresh Companion for binding ' + $b)
  if (-not $ready) {
    $results += [ordered]@{ binding=$b; ok=$false; detail='no Companion was offered' }
    [void](CX-WriteJson -Path (CX-Marker -Nonce $Nonce -Name ('KILL-DONE-' + $b + '.json')) -Object @{
      marker='KILL-DONE'; binding=$b; ok=$false; detail='no Companion was offered'; at=(Get-Date).ToString('o') })
    break
  }

  # demo-killswitch.js proves the Companion ALIVE with a real ping/pong before it kills
  # anything, and reports NOT DEMONSTRATED rather than a pass if the target was already dead.
  # That check stays where it is; this does not re-implement it.
  $out = CX-Marker -Nonce $Nonce -Name ('kill-' + $b + '.json')
  $log = CX-Marker -Nonce $Nonce -Name ('kill-' + $b + '.log')
  $p = Start-Process -FilePath $node -ArgumentList @($demo, $ready.pipeName, $out, $b) `
       -PassThru -WindowStyle Hidden -RedirectStandardOutput $log
  $p | Wait-Process -Timeout 180 -ErrorAction SilentlyContinue
  if (-not $p.HasExited) { try { Stop-Process -Id $p.Id -Force } catch { } }

  $ev = CX-ReadJson -Path $out
  $ok = [bool]($ev -and $ev.demonstratedAgainstLiveCompanion)
  $detail = if ($ev) { ('alive before: ' + $ev.companionAliveBefore) } else { 'no evidence file written' }
  $results += [ordered]@{ binding=$b; ok=$ok; detail=$detail; evidence=$out }
  [void](CX-WriteJson -Path (CX-Marker -Nonce $Nonce -Name ('KILL-DONE-' + $b + '.json')) -Object @{
    marker='KILL-DONE'; binding=$b; ok=$ok; detail=$detail; at=(Get-Date).ToString('o') })
  if (-not $ok) { break }
}

$done = CX-WaitForMarker -UI $UI -Path (CX-Marker -Nonce $Nonce -Name 'LOCK5-DONE.json') -TimeoutSeconds 900 `
  -WaitBanner 'Stop-control check: waiting for the other account to re-measure the observation.'
if (-not $done) {
  return @{ ok = $false; verdict = 'INVALID'; summary = 'the operator side did not report the observation result' }
}

$allBound = (@($results | Where-Object { $_.ok }).Count -eq $BINDINGS.Count)
@{
  ok = ([string]$done.verdict -eq 'CONFIRMED' -and $allBound)
  verdict = [string]$done.verdict
  summary = ('bindings demonstrated ' + @($results | Where-Object { $_.ok }).Count + '/' + $BINDINGS.Count + '; observation ' + [string]$done.verdict)
}
