# ===========================================================================
#  Operator-StartCompanion.ps1 - fixed launcher. No parameters, no choices.
#
#  Re-checks everything, then waits for one task from the Owner.
#
#  It starts ONE file, whose name is written below and nowhere else. There is
#  no argument, no environment variable and no shortcut property that can
#  change which file that is.
# ===========================================================================

. (Join-Path $PSScriptRoot 'operatorLauncher.ps1')

Invoke-OperatorTool 'tool-start-companion.js' 'START AROMA COMPANION'
