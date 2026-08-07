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
  if ($Mode -eq 'Open') { Show-Msg '8090 已被其他程式佔用，香香未啟動' }
  return
}

# state == 'down' : hydrate runtime env (no hardcoded secrets) and start our server
$key = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY', 'User')
$hub = [Environment]::GetEnvironmentVariable('HUB_TOKEN', 'User')
if ([string]::IsNullOrEmpty($key)) {
  Write-Log 'ANTHROPIC_API_KEY (User) is empty; fail-closed'
  if ($Mode -eq 'Open') { Show-Msg '缺少 ANTHROPIC_API_KEY（使用者環境），香香未啟動' }
  return
}
if ([string]::IsNullOrEmpty($hub)) {
  Write-Log 'HUB_TOKEN (User) is empty; fail-closed'
  if ($Mode -eq 'Open') { Show-Msg '缺少 HUB_TOKEN（使用者環境），香香未啟動' }
  return
}
$env:ANTHROPIC_API_KEY = $key
$env:HUB_TOKEN         = $hub
$env:CONVERSATION_DEMO = 'on'
$env:LLM_PROVIDER      = 'claude'
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
  if ($Mode -eq 'Open') { Show-Msg ('香香 未啟動：程式庫不在 main（目前 ' + $branch + '）') }
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
Start-Process node -ArgumentList 'src/index.js' -WorkingDirectory $Repo -WindowStyle Hidden `
  -RedirectStandardOutput $SrvOut -RedirectStandardError $SrvErr

# poll health up to ~15s until our app answers
$ok = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  if ((Probe-Server) -eq 'ours') { $ok = $true; break }
}
if ($ok) {
  Write-Log 'health probe matched after start'
  if ($Mode -eq 'Open') { Start-Process $Url }
} else {
  Write-Log 'server did not become healthy within ~15s'
  if ($Mode -eq 'Open') { Show-Msg '香香 啟動逾時，請查看 C:\Aroma\xiangxiang.log' }
}
