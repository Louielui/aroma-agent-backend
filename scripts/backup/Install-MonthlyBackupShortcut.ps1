<#
================================================================================================
 Install-MonthlyBackupShortcut.ps1 — put the monthly backup on the Desktop. Run once.

 NO ELEVATION: it writes one .lnk to YOUR Desktop and nothing else. It creates no scheduled
 task, and that is deliberate — see the header of Monthly-OfflineBackup.ps1 for why the
 monthly leg is manual on purpose.

 Re-running is safe: the shortcut is simply rewritten.
================================================================================================
#>

[CmdletBinding()]
param(
  [string]$ShortcutName = '每月離線備份 (Seagate).lnk'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$target = Join-Path $PSScriptRoot 'Monthly-OfflineBackup.ps1'
if (-not (Test-Path -LiteralPath $target)) { throw "missing: $target" }

$desktop = [Environment]::GetFolderPath('Desktop')
$lnk     = Join-Path $desktop $ShortcutName
$ps      = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

# ── WHY THE SHORTCUT IS BUILT UNDER AN ASCII NAME AND THEN RENAMED ────────────────────────
# WScript.Shell is an ANSI COM API. This machine's ANSI codepage is 1252 (Western European),
# which cannot represent Chinese, so passing the real name straight to CreateShortcut turned
# 「每月離線備份」 into "??????" — and '?' is an ILLEGAL filename character, so the save died
# with a FileNotFoundException that named a path nobody asked for.
#
# So the .lnk is created under a plain-ASCII name, which COM handles, and then renamed with
# [System.IO.File]::Move, which is Unicode-native. The Owner sees the Chinese name; COM never
# sees a character it cannot encode.
$tmpLnk = Join-Path $desktop ('_installing-monthly-backup-' + [guid]::NewGuid().ToString('N') + '.lnk')

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($tmpLnk)
$s.TargetPath       = $ps
$s.Arguments        = '-NoProfile -ExecutionPolicy Bypass -File "' + $target + '"'
$s.WorkingDirectory = $PSScriptRoot
$s.IconLocation     = "$env:WINDIR\System32\imageres.dll,166"   # a drive icon
$s.Description      = 'Monthly: copy backups + code to the Seagate and verify every file.'
$s.Save()
if (-not (Test-Path -LiteralPath $tmpLnk)) { throw "could not create the shortcut at $tmpLnk" }

if (Test-Path -LiteralPath $lnk) { [System.IO.File]::Delete($lnk) }   # re-running is safe
[System.IO.File]::Move($tmpLnk, $lnk)
if (-not (Test-Path -LiteralPath $lnk)) { throw "could not rename the shortcut to $lnk" }

Write-Host ''
Write-Host '  ✔ 桌面捷徑已建立' -ForegroundColor Green
Write-Host ("    " + $lnk)
Write-Host ''
Write-Host '  每月插好個 Seagate、解鎖,然後撳一下佢。' -ForegroundColor Yellow
Write-Host '  佢唔會自動行,亦冇排程任務。' -ForegroundColor Yellow
Write-Host ''
