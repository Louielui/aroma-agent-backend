'use strict'
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process')
const safePath = value => typeof value === 'string' && path.win32.isAbsolute(value) && !/["\r\n]/.test(value)
function startupPlan({ repo, node }) {
  if (!safePath(repo) || !safePath(node)) throw Error('invalid_runtime_path')
  const entry = path.win32.join(repo, 'scripts', 'memory', 'serviceSupervisor.cjs')
  return [
    { name: 'Xiangxiang Subscription Bridge.lnk', component: 'bridge', legacy: path.win32.join(repo, 'scripts', 'subscription', 'startBridge.ps1') },
    { name: 'Xiangxiang Memory.lnk', component: 'hindsight', legacy: path.win32.join(repo, 'scripts', 'memory', 'supervise.ps1') }
  ].map(row => ({ ...row, target: node, arguments: '"' + entry + '" ' + row.component, workingDirectory: repo }))
}
const quote = value => "'" + value.replace(/'/g, "''") + "'"
function installScript(plan) {
  if (!Array.isArray(plan) || plan.length !== 2 || plan.some((p, i) => !safePath(p.target) || !safePath(p.workingDirectory) ||
    p.name !== ['Xiangxiang Subscription Bridge.lnk', 'Xiangxiang Memory.lnk'][i] || p.component !== ['bridge', 'hindsight'][i] || !safePath(p.legacy))) throw Error('invalid_runtime_path')
  const rows = plan.map(p => '@{Name=' + quote(p.name) + ';Target=' + quote(p.target) + ';Arguments=' + quote(p.arguments) + ';WorkingDirectory=' + quote(p.workingDirectory) + ';Legacy=' + quote(p.legacy) + '}').join(',\n')
  return `$ErrorActionPreference = 'Stop'
$startup = [Environment]::GetFolderPath('Startup')
$backup = Join-Path $env:LOCALAPPDATA ('AromaXiangXiang/startup-backups/' + [Guid]::NewGuid().ToString())
$shell = New-Object -ComObject WScript.Shell
$plan = @(${rows})
$out = @()
# Validate both existing identities before writing either shortcut.
foreach ($item in $plan) {
  $target = Join-Path $startup $item.Name
  if (Test-Path -LiteralPath $target) {
    $old = $shell.CreateShortcut($target)
    $ps = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $legacyArguments = @(('-NoProfile -WindowStyle Hidden -File ' + $item.Legacy), ('-NoProfile -WindowStyle Hidden -File "' + $item.Legacy + '"'), ('-NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File "' + $item.Legacy + '"'))
    $same = $old.TargetPath -eq $item.Target -and $old.Arguments -eq $item.Arguments
    $legacy = $old.TargetPath -eq $ps -and $legacyArguments -contains $old.Arguments
    if (-not $same -and -not $legacy) { throw 'shortcut_identity_mismatch' }
    $item.Changed = -not $same
  }
}
foreach ($item in $plan) {
  $target = Join-Path $startup $item.Name
  if ($item.Changed) {
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item -LiteralPath $target -Destination (Join-Path $backup $item.Name)
  }
  $shortcut = $shell.CreateShortcut($target)
  $shortcut.TargetPath = $item.Target
  $shortcut.Arguments = $item.Arguments
  $shortcut.WorkingDirectory = $item.WorkingDirectory
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'Owner session memory service supervisor'
  $shortcut.Save()
  $verified = $shell.CreateShortcut($target)
  if ($verified.TargetPath -ne $item.Target -or $verified.Arguments -ne $item.Arguments) { throw 'shortcut_readback_failed' }
  $approved = Get-ItemProperty -LiteralPath 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Explorer/StartupApproved/StartupFolder' -Name $item.Name -ErrorAction SilentlyContinue
  $disabled = $approved -and $approved.($item.Name) -and $approved.($item.Name)[0] -in @(3,7)
  $out += @{component=$item.Component; verified=$true; disabled=[bool]$disabled; path=$target}
}
$out | ConvertTo-Json -Compress
`
}
function install({ repo = path.resolve(__dirname, '../..'), node = process.execPath, invoke = spawnSync } = {}) {
  if (invoke === spawnSync && require('../../src/testProcess').isTestProcess()) throw Error('autostart_test_fence')
  const plan = startupPlan({ repo, node })
  for (const item of plan) if (!fs.existsSync(item.target) || !fs.existsSync(path.win32.join(repo, 'scripts', 'memory', 'serviceSupervisor.cjs'))) throw Error('runtime_file_missing')
  const command = installScript(plan)
  const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const execution = invoke(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, encoding: 'utf8', timeout: 30000 })
  if (execution.status !== 0) throw Error('autostart_install_unconfirmed')
  try { return JSON.parse(execution.stdout) } catch (_) { throw Error('autostart_readback_unconfirmed') }
}
if (require.main === module) {
  try { console.log(JSON.stringify({ installed: install() })) }
  catch (e) { console.error(['invalid_runtime_path', 'runtime_file_missing', 'autostart_install_unconfirmed', 'autostart_readback_unconfirmed'].includes(e.message) ? e.message : 'autostart_install_unconfirmed'); process.exitCode = 1 }
}
module.exports = { startupPlan, installScript, install }
