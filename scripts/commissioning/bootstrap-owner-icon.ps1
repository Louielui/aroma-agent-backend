#-------------------------------------------------------------------------------------------
# bootstrap-owner-icon.ps1 - THE EXPLICIT CREATOR OF THE FIRST ICON.
#
# ── THE CHICKEN-AND-EGG GAP THIS CLOSES ────────────────────────────────────
# install-commissioning.ps1 places BOTH icons - but it only ever runs from launcher 1, and
# launcher 1 is started by pressing icon 1. So icon 1 could only ever be created by something
# that could not run until icon 1 already existed. Nobody outside that loop owned it, so it
# did not exist, and the one icon Louie has to press to start any of this was missing.
#
# This script owns it. It is named, it is testable, and a test asserts the first icon has an
# explicit creator rather than being assumed into existence.
#
# ── AND THE DESKTOP IS NOT WHERE YOU THINK ─────────────────────────────────
# MEASURED on this machine: [Environment]::GetFolderPath('Desktop') returns
# C:\Users\louis\Desktop, but the OneDrive-redirected desktop is C:\Users\louis\OneDrive\桌面
# - a LOCALISED folder name - and BOTH directories exist with items in them. One is live, the
# other is a leftover, and from a non-interactive context they are indistinguishable.
#
# Guessing wrong means Louie stands at the machine unable to start. So this does not guess:
# it writes the icon to EVERY plausible desktop it can find, verifies each file afterwards,
# and prints every path. A duplicate in a stale folder costs nothing; a miss costs the visit.
#
# Runs as louis, NO ELEVATION - it only writes into that account's own profile.
#-------------------------------------------------------------------------------------------

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$IconName   = 'Aroma 第一步 —— 擁有者標記'
$RepoScript = 'C:\Aroma\aroma-agent-backend\scripts\commissioning\Owner-Sentinel-Launcher.ps1'
$PowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'

if (-not (Test-Path -LiteralPath $RepoScript)) {
  Write-Host ("launcher not found: " + $RepoScript) -ForegroundColor Red
  exit 1
}

# Every place this account's desktop might actually be. Deliberately generous.
$candidates = New-Object System.Collections.Generic.List[string]
foreach ($c in @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:USERPROFILE 'Desktop'),
  (Join-Path $env:USERPROFILE 'OneDrive\Desktop'),
  (Join-Path $env:USERPROFILE 'OneDrive\桌面')
)) { if ($c -and -not $candidates.Contains($c)) { $candidates.Add($c) } }

# and whatever the shell itself says, expanded
try {
  $reg = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -Name 'Desktop' -ErrorAction Stop).Desktop
  $reg = [Environment]::ExpandEnvironmentVariables($reg)
  if ($reg -and -not $candidates.Contains($reg)) { $candidates.Add($reg) }
} catch { }

Write-Host '=== creating the FIRST icon ===' -ForegroundColor Cyan
Write-Host ('  name   : ' + $IconName)
Write-Host ('  target : ' + $RepoScript)
Write-Host ''

# ── WHY THE SHORTCUT IS BUILT SOMEWHERE ELSE AND THEN COPIED ──────────────
# WScript.Shell.CreateShortcut goes through an ANSI code path. MEASURED on this machine: the
# system locale for non-Unicode programs is not Chinese, so
#   * saving to a Chinese FILENAME wrote "Aroma ??? -- ?????.lnk" and failed, and
#   * saving into the OneDrive\桌面 DIRECTORY failed even under an ASCII filename, because the
#     folder name itself cannot be encoded - so renaming in place does not rescue it, and
#   * reading such a path back returns a BLANK shortcut object instead of erroring, which is
#     why a naive read-back "verified" an empty target and looked fine.
# So: build the .lnk ONCE at a fully-ASCII temp path where COM is reliable, verify it THERE
# by reading its fields back, then copy the finished bytes to each desktop. Copy-Item is
# Unicode-safe, and a .lnk stores no reference to its own filename or folder.
$asciiTemp = $env:TEMP
if (-not $asciiTemp -or $asciiTemp -match '[^\u0000-\u007F]') { $asciiTemp = 'C:\Windows\Temp' }
$src = Join-Path $asciiTemp ('aroma-step1-bootstrap-' + $PID + '.lnk')

try {
  $sh = New-Object -ComObject WScript.Shell
  $s = $sh.CreateShortcut($src)
  $s.TargetPath = $PowerShell
  # -WindowStyle Hidden: the console that would otherwise flash is also a clipboard writer if
  # QuickEdit is on. The launcher's own window is WinForms.
  $s.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $RepoScript + '"'
  $s.WorkingDirectory = (Split-Path $RepoScript -Parent)
  $s.IconLocation = 'shell32.dll,44'
  $s.Description = $IconName
  $s.Save()
} catch {
  Write-Host ('could not build the shortcut: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}

# Verify the CONTENT here, where COM can actually read it back.
$check = $sh.CreateShortcut($src)
if ($check.TargetPath -ne $PowerShell -or $check.Arguments -notlike '*Owner-Sentinel-Launcher.ps1*') {
  Write-Host 'the shortcut built, but read back with the wrong target - refusing to place it.' -ForegroundColor Red
  Write-Host ('  target : ' + $check.TargetPath)
  Write-Host ('  args   : ' + $check.Arguments)
  Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue
  exit 1
}
$srcLen = (Get-Item -LiteralPath $src).Length
Write-Host ('  built and read back OK (' + $srcLen + ' bytes)') -ForegroundColor DarkGray
Write-Host ''

$written = New-Object System.Collections.Generic.List[string]
foreach ($d in $candidates) {
  if (-not (Test-Path -LiteralPath $d)) { Write-Host ('  skip (no such folder) : ' + $d) -ForegroundColor DarkGray; continue }
  $lnk = Join-Path $d ($IconName + '.lnk')
  try {
    Copy-Item -LiteralPath $src -Destination $lnk -Force -ErrorAction Stop
  } catch {
    Write-Host ('  FAILED : ' + $lnk + '  -  ' + $_.Exception.Message) -ForegroundColor Red
    continue
  }
  # VERIFY IT LANDED, by size - not by asking COM, which blanks rather than fails on these
  # paths. "I created it" is not evidence that it is there.
  $got = Get-Item -LiteralPath $lnk -ErrorAction SilentlyContinue
  if ($got -and $got.Length -eq $srcLen) {
    $written.Add($lnk)
    Write-Host ('  CREATED and VERIFIED : ' + $lnk) -ForegroundColor Green
  } else {
    Write-Host ('  COPIED BUT NOT VERIFIED : ' + $lnk) -ForegroundColor Red
  }
}
Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue

Write-Host ''
if ($written.Count -eq 0) {
  Write-Host 'NO ICON WAS CREATED. Louie would have nothing to press.' -ForegroundColor Red
  exit 1
}
Write-Host ('icon present in ' + $written.Count + ' desktop folder(s):') -ForegroundColor Cyan
foreach ($w in $written) { Write-Host ('  ' + $w) }
Write-Host ''
Write-Host 'Louie presses this one. Launcher 1 places the second icon itself.' -ForegroundColor Yellow
exit 0
