'use strict'

/**
 * tool-check-machine.js — the full preflight, run by the operator, as the operator.
 *
 * It checks identity FIRST and stops if that is wrong. A folder-permission answer measured by
 * the wrong account is not a weaker answer, it is an answer to a different question — which is
 * exactly how a preflight once passed on the Owner's side for a run that would have acted as
 * the wrong person.
 */

const T = require('./operatorToolsCommon')

T.title('CHECK OPERATOR MACHINE')

const who = T.checkIdentity()
if (!who.ok) {
  T.renderIdentity(who)
  T.out('  The machine was NOT checked: it would have been checked as the wrong account.')
  T.out('')
  process.exit(1)
}
T.line('Account', who.snapshot.name, true)
T.out('')

const res = T.checkMachine()
T.renderMachine(res)

if (res.ok) {
  T.out('  Next: run "Start Aroma Companion" when you are ready.')
} else {
  T.out('  Nothing was started and nothing was changed.')
}
T.out('')
process.exit(res.ok ? 0 : 1)
