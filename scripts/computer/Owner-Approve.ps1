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

# ===========================================================================
#  READING THE OWNER'S ANSWER
#
#  ── WHAT WENT WRONG BEFORE, MEASURED FROM THE SYMPTOM ──────────────────
#  The screen rendered and INSTANTLY said "you pressed something other than
#  A", with no key touched. ReadKey did not throw - it RETURNED, immediately,
#  with an event whose Character was not 'A'. Almost certainly a key event
#  carrying no character: a modifier, or something already sitting in the
#  input buffer when the window opened. The old code compared that straight
#  against 'A' and reported it as the Owner's mistake.
#
#  Two separate defects, and the second is the worse one:
#    1. a non-character event was treated as an answer;
#    2. "no keyboard" and "wrong key" produced THE SAME SENTENCE, so the
#       Owner had no way to tell a tool failure from his own action.
#
#  ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────
#  It does not relax anything. An unreadable keyboard still approves nothing.
#  Skipping a Shift key-down is not leniency - a modifier was never an answer.
#  And it sets no console encoding and no hidden state: the fix is in how the
#  events are read, not in configuring the machine underneath.
# ===========================================================================
function Read-OwnerChoice {
  param([string[]] $Accept)

  # Capability FIRST, so "cannot ask" is decided before anything is read and
  # can never be confused with "asked and got the wrong answer".
  if (-not [Environment]::UserInteractive) { return @{ ok = $false; kind = 'no_keyboard'; detail = 'the session is not interactive' } }
  try {
    if ([Console]::IsInputRedirected) { return @{ ok = $false; kind = 'no_keyboard'; detail = 'input is redirected, so no person is typing' } }
  } catch { return @{ ok = $false; kind = 'no_keyboard'; detail = 'could not tell whether input is a console' } }
  if ($Host.Name -ne 'ConsoleHost') { return @{ ok = $false; kind = 'no_keyboard'; detail = ('this host is ' + $Host.Name + ', which has no console keyboard') } }
  try { $null = $Host.UI.RawUI.KeyAvailable } catch { return @{ ok = $false; kind = 'no_keyboard'; detail = 'this host exposes no keyboard buffer' } }

  # Anything already queued when the window opened is NOT a decision.
  try { $Host.UI.RawUI.FlushInputBuffer() } catch { }

  $ignored = 0
  while ($ignored -lt 50) {
    $k = $null
    try { $k = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') }
    catch { return @{ ok = $false; kind = 'no_keyboard'; detail = $_.Exception.Message } }
    if ($null -eq $k) { $ignored++; continue }

    $ch = [string]$k.Character
    # Modifiers and control keys carry no character. Waiting past them is what
    # a person expects; treating them as an answer is what broke.
    if ([string]::IsNullOrEmpty($ch)) { $ignored++; continue }
    if ([int][char]$ch[0] -lt 32) { $ignored++; continue }

    $up = $ch.ToUpper()
    if ($Accept -contains $up) { return @{ ok = $true; key = $up } }
    return @{ ok = $false; kind = 'other_key'; detail = $ch }
  }
  # Fifty events and not one character: the keyboard is not reaching us.
  return @{ ok = $false; kind = 'no_keyboard'; detail = 'only non-character key events arrived' }
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
$choice = Read-OwnerChoice -Accept @('A', 'C')

if (-not $choice.ok -and $choice.kind -eq 'no_keyboard') {
  # NOT the Owner's doing, and it must not read as if it were.
  Say ""
  Say "  THIS TOOL COULD NOT READ YOUR KEYBOARD." 'Red'
  Say ""
  Say "  You did nothing wrong. Nothing was approved and nothing" 'White'
  Say "  was changed - the screen simply cannot take your answer." 'White'
  Say ""
  Say "  Please tell whoever set this up, and pass on this line:" 'White'
  Say ("    keyboard unavailable: " + $choice.detail) 'DarkGray'
  Say ("    host=" + $Host.Name + "  interactive=" + [Environment]::UserInteractive) 'DarkGray'
  Say ""
  exit 5
}
if (-not $choice.ok) { Cancel-Now ("you pressed '" + $choice.detail + "' rather than A or C") }
if ($choice.key -eq 'C') { Cancel-Now "you chose Cancel" }

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
