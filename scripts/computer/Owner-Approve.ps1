# Owner-Approve.ps1  -  SCREEN 1 of the Owner Approval Ceremony
#
# ===========================================================================
#  Louie reads a plain summary and presses one key. That is the whole job.
#
#  He never: invents an id, copies JSON, compares a hash, tracks a nonce, or
#  pastes a command. Everything technical happens after the keypress.
#
#  ── NO NON-INTERACTIVE APPROVAL PATH. AT ALL. ───────────────────────────
#  This script has NO -Approve, -Yes, -Force or -NonInteractive parameter and
#  reads NO environment variable that could stand in for consent. It takes no
#  parameters that affect the decision, deliberately.
#
#  Consent is read with $Host.UI.RawUI.ReadKey, which reads the real console
#  keyboard buffer. Piped stdin does not reach it and it throws when input is
#  redirected. Combined with the two checks below, a script, a CI job, an
#  agent or a builder cannot produce an Approve - the worst any of them can
#  do is produce a Cancel.
#
#  That matters more than it looks: if a builder could manufacture the
#  "Owner approved" state, then the receipt proves nothing and the whole
#  ceremony is theatre. Owner-Approve.test.js proves the property by running
#  this script with redirected input and asserting Cancel with no receipt.
# ===========================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoDir = 'C:\Aroma\aroma-3b'
$Node    = 'C:\Program Files\nodejs\node.exe'
$Helper  = Join-Path $RepoDir 'scripts\computer\ownerApproval.js'

function Say { param([string]$T, [string]$C = 'Gray') Write-Host $T -ForegroundColor $C }

function Cancel-Now {
  param([string] $Why)
  Say ""
  Say "  CANCELLED - nothing was approved." 'Yellow'
  if ($Why) { Say ("  reason: " + $Why) 'DarkGray' }
  exit 2
}

if (-not (Test-Path -LiteralPath $Node))   { Cancel-Now "node not found" }
if (-not (Test-Path -LiteralPath $Helper)) { Cancel-Now "approval helper not found" }

# ---------------------------------------------------------------------------
# THE SCREEN
# ---------------------------------------------------------------------------
Clear-Host
Say ""
Say "  ==========================================================" 'Cyan'
Say "   APPROVE A COMPUTER TASK                        Step 1 of 2" 'Cyan'
Say "  ==========================================================" 'Cyan'
Say ""
Say "  You are being asked to approve ONE task on this computer." 'White'
Say "  Please read what it will do:" 'White'
Say ""

$summary = & $Node $Helper summary
if ($LASTEXITCODE -ne 0) { Cancel-Now "could not read the task" }
$summary | ForEach-Object { Say $_ 'White' }

Say ""
Say "  Nothing happens yet. Approving only records your decision;" 'DarkGray'
Say "  you will be asked again on a second screen before it runs." 'DarkGray'
Say ""
Say "  ----------------------------------------------------------" 'Cyan'
Say "    Press  A  to APPROVE        Press  C  to CANCEL" 'Cyan'
Say "  ----------------------------------------------------------" 'Cyan'
Say ""

# ---------------------------------------------------------------------------
# CONSENT - a real key, from a real console, or nothing
# ---------------------------------------------------------------------------
if (-not [Environment]::UserInteractive) { Cancel-Now "not an interactive session" }
try {
  if ([Console]::IsInputRedirected) { Cancel-Now "input is redirected - a person must press the key" }
} catch { Cancel-Now "could not determine whether input is a console" }

$key = $null
try {
  $key = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
} catch {
  # The host has no real keyboard to read. Fail CLOSED: an unreadable console
  # is not consent, and must never be treated as one.
  Cancel-Now "no console keyboard available"
}
if ($null -eq $key) { Cancel-Now "no key was read" }

$ch = [string]$key.Character
if ($ch -ne 'a' -and $ch -ne 'A') { Cancel-Now "you pressed something other than A" }

# ---------------------------------------------------------------------------
# ISSUE - only now, and only here
# ---------------------------------------------------------------------------
Say ""
Say "  Recording your approval..." 'Cyan'

$who = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$raw = & $Node $Helper issue --by $who --machine $env:COMPUTERNAME
if ($LASTEXITCODE -ne 0) { Cancel-Now "the approval could not be recorded" }

$res = $raw | ConvertFrom-Json
if (-not $res.ok) { Cancel-Now ("the approval could not be recorded: " + $res.reason) }

Say ""
Say "  APPROVED." 'Green'
Say ""
Say "  A signed-off record has been saved. You do not need to copy" 'White'
Say "  or remember anything from this screen." 'White'
Say ""
Say ("  approved by : " + $who) 'DarkGray'
Say ("  reference   : " + $res.approvalId) 'DarkGray'
Say ""
Say "  NEXT: when you are ready to actually run it, open Step 2." 'Cyan'
Say "        Nothing runs until you confirm there." 'Cyan'
Say ""
exit 0
