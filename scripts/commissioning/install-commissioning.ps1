# install-commissioning.ps1 - put the two icons where Louie can press them. RUN ELEVATED.
#
# CALLED BY LAUNCHER 1 ON EVERY PRESS. There is one person at this machine, so there is no
# separate installer step for somebody else to perform - a step described that way is a step
# Louie performs cold, on an untested path. It is idempotent and safe to re-run.
#
# Two icons, two desktops:
#   "Aroma - Owner Sentinel"  on Louie's desktop        - self-elevates when pressed
#   "Aroma - Operator Check"  on AromaOperator's desktop - never elevates (that account is
#                                                          not an administrator; measured)
#
# The launchers live in C:\Aroma\Commissioning, NOT in the probe directory: Gate B denies the
# Owner read there, so a launcher placed there could not be started from Louie's session.

#Requires -RunAsAdministrator
# -Quiet: called BY launcher 1, which has already elevated. There is one person at this
# machine, so a separate installer step does not exist - the launcher
# installs itself on every press.
param(
  [switch]$Quiet,
  [string]$Repo = 'C:\Aroma\aroma-agent-backend',
  [string]$InstallDir = 'C:\Aroma\Commissioning',
  [string]$OwnerAccount = 'louis',
  [string]$OperatorAccount = 'AromaOperator'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$src = Join-Path $Repo 'scripts\commissioning'
$files = @('commissioningCore.ps1','commissioningPrepare.ps1','commissioningLock5.ps1',
           'commissioningLock5Operator.ps1','commissioningSelfCheck.ps1','install-commissioning.ps1',
           'Owner-Sentinel-Launcher.ps1','Operator-Verification-Launcher.ps1')

if (-not $Quiet) { Write-Host '=== install commissioning launchers ===' -ForegroundColor Cyan }
foreach ($f in $files) {
  if (-not (Test-Path -LiteralPath (Join-Path $src $f))) { throw "missing from the repo: $f" }
}
if (-not (Test-Path -LiteralPath $InstallDir)) { New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null }
foreach ($f in $files) { Copy-Item -LiteralPath (Join-Path $src $f) -Destination $InstallDir -Force }
if (-not $Quiet) { Write-Host ("  copied " + $files.Count + " files to " + $InstallDir) -ForegroundColor Green }

# The operator account must be able to READ and RUN the launcher it is given, and must not be
# able to modify it. Explicit, not inherited: an inherited grant can be removed by a later
# change to C:\ without anything here noticing.
$acl = Get-Acl -LiteralPath $InstallDir
$q = $env:COMPUTERNAME + '\' + $OperatorAccount
$inh = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($q, 'ReadAndExecute', $inh, 'None', 'Allow')))
$deny = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete `
  -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($q, $deny, $inh, 'None', 'Deny')))
Set-Acl -LiteralPath $InstallDir -AclObject $acl
Write-Host '  ACL: operator read+execute, explicit deny on write' -ForegroundColor Green

# The commissioning round directory must be writable by BOTH accounts - it is the handoff.
$cx = 'C:\Aroma\ComputerOperator-Evidence\commissioning'
if (-not (Test-Path -LiteralPath $cx)) { New-Item -ItemType Directory -Force -Path $cx | Out-Null }
$cacl = Get-Acl -LiteralPath $cx
$cacl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($q, 'Modify', $inh, 'None', 'Allow')))
Set-Acl -LiteralPath $cx -AclObject $cacl
Write-Host '  handoff directory writable by both accounts' -ForegroundColor Green

function New-Launcher {
  param([string]$DesktopPath, [string]$Name, [string]$Script, [bool]$Elevate)
  if (-not (Test-Path -LiteralPath $DesktopPath)) { Write-Host ("  SKIPPED (no desktop): " + $DesktopPath) -ForegroundColor Yellow; return }
  $lnkPath = Join-Path $DesktopPath ($Name + '.lnk')
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut($lnkPath)
  $lnk.TargetPath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  $lnk.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $InstallDir $Script) + '"'
  $lnk.WorkingDirectory = $InstallDir
  $lnk.IconLocation = 'shell32.dll,44'
  $lnk.Description = $Name
  $lnk.Save()
  # NOTE: the shortcut is NOT marked run-as-administrator. Launcher 1 elevates ITSELF, so the
  # behaviour survives the shortcut being recreated, and Louie is never asked to right-click
  # and pick "Run as administrator" - he answers a UAC prompt, which is one button.
  Write-Host ("  icon: " + $lnkPath) -ForegroundColor Green
}

New-Launcher -DesktopPath (Join-Path (Join-Path 'C:\Users' $OwnerAccount) 'Desktop') `
  -Name 'Aroma - Owner Sentinel' -Script 'Owner-Sentinel-Launcher.ps1' -Elevate $true
New-Launcher -DesktopPath (Join-Path (Join-Path 'C:\Users' $OperatorAccount) 'Desktop') `
  -Name 'Aroma - Operator Check' -Script 'Operator-Verification-Launcher.ps1' -Elevate $false

Write-Host ''
if (-not $Quiet) { Write-Host 'Installed. Louie presses ONLY these two icons.' -ForegroundColor Cyan }
Write-Host 'Launcher 1 runs this itself and self-checks before touching anything.' -ForegroundColor Yellow
