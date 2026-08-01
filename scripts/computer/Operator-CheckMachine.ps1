# ===========================================================================
#  Operator-CheckMachine.ps1 - fixed launcher. No parameters, no choices.
#
#  Checks the folder, the permissions and the state of this machine.
#
#  It starts ONE file, whose name is written below and nowhere else. There is
#  no argument, no environment variable and no shortcut property that can
#  change which file that is.
# ===========================================================================

. (Join-Path $PSScriptRoot 'operatorLauncher.ps1')

Invoke-OperatorTool 'tool-check-machine.js' 'CHECK OPERATOR MACHINE'
