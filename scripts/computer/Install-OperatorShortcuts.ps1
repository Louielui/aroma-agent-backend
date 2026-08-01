# ===========================================================================
#  Install-OperatorShortcuts.ps1 - put the three icons on the operator's desktop.
#
#  RUN ONCE, BY THE OPERATOR, IN THE OPERATOR'S OWN SESSION.
#  It needs no administrator rights, because it writes only to the desktop of
#  the account running it. That is deliberate: an elevated installer writing
#  into somebody else's profile is a larger permission than the job needs, and
#  this job needs none.
#
#  THE SHORTCUT IS A CONVENIENCE, NOT A CONTROL.
#  Each .lnk starts PowerShell on one fixed launcher in the staged folder. A
#  shortcut can be edited by whoever owns the desktop, so nothing is trusted
#  because it came from one: every check that matters is made by the launcher
#  and the tool it starts, after they are running. Deleting all three icons
#  removes no protection and breaks nothing except convenience.
# ===========================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PowerShellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$StageScripts  = 'C:\Aroma\ComputerOperator-Companion\scripts\computer'

$Shortcuts = @(
  @{ Name = 'Check Operator Identity'; Script = 'Operator-CheckIdentity.ps1' },
  @{ Name = 'Check Operator Machine';  Script = 'Operator-CheckMachine.ps1' },
  @{ Name = 'Start Aroma Companion';   Script = 'Operator-StartCompanion.ps1' }
)

Write-Host ""
Write-Host "  INSTALL OPERATOR SHORTCUTS" -ForegroundColor Cyan
Write-Host ""

$who = [Security.Principal.WindowsIdentity]::GetCurrent().Name
Write-Host ("  Running as: " + $who)

if (-not (Test-Path -LiteralPath $StageScripts)) {
  Write-Host ""
  Write-Host "  The staged program folder is not there, or this account cannot read it." -ForegroundColor Red
  Write-Host ("  Looked for: " + $StageScripts) -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "  No shortcuts were created." -ForegroundColor Yellow
  Write-Host ""
  $null = Read-Host "  Press Enter to close"
  exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
Write-Host ("  Desktop:    " + $desktop)
Write-Host ""

$made = 0
$shell = New-Object -ComObject WScript.Shell
foreach ($s in $Shortcuts) {
  $target = Join-Path $StageScripts $s.Script
  if (-not (Test-Path -LiteralPath $target)) {
    Write-Host ("  MISSING: " + $s.Script + " - no icon created") -ForegroundColor Yellow
    continue
  }
  $lnk = $shell.CreateShortcut((Join-Path $desktop ($s.Name + '.lnk')))
  $lnk.TargetPath = $PowerShellExe
  # -File with an absolute path, and nothing after it. No -Command, so there is
  # no command string for anything to be appended to.
  $lnk.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $target + '"'
  $lnk.WorkingDirectory = $StageScripts
  $lnk.Description = $s.Name
  $lnk.Save()
  Write-Host ("  Created: " + $s.Name) -ForegroundColor Green
  $made = $made + 1
}

Write-Host ""
Write-Host ("  " + $made + " of " + $Shortcuts.Count + " icons are on the desktop.")
Write-Host ""
Write-Host "  Use them in this order: Identity, then Machine, then Companion."
Write-Host ""
$null = Read-Host "  Press Enter to close"
exit 0
