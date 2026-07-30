# commissioningCore.ps1 - shared core for the two physical-machine commissioning launchers.
#
# Owner ruling 2026-07-30: one-visit commissioning. Louie does THREE things only - attend
# physically, press two launcher icons, switch Windows accounts. He does not paste commands,
# keep nonces, verify hashes, judge machine state, or handle errors. Those are executor work
# and the exception does not cover them.
#
# ── NO param() BLOCK. DELIBERATELY. ─────────────────────────────────────────
# This file is DOT-SOURCED. A dot-sourced script runs its param() block in the CALLER's scope,
# which is how assertionRegistry.ps1's -SelfTest and -RegistryPath silently reset both in every
# probe - a bound -SelfTest became $false and ran a real measurement path in the Owner's
# session, twice. A file that is dot-sourced declares no parameters.
#
# ── WHY WinForms AND NOT A CONSOLE ──────────────────────────────────────────
# Not cosmetic. A console with QuickEdit lets a stray click-drag select text and the next
# Enter COPIES it - the console displaying the instructions is itself a clipboard writer
# (constraint C-2). No console means no QuickEdit means that hazard cannot occur. It also
# satisfies the requirement that Louie sees human-readable progress rather than a raw log.

Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue

$script:CX_EvidenceRoot = 'C:\Aroma\ComputerOperator-Evidence'
$script:CX_CommissionRoot = Join-Path $script:CX_EvidenceRoot 'commissioning'
$script:CX_Repo = 'C:\Aroma\aroma-agent-backend'
$script:CX_Scripts = Join-Path $script:CX_Repo 'scripts\computer'
$script:CX_ProbeDir = 'C:\AromaOperator-Probe'
$script:CX_GateDir = 'C:\Aroma\ComputerOperator-Gate'
$script:CX_StageDir = 'C:\Aroma\ComputerOperator-Companion'
$script:CX_Account = 'AromaOperator'
$script:CX_MaxRounds = 3

function CX-Sha256Text {
  param([string]$Text)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) | ForEach-Object { $_.ToString('x2') }) -join '') }
  finally { $sha.Dispose() }
}
function CX-Sha256File {
  param([string]$Path)
  try { (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLower() } catch { $null }
}

# WriteAllText, never Set-Content. Set-Content APPENDS ITS OWN TRAILING NEWLINE, which is what
# made C7 structurally unable to pass: the file on disk was always the string plus CR LF, so
# any later hash comparison compared a value against itself-plus-a-newline. Measured: 1346
# written, 1348 read back. Every marker here is hashed, so every write must be exact.
function CX-WriteJson {
  param([string]$Path, $Object)
  $json = ($Object | ConvertTo-Json -Depth 10)
  [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding($false)))
  $Path
}
function CX-ReadJson {
  param([string]$Path)
  try { Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json } catch { $null }
}

function CX-RoundDir { param([string]$Nonce) Join-Path $script:CX_CommissionRoot $Nonce }
function CX-Marker { param([string]$Nonce, [string]$Name) Join-Path (CX-RoundDir -Nonce $Nonce) $Name }

