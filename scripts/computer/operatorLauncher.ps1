# ===========================================================================
#  operatorLauncher.ps1 - the shared body of the three operator launchers.
#
#  WHY A SHARED BODY
#  Two PowerShell launchers in this project had already drifted apart, and both
#  were broken in ways only a real run exposed. The three operator tools differ
#  by exactly one thing: which fixed Node file they start. Everything else -
#  finding Node, refusing to take arguments, keeping the window open, proving
#  the operator switch was never written outside this process - is identical,
#  so it is written once.
#
#  WHAT A LAUNCHER MAY NOT DO
#  It takes no parameters. It reads no environment. It builds no path from
#  anything but $PSScriptRoot and a fixed file name. There is no shape in which
#  a shortcut, a command line or a variable can point it at a different file.
#
#  THE WINDOW STAYS OPEN
#  A double-clicked shortcut that closes on completion shows the operator a
#  flash. Every path through this file ends at the same "press a key" prompt,
#  including the failure paths - especially the failure paths.
# ===========================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Absolute. Never resolved from PATH: a bare name once resolved to a Git-for-
# Windows binary and produced a confident, wrong answer about this machine.
$script:NodeExe = 'C:\Program Files\nodejs\node.exe'

function Say ([string]$Text, [string]$Colour = 'Gray') {
  if ($Colour -eq 'Gray') { Write-Host $Text } else { Write-Host $Text -ForegroundColor $Colour }
}

function Wait-ThenClose ([int]$Code) {
  Say ""
  Say "  Press any key to close this window." 'DarkGray'
  $read = $false
  try {
    if ($Host.Name -eq 'ConsoleHost') {
      $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
      $read = $true
    }
  } catch { $read = $false }
  if (-not $read) { try { $null = Read-Host } catch { Start-Sleep -Seconds 30 } }
  exit $Code
}

# ---------------------------------------------------------------------------
#  Run one fixed tool.
#
#  The operator switch is measured in all three scopes before and after. This
#  window never sets it - the Node process sets it in its OWN process scope for
#  the moment it acts, and that value cannot propagate back to this one. So if
#  User or Machine has changed here, something wrote a scope nothing is allowed
#  to write, and that is reported as an incident rather than as a result.
# ---------------------------------------------------------------------------
function Invoke-OperatorTool ([string]$ToolFileName, [string]$Heading) {
  Clear-Host
  Say ""
  Say ("  " + $Heading) 'Cyan'
  Say ""

  if (-not (Test-Path -LiteralPath $script:NodeExe)) {
    Say "  This computer is missing a program this tool needs (Node)." 'Red'
    Say ("  Looked for: " + $script:NodeExe) 'DarkGray'
    Wait-ThenClose 2
  }

  $tool = Join-Path $PSScriptRoot $ToolFileName
  if (-not (Test-Path -LiteralPath $tool)) {
    Say "  The tool file is missing from this folder." 'Red'
    Say ("  Looked for: " + $tool) 'DarkGray'
    Wait-ThenClose 2
  }

  $procBefore = $env:COMPUTER_OPERATOR
  $userBefore = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', 'User')
  $machineBefore = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', 'Machine')

  & $script:NodeExe $tool
  $code = $LASTEXITCODE

  $procAfter = $env:COMPUTER_OPERATOR
  $userAfter = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', 'User')
  $machineAfter = [Environment]::GetEnvironmentVariable('COMPUTER_OPERATOR', 'Machine')

  if ($procAfter -ne $procBefore -or $userAfter -ne $userBefore -or $machineAfter -ne $machineBefore) {
    Say ""
    Say "  *** CONTAINMENT INCIDENT ***" 'Red'
    Say "  The computer operator switch changed outside the program that uses it." 'Red'
    Say "  Not retrying. Please report this." 'Yellow'
    Wait-ThenClose 9
  }

  Wait-ThenClose $code
}
