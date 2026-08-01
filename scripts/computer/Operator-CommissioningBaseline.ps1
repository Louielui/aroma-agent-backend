# ===========================================================================
#  Operator-CommissioningBaseline.ps1 - fixed launcher. No parameters.
#
#  Measures this machine and records what it finds. Judges nothing, refuses
#  nothing, starts nothing. Run it once, in a real operator session, BEFORE
#  the first canary - so the expectations come from the machine rather than
#  from someone's idea of the machine.
# ===========================================================================

. (Join-Path $PSScriptRoot 'operatorLauncher.ps1')

Invoke-OperatorTool 'tool-commissioning-baseline.js' 'COMMISSIONING BASELINE'