# ═══════════════════════════════════════════════════════════════════════════
# THE STATUS WINDOW
#
# One window, a list of steps, a banner. Every step is one of pending / running / ok / fail /
# skip, and the banner is the only thing Louie needs to read. No log, no stack trace, no
# decision to make.
# ═══════════════════════════════════════════════════════════════════════════
function CX-NewUI {
  param([string]$Title, [string]$Subtitle)

  $form = New-Object Windows.Forms.Form
  $form.Text = $Title
  $form.Size = New-Object Drawing.Size(980, 700)
  $form.StartPosition = 'CenterScreen'
  $form.BackColor = [Drawing.Color]::FromArgb(250, 247, 242)
  $form.FormBorderStyle = 'FixedSingle'
  $form.MaximizeBox = $false
  $form.TopMost = $true

  $head = New-Object Windows.Forms.Label
  $head.Text = $Title
  $head.Font = New-Object Drawing.Font('Segoe UI', 20, [Drawing.FontStyle]::Bold)
  $head.ForeColor = [Drawing.Color]::FromArgb(44, 42, 38)
  $head.Location = New-Object Drawing.Point(28, 22)
  $head.Size = New-Object Drawing.Size(920, 38)
  $form.Controls.Add($head)

  $sub = New-Object Windows.Forms.Label
  $sub.Text = $Subtitle
  $sub.Font = New-Object Drawing.Font('Segoe UI', 11)
  $sub.ForeColor = [Drawing.Color]::FromArgb(107, 102, 93)
  $sub.Location = New-Object Drawing.Point(30, 62)
  $sub.Size = New-Object Drawing.Size(920, 26)
  $form.Controls.Add($sub)

  $panel = New-Object Windows.Forms.Panel
  $panel.Location = New-Object Drawing.Point(28, 100)
  $panel.Size = New-Object Drawing.Size(920, 390)
  $panel.AutoScroll = $true
  $panel.BackColor = [Drawing.Color]::White
  $panel.BorderStyle = 'FixedSingle'
  $form.Controls.Add($panel)

  $banner = New-Object Windows.Forms.Label
  $banner.Text = ''
  $banner.Font = New-Object Drawing.Font('Segoe UI', 15, [Drawing.FontStyle]::Bold)
  $banner.TextAlign = 'MiddleCenter'
  $banner.Location = New-Object Drawing.Point(28, 505)
  $banner.Size = New-Object Drawing.Size(920, 120)
  $banner.BackColor = [Drawing.Color]::FromArgb(236, 230, 218)
  $banner.ForeColor = [Drawing.Color]::FromArgb(44, 42, 38)
  $form.Controls.Add($banner)

  $foot = New-Object Windows.Forms.Label
  $foot.Text = ''
  $foot.Font = New-Object Drawing.Font('Consolas', 9)
  $foot.ForeColor = [Drawing.Color]::FromArgb(138, 133, 124)
  $foot.Location = New-Object Drawing.Point(30, 634)
  $foot.Size = New-Object Drawing.Size(920, 22)
  $form.Controls.Add($foot)

  $form.Show()
  $form.Refresh()

  $ui = [pscustomobject]@{
    Form = $form; Panel = $panel; Banner = $banner; Foot = $foot
    Steps = (New-Object System.Collections.Generic.List[object])
    Y = 12
  }

  $ui | Add-Member -MemberType ScriptMethod -Name Pump -Value {
    for ($i = 0; $i -lt 3; $i++) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 12 }
  }
  $ui | Add-Member -MemberType ScriptMethod -Name AddStep -Value {
    param([string]$Key, [string]$Text)
    $l = New-Object Windows.Forms.Label
    $l.Text = '   ' + $Text
    $l.Font = New-Object Drawing.Font('Segoe UI', 12)
    $l.ForeColor = [Drawing.Color]::FromArgb(163, 157, 146)
    $l.Location = New-Object Drawing.Point(14, $this.Y)
    $l.Size = New-Object Drawing.Size(880, 30)
    $this.Panel.Controls.Add($l)
    $this.Steps.Add([pscustomobject]@{ Key = $Key; Label = $l; Text = $Text })
    $this.Y += 30
    $this.Pump()
  }
  $ui | Add-Member -MemberType ScriptMethod -Name SetStep -Value {
    param([string]$Key, [string]$State, [string]$Detail)
    $s = $this.Steps | Where-Object { $_.Key -eq $Key } | Select-Object -First 1
    if (-not $s) { return }
    $mark = switch ($State) { 'ok' { 'OK  ' } 'fail' { 'X   ' } 'run' { '>>  ' } 'skip' { '--  ' } default { '    ' } }
    $col = switch ($State) {
      'ok'   { [Drawing.Color]::FromArgb(95, 132, 102) }
      'fail' { [Drawing.Color]::FromArgb(176, 86, 75) }
      'run'  { [Drawing.Color]::FromArgb(44, 42, 38) }
      'skip' { [Drawing.Color]::FromArgb(163, 157, 146) }
      default { [Drawing.Color]::FromArgb(163, 157, 146) }
    }
    $s.Label.Text = $mark + $s.Text + $(if ($Detail) { '   -  ' + $Detail } else { '' })
    $s.Label.ForeColor = $col
    if ($State -eq 'run' -or $State -eq 'ok' -or $State -eq 'fail') {
      $s.Label.Font = New-Object Drawing.Font('Segoe UI', 12, $(if ($State -eq 'run') { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }))
    }
    $this.Panel.ScrollControlIntoView($s.Label)
    $this.Pump()
  }
  $ui | Add-Member -MemberType ScriptMethod -Name Banner2 -Value {
    param([string]$Text, [string]$Kind)
    $this.Banner.Text = $Text
    switch ($Kind) {
      'pass' { $this.Banner.BackColor = [Drawing.Color]::FromArgb(238, 243, 238); $this.Banner.ForeColor = [Drawing.Color]::FromArgb(60, 100, 68) }
      'fail' { $this.Banner.BackColor = [Drawing.Color]::FromArgb(245, 227, 224); $this.Banner.ForeColor = [Drawing.Color]::FromArgb(168, 73, 63) }
      'wait' { $this.Banner.BackColor = [Drawing.Color]::FromArgb(243, 233, 212); $this.Banner.ForeColor = [Drawing.Color]::FromArgb(143, 106, 34) }
      default { $this.Banner.BackColor = [Drawing.Color]::FromArgb(236, 230, 218); $this.Banner.ForeColor = [Drawing.Color]::FromArgb(44, 42, 38) }
    }
    $this.Pump()
  }
  $ui | Add-Member -MemberType ScriptMethod -Name SetFoot -Value {
    param([string]$Text) $this.Foot.Text = $Text; $this.Pump()
  }
  $ui
}

