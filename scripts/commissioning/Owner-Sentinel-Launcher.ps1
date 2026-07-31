# Owner-Sentinel-Launcher.ps1 - LAUNCHER 1. Louie's session. Self-elevating.
#
# Louie presses one icon and answers the UAC prompt. Everything else happens here.
#
# PHASES
#   0  self-elevate
#   1  preflight            - HARD STOPS ONLY. Nothing is repaired that was not expected.
#   2  prepare              - the known, idempotent, baselined items and nothing else
#   3  mint the round       - nonce, manifest, round directory
#   4  owner sentinel       - open it and verify its colour reached the framebuffer
#   5  READY -> wait        - Louie switches accounts; this polls a file
#   6  PART B adjudicate + SEAL   <- sealed to disk BEFORE Lock 5 is allowed to begin
#   7  LOCK 5               - service side of the three kill bindings, then wait
#   8  final report         - Part B and Lock 5 adjudicated SEPARATELY
#
# OWNER RULING 2026-07-30 ON ORDER: Part B results are written and SEALED first. Lock 5 opens
# only after that, and a Lock 5 failure MUST NOT invalidate Part B. The two are adjudicated
# separately in the report, and this file is the thing that enforces it.
#
# UP TO 3 ROUNDS. The one-shot nonce exists so a crashed run cannot be quietly retried into a
# clean-looking result. That intent is kept: every round is recorded separately and the final
# report names the total and each round's outcome. After the third, it stops and reports.

param([switch]$DryRun, [int]$MaxRounds = 3)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DRY = ($PSBoundParameters.ContainsKey('DryRun') -and [bool]$PSBoundParameters['DryRun'])
$ROUND_CAP = $MaxRounds

# ── PHASE 0: SELF-ELEVATE ───────────────────────────────────────────────────
# Louie must not be asked to right-click and choose "Run as administrator". He presses the
# icon; if this is not elevated it relaunches itself and he answers the UAC prompt. Answering
# UAC is not executor work - it is one button on a dialog Windows raises.
. (Join-Path $PSScriptRoot 'commissioningCore.ps1')

