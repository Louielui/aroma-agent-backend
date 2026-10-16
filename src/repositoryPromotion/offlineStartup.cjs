'use strict'
// Called by a separately installed, immutable host launcher, before application
// imports. Not wired into production by this tranche. No global API patching.
function runEntrypoint ({ gate, participant, entry, maintenanceDirectory }) {
  const fs = require('node:fs'), path = require('node:path')
  if (!path.isAbsolute(maintenanceDirectory || '') || fs.realpathSync(maintenanceDirectory) !== maintenanceDirectory) throw Error('untrusted_maintenance_directory')
  if (fs.existsSync(path.join(maintenanceDirectory, 'maintenance.failed.json')) || fs.existsSync(path.join(maintenanceDirectory, 'maintenance.operation.lock'))) throw Error('maintenance_unreconciled')
  const journal = path.join(maintenanceDirectory, 'maintenance.json')
  if (fs.existsSync(journal)) {
    const stat = fs.lstatSync(journal)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || JSON.parse(fs.readFileSync(journal)).pending) throw Error('maintenance_unreconciled')
  }
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
