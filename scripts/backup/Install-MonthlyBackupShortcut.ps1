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

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath       = $ps
$s.Arguments        = '-NoProfile -ExecutionPolicy Bypass -File "' + $target + '"'
$s.WorkingDirectory = $PSScriptRoot
$s.IconLocation     = "$env:WINDIR\System32\imageres.dll,166"   # a drive icon
$s.Description      = '每月一次:將備份同程式碼複製落 Seagate 並逐個檔核對。唔會自動執行。'
$s.Save()

Write-Host ''
Write-Host '  ✔ 桌面捷徑已建立' -ForegroundColor Green
Write-Host ("    " + $lnk)
Write-Host ''
Write-Host '  每月插好個 Seagate、解鎖,然後撳一下佢。' -ForegroundColor Yellow
Write-Host '  佢唔會自動行,亦冇排程任務。' -ForegroundColor Yellow
Write-Host ''
