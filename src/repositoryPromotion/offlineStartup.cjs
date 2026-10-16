'use strict'
// Called by a separately installed, immutable host launcher, before application
// imports. Not wired into production by this tranche. No global API patching.
function runEntrypoint ({ gate, participant, entry }) {
  const fs = require('node:fs'), path = require('node:path')
  if (!path.isAbsolute(entry) || fs.realpathSync(entry) !== entry) throw Error('untrusted_entrypoint')
  const lease = gate.admit(participant)
  // Keep admission for the entire process, including asynchronous startup and
  // final callbacks. Descendant lifetime is verified separately through the Job.
  // An abnormal exit leaves a stale lease and therefore cannot fake a drain.
  process.once('exit', () => lease.finish())
  process.argv[1] = entry
  return require('node:module')._load(entry, null, true)
}
module.exports = { runEntrypoint }
