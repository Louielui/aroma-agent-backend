param([ValidateSet('Startup', 'Open')][string]$Mode = 'Open')

# 心燈 Fixed Entry v1 — resident launcher for the local 心燈 Conversation Demo.
#   -Mode Open    : ensure the server is up, then open the browser at /demo.
#   -Mode Startup : ensure the server is up only (no browser) — used by the Startup shortcut.
# No secrets on disk: ANTHROPIC_API_KEY and HUB_TOKEN are hydrated at RUNTIME from the
# USER-scope environment. DECISION_RECALL is intentionally never set (and is stripped from the
# process before Node is spawned, so the child can never inherit 'on'). Loopback-only, port 8090,
# fail-closed on a foreign 8090 holder or a non-main repo. Read the log at C:\Aroma\xiangxiang.log.

$ErrorActionPreference = 'Stop'
$Port = 8090
$Repo = 'C:\Aroma\aroma-agent-backend'
$Url  = "http://127.0.0.1:$Port/demo"
$Log  = 'C:\Aroma\xiangxiang.log'

function Write-Log([string]$m) {
  $line = ((Get-Date).ToString('o')) + '  [' + $Mode + ']  ' + $m
  try { Add-Content -LiteralPath $Log -Value $line -Encoding UTF8 } catch { }
}
function Show-Msg([string]$text) {
  try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($text, '香香') | Out-Null } catch { }
}
# ── THE NOTIFIER (L2-1). Every failure below used to be gated on -Mode Open, so at boot —
# the only time a restart happens unattended — it was silent BY CONSTRUCTION. The detector
# already existed and already wrote the log line; the line just never reached a human.
#
# ⛔ REFUSED IS NOT A FAILURE. Four of the five branches are fail-closed working correctly:
# a foreign port holder, a missing credential, a repo off main. If those read as breakage,
# the reader learns to dismiss the box, and then it protects nothing (HR-47's other half).
# So the outcome word is part of the message, not a tone.
#
# ⚠ WHAT THIS CANNOT DO, stated so it is not read as more: it reaches an interactive
# session and nothing else. If the Owner is not logged on there is no box — and there is
# also no 8090, because her uptime is coupled to that same session. The channel's reach
# matches the need's scope TODAY. When Layer 2 gives her unattended work, it stops matching,
# and that is the trigger to revisit, not a date. See docs/DESIGN-RESTART-REPAIR.md §5.
function Notify-Owner([string]$outcome, [string]$text) {
  # BLOCKING ON PURPOSE. MessageBox::Show does not return until it is dismissed, so the
  # return IS evidence a human saw it. The WinRT toast was rejected for exactly this: its
  # Show() returns without throwing whether or not the toast is ever delivered, which is
  # 「ran and did nothing」 wearing a success. A notifier may not report its own success.
  Show-Msg ($outcome + "`n`n" + $text)
}
# Returns 'ours' | 'foreign' | 'down'
# Identity is taken from the SERVICE, not from the page. This probe used to match a
# literal string in the /demo markup ('香香 Conversation Demo' — the name at that time);
# the page and the probe then reported a perfectly healthy server as unhealthy — and,
# worse, would have judged a running 心燈 to be a FOREIGN process and refused to start.
# Markup is presentation and will keep changing; /health is the service's own identity
# and is unguarded, so it answers even when the demo flag is off. Fail-closed semantics
# are unchanged: anything that is not provably ours is still 'foreign'.
function Probe-Server {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4 -UseBasicParsing
    if ($r.StatusCode -eq 200) {
      $svc = $null
      try { $svc = ($r.Content | ConvertFrom-Json).service } catch { $svc = $null }
      if ($svc -eq 'aroma-hub') { return 'ours' }
    }
    return 'foreign'
  } catch {
    $listen = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listen) { return 'foreign' }
    return 'down'
  }
}

