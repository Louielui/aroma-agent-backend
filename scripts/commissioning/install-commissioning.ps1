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
           'Owner-Sentinel-Launcher.ps1','Operator-Verification-Launcher.ps1',
           'Report-Reader-Launcher.ps1')

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

# ── DESKTOPS ARE NOT WHERE THE PATH SAYS ──────────────────────────────────
# This used to hardcode C:\Users\<account>\Desktop. MEASURED on this machine: the profile can
# be OneDrive-redirected to a LOCALISED folder (C:\Users\louis\OneDrive\桌面), and BOTH the
# redirected and the plain folder can exist at once with items in each. A wrong guess puts the
# icon somewhere Louie cannot see, which - for the one icon he has to press - is the same as
# not having built any of this. So resolve every plausible desktop and write to all of them.
# A duplicate in a stale folder costs nothing; a miss costs the visit.
function Get-ProfileRoot {
  param([string]$Account)
  # Ask the SID's ProfileImagePath rather than assuming the folder is named after the account.
  try {
    $sid = (New-Object Security.Principal.NTAccount($env:COMPUTERNAME, $Account)).Translate([Security.Principal.SecurityIdentifier]).Value
    $pp = (Get-ItemProperty -Path ("HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\" + $sid) -Name 'ProfileImagePath' -ErrorAction Stop).ProfileImagePath
    if ($pp) { return [Environment]::ExpandEnvironmentVariables($pp) }
  } catch { }
  # No guess here. Falling back to C:\Users\<account> is the very assumption that puts an icon
  # where Louie cannot see it, and a wrong path fails SILENTLY - the copy succeeds into a
  # folder nobody is looking at. Stopping produces a report; guessing produces a wasted visit.
  throw ("could not resolve the profile folder for " + $Account + " from ProfileList - refusing to guess a desktop path")
}

function Resolve-DesktopPaths {
  param([string]$Account)
  $root = Get-ProfileRoot -Account $Account
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($c in @((Join-Path $root 'Desktop'), (Join-Path $root 'OneDrive\Desktop'), (Join-Path $root 'OneDrive\桌面'))) {
    # MEASURED: probing the OTHER account's profile without elevation raises Access Denied,
    # which under $ErrorActionPreference='Stop' aborts with an opaque Test-Path error instead
    # of the clear "no desktop found" report. Treat unreadable as absent and let the caller's
    # own check produce the message that actually tells someone what happened.
    $ok = $false
    try { $ok = Test-Path -LiteralPath $c -ErrorAction Stop } catch { $ok = $false }
    if ($ok -and -not $out.Contains($c)) { $out.Add($c) }
  }
  # and whatever that account's own shell settings say, if its hive is loaded (it is, while
  # the account is signed in - which launcher 1 has already required by this point)
  try {
    $sid = (New-Object Security.Principal.NTAccount($env:COMPUTERNAME, $Account)).Translate([Security.Principal.SecurityIdentifier]).Value
    # RAW, NOT EXPANDED. These values are REG_EXPAND_SZ, and Get-ItemProperty expands them
    # against the CURRENT PROCESS environment - so another account's "%USERPROFILE%\Desktop"
    # comes back as *this* user's desktop. MEASURED: that is how the operator's icon was
    # placed on louis's desktop during round 1e80253806ce. Never expand another user's value.
    $rk = [Microsoft.Win32.Registry]::Users.OpenSubKey("$sid\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders")
    if ($rk) {
      try {
        $v = $rk.GetValue('Desktop', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($v) {
          $v = $v -replace '%USERPROFILE%', $root
          if ($v -and (Test-Path -LiteralPath $v) -and -not $out.Contains($v)) { $out.Add($v) }
        }
      } finally { $rk.Close() }
    }
  } catch { }

  # THE BELT: nothing outside that account's own profile is that account's desktop. This is
  # what makes the whole class of error impossible rather than just the one instance above -
  # any future path that resolves somewhere else is dropped rather than written to.
  $bad = @($out | Where-Object { $_ -notlike ($root + '\*') })
  foreach ($b in $bad) {
    Write-Host ("  ignoring a desktop outside " + $Account + "'s profile: " + $b) -ForegroundColor Yellow
    [void]$out.Remove($b)
  }
  # NO leading comma here. MEASURED: `return ,$arr` read back through the caller's @(...)
  # yields a 1-element array holding the array - count=1 EVEN WHEN EMPTY - which would make
  # the caller's "no desktop found" throw unreachable and hand Join-Path an array. The leading
  # comma is only correct when the caller does NOT re-wrap; here @() already covers the empty
  # case. (Same trap, opposite direction, as Get-AssertionRegistryDrift.)
  return $out.ToArray()
}

function New-Launcher {
  param([string]$Account, [string]$Name, [string]$Script)
  $desktops = @(Resolve-DesktopPaths -Account $Account)
  if ($desktops.Count -eq 0) {
    # NOT a warning. A missing icon is discovered by Louie standing at the machine with
    # nothing to press, which is exactly the situation the fail-safe exists to prevent.
    throw ("no desktop folder could be found for " + $Account + " (profile root: " + (Get-ProfileRoot -Account $Account) + ") - refusing to report success without placing '" + $Name + "'")
  }
  # WScript.Shell saves through an ANSI code path and these names are Chinese. MEASURED: it
  # writes "Aroma ??? -- ?????.lnk" and fails, and it fails even for an ASCII filename inside
  # the OneDrive\桌面 folder, because the FOLDER name cannot be encoded either. Reading such a
  # path back returns a blank shortcut instead of an error, so a naive check "passes".
  # Build once at a fully-ASCII temp path, verify there, then copy the finished bytes.
  $asciiTemp = $env:TEMP
  if (-not $asciiTemp -or $asciiTemp -match '[^\u0000-\u007F]') { $asciiTemp = 'C:\Windows\Temp' }
  $src = Join-Path $asciiTemp ('aroma-lnk-' + [guid]::NewGuid().ToString('N') + '.lnk')
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut($src)
  $lnk.TargetPath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  $lnk.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $InstallDir $Script) + '"'
  $lnk.WorkingDirectory = $InstallDir
  $lnk.IconLocation = 'shell32.dll,44'
  $lnk.Description = $Name
  $lnk.Save()
  # NOTE: the shortcut is NOT marked run-as-administrator. Launcher 1 elevates ITSELF, so the
  # behaviour survives the shortcut being recreated, and Louie is never asked to right-click
  # and pick "Run as administrator" - he answers a UAC prompt, which is one button.
  $check = $sh.CreateShortcut($src)
  if ($check.Arguments -notlike ('*' + $Script + '*')) {
    Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue
    throw ("built '" + $Name + "' but it read back with the wrong target - refusing to place it")
  }
  $srcLen = (Get-Item -LiteralPath $src).Length

  $placed = 0
  foreach ($d in $desktops) {
    $lnkPath = Join-Path $d ($Name + '.lnk')
    Copy-Item -LiteralPath $src -Destination $lnkPath -Force
    # verify by size: COM blanks rather than fails when it cannot encode these paths
    $got = Get-Item -LiteralPath $lnkPath -ErrorAction SilentlyContinue
    if ($got -and $got.Length -eq $srcLen) { $placed++; Write-Host ("  icon: " + $lnkPath) -ForegroundColor Green }
    else { Write-Host ("  COPIED BUT NOT VERIFIED: " + $lnkPath) -ForegroundColor Red }
  }
  Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue
  if ($placed -eq 0) { throw ("could not place '" + $Name + "' on any desktop for " + $Account) }
}

New-Launcher -Account $OwnerAccount `
  -Name 'Aroma 第一步 —— 擁有者標記' -Script 'Owner-Sentinel-Launcher.ps1'
New-Launcher -Account $OperatorAccount `
  -Name 'Aroma 第二步 —— 操作員檢查' -Script 'Operator-Verification-Launcher.ps1'
# Not part of the two-press commissioning sequence - it is pressed AFTERWARDS, whenever a report
# needs to come back out. Refreshed here so it always points at the installed copy.
New-Launcher -Account $OwnerAccount `
  -Name 'Aroma 報告 —— 攞返驗收報告' -Script 'Report-Reader-Launcher.ps1'

Write-Host ''
if (-not $Quiet) { Write-Host 'Installed. Louie presses ONLY these two icons.' -ForegroundColor Cyan }
Write-Host 'Launcher 1 runs this itself and self-checks before touching anything.' -ForegroundColor Yellow