if (-not (CX-IsElevated)) {
  $argl = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $PSCommandPath)
  if ($DRY) { $argl += '-DryRun' }
  try { Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -ArgumentList $argl -Verb RunAs | Out-Null }
  catch {
    # Declining UAC is not an error to diagnose - it ends the run, safely, with the same three
    # instructions every other stop uses. 'OK' only: never a Yes/No that asks Louie to decide.
    Add-Type -AssemblyName System.Windows.Forms
    $r = CX-Fail -UI $null -Nonce $null -Stage 'elevation' -Reason '冇畀到系統管理員批准' `
      -Detail @('呢部機冇任何嘢被改動過。') -Launcher 'owner'
    [Windows.Forms.MessageBox]::Show(
      (CX-FailSafeBanner -Path $r.txt -Sha $r.sha256), 'Aroma 驗收', 'OK', 'Information') | Out-Null
  }
  exit 0
}

# Building the window is itself protected. See Operator-Verification-Launcher.ps1 for the
# incident: an unprotected preamble under $ErrorActionPreference='Stop' exits with NO window at
# all, which leaves the person at the machine nothing to photograph and no way to tell a crash
# from a mis-click. A launcher must always produce a window.
$UI = $null
try {
  $UI = CX-NewUI -Title 'Aroma 第一步 —— 擁有者標記' -Subtitle $(if ($DRY) { '試跑 —— 唔會改動呢部機任何嘢' } else { '實體機驗收，第 1 步，共 2 步' })
} catch {
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    [Windows.Forms.MessageBox]::Show(
      ('已經停止 —— 而且係安全咁停低咗。' + "`r`n" +
       '呢一步連開始都未開始，部機冇被改動過。' + "`r`n" +
       '影一張相，然後就可以停手。' + "`r`n`r`n" + $_.Exception.Message),
      'Aroma 第一步', 'OK', 'Information') | Out-Null
  } catch { }
  exit 1
}
$UI.Banner2('開始緊……', 'info')

foreach ($s in @(
  @('inst',   '自我安裝，並喺另一個帳戶放低第二個圖示'),
  @('self',   '檢查自己嘅機件正常'),
  @('pre',    '檢查部機準備好'),
  @('sess',   '檢查操作員帳戶仲登入住'),
  @('prep',   '準備排程工作同已上架檔案'),
  @('mint',   '建立今次執行嘅識別碼'),
  @('sent',   '開啟並驗證擁有者標記視窗'),
  @('handoff','交接畀操作員帳戶'),
  @('partb',  '接收並封存 Part B 結果'),
  @('lock5',  'Lock 5 —— 停止控制檢查'),
  @('report', '寫出最終報告')
)) { $UI.AddStep($s[0], $s[1]) }

$NONCE = $null
$roundLog = New-Object System.Collections.Generic.List[object]

try {
  # ── PHASE 0.5: INSTALL ITSELF ────────────────────────────────────────────
  # THERE IS ONLY ONE PERSON ON THIS MACHINE. An earlier draft said "the executor runs the
  # installer, not Louie" - on a machine where Louie is the only human, that sentence puts him
  # back in front of exactly the untested path it claimed to protect him from. So the launcher
  # installs itself: copies its own files, sets the permissions, and places the second icon on
  # the Operator desktop. Louie presses ONE icon and never learns which stage he is in.
  $UI.SetStep('inst', 'run', '')
  if ($DRY) {
    $UI.SetStep('inst', 'skip', '試跑 —— 冇安裝任何嘢')
  } else {
    $inst = & (Join-Path $PSScriptRoot 'install-commissioning.ps1') -Quiet 2>&1 | Out-String
    $opIcon = Join-Path (Join-Path (Join-Path 'C:\Users' $script:CX_Account) 'Desktop') 'Aroma 第二步 —— 操作員檢查.lnk'
    if (-not (Test-Path -LiteralPath $opIcon)) {
      $UI.SetStep('inst', 'fail', '放唔到第二個圖示')
      [void](CX-Fail -UI $UI -Nonce $null -Stage 'install' -Reason '放唔到操作員圖示落佢個桌面' -Detail @($inst) -Launcher 'owner')
      CX-Wait -UI $UI; exit 1
    }
    $UI.SetStep('inst', 'ok', '第二個圖示已經放咗喺操作員桌面')
  }

  # ── PHASE 0.6: SELF-CHECK ────────────────────────────────────────────────
  # Exercises this launcher's OWN machinery against a scratch directory - exact writes,
  # hashing, the failure report, the marker handoff both ways - before it touches the machine.
  # It cannot exercise the other session (that needs Louie to switch, and making him switch
  # twice for a rehearsal is a worse trade than running the real thing behind fail-safes).
  $UI.SetStep('self', 'run', '')
  $sc = & (Join-Path $PSScriptRoot 'commissioningSelfCheck.ps1')
  if (-not $sc.ok) {
    $UI.SetStep('self', 'fail', $sc.summary)
    [void](CX-Fail -UI $UI -Nonce $null -Stage 'self-check' -Reason '啟動器自己嘅機件冇通過自我檢查' -Detail $sc.detail -Launcher 'owner')
    CX-Wait -UI $UI; exit 1
  }
  $UI.SetStep('self', 'ok', $sc.summary)

  # ── PHASE 1: PREFLIGHT. HARD STOPS. ──────────────────────────────────────
  $UI.SetStep('pre', 'run', '')
  $problems = New-Object System.Collections.Generic.List[string]

  if ($env:COMPUTER_OPERATOR) { $problems.Add('COMPUTER_OPERATOR 喺呢個環境有值，佢必須保持關閉') }
  foreach ($p in @($script:CX_Repo, $script:CX_Scripts, $script:CX_EvidenceRoot)) {
    if (-not (Test-Path -LiteralPath $p)) { $problems.Add('缺少必要路徑：' + $p) }
  }
  if (-not (Get-LocalUser -Name $script:CX_Account -ErrorAction SilentlyContinue)) {
    $problems.Add($script:CX_Account + ' 帳戶唔存在')
  }
  # the evidence directory must be writable BY US, now, not assumed
  try {
    $t = Join-Path $script:CX_EvidenceRoot ('.cx-write-test-' + [guid]::NewGuid().ToString('N').Substring(0,6))
    [IO.File]::WriteAllText($t, 'x'); Remove-Item -LiteralPath $t -Force
  } catch { $problems.Add('寫唔入證據資料夾：' + $_.Exception.Message) }

  if ($problems.Count -gt 0) {
    $UI.SetStep('pre', 'fail', ($problems -join '; '))
    [void](CX-Fail -UI $UI -Nonce $null -Stage 'preflight' -Reason '部機而家嘅狀態，唔容許呢個啟動器繼續' -Detail $problems -Launcher 'owner')
    CX-Wait -UI $UI; exit 1
  }
  $UI.SetStep('pre', 'ok', '旗標關閉、路徑齊全、證據資料夾寫得入')

  # ── REMOTE SESSION: STOP BEFORE TOUCHING ANYTHING ────────────────────────
  # Sits ahead of the operator-session check because it invalidates the run earlier: from RDP
  # the account switch cannot be performed AT ALL, so preparing the machine and then handing
  # off would strand the Owner at a step that has no button. Owner ruling 2026-07-30, after
  # hitting exactly that.
  $rs = CX-IsRemoteSession
  if ($rs.isRemote) {
    $UI.SetStep('pre', 'fail', '而家係遙距連線')
    [void](CX-Fail -UI $UI -Nonce $null -Stage 'preflight/remote' `
      -Reason '你而家係遙距連線（RDP），呢個驗收唔可以喺遙距做' `
      -Detail @(
        '第 2 步要切換 Windows 帳戶，而切換帳戶係主控台先做到嘅功能。',
        'RDP 入面撳 Ctrl+Alt+Del 係去咗你自己部機，個保安畫面亦唔會俾另一個 session 你揀。',
        '請去到 ' + $env:COMPUTERNAME + ' 機面前，喺主控台登入，然後再撳一次呢個圖示。',
        '呢部機冇任何嘢被改動過。',
        ('session name: ' + $rs.sessionName)) -Launcher 'owner')
    CX-Wait -UI $UI; exit 1
  }

  # ── THE PRECONDITION THE OWNER NAMED: is session 5 still signed in? ──────
  # If it is, switching to it needs only an unlock - no password, and the whole
  # credential risk disappears. If it is gone we stop HERE, not half way through.
  $UI.SetStep('sess', 'run', '')
  $op = CX-OperatorSession
  if (-not $op.signedIn) {
    $UI.SetStep('sess', 'fail', '操作員帳戶並冇登入')
    [void](CX-Fail -UI $UI -Nonce $null -Stage 'preflight/session' `
      -Reason ($script:CX_Account + ' 冇登入，所以今次執行無法繼續') `
      -Detail @(
        '切去嗰個帳戶會需要佢嘅密碼，而呢個啟動器唔可以問你攞。',
        '嗰個 session 必須喺驗收開始之前已經登入。',
        '呢部機冇任何嘢被改動過。') -Launcher 'owner')
    CX-Wait -UI $UI; exit 1
  }
  $UI.SetStep('sess', 'ok', ('signed in, session ' + $op.sessionId + ' (' + $op.state + ') —— 切換過去只需要解鎖'))

  # ── PHASE 2: PREPARE. ONLY THE KNOWN ITEMS. ──────────────────────────────
  $UI.SetStep('prep', 'run', '')
  if ($DRY) {
    $UI.SetStep('prep', 'skip', '試跑 —— 冇重新註冊工作，冇上架檔案')
  } else {
    $prepDetail = & (Join-Path $PSScriptRoot 'commissioningPrepare.ps1') -UI $UI
    if (-not $prepDetail.ok) {
      $UI.SetStep('prep', 'fail', $prepDetail.reason)
      [void](CX-Fail -UI $UI -Nonce $null -Stage 'prepare' -Reason $prepDetail.reason -Detail $prepDetail.detail -Launcher 'owner')
      CX-Wait -UI $UI; exit 1
    }
    $UI.SetStep('prep', 'ok', $prepDetail.summary)
  }

  # ── PHASES 3-8, up to $ROUND_CAP rounds ──────────────────────────────────
  $sealed = $null
  for ($round = 1; $round -le $ROUND_CAP -and -not $sealed; $round++) {
    $NONCE = [guid]::NewGuid().ToString('N').Substring(0, 12)
    $dir = CX-RoundDir -Nonce $NONCE
    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    # ── RESET THE SCREEN AT THE START OF EVERY ROUND ────────────────────────
    # MEASURED 2026-07-31: with round 2 running, one window showed round 1's "Part B FAIL ——
    # 已封存" ABOVE round 2's sentinel step still turning, under a banner left over from round
    # 1's handoff saying "waiting, 59 minutes left". Three states from two different rounds,
    # all true when written, none true together. The Owner had to ask which one to believe.
    #
    # Nothing was resetting: SetStep overwrites one line at a time, so a step the new round has
    # not reached yet keeps the OLD round's result. Steps that belong to this round are cleared
    # back to pending, and the banner is cleared with them.
    # ONLY the per-round steps. inst/self/pre/sess/prep happen once, before the loop, and they
    # really did pass - blanking them would replace one misleading screen with another.
    foreach ($k in @('mint', 'sent', 'handoff', 'partb', 'lock5', 'report')) { $UI.SetStep($k, 'pending', '') }
    $UI.Banner2('回合 ' + $round + ' / ' + $ROUND_CAP + ' —— 開始緊……', 'info')
    $UI.SetFoot('')
    $UI.SetStep('mint', 'run', ('round ' + $round + ' of ' + $ROUND_CAP))
    $manifest = [ordered]@{
      marker = 'COMMISSIONING-MANIFEST'; round = $round; roundNonce = $NONCE
      operatorNonce = $NONCE; ownerNonce = $NONCE
      consumed = $false
      mintedBy = ([Security.Principal.WindowsIdentity]::GetCurrent()).Name
      mintedSessionId = (Get-Process -Id $PID).SessionId
      dryRun = [bool]$DRY
      at = (Get-Date).ToString('o')
    }
    [void](CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'MANIFEST.json') -Object $manifest)

    # Part A's OWN manifest, which is a different file the harness reads and burns. Minted per
    # round, not once: round 1e80253806ce died on stage3-harness.ps1 exit 11 because nothing in
    # the commissioning path ever minted it, and doing it in PHASE 2 instead would leave a
    # round-2 retry running against a manifest round 1 already burned - the same failure, one
    # round later, which is exactly what a retry cap is supposed to survive.
    if (-not $DRY) {
      $mf = & (Join-Path $PSScriptRoot 'commissioningPrepare.ps1') -UI $UI -ManifestOnly
      if (-not $mf.ok) {
        $UI.SetStep('mint', 'fail', $mf.reason)
        [void](CX-Fail -UI $UI -Nonce $NONCE -Stage 'mint' -Reason $mf.reason -Detail $mf.detail -Launcher 'owner')
        CX-Wait -UI $UI; exit 1
      }
      $UI.SetStep('mint', 'ok', ('round ' + $round + ' - ' + $NONCE + ' - ' + $mf.summary))
    } else {
      $UI.SetStep('mint', 'ok', ('round ' + $round + ' - ' + $NONCE))
    }

    # ── THE SENTINEL NONCE COMES FROM PART A'S MANIFEST, NOT FROM THIS ROUND ─
    # ROOT CAUSE OF THE VOIDED ROUND 28ba1e19f7ab. The sentinel was painted under the
    # COMMISSIONING round nonce, while stage3-harness.ps1 builds both the window title and the
    # attestation path from Part A's manifest ownerNonce:
    #     $ownerTitle      = 'AROMA-OWNER-SENTINEL-' + $manifest.ownerNonce
    #     $ownerAttestPath = 'stage3-sentinel-owner-' + $manifest.ownerNonce + '.json'
    # Two different values, so the attestation was never found, $ownerAttested stayed false, and
    # all three EYE positive controls came back INVALID - the negatives proved nothing.
    #
    # §12 joined the two manifests for CONSUMPTION. Their IDENTITY was never joined. This joins
    # it: the sentinel is painted with the nonce the harness will actually look for.
    $SENTINEL_NONCE = $NONCE
    if (-not $DRY) {
      $paManifest = CX-ReadJson -Path (Join-Path $script:CX_EvidenceRoot 'stage3-manifest.json')
      if (-not $paManifest -or -not $paManifest.ownerNonce) {
        $UI.SetStep('sent', 'fail', '讀唔到 Part A manifest 嘅 ownerNonce')
        [void](CX-Fail -UI $UI -Nonce $NONCE -Stage 'sentinel-nonce' `
          -Reason '讀唔到 Part A manifest，哨兵會用錯 nonce' `
          -Detail @('哨兵嘅 nonce 必須同 harness 揾嘅一致，否則三個眼睛正控制會全部 INVALID。',
                    '呢個就係 28ba1e19f7ab 被作廢嘅原因。') -Launcher 'owner')
        CX-Wait -UI $UI; exit 1
      }
      $SENTINEL_NONCE = [string]$paManifest.ownerNonce
    }

    # ── PHASE 4: owner sentinel ────────────────────────────────────────────
    $UI.SetStep('sent', 'run', '')
    $sentinelOk = $false; $sentinelDetail = 'dry run'
    if ($DRY) {
      $sentinelOk = $true
      $UI.SetStep('sent', 'skip', '試跑 —— 冇開任何視窗')
    } else {
      $sp = Join-Path $script:CX_Scripts 'stage3-sentinel.ps1'
      $so = Join-Path $dir 'owner-sentinel.out'
      $pr = Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
        -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$sp,'-Role','owner','-Nonce',$SENTINEL_NONCE) `
        -PassThru -WindowStyle Normal -RedirectStandardOutput $so
      $att = Join-Path $script:CX_EvidenceRoot ('stage3-sentinel-owner-' + $SENTINEL_NONCE + '.json')
      $wait = 0
      while ($wait -lt 40000 -and -not (Test-Path -LiteralPath $att)) { Start-Sleep -Milliseconds 500; $wait += 500; $UI.Pump() }
      $a = CX-ReadJson -Path $att
      $sentinelOk = ($a -and $a.matchedSamples -gt 0)
      $sentinelDetail = if ($a) { ('辨認到 ' + $a.matchedSamples + ' 個取樣點') } else { '冇寫出任何證明' }
      if ($sentinelOk) { $UI.SetStep('sent', 'ok', $sentinelDetail) } else { $UI.SetStep('sent', 'fail', $sentinelDetail) }
    }
    if (-not $sentinelOk) {
      $roundLog.Add([ordered]@{ round = $round; nonce = $NONCE; outcome = 'FAILED'; where = 'owner-sentinel'; detail = $sentinelDetail })
      if ($round -ge $ROUND_CAP) {
        [void](CX-Fail -UI $UI -Nonce $NONCE -Stage 'owner-sentinel' -Reason '驗證唔到擁有者標記視窗' -Detail $roundLog -Launcher 'owner')
        CX-Wait -UI $UI; exit 1
      }
      continue
    }

    # ── PHASE 5: READY, then wait for the operator side ────────────────────
    $UI.SetStep('handoff', 'run', '')
    $ready = [ordered]@{
      marker = 'READY'; roundNonce = $NONCE; round = $round; dryRun = [bool]$DRY
      ownerSentinelAttested = $true
      probeDir = $script:CX_ProbeDir; evidenceRoot = $script:CX_EvidenceRoot
      partBScripts = @('tierA-probe.ps1', 'stage3-harness.ps1', 'stage3-topup.ps1')
      at = (Get-Date).ToString('o')
    }
    [void](CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'READY.json') -Object $ready)

    $UI.Banner2(
      "而家請切去另一個 Windows 帳戶" + "`r`n`r`n" +
      "撳 Ctrl+Alt+Del，揀「切換使用者」，再揀 " + $script:CX_Account + "," + "`r`n" +
      "然後撳嗰個桌面上「Aroma 第二步 —— 操作員檢查」個圖示。" + "`r`n`r`n" +
      "呢個窗唔好閂。等嗰邊話完成之後，返嚟呢度。", 'wait')
    $UI.SetFoot('回合 ' + $NONCE + '  —  等緊另一個帳戶')

    $done = CX-WaitForMarker -UI $UI -Path (CX-Marker -Nonce $NONCE -Name 'OPERATOR-DONE.json') `
      -TimeoutSeconds 3600 -WaitBanner "等緊操作員帳戶完成 Part B。"
    if (-not $done) {
      $UI.SetStep('handoff', 'fail', '等另一個帳戶等到逾時')
      $roundLog.Add([ordered]@{ round = $round; nonce = $NONCE; outcome = 'FAILED'; where = 'handoff'; detail = 'timeout' })
      if ($round -ge $ROUND_CAP) {
        [void](CX-Fail -UI $UI -Nonce $NONCE -Stage 'handoff' -Reason '操作員帳戶冇喺時限內回報' -Detail $roundLog -Launcher 'owner')
        CX-Wait -UI $UI; exit 1
      }
      continue
    }
    $UI.SetStep('handoff', 'ok', '操作員已經回報')

    # ── PHASE 6: ADJUDICATE PART B, THEN SEAL IT ───────────────────────────
    # SEALED BEFORE LOCK 5 OPENS. Owner ruling: a Lock 5 failure must not be able to
    # invalidate a Part B result that already stands.
    $UI.SetStep('partb', 'run', '')
    $partBPass = ([string]$done.verdict -eq 'PASS')
    $sealRec = [ordered]@{
      marker = 'PARTB-SEALED'; roundNonce = $NONCE; round = $round
      verdict = [string]$done.verdict
      rowCount = $done.rowCount; drift = $done.registryDrift; controlGaps = $done.controlGaps
      resultFiles = $done.resultFiles
      sealedAt = (Get-Date).ToString('o')
    }
    $sealPath = CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'PARTB-SEALED.json') -Object $sealRec
    $sealSha = CX-Sha256File -Path $sealPath
    [void](CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'PARTB-SEAL-SHA.json') -Object ([ordered]@{
      marker = 'PARTB-SEAL-SHA'; file = $sealPath; sha256 = $sealSha; at = (Get-Date).ToString('o') }))
    $UI.SetStep('partb', $(if ($partBPass) { 'ok' } else { 'fail' }), ('Part B ' + $sealRec.verdict + ' —— 已封存'))
    $roundLog.Add([ordered]@{ round = $round; nonce = $NONCE; outcome = $sealRec.verdict; where = 'part-b'; sealSha256 = $sealSha })

    # ── A SEALED FAIL IS A RESULT. IT IS NOT RETRIED. ───────────────────────
    # OWNER RULING 2026-07-31. The 3-round cap exists to stop a CRASH - a run that ended in a
    # state nobody can characterise - from being quietly retried into something clean-looking.
    # A sealed FAIL is the opposite of that: it is a KNOWN, adjudicated, named conclusion.
    # Retrying a known conclusion cannot change it, and on 2026-07-31 the retry did exactly
    # three harmful things and no useful one: it burned a second nonce, it raced the Owner
    # switching accounts (round 2's owner sentinel died on CopyFromScreen "handle is invalid"),
    # and it left one window showing a mixture of two rounds.
    #
    # Crashes and timeouts still retry - those are handled by the `continue` paths above, which
    # is where "we do not know what happened" actually lives.
    if (-not $partBPass) {
      $UI.Banner2('Part B：' + $sealRec.verdict + "`r`n`r`n" + '已經封存。呢個係結果，唔會重試。', 'fail')
      break
    }
    $sealed = [pscustomobject]@{ nonce = $NONCE; round = $round; sha = $sealSha; rec = $sealRec }
  }

  if (-not $sealed) {
    # A FAILED PART B STILL GETS A FINAL REPORT. Round b7323a3b9070 produced none at all: the
    # only artefacts were PARTB-SEALED and a fail-safe report, so the two-column record this
    # design promises simply did not exist for a FAIL. A result you cannot hand to anyone is
    # half a result.
    $UI.SetStep('report', 'run', '')
    $lastRound = if ($roundLog.Count) { $roundLog[$roundLog.Count - 1] } else { $null }
    $failFinal = [ordered]@{
      marker = 'FINAL-REPORT'; overall = 'PART-B-FAILED'
      roundNonce = $(if ($lastRound) { $lastRound.nonce } else { $NONCE })
      roundsRun = $roundLog.Count
      partB = [ordered]@{
        verdict = $(if ($lastRound) { $lastRound.outcome } else { 'UNKNOWN' })
        sealedSha256 = $(if ($lastRound -and $lastRound.Contains('sealSha256')) { $lastRound.sealSha256 } else { $null })
        retried = $false
        whyNotRetried = 'Owner ruling 2026-07-31: a sealed FAIL is a known conclusion, not an unknown state. Only crashes and timeouts retry.'
      }
      # Kept as its own column even though it never opened, so the report never reads as though
      # Lock 5 passed or was merely forgotten.
      lock5 = [ordered]@{ verdict = 'NOT-OPENED'; why = 'Part B did not pass; Lock 5 opens only after Part B is sealed as PASS' }
      rounds = @($roundLog)
      at = (Get-Date).ToString('o')
    }
    $fp = CX-WriteJson -Path (CX-Marker -Nonce $failFinal.roundNonce -Name 'FINAL-REPORT.json') -Object $failFinal
    $UI.SetStep('report', 'ok', 'FINAL-REPORT.json')

    # The failure belongs to PART B, and the partb step already says so. Marking the report step
    # red made it read as "writing the report failed" when the report was written fine.
    $UI.SetStep('partb', 'fail', ('Part B ' + $failFinal.partB.verdict + ' —— 已封存，唔重試'))
    [void](CX-Fail -UI $UI -Nonce $failFinal.roundNonce -Stage 'part-b' `
      -Reason ('Part B 唔通過，結果已封存。按裁決唔重試（跑咗 ' + $roundLog.Count + ' 個回合）。') `
      -Detail (@('最終報告：' + $fp) + @($roundLog)) -Launcher 'owner')
    CX-Wait -UI $UI; exit 1
  }

  # ── PHASE 7: LOCK 5 - ONLY NOW, AND IT CANNOT UNDO PART B ────────────────
  $UI.SetStep('lock5', 'run', 'Part B 已封存，Lock 5 可以開始')
  $lock5 = & (Join-Path $PSScriptRoot 'commissioningLock5.ps1') -UI $UI -Nonce $sealed.nonce -DryRun:$DRY
  $UI.SetStep('lock5', $(if ($lock5.ok) { 'ok' } else { 'fail' }), $lock5.summary)

  # ── PHASE 8: FINAL REPORT - TWO SEPARATE VERDICTS ────────────────────────
  $UI.SetStep('report', 'run', '')
  $final = [ordered]@{
    marker = 'COMMISSIONING-FINAL'
    roundNonce = $sealed.nonce
    roundsRun = $roundLog.Count
    rounds = $roundLog
    partB = [ordered]@{ verdict = 'PASS'; sealedSha256 = $sealed.sha; note = 'sealed to disk before Lock 5 began; a Lock 5 result cannot alter it' }
    lock5 = [ordered]@{ verdict = $lock5.verdict; detail = $lock5.summary; note = 'adjudicated separately from Part B by Owner ruling' }
    dryRun = [bool]$DRY
    at = (Get-Date).ToString('o')
  }
  $fp = CX-WriteJson -Path (CX-Marker -Nonce $sealed.nonce -Name 'FINAL-REPORT.json') -Object $final

  $lines = @()
  $lines += 'AROMA COMMISSIONING - FINAL REPORT'
  $lines += ''
  $lines += ('round        : ' + $sealed.nonce + '   (rounds run: ' + $roundLog.Count + ' of ' + $ROUND_CAP + ')')
  $lines += ('PART B       : PASS      sealed SHA-256 ' + $sealed.sha)
  $lines += ('LOCK 5       : ' + $lock5.verdict + '   ' + $lock5.summary)
  $lines += ''
  $lines += 'Part B was written and sealed to disk BEFORE Lock 5 began.'
  $lines += 'The two are judged separately: a Lock 5 result does not change Part B.'
  $lines += ''
  foreach ($r in $roundLog) { $lines += ('  round ' + $r.round + '  ' + $r.outcome + '  (' + $r.where + ')') }
  $txtPath = (CX-Marker -Nonce $sealed.nonce -Name 'FINAL-REPORT.txt')
  [IO.File]::WriteAllText($txtPath, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
  $UI.SetStep('report', 'ok', $txtPath)

  $UI.Banner2(
    "PART B：通過" + "`r`n" +
    "LOCK 5:" + $lock5.verdict + "`r`n`r`n" +
    "報告：" + $txtPath, $(if ($lock5.ok) { 'pass' } else { 'wait' }))
  $UI.SetFoot('SHA-256 ' + (CX-Sha256File -Path $txtPath) + '   —  可以閂咗呢個窗。')
}
catch {
  # The handler itself must not be able to throw — see CX-Crash. If the ordinary fail-safe
  # cannot run, the last resort writes to the Owner's own profile, which needs no elevation.
  $err = $_
  $ok = $false
  try {
    [void](CX-Fail -UI $UI -Nonce $NONCE -Stage 'unexpected' -Reason $err.Exception.Message `
      -Detail @($err.ScriptStackTrace, $roundLog) -Launcher 'owner')
    $ok = $true
  } catch { $ok = $false }
  if (-not $ok) { [void](CX-Crash -Launcher 'owner' -ErrorRecord $err -UI $UI); exit 1 }
}

CX-Wait -UI $UI