$state = Probe-Server
if ($state -eq 'ours') {
  Write-Log 'health probe matched: 香香 already up; skip start'
  if ($Mode -eq 'Open') { Start-Process $Url }
  return
}
if ($state -eq 'foreign') {
  Write-Log 'port 8090 held by a FOREIGN process; fail-closed, not starting, not picking another port'
  Notify-Owner '拒絕啟動（fail-closed 正常運作）' '8090 已被其他程式佔用。香香冇啟動，亦冇殺對方、冇轉去第二個 port。'
  return
}

# state == 'down' : hydrate runtime env (no hardcoded secrets) and start our server
$key = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY', 'User')
$hub = [Environment]::GetEnvironmentVariable('HUB_TOKEN', 'User')
if ([string]::IsNullOrEmpty($key)) {
  Write-Log 'ANTHROPIC_API_KEY (User) is empty; fail-closed'
  Notify-Owner '拒絕啟動（fail-closed 正常運作）' '使用者環境入面缺少 ANTHROPIC_API_KEY。香香冇啟動。'
  return
}
if ([string]::IsNullOrEmpty($hub)) {
  Write-Log 'HUB_TOKEN (User) is empty; fail-closed'
  Notify-Owner '拒絕啟動（fail-closed 正常運作）' '使用者環境入面缺少 HUB_TOKEN。香香冇啟動。'
  return
}
$env:ANTHROPIC_API_KEY = $key
$env:HUB_TOKEN         = $hub
$env:CONVERSATION_DEMO = 'on'
$env:LLM_PROVIDER      = 'claude'
# ── THE CHAT AND EXECUTE MODEL (Owner GO 2026-08-10) ──────────────────────────────────────
#
# claude-haiku-4-5-20251001 was the smallest model on the account, and it was in this slot by
# default rather than by decision. It answered the chat lane AND the proposal / work-order
# lane — the path that produces the thing the Owner types EXECUTE against — because the
# picker's hint reaches chat only and every other lane returns 'claude' regardless.
#
# The Owner spent a fortnight judging the system on it while believing the router had sent
# chat to GPT. It had not: the picker defaults to 'claude' and its hint is read BEFORE the
# MULTI_AI_ROUTER flag, so the flag's chat rule never ran. (HR-62.)
#
# ⛔ ROLLBACK IS THIS ONE LINE. Swap the value back and restart; nothing else changes and no
# rebuild is involved. The previous value is kept in the comment below precisely so going
# back is a copy rather than an act of archaeology:
#
#     $env:CLAUDE_MODEL = 'claude-opus-5'   # the other value, reachable on this account
#
# ⛔ ROLLED BACK 2026-08-11, SAME DAY, ON EVIDENCE. opus-5 was live for roughly an hour and
# reached its answer WITHOUT the answer-plan validation on 2 of 2 answered turns
# (`reason: no_plan_returned`) — the citation binding and row checks this system exists to
# perform were skipped. haiku goes through that gate on 3 of 3.
#
# It also produced THREE distinct failure modes in about eight calls: no plan, an
# `empty_response` from the distill parse, and one 30-second adapter timeout. That is not
# 「slower」; on this path it is unstable.
#
# ⛔ AND WHY THE SMALLER MODEL WINS HERE. Owner ruling: 「I would rather be on a smaller model
# that goes through the gate than a stronger one that does not.」 The rollback costs one line
# and a restart. Being wrong the other way costs a fortnight of answers about the business
# that nobody proved.
#
# NOT YET KNOWN, and deliberately not asserted: whether this is opus, this prompt, or this
# schema. Diagnosis continues with opus reachable in the harness only.
$env:CLAUDE_MODEL      = 'claude-haiku-4-5-20251001'
$env:AROMA_BIND_HOST   = '127.0.0.1'
$env:PORT              = '8090'
# DECISION_RECALL enabled for this resident entry (Owner GO) — chat-lane recall active.
$env:DECISION_RECALL   = 'on'
# READ ACCESS enabled for Drive/Gmail/Calendar/GitHub (Owner GO) — read-only, cited+dated
# context in the chat lane. GitHub reads use the read-only PAT + repo from .env
# (GITHUB_READ_TOKEN / GITHUB_READ_REPO), which dotenv loads at startup — never from here.
$env:READ_ACCESS       = 'on'
$env:CONTEXT_DRIVE     = 'on'
$env:CONTEXT_GMAIL     = 'on'
$env:CONTEXT_CALENDAR  = 'on'
$env:CONTEXT_GITHUB    = 'on'
# aroma_system read source (Owner GO) — six GET endpoints only, read-only by construction.
# The API key comes from .env (AROMA_SYSTEM_KEY), which dotenv loads at startup — never from
# here. No key => the source is simply not registered and reports unavailable.
$env:CONTEXT_AROMA_SYSTEM = 'on'

