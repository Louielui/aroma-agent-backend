# measurementContext.ps1 - capture the conditions a measurement was taken under.
#
# Owner ruling 2026-07-30. Part B, Lock 3 and the DoD must record and cross-check the SAME
# measurement context, because the DoD's step 2 is a formal acceptance and an acceptance built
# from stages measured under different conditions describes nothing.
#
# The adjudicator is src/computer/measurementContext.js. THIS side only observes and records -
# it deliberately does not decide, so that the decision has exactly one implementation. It does
# refuse to record a context it can see is unusable, which is not the same thing: recording a
# known-bad context as if it were fine is how an unusable run gets adjudicated later as a
# merely-inconsistent one.
#
# ── NO param() BLOCK. DOT-SOURCED. ──────────────────────────────────────────
# A dot-sourced script runs its param() in the CALLER's scope. That is how a bound -SelfTest
# became $false and ran a real measurement in the Owner's session, twice.
#
# ── ONE MEASURED FACT DRIVES THE WHOLE DESIGN ───────────────────────────────
# A DISCONNECTED session reports a BLANK session name. Measured on this machine: session 5,
# state Disc, SESSIONNAME empty in both `quser` and `qwinsta`. So while the Companion session is
# Disconnected its protocol is not merely awkward to obtain - it is UNKNOWABLE, and any script
# claiming `protocol = console` about it is reporting a guess. That is why state is checked
# BEFORE protocol, and why Active is a precondition rather than a preference.

Set-StrictMode -Version Latest

# Read the session table once and return rows. `qwinsta` is used rather than `quser` because it
# reports the session NAME for every session including ones with no user, which is what the
# protocol determination needs.
function Get-SessionTable {
  $rows = New-Object System.Collections.Generic.List[object]
  $lines = @()
  try { $lines = @(qwinsta 2>$null) } catch { }
  if ($lines.Count -lt 2) { return $rows.ToArray() }

  # Column offsets are read FROM THE HEADER, not hardcoded. A first attempt used measured
  # constants and returned ZERO rows - which fell through to "NOT-SIGNED-IN" for an account
  # that was in fact signed in. A parser that reports absence when it simply failed to read is
  # the worst possible failure here, because absence and refusal need opposite responses.
  $header = $null
  foreach ($l in $lines) { if ($l -match 'SESSIONNAME' -and $l -match 'USERNAME') { $header = $l; break } }
  if (-not $header) { return $rows.ToArray() }
  $nameStart  = $header.IndexOf('SESSIONNAME')
  $userStart  = $header.IndexOf('USERNAME')
  $idEnd      = $header.IndexOf('ID') + 2      # ID is RIGHT-aligned: values end where the header does
  $stateStart = $header.IndexOf('STATE')
  if ($nameStart -lt 0 -or $userStart -le $nameStart -or $idEnd -le $userStart -or $stateStart -lt $idEnd) {
    return $rows.ToArray()
  }

  foreach ($line in $lines) {
    if ($line -eq $header) { continue }
    if ($line.Length -lt $stateStart) { continue }

    # The name column is parsed BY POSITION because a disconnected session leaves it EMPTY -
    # splitting the line on whitespace would silently shift the username into the name column
    # and make every Disc session look like it were named after its user.
    $name = $line.Substring($nameStart, $userStart - $nameStart).Trim().TrimStart('>')

    # Username (left-aligned) and id (right-aligned) share a span; take the span and split it.
    # Usernames contain no spaces, so at most two tokens can appear.
    $span = $line.Substring($userStart, $idEnd - $userStart).Trim()
    $tok = @($span -split '\s+' | Where-Object { $_ -ne '' })
    $user = ''
    $idTxt = ''
    if ($tok.Count -ge 2) { $user = $tok[0]; $idTxt = $tok[$tok.Count - 1] }
    elseif ($tok.Count -eq 1) {
      if ($tok[0] -match '^\d+$') { $idTxt = $tok[0] } else { $user = $tok[0] }
    }

    $state = $line.Substring($stateStart).Trim() -replace '\s.*$', ''
    $id = 0
    if ([int]::TryParse($idTxt, [ref]$id)) {
      $rows.Add([pscustomobject]@{ sessionName = $name; user = $user; sessionId = $id; state = $state })
    }
  }
  # no leading comma: callers wrap with @()
  return $rows.ToArray()
}

# console vs rdp vs unknown, from the session NAME. Never guessed from anything else.
function Resolve-SessionProtocol {
  param([string]$SessionName, [string]$State)
  if ($State -ne 'Active') { return 'unknown-disconnected' }
  if ([string]::IsNullOrWhiteSpace($SessionName)) { return 'unknown-unnamed' }
  if ($SessionName -eq 'console') { return 'console' }
  if ($SessionName -like 'rdp-tcp*') { return $SessionName }
  return $SessionName
}