# ═══════════════════════════════════════════════════════════════════════════
# FAILURE = STOP. Write a handoff-able report, show its path and SHA-256, and ask Louie for
# NOTHING. He is not being invited to diagnose; he is being told it stopped and where the
# report is.
# ═══════════════════════════════════════════════════════════════════════════
# THE ONE FAILURE SCREEN. Every failure, from every stage, renders through this and nothing
# else. Louie is never shown a choice, a retry, a prompt or a stack trace - only these three
# instructions, always in this order, always the same words.
#
# This is a GUARANTEE, and it is enforced by test, not by discipline:
# commissioningFailSafe.test.js asserts that no commissioning script contains an interactive
# construct at all, and that every catch block routes here.
$script:CX_FAILSAFE_LINE1 = 'STOPPED - and it stopped safely.'
$script:CX_FAILSAFE_LINE2 = 'It has been recorded. There is nothing for you to fix.'
$script:CX_FAILSAFE_LINE3 = 'Take a photo of this window, then stop.'

function CX-FailSafeBanner {
  param([string]$Path, [string]$Sha)
  ($script:CX_FAILSAFE_LINE1 + "`r`n" + $script:CX_FAILSAFE_LINE2 + "`r`n" + $script:CX_FAILSAFE_LINE3 +
   "`r`n`r`n" + $Path + "`r`n" + 'SHA-256: ' + $Sha)
}