# B, the goal decomposer — LOAD-BEARING (Owner GO 2026-08-11). One model call before the read
# decides WHAT FACTS the question needs; the server then reads only the operations named, and
# a fact nothing carries is reported as UNAVAILABLE instead of substituted.
#
# Acceptance case, measured before this was switched on: 「給我 Aroma System 的 website」 used to
# read four stock counts and fail to assemble an answer. With B it names the required fact as
# the system's own URL, finds no operation providing it, and reads ZERO sources.
#
# Costs one extra model call per BUSINESS_QUERY turn (measured 1652 in / 68 out / 2.5s on the
# acceptance case). UTILITY and CONVERSATION never reach it — 聽日幾號 and arithmetic return
# hundreds of lines earlier, so they pay nothing.
#
# ⛔ FAIL-SAFE, NOT FAIL-SHUT. If B errors, times out, or returns an unusable plan it has NO
# OPINION and the turn proceeds exactly as it did before B existed. It is a requirement
# declaration, never a gate. Set to anything other than 'on' (or remove the line) to disable.
# ⛔ OFF — AND THE REASON ORIGINALLY WRITTEN HERE WAS WRONG. Corrected 2026-08-12 from records.
#
# This line used to read 「empty-reply regression under diagnosis」, which attributed an empty
# reply to B. The timestamps refute it:
#
#   07:25:47  the answering process started
#   07:31:03  'GOAL_DECOMPOSER = on' first reached main — SIX MINUTES LATER
#   07:39:10  the empty reply
#
# Node reads its files once at start, so the process that produced that reply was spawned by a
# launcher with no GOAL_DECOMPOSER line at all. B was not running. A second empty reply on
# 2026-08-12 22:18:29Z occurred on 91b0a0a with B off, and [AROMA-GOAL] appears zero times in
# every server log that day — B has never run in production.
#
# ⛔ WHAT DID CAUSE THE SECOND ONE, from C:\Aroma\logs (requestId 48fd8c80): the model chose
# public_knowledge.search, the read FAILED, the completion guard refused the next two attempts
# with 'before_terminal', the loop hit its step limit, and the turn ended
# 'required_world_missing' — logged as outcome:success, httpStatus:200, with no text.
#
# ⛔ STILL UNSETTLED: whether the 07:39 reply shares that cause. Its own log predates the
# per-boot files under C:\Aroma\logs, so its pipeline is not on disk.
#
# ⛔ ON — CONTROLLED CANARY, Owner GO 2026-08-12. NOT a finding that B is stable.
#
# It is on to measure two things and nothing else: whether B identifies a requirement its
# catalogue cannot serve and STOPS unrelated reads, and whether it still requires the right
# reads when the question is a real business one.
#
# ⛔ ROLLBACK IS THIS ONE LINE BACK TO 'off', then restart. Nothing else changes and no rebuild
# is involved. Roll back FIRST and diagnose afterwards on any of: an empty reply, a crash, a
# timeout, or a read of a source unrelated to the question.
$env:GOAL_DECOMPOSER   = 'on'

# A4 Universal Knowledge Routing — PRODUCTION ACTIVATION (Owner GO 2026-08-10).
# 香香 now establishes WHICH knowledge world a question belongs to before answering it:
# internal (Aroma System), public (the outside world), both, or neither — and asks when the
# Owner's meaning is genuinely open, instead of answering from model memory.
#
# public_knowledge is READ-ONLY and stays governed: the Owner-only Public Query Egress
# Planner authors the outbound words for EVERY public read, so the main model decides
# whether the outside world is needed and never decides what words leave the building.
# Its API key comes from .env (OPENAI_API_KEY), never from here; no key => the source is
# simply not registered and reports unavailable.
#
# Rollback without a rebuild: set either flag to 'off'. A4 off restores the previous
# answering path entirely and constructs none of its verifiers.
$env:A4_KNOWLEDGE_ROUTING       = 'on'
$env:CONTEXT_PUBLIC_KNOWLEDGE   = 'on'