function Get-OwnWindowStationAndDesktop {
  # The station and desktop this process is actually attached to. Not inferred from the session.
  $sta = 'unknown'; $dsk = 'unknown'
  try {
    $sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CxSta {
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetThreadDesktop(uint dwThreadId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool GetUserObjectInformationW(IntPtr hObj, int nIndex, StringBuilder pvInfo, uint nLength, out uint lpnLengthNeeded);
  public static string Name(IntPtr h) {
    StringBuilder sb = new StringBuilder(256); uint need;
    if (GetUserObjectInformationW(h, 2, sb, 256, out need)) return sb.ToString();
    return "unknown";
  }
  public static string Station() { return Name(GetProcessWindowStation()); }
  public static string Desktop() { return Name(GetThreadDesktop(GetCurrentThreadId())); }
}
'@
    if (-not ('CxSta' -as [type])) { Add-Type -TypeDefinition $sig -ErrorAction Stop }
    $sta = [CxSta]::Station()
    $dsk = [CxSta]::Desktop()
  } catch {
    # A named failure, never a silent 'unknown' that reads like a successful observation of
    # something called unknown. The adjudicator treats these as present-but-wrong, and the
    # required-field check will not save us here, so the value itself has to say what happened.
    $sta = 'UNREADABLE'; $dsk = 'UNREADABLE'
  }
  [pscustomobject]@{ station = $sta; desktop = $dsk }
}

# Build the context record for one stage.
#   -Stage    part-b | lock3 | dod
#   -RunId    the commissioning round nonce - the SAME value for all three stages
#   -Subject  the account the phase is about (the Companion)
function New-MeasurementContext {
  param(
    [string]$Stage,
    [string]$RunId,
    [string]$Subject = 'AromaOperator'
  )

  $table = @(Get-SessionTable)
  $subjectRow = $null
  foreach ($r in $table) { if ($r.user -and ($r.user -ieq $Subject)) { $subjectRow = $r; break } }

  $me = [Security.Principal.WindowsIdentity]::GetCurrent()
  $mySession = (Get-Process -Id $PID).SessionId
  $sd = Get-OwnWindowStationAndDesktop

  $subjectState = 'NOT-SIGNED-IN'
  $subjectId = -1
  $subjectName = ''
  if ($subjectRow) {
    $subjectState = $(if ($subjectRow.state) { $subjectRow.state } else { 'UNKNOWN' })
    $subjectId = $subjectRow.sessionId
    $subjectName = $subjectRow.sessionName
  }
  # Windows abbreviates the disconnected state; the adjudicator speaks in full words.
  if ($subjectState -eq 'Disc') { $subjectState = 'Disc' }

  $ctx = [ordered]@{
    runId                 = $RunId
    stage                 = $Stage
    subjectAccount        = $Subject
    subjectSessionId      = $subjectId
    subjectState          = $subjectState
    subjectSessionName    = $subjectName
    subjectProtocol       = (Resolve-SessionProtocol -SessionName $subjectName -State $subjectState)
    observerAccount       = ($me.Name -replace '^.*\\', '')
    observerAccountFull   = $me.Name
    observerSessionId     = $mySession
    observerWindowStation = $sd.station
    observerDesktop       = $sd.desktop
    observerElevated      = (New-Object Security.Principal.WindowsPrincipal($me)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    capturedAt            = (Get-Date).ToString('o')
  }

  # What this side refuses to pretend about. Recorded ON the context so the report says why,
  # rather than leaving the Owner to infer it from a verdict.
  # ── ONLY THE MEASURING STAGE REQUIRES Active + console ──────────────────────
  # Corrected 2026-07-31 at the machine. Requiring it of EVERY stage made Lock 3 unsatisfiable:
  # only one session is connected to the console at a time, so the Companion session is Active
  # only while somebody is switched into it — and Lock 3 needs elevation, which that account
  # does not have. The two conditions cannot hold together, so the rule blocked the work while
  # looking rigorous.
  #
  # Part B MEASURES the session, so it must be Active on the console. Lock 3 and the DoD
  # ADJUDICATE evidence Part B already produced; the session's state at that later moment says
  # nothing about that evidence. What they must prove is that it is the SAME session — checked
  # by the adjudicator against Part B's recorded id.
  $usable = $true
  $why = New-Object System.Collections.Generic.List[string]
  if ($Stage -eq 'part-b') {
    if ($ctx.subjectState -ne 'Active') {
      $usable = $false
      $why.Add('the Companion session is ' + $ctx.subjectState + ', not Active - while it is not Active its session name is blank and its protocol cannot be read at all')
    }
    if ($ctx.subjectProtocol -ne 'console') {
      $usable = $false
      $why.Add('the Companion session is not on the physical console - protocol reads as ' + $ctx.subjectProtocol)
    }
  } else {
    if ($ctx.subjectState -eq 'NOT-SIGNED-IN') {
      $usable = $false
      $why.Add('the Companion session is gone - the thing the evidence describes no longer exists, so this stage cannot be joined to it')
    }
  }
  $ctx.usable = $usable
  $ctx.unusableBecause = @($why)

  [pscustomobject]$ctx
}

function Write-MeasurementContext {
  param([string]$Path, $Context)
  # ── REFUSE TO WRITE NOTHING ─────────────────────────────────────────────────
  # MEASURED 2026-07-31: all three CONTEXT-*.json files for round 28ba1e19f7ab were 0 bytes.
  # Every call site passed -Object, this parameter is -Context, so nothing bound, $Context was
  # $null, ConvertTo-Json produced nothing, and WriteAllText created an empty file. The
  # surrounding [void](...) swallowed the rest. The result LOOKED written — a file existed at
  # the expected path — and the DoD chain was unsealable because of it.
  #
  # A file that exists but says nothing is worse than a missing one: absence is noticed, an
  # empty file is inherited. So this throws, loudly, before anything is created.
  if ($null -eq $Context) {
    throw "Write-MeasurementContext: no context supplied for $Path (check the caller uses -Context, not -Object)"
  }
  $json = ($Context | ConvertTo-Json -Depth 6)
  if ([string]::IsNullOrWhiteSpace($json)) {
    throw "Write-MeasurementContext: the context serialised to nothing for $Path"
  }
  # WriteAllText, never Set-Content: Set-Content appends its own trailing newline, which is what
  # made an earlier hash comparison structurally unable to pass.
  [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding($false)))
  $Path
}
