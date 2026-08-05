<#
  Test-SessionPrimitives.ps1 — three primitives, three session states, nine results.

  PURPOSE
    Answer, by measurement, whether a Windows session can be DRIVEN when it is not the one
    a human is looking at. Nothing in the Computer Operator record ever measured this: Part B
    required the Companion session to be Active on the console, so the question never had to
    be answered. See SEQUENCE-001 and measurementContext.js.

  THIS IS NOT COMPUTER OPERATOR.
    No flag, no work order, no sealed order, no Companion, no governance surface. It touches
    none of that code. It is a plain Windows question asked with plain Windows APIs, which is
    why it can be answered before anything is enabled.

  WHAT IT DOES
    Opens a Notepad it owns, then tries three things and judges each one HONESTLY:
      1. UIA READ      walk the window's automation tree
      2. SCREENSHOT    capture the screen AND check it is not blank
      3. SEND INPUT    type a marker, then read it back through UIA

  WHY EACH RESULT IS JUDGED, NOT JUST ATTEMPTED
    The 3b work kept finding "positive controls that could not have failed". The same trap is
    live here in all three:
      - a UIA walk returning 1 node proves the reader is not blind, not that a tree was read;
      - a screenshot that succeeds and is entirely black is a SUCCESS that proves nothing;
      - SendInput reporting no error says nothing about whether a character arrived.
    So each primitive has a vacuity check, and a vacuous result is reported as VACUOUS —
    which is a different answer from PASS and from FAIL.

  IT RECORDS ITS OWN SESSION STATE
    You do not tell it which of the three states it is in; it looks. A result attributed to
    the wrong state is worse than no result, and this is exactly the discipline
    measurementContext.js exists to enforce.

  SAFETY
    Opens one Notepad, types one marker into it, never saves, closes it. Writes ONE results
    file. Reads no personal data, touches no store, needs no elevation, changes no setting.

  USAGE — run three times, once per state:

    # 1. at the console, logged on as AromaOperator
    .\Test-SessionPrimitives.ps1

    # 2. locked console: start it, then press Win+L within the delay
    .\Test-SessionPrimitives.ps1 -DelaySeconds 45

    # 3. disconnected: start it, then switch user / reconnect as louis within the delay
    .\Test-SessionPrimitives.ps1 -DelaySeconds 45

  Then send me the results file. Nine rows, each stamped with the state it was measured in.
#>

[CmdletBinding()]
param(
  [int]$DelaySeconds = 0,
  [string]$OutFile = "$env:USERPROFILE\Documents\aroma-session-primitives.log"
)

$ErrorActionPreference = 'Continue'
$marker = "AROMA-PROBE-" + (Get-Random -Minimum 100000 -Maximum 999999)