# Conversation Experience Contract v1 (Owner GO) — trusted expression/epistemic frame in
# the system string; governs the prose inside `reply` only, never the output schema.
$env:CONVERSATION_CONTRACT = 'on'

# Turn Router — ON (Owner GO 2026-08-04, Step 3). Routing now GOVERNS reads:
# CONVERSATION and UTILITY read nothing; BUSINESS_QUERY reads only the ONE source its intent
# names; ACTION is unchanged. Two rollback points without a rebuild: set this to 'shadow' for
# Step 2 behaviour (UTILITY answers, reads ungoverned), or 'off' for pre-router behaviour.
# The repo default remains off.
$env:TURN_ROUTER = 'on'
# Multi-AI Router v0 — RE-ENABLED 2026-07-26 after fix (c) (no sampling params sent to the
# reasoning model; effort pinned 'low'). GPT is PRIMARY for the chat lane only; every other
# lane stays Claude, and Claude remains the one-shot fallback. OPENAI_MODEL / OPENAI_API_KEY
# come from .env, never from here. A fallback turn bills two providers.
$env:MULTI_AI_ROUTER   = 'on'
$env:XIANGXIANG_ARCHIVE = 'on'
# Conversation Recall v0.1 (Owner GO 2026-08-02) - the READ side of the archive.
# Chat lane only, fail-closed OFF unless exactly 'on'. Injects the most recent PREVIOUS
# conversations as memory; turns whose reply cited external context show as
# '[reply not retained]' rather than as a gap.
$env:CONVERSATION_RECALL = 'on'
# Agent Bridge v1 (Owner GO 2026-08-02) - 香香 can hand a Work Order to Claude Code.
# Every run needs a Work Order the Owner approved by typing EXECUTE. The agent works in a
# throwaway clone with no remotes and can only Read/Edit/Write; the result is a .patch file
# in C:AromaAgentPatches which the Owner applies by hand. v1 never applies anything.
# NOTE: the four-flag gate means COMPUTER_OPERATOR must stay off while this is on.
$env:AGENT_BRIDGE = 'on'

# repo MUST be on main (never auto-checkout)
try { $branch = (& git -C $Repo rev-parse --abbrev-ref HEAD 2>$null).Trim() } catch { $branch = '' }
if ($branch -ne 'main') {
  Write-Log ("repo not on main (on '" + $branch + "'); fail-closed, not starting")
  Notify-Owner '拒絕啟動（fail-closed 正常運作）' ('程式庫唔喺 main，而家喺 ' + $branch + '。香香冇啟動，亦冇自動 checkout。')
  return
}