function CX-Fail {
  param($UI, [string]$Nonce, [string]$Stage, [string]$Reason, $Detail, [string]$Launcher)
  $dir = if ($Nonce) { CX-RoundDir -Nonce $Nonce } else { $script:CX_CommissionRoot }
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $base = Join-Path $dir ('FAILED-' + $Launcher + '-' + $stamp)

  $rec = [ordered]@{
    marker = 'COMMISSIONING-FAILED'
    launcher = $Launcher
    stage = $Stage
    reason = $Reason
    detail = $Detail
    roundNonce = $Nonce
    identity = ([Security.Principal.WindowsIdentity]::GetCurrent()).Name
    sessionId = (Get-Process -Id $PID).SessionId
    at = (Get-Date).ToString('o')
  }
  $jsonPath = CX-WriteJson -Path ($base + '.json') -Object $rec

  $txt = @()
  $txt += 'AROMA COMMISSIONING - STOPPED'
  $txt += ''
  $txt += $script:CX_FAILSAFE_LINE1
  $txt += $script:CX_FAILSAFE_LINE2
  $txt += $script:CX_FAILSAFE_LINE3
  $txt += ''
  $txt += 'Nothing further is needed from you at the machine.'
  $txt += ''
  $txt += ('launcher : ' + $Launcher)
  $txt += ('stage    : ' + $Stage)
  $txt += ('reason   : ' + $Reason)
  $txt += ('round    : ' + $(if ($Nonce) { $Nonce } else { '(not started)' }))
  $txt += ('when     : ' + (Get-Date).ToString('o'))
  $txt += ''
  $txt += 'detail:'
  $txt += ('  ' + ($Detail | Out-String).Trim())
  $txtPath = $base + '.txt'
  [IO.File]::WriteAllText($txtPath, (($txt -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))

  $sha = CX-Sha256File -Path $txtPath
  if ($UI) {
    $UI.Banner2((CX-FailSafeBanner -Path $txtPath -Sha $sha), 'fail')
    $UI.SetFoot('You may close this window.')
  }
  [pscustomobject]@{ json = $jsonPath; txt = $txtPath; sha256 = $sha }
}

# ═══════════════════════════════════════════════════════════════════════════
# Wait for a marker file written by the OTHER session. This is the whole handoff: no nonce in
# anyone's head, nothing on the clipboard, no key press.
# ═══════════════════════════════════════════════════════════════════════════
function CX-WaitForMarker {
  param($UI, [string]$Path, [int]$TimeoutSeconds, [string]$WaitBanner)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $Path) {
      Start-Sleep -Milliseconds 400   # let the writer finish flushing
      $d = CX-ReadJson -Path $Path
      if ($d) { return $d }
    }
    if ($UI) {
      $left = [int]($deadline - (Get-Date)).TotalMinutes
      $UI.Banner2($WaitBanner + "`r`n`r`n" + '(waiting - up to ' + $left + ' more minutes)', 'wait')
    }
    Start-Sleep -Milliseconds 600
  }
  $null
}

function CX-IsElevated {
  $p = New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())
  $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Is the Companion account signed in, and in which session? Chef's precondition: if session 5
# is still signed in, switching to it needs only an unlock, so no password is required and the
# risk disappears. If it is GONE we must stop AT THE START, not discover it half way through.
function CX-OperatorSession {
  $sid = $null; $state = $null
  try {
    foreach ($line in @(quser 2>$null)) {
      if ($line -match ('^\s*>?\s*' + [regex]::Escape($script:CX_Account) + '\s')) {
        if ($line -match '\s(\d+)\s') { $sid = [int]$Matches[1] }
        if ($line -match '\bActive\b') { $state = 'Active' } elseif ($line -match '\bDisc\b') { $state = 'Disc' }
      }
    }
  } catch { }
  if ($null -eq $sid) {
    # quser can be unavailable; fall back to a process-owner scan, which needs no privilege
    try {
      $p = @(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object {
        $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue
        if ($o -and $o.User -eq $script:CX_Account) { $_.SessionId }
      } | Where-Object { $_ } | Select-Object -First 1)
      if (@($p).Count -gt 0) { $sid = [int]$p[0]; $state = 'Unknown' }
    } catch { }
  }
  [pscustomobject]@{ signedIn = ($null -ne $sid); sessionId = $sid; state = $state }
}