function Write-Result {
  param($Primitive, $Verdict, $Detail)
  $line = '{0}|state={1}|protocol={2}|session={3}|{4}|{5}|{6}' -f `
    (Get-Date -Format 's'), $script:State, $script:Protocol, $script:SessionId, $Primitive, $Verdict, $Detail
  Add-Content -Path $OutFile -Value $line
  Write-Host $line
}

# ── 0. WHICH SESSION AM I, AND WHAT STATE IS IT IN ────────────────────────────
# Looked up, never assumed. A blank SESSIONNAME is itself the documented signature of a
# disconnected session, so it is reported as such rather than guessed at.
$script:SessionId = (Get-Process -Id $PID).SessionId
$script:State = 'UNKNOWN'
$script:Protocol = 'UNKNOWN'
try {
  $rows = qwinsta 2>$null | Select-Object -Skip 1
  foreach ($r in $rows) {
    $t = $r.Trim() -replace '^>', ''
    $parts = ($t -split '\s{2,}') | Where-Object { $_ -ne '' }
    if ($parts.Count -ge 3) {
      $idIdx = ($parts | ForEach-Object { $_ } | Select-String -Pattern "^$script:SessionId$" -Quiet)
      if ($t -match "\s$script:SessionId\s+(\w+)") {
        $script:State = $Matches[1]
        $name = ($t -split '\s{2,}')[0]
        if ($name -match '^console') { $script:Protocol = 'console' }
        elseif ($name -match '^rdp') { $script:Protocol = 'rdp' }
        elseif ([string]::IsNullOrWhiteSpace($name) -or $name -match '^\d') { $script:Protocol = 'BLANK-NAME' }
        break
      }
    }
  }
} catch { }

if ($DelaySeconds -gt 0) {
  Write-Host ""
  Write-Host "Starting in $DelaySeconds seconds. Switch away / lock NOW." -ForegroundColor Yellow
  Write-Host ""
  Start-Sleep -Seconds $DelaySeconds
  # Re-read: the state is whatever it is AT MEASUREMENT TIME, not at launch time.
  try {
    $rows = qwinsta 2>$null | Select-Object -Skip 1
    foreach ($r in $rows) {
      $t = $r.Trim() -replace '^>', ''
      if ($t -match "\s$script:SessionId\s+(\w+)") { $script:State = $Matches[1]; break }
    }
  } catch { }
}

Add-Content -Path $OutFile -Value ("=== run {0}  session {1}  state {2} ===" -f (Get-Date -Format 's'), $script:SessionId, $script:State)

# ── the target: a Notepad this script owns ────────────────────────────────────
$np = $null
try {
  $np = Start-Process notepad -PassThru
  Start-Sleep -Seconds 2
} catch {
  Write-Result 'setup' 'FAIL' "could not start notepad: $($_.Exception.Message)"
  return
}

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing -ErrorAction SilentlyContinue

# ── 1. UIA READ ───────────────────────────────────────────────────────────────
# VACUITY: a tree of 0 or 1 nodes is not a tree. POS-read_uia_tree-own passed at nodeCount 1
# because a Label had been added to the sentinel precisely so the walk returned something.
try {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $np.Id)
  $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
  if ($null -eq $win) {
    Write-Result 'uia_read' 'FAIL' 'no window element found for the notepad process'
  } else {
    $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $n = $all.Count
    if ($n -le 1) { Write-Result 'uia_read' 'VACUOUS' "nodeCount=$n (a walk that returns 0-1 nodes proves only that it is not blind)" }
    else { Write-Result 'uia_read' 'PASS' "nodeCount=$n" }
  }
} catch {
  Write-Result 'uia_read' 'FAIL' $_.Exception.Message
}

# ── 2. SCREENSHOT ─────────────────────────────────────────────────────────────
# VACUITY: a capture that succeeds and is uniformly black is the classic false positive here.
# Distinct colours and mean brightness are both reported so a blank frame cannot read as ok.
try {
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  if ($bounds.Width -le 0 -or $bounds.Height -le 0) {
    Write-Result 'screenshot' 'FAIL' "no virtual screen: $($bounds.Width)x$($bounds.Height)"
  } else {
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)
    $colors = New-Object 'System.Collections.Generic.HashSet[int]'
    $sum = 0; $count = 0
    for ($x = 0; $x -lt $bmp.Width; $x += 40) {
      for ($y = 0; $y -lt $bmp.Height; $y += 40) {
        $c = $bmp.GetPixel($x, $y)
        [void]$colors.Add($c.ToArgb())
        $sum += ($c.R + $c.G + $c.B) / 3; $count++
      }
    }
    $mean = if ($count) { [math]::Round($sum / $count, 1) } else { 0 }
    $g.Dispose(); $bmp.Dispose()
    if ($colors.Count -le 2) {
      Write-Result 'screenshot' 'VACUOUS' "size=$($bounds.Width)x$($bounds.Height) distinctColors=$($colors.Count) meanBrightness=$mean (a uniform frame is not a screen)"
    } else {
      Write-Result 'screenshot' 'PASS' "size=$($bounds.Width)x$($bounds.Height) distinctColors=$($colors.Count) meanBrightness=$mean"
    }
  }
} catch {
  Write-Result 'screenshot' 'FAIL' $_.Exception.Message
}

# ── 3. SEND INPUT ─────────────────────────────────────────────────────────────
# VACUITY: SendKeys reporting no error says nothing about arrival. The marker is READ BACK
# through UIA, so the verdict is what the window contains, not what the call returned.
try {
  $activated = $false
  try { $activated = (New-Object -ComObject WScript.Shell).AppActivate($np.Id) } catch { }
  Start-Sleep -Milliseconds 500
  [System.Windows.Forms.SendKeys]::SendWait($marker)
  Start-Sleep -Seconds 1

  $readBack = $null
  try {
    $root2 = [System.Windows.Automation.AutomationElement]::RootElement
    $cond2 = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $np.Id)
    $win2 = $root2.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond2)
    if ($win2) {
      $edit = $win2.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
          [System.Windows.Automation.ControlType]::Document)))
      if (-not $edit) {
        $edit = $win2.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
          (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit)))
      }
      if ($edit) {
        $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $readBack = $vp.Current.Value
      }
    }
  } catch { }

  if ($null -eq $readBack) {
    Write-Result 'send_input' 'UNKNOWN' "activated=$activated; typed, but the text could not be read back — arrival is UNVERIFIED, which is not the same as failed"
  } elseif ($readBack -like "*$marker*") {
    Write-Result 'send_input' 'PASS' "activated=$activated; marker arrived and was read back"
  } else {
    Write-Result 'send_input' 'FAIL' "activated=$activated; window content does not contain the marker (len=$($readBack.Length))"
  }
} catch {
  Write-Result 'send_input' 'FAIL' $_.Exception.Message
}

# ── cleanup: nothing is saved, nothing is left running ────────────────────────
try { if ($np -and -not $np.HasExited) { $np.Kill() } } catch { }

Write-Host ""
Write-Host "Results appended to: $OutFile" -ForegroundColor Green
Write-Host "State measured as: $script:State  (protocol: $script:Protocol)" -ForegroundColor Green