Write-Log 'starting node src/index.js (hidden)'
# Server stdout/stderr are captured so a failure can be diagnosed without a live probe.
# The server only ever prints status lines, ids, counts and metrics (model/latency/token
# COUNTS) — never prompts, never fetched source content, never credentials.
#
# RETENTION (2026-07-26): the previous scheme moved the logs to a single `.prev` on every
# launch, so two restarts ERASED the evidence of a failure — that actually happened. Each
# launch now writes its OWN timestamped pair under C:\Aroma\logs\, so no start can destroy
# an earlier one. Pruning is deliberately conservative: a file is deleted only when it is
# BOTH older than 14 days AND outside the newest 40 files (= 20 launches x 2 streams), so a
# burst of restarts can never age out a recent failure, and the folder stays bounded.
$SrvLogDir = 'C:\Aroma\logs'
if (-not (Test-Path -LiteralPath $SrvLogDir)) { New-Item -ItemType Directory -Force -Path $SrvLogDir | Out-Null }
$stamp  = (Get-Date).ToString('yyyyMMdd-HHmmss')
$SrvOut = Join-Path $SrvLogDir ("xiangxiang-server-$stamp.log")
$SrvErr = Join-Path $SrvLogDir ("xiangxiang-server-$stamp.err.log")
try {
  $keep = @(Get-ChildItem -LiteralPath $SrvLogDir -Filter 'xiangxiang-server-*.log' -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending)
  $cutoff = (Get-Date).AddDays(-14)
  if ($keep.Count -gt 40) {
    foreach ($old in $keep[40..($keep.Count-1)]) {
      if ($old.LastWriteTime -lt $cutoff) { Remove-Item -LiteralPath $old.FullName -Force -ErrorAction SilentlyContinue }
    }
  }
} catch { }   # log pruning must never block a start
Write-Log ("server logs: " + $SrvOut)
# -PassThru so the poll below can tell 「still starting」 from 「the process is gone」. Those are
# different facts and they need different words; without the handle both look like a timeout.
$proc = Start-Process node -ArgumentList 'src/index.js' -WorkingDirectory $Repo -WindowStyle Hidden `
  -RedirectStandardOutput $SrvOut -RedirectStandardError $SrvErr -PassThru
# ⛔ REQUIRED, and found by running proof case 4 rather than by reading this. When Start-Process
# is given -RedirectStandardOutput/-RedirectStandardError, the object -PassThru hands back never
# populates ExitCode — not even after WaitForExit(). HasExited still works, so the branch fired
# correctly and the message read 「exit code 」 with nothing after it. Setting this makes .NET
# retain the process handle, which is what keeps the code readable after the process is gone.
try { $proc.EnableRaisingEvents = $true } catch { }

# ⛔ WHY THIS POLLS FOR 60s AND NOT 15s — THE ONLY RECORDED FAILURE WAS THIS BRANCH, AND IT WAS
# WRONG. 2026-07-26 13:06:52 logged 'did not become healthy within ~15s'. That launch's own
# server log says 'Listening on 127.0.0.1:8090', its .err.log is empty, and she was found up
# 8m32s later. Across 164 measured starts the median is 1.10s and the max is 6.43s, so 15s was
# not tight — but 「usually 1 second」 is not 「never 20」, and a notifier that fires on the one
# event that has ever happened, wrongly, teaches the Owner to dismiss the box. Un-gating this
# branch WITHOUT this change would have shipped exactly that.
#
# A slow start is NOT a failure and is NOT notified — it is logged with its measured time, so
# the next person arguing about this budget has data instead of one anecdote.
# ⛔ A CLOCK, NOT A COUNTER — found by running proof case 5, not by reading. The first version
# counted loop iterations into a variable called $waited and printed it with an 's' suffix.
# One iteration is NOT one second: Probe-Server sleeps 1s, and on a closed port its
# Get-NetTCPConnection fallback costs roughly another. Case 5 took 23 real seconds and the
# counter reached ~12, so the SLOW line did not fire and the budget everyone had agreed was
# 「60 seconds」 was really 60 iterations ≈ 2 minutes. A number labelled as one thing and
# measuring another is the defect this project keeps finding; here it was in the one line
# whose entire job is to give the next person data instead of an anecdote.
$ok = $false
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 60) {
  Start-Sleep -Seconds 1
  if ((Probe-Server) -eq 'ours') { $ok = $true; break }
  if ($proc -and $proc.HasExited) { break }   # dead is dead; no point waiting out the clock
}
$waited = [int][Math]::Round($sw.Elapsed.TotalSeconds)
if ($ok) {
  if ($waited -gt 15) { Write-Log ("health probe matched after start — SLOW: " + $waited + "s (median is ~1s)") }
  else { Write-Log 'health probe matched after start' }

  # ── STARTUP SMOKE: one real chat turn per provider, before this is handed back ──────────
  #
  # /health proves the PROCESS is up. It does not prove she can answer. On 2026-08-10 those
  # two facts came apart: A4_KNOWLEDGE_ROUTING was committed 45 seconds after the running
  # process started, and it made every Claude chat turn return HTTP 400. /health would have
  # been green the whole time.
  #
  # ⛔ IT NEVER BLOCKS THE HAND-BACK. Owner ruling, and the L2-1 shape is the reason: a gate
  # that can refuse to start can refuse for a reason that is not real, and then the tool that
  # would fix it is the one that will not run. The recorded history of that class here is one
  # false positive and zero true positives. So this reports and gets out of the way — the
  # system is handed back either way, with the failure said out loud.
  #
  # Costs two model calls per start. That is the price of not discovering a dead chat lane by
  # typing into it.
  # ⛔ BOUNDED, AND IT WAS NOT ON THE FIRST TRY. The first version called `& node ...` inline.
  # The node process ran and exited, and the launcher never came back — the hand-back sat
  # blocked behind a check whose entire stated purpose was never to block the hand-back.
  # Exactly the shape this was written to avoid, in the file that says so.
  #
  # So: a separate process, output to a file, and a HARD WAIT with a ceiling. Two model calls
  # take about 8 seconds; 120 gives room for a slow provider without ever becoming a hang. If
  # the ceiling is reached the child is killed and the launcher continues — a smoke test that
  # cannot answer must not be able to hold the system hostage either.
  Write-Log 'startup smoke: one chat turn per provider'
  $smokeOut = Join-Path $env:TEMP 'aroma-startup-smoke.out'
  $smokeErr = Join-Path $env:TEMP 'aroma-startup-smoke.err'
  $smoke = @()
  try {
    $sp = Start-Process node -ArgumentList (Join-Path $Repo 'scripts\launcher\startupSmoke.js') `
      -NoNewWindow -PassThru -RedirectStandardOutput $smokeOut -RedirectStandardError $smokeErr
    if (-not $sp.WaitForExit(120000)) {
      try { $sp.Kill() } catch {}
      Write-Log 'smoke: TIMED OUT after 120s — killed; the system is still being handed back'
    }
    if (Test-Path $smokeOut) { $smoke += Get-Content $smokeOut -Encoding UTF8 }
    if (Test-Path $smokeErr) { $smoke += Get-Content $smokeErr -Encoding UTF8 }
  } catch {
    Write-Log ('smoke: could not run (' + $_.Exception.Message + ') — the system is still being handed back')
  }
  foreach ($l in $smoke) { if ($l) { Write-Log ("smoke: " + $l) } }
  $verdict = $smoke | Where-Object { $_ -match 'STARTUP_SMOKE_VERDICT' } | Select-Object -Last 1
  if ($verdict -and $verdict -match '"outcome":"FAIL"') {
    $saying = '香香啟動咗，但有一邊答唔到。系統照樣開咗，詳情睇 C:\Aroma\xiangxiang.log。'
    if ($verdict -match '"saying":"([^"]*)"') { $saying = $Matches[1] }
    Notify-Owner '啟動咗，但答唔到' $saying
  }

  if ($Mode -eq 'Open') { Start-Process $Url }
} elseif ($proc -and $proc.HasExited) {
  # ⛔ AN UNREADABLE CODE MUST SAY SO. If EnableRaisingEvents failed above, ExitCode is empty
  # and 「exit code 」 reads as a gap the eye skips — an unknown printed as a blank rather than
  # as an unknown. Name it instead.
  $code = ''
  try { $code = [string]$proc.ExitCode } catch { $code = '' }
  if ([string]::IsNullOrEmpty($code)) { $code = '讀唔到' }
  Write-Log ("server process EXITED after " + $waited + "s with code " + $code + "; see " + $SrvErr)
  Notify-Owner '啟動失敗' ("香香 開咗之後即刻死咗（" + $waited + " 秒，exit code " + $code + "）。`n錯誤內容：" + $SrvErr)
} else {
  Write-Log ("server still not healthy after " + $waited + "s; process is alive but not answering /health")
  Notify-Owner '啟動失敗' ("香香 開咗但 " + $waited + " 秒都仲未應 /health，程序仲喺度行緊。`n記錄：C:\Aroma\xiangxiang.log`n伺服器輸出：" + $SrvOut)
}
