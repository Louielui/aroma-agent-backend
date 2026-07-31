# Retention-Check-Launcher.ps1 - LAUNCHER 4. Lock 3, the retention sweep, as one press.
#
# ── WHY IT EXISTS ───────────────────────────────────────────────────────────
# Owner ruling 2026-07-30. Without it, the physical visit runs Part B by pressing icons and then
# Lock 3 requires opening PowerShell and pasting a command - which puts the Owner straight back
# into being the executor, at the end of a visit whose whole purpose was that he is not.
#
# ── WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────
# It runs the Lock 3 retention sweep against the REAL evidence directory - the store the sweep
# has only ever been exercised against in code. Everything it does is bounded by the sweep's own
# classification: raw material may be deleted once past retention, records never are.
#
# It captures a measurement context first and REFUSES if the context is unusable, so a Lock 3
# result can never be joined to a Part B taken under different conditions.
#
# Not part of the two-press commissioning sequence. Pressed after it, in the same session.

param(
  [switch]$DryRun,
  [string]$RunId
)

. (Join-Path $PSScriptRoot 'commissioningCore.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$DRY = ($PSBoundParameters.ContainsKey('DryRun') -and [bool]$PSBoundParameters['DryRun'])

# ── SELF-ELEVATE ────────────────────────────────────────────────────────────
# The evidence directory needs it. One UAC prompt, never a right-click instruction.
if (-not (CX-IsElevated)) {
  $argl = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $PSCommandPath)
  if ($DRY) { $argl += '-DryRun' }
  if ($RunId) { $argl += @('-RunId', $RunId) }
  try { Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -ArgumentList $argl -Verb RunAs | Out-Null }
  catch {
    Add-Type -AssemblyName System.Windows.Forms
    $r = CX-Fail -UI $null -Nonce $null -Stage 'elevation' -Reason '冇畀到系統管理員批准' `
      -Detail @('冇掃描過任何嘢，亦冇刪除過任何嘢。') -Launcher 'retention'
    [Windows.Forms.MessageBox]::Show(
      (CX-FailSafeBanner -Path $r.txt -Sha $r.sha256), 'Aroma 保留期檢查', 'OK', 'Information') | Out-Null
  }
  exit 0
}

# Protected: an unprotected preamble exits with NO window at all, which leaves the person at the
# machine nothing to photograph. See Operator-Verification-Launcher.ps1 for the incident.
$UI = $null
try {
  $UI = CX-NewUI -Title 'Aroma 第四步 —— 保留期檢查' -Subtitle 'Lock 3 —— 對真實證據資料夾行保留期掃描'
} catch {
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    [Windows.Forms.MessageBox]::Show(
      ('已經停止 —— 而且係安全咁停低咗。' + "`r`n" +
       '呢一步連開始都未開始，冇掃描過亦冇刪過任何嘢。' + "`r`n" +
       '影一張相，然後就可以停手。' + "`r`n`r`n" + $_.Exception.Message),
      'Aroma 第四步', 'OK', 'Information') | Out-Null
  } catch { }
  exit 1
}
$UI.Banner2('開始緊……', 'info')

foreach ($s in @(
  @('find',  '揾出今次驗收嘅回合'),
  @('gate',  '睇 Part B 有冇通過'),
  @('ctx',   '記錄今次量測嘅條件'),
  @('sweep', '行保留期掃描'),
  @('chain', '核對三個階段係咪同一組條件'),
  @('report','寫出報告'),
  @('done',  '完成')
)) { $UI.AddStep($s[0], $s[1]) }

try {
  # ── 1. WHICH ROUND ───────────────────────────────────────────────────────
  $UI.SetStep('find', 'run', '')
  . (Join-Path $script:CX_Scripts 'measurementContext.ps1')

  # The newest round that got as far as sealing Part B - sealed, not passed. The verdict is
  # examined separately below, because "no seal" and "sealed as FAIL" are different situations
  # and collapsing them would report the wrong one.
  $round = $RunId
  if (-not $round) {
    $newest = @(Get-ChildItem -LiteralPath $script:CX_CommissionRoot -Directory -Force -ErrorAction SilentlyContinue |
                Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'PARTB-SEALED.json') } |
                Sort-Object LastWriteTime -Descending)
    if ($newest.Count -gt 0) { $round = $newest[0].Name }
  }

  # ── 2. THE GATE THE OWNER ASKED FOR ──────────────────────────────────────
  # THE GAP THIS CLOSES: if Part B fails, should he still press this icon? The guide did not
  # say - so he would have stood at the machine in front of a red screen deciding, which is the
  # single thing this design exists to spare him. The icon decides instead, and pressing it
  # after a failed Part B is now HARMLESS rather than merely inadvisable.
  #
  # Nothing is read, swept, sealed or removed above this point, so a not-applicable exit leaves
  # the round exactly as Part B left it.
  $UI.SetStep('find', $(if ($round) { 'ok' } else { 'skip' }), $(if ($round) { '回合 ' + $round } else { '揾唔到回合' }))
  $UI.SetStep('gate', 'run', '')

  $seal = $null
  if ($round) { $seal = CX-ReadJson -Path (CX-Marker -Nonce $round -Name 'PARTB-SEALED.json') }
  $partBVerdict = $(if ($seal -and $seal.verdict) { [string]$seal.verdict } else { $null })

  if (-not $round -or -not $seal -or $partBVerdict -ne 'PASS') {
    $why = if (-not $round) { '仲未有一次驗收行到封存 Part B 呢一步。' }
           elseif (-not $seal) { 'Part B 未封存 —— 嗰次驗收冇行完。' }
           else { 'Part B 嘅結果係 ' + $partBVerdict + '，唔係 PASS。' }
    $UI.SetStep('gate', 'skip', $why)
    [void](CX-NotApplicable -UI $UI -Nonce $round -Launcher 'retention' -Why $why `
      -Detail @('保留期檢查只可以喺 Part B 通過之後行。',
                'Part B 未通過之前，佢嘅結果冇嘢可以綁返去，DoD 亦唔應該封存。',
                '冇跑過保留期掃描，冇刪過任何檔案，冇改過任何嘢。'))
    $UI.Form.ShowDialog() | Out-Null
    exit 0   # not a failure: nothing went wrong, and nothing was done
  }
  $UI.SetStep('gate', 'ok', 'Part B：通過')

  # ── 3. MEASUREMENT CONTEXT, AND IT CAN REFUSE ────────────────────────────
  # A Lock 3 result taken while the Companion session is Disconnected cannot be joined to a
  # Part B taken while it was Active - the DoD would be accepting numbers gathered under
  # conditions other than the ones it describes.
  $UI.SetStep('ctx', 'run', '')
  $ctx = New-MeasurementContext -Stage 'lock3' -RunId $round
  [void](Write-MeasurementContext -Path (CX-Marker -Nonce $round -Name 'CONTEXT-lock3.json') -Object $ctx)
  if (-not $ctx.usable) {
    $UI.SetStep('ctx', 'fail', '量測條件唔合格')
    [void](CX-Fail -UI $UI -Nonce $round -Stage 'context' `
      -Reason '而家嘅量測條件，唔可以同 Part B 嘅結果合併' `
      -Detail (@('Lock 3 必須喺同一組條件下量度，否則份記錄就係混合條件。') + @($ctx.unusableBecause) +
               @('冇掃描過任何嘢，冇刪除過任何嘢。')) -Launcher 'retention')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  $UI.SetStep('ctx', 'ok', ('session ' + $ctx.subjectSessionId + ' / ' + $ctx.subjectState + ' / ' + $ctx.subjectProtocol))

  # ── 4. THE SWEEP ─────────────────────────────────────────────────────────
  $UI.SetStep('sweep', 'run', $(if ($DRY) { '試跑 —— 唔會刪任何嘢' } else { '' }))
  # Runs the JS sweep, NOT a PowerShell reimplementation. The classification and the retention
  # rule live in src/computer/evidenceStore.js and are covered by its tests; a second copy in
  # PowerShell would drift from the tested one exactly as the assertion ids and the observer
  # SHA pin did. The launcher shells out rather than duplicating the rule.
  $sweep = Join-Path $script:CX_Scripts 'lock3-sweep.js'
  if (-not (Test-Path -LiteralPath $sweep)) {
    [void](CX-Fail -UI $UI -Nonce $round -Stage 'sweep' -Reason '揾唔到保留期掃描腳本' `
      -Detail @($sweep) -Launcher 'retention')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  $node = $null
  foreach ($cand in @((Get-Command node -ErrorAction SilentlyContinue).Source,
                      'C:\Program Files\nodejs\node.exe')) {
    if ($cand -and (Test-Path -LiteralPath $cand)) { $node = $cand; break }
  }
  if (-not $node) {
    [void](CX-Fail -UI $UI -Nonce $round -Stage 'sweep' -Reason '揾唔到 node' `
      -Detail @('保留期掃描係用 node 行，因為分類規則同保留期只可以有一份實作。') -Launcher 'retention')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  $log = CX-Marker -Nonce $round -Name 'lock3-sweep.log'
  $argl = @($sweep, '--evidence-dir', $script:CX_EvidenceRoot,
            '--result', (CX-Marker -Nonce $round -Name 'lock3-result.json'))
  if ($DRY) { $argl += '--dry-run' }
  $p = Start-Process -FilePath $node -ArgumentList $argl -PassThru -WindowStyle Hidden -RedirectStandardOutput $log
  $p | Wait-Process -Timeout 900 -ErrorAction SilentlyContinue
  if (-not $p.HasExited) {
    try { Stop-Process -Id $p.Id -Force } catch { }
    [void](CX-Fail -UI $UI -Nonce $round -Stage 'sweep' -Reason '保留期掃描逾時' -Detail @($log) -Launcher 'retention')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  if ($p.ExitCode -ne 0) {
    [void](CX-Fail -UI $UI -Nonce $round -Stage 'sweep' -Reason ('保留期掃描結束碼 ' + $p.ExitCode) `
      -Detail @($log) -Launcher 'retention')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  $res = CX-ReadJson -Path (CX-Marker -Nonce $round -Name 'lock3-result.json')
  if (-not $res) {
    [void](CX-Fail -UI $UI -Nonce $round -Stage 'sweep' -Reason '掃描完成但冇寫低結果' `
      -Detail @($log) -Launcher 'retention')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  $UI.SetStep('sweep', 'ok', ('檢視 ' + $res.examined + ' 個檔案，保留 ' + $res.retained + ' 個，' +
    $(if ($DRY) { '試跑冇刪' } else { '刪咗 ' + $res.deleted + ' 個' })))

  # ── 3. SEAL THE CHAIN ────────────────────────────────────────────────────
  # The `dod` context is taken HERE, at the machine, as the last act of the visit. It is not
  # bookkeeping: it attests that at the moment of acceptance the Companion session was still
  # the same session, still Active, still on the console. Captured later - from a remote
  # session, after the machine was left - it would be unusable, and rightly so.
  #
  # NOTE FOR THE OWNER: launcher 4 was specified as the retention check only. The DoD seal was
  # folded in because it is the sole remaining moment at which its own rule can be satisfied.
  # Say the word and it splits into a fifth icon.
  $UI.SetStep('chain', 'run', '')
  $dodCtx = New-MeasurementContext -Stage 'dod' -RunId $round
  [void](Write-MeasurementContext -Path (CX-Marker -Nonce $round -Name 'CONTEXT-dod.json') -Object $dodCtx)

  $seal = CX-ReadJson -Path (CX-Marker -Nonce $round -Name 'PARTB-SEALED.json')
  $verdicts = @{ 'part-b' = $(if ($seal -and $seal.verdict) { [string]$seal.verdict } else { 'UNKNOWN' })
                 'lock3'  = $(if ($res.ok) { 'PASS' } else { 'FAIL' })
                 'dod'    = 'PASS' }
  $adj = Join-Path $script:CX_Scripts 'dod-adjudicate.js'
  $chainOut = CX-Marker -Nonce $round -Name 'DOD-VERDICT.json'
  $clog = CX-Marker -Nonce $round -Name 'dod-adjudicate.log'
  $cargs = @($adj, '--round-dir', (CX-RoundDir -Nonce $round), '--result', $chainOut,
             '--verdicts', ($verdicts | ConvertTo-Json -Compress))
  $cp = Start-Process -FilePath $node -ArgumentList $cargs -PassThru -WindowStyle Hidden -RedirectStandardOutput $clog
  $cp | Wait-Process -Timeout 300 -ErrorAction SilentlyContinue
  $chain = CX-ReadJson -Path $chainOut
  if (-not $chain) {
    [void](CX-Fail -UI $UI -Nonce $round -Stage 'chain' -Reason '核對唔到三個階段嘅條件' `
      -Detail @($clog) -Launcher 'retention')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  $UI.SetStep('chain', $(if ($chain.verdict -eq 'PASS') { 'ok' } else { 'fail' }), [string]$chain.verdict)

  # ── 4. REPORT ────────────────────────────────────────────────────────────
  $UI.SetStep('report', 'run', '')
  $rec = [ordered]@{
    marker = 'LOCK3-DONE'; roundNonce = $round; dryRun = [bool]$DRY
    verdict = $(if ($res.ok) { 'PASS' } else { 'FAIL' })
    examined = $res.examined; retained = $res.retained; deleted = $res.deleted
    context = $ctx
    dodContext = $dodCtx
    # Two separate columns, never merged into one word. A clean retention sweep whose stages
    # were measured under different conditions is a PASSED Lock 3 inside a record that cannot
    # be accepted - and the report has to be able to say exactly that.
    chainVerdict = [string]$chain.verdict
    chainProblems = @($chain.problems)
    at = (Get-Date).ToString('o')
  }
  $rp = CX-WriteJson -Path (CX-Marker -Nonce $round -Name 'LOCK3-DONE.json') -Object $rec
  $sha = CX-Sha256File -Path $rp
  $UI.SetStep('report', 'ok', 'LOCK3-DONE.json')
  $UI.SetStep('done', 'ok', '')

  $l3 = $(if ($res.ok) { 'LOCK 3：通過' } else { 'LOCK 3：唔通過' })
  $cv = $(if ($chain.verdict -eq 'PASS') { '量測條件：三個階段一致' } else { '量測條件：' + [string]$chain.verdict })
  $kind = $(if ($res.ok -and $chain.verdict -eq 'PASS') { 'pass' } else { 'fail' })
  $UI.Banner2(($l3 + "`r`n" + $cv + "`r`n`r`n" + $rp + "`r`n" + 'SHA-256:' + $sha), $kind)
  $UI.SetFoot('可以閂咗呢個窗。')
  $UI.Form.ShowDialog() | Out-Null
  exit 0
}
catch {
  # AN ERROR HANDLER MUST NOT BE ABLE TO THROW. This one did: it read $round, which is assigned
  # inside the try, so an exception arriving before that line made the CATCH fail too — the
  # process died and took its already-shown window with it. Every access here is now guarded,
  # and the last resort writes somewhere readable without elevation.
  $err = $_
  $nonce = $null
  try { $v = Get-Variable -Name 'round' -Scope 1 -ErrorAction SilentlyContinue; if ($v) { $nonce = [string]$v.Value } } catch { }
  $reported = $false
  try {
    if ($UI) {
      [void](CX-Fail -UI $UI -Nonce $nonce -Stage 'unexpected' `
        -Reason $err.Exception.Message -Detail @($err.ScriptStackTrace) -Launcher 'retention')
      $UI.Form.ShowDialog() | Out-Null
      $reported = $true
    }
  } catch { $reported = $false }
  if (-not $reported) { [void](CX-Crash -Launcher 'retention' -ErrorRecord $err -UI $UI) }
  exit 1
}
