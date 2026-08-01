'use strict'

/**
 * tool-check-identity.js — "who is this session?", asked by the session itself.
 *
 * No arguments, no stdin, no configuration. It measures one thing and says one sentence.
 */

const T = require('./operatorToolsCommon')

T.title('CHECK OPERATOR IDENTITY')
T.out('  Asking this computer who this session is running as...')
T.out('')

const res = T.checkIdentity()
T.renderIdentity(res)

if (res.ok) {
  T.out('  Next: run "Check Operator Machine".')
} else {
  T.out('  Nothing was started and nothing was changed.')
}
T.out('')
process.exit(res.ok ? 0 : 1)
