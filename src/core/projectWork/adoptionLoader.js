'use strict'
const fs = require('node:fs'), path = require('node:path'), { execFile } = require('node:child_process')
const { git, normalize } = require('./adoptionRepository')
function createLoader ({ root, run = execFile }) {
  return async row => {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.id || '') || !/^[a-f0-9]{40}$/.test(row.commit || '') || row.state !== 'awaiting_restart') throw Error('invalid_request')
    if ((await git(root, ['rev-parse', 'HEAD'])).trim() !== row.commit) throw Error('source_changed')
    const { FILE } = require('./contract')
    const sourcePath = path.join(root, FILE), sourceStat = fs.lstatSync(sourcePath)
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.nlink !== 1 || path.resolve(fs.realpathSync(sourcePath)).toLowerCase() !== path.resolve(sourcePath).toLowerCase() || normalize(fs.readFileSync(sourcePath, 'utf8')) !== row.after || normalize(await git(root, ['show', row.commit + ':' + FILE])) !== row.after || (await git(root, ['status', '--porcelain=v1', '--', FILE])).trim()) throw Error('source_changed')
    const relative = 'scripts/subscription/restartAdoption.ps1', script = path.join(root, relative), st = fs.lstatSync(script)
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || path.resolve(fs.realpathSync(script)).toLowerCase() !== path.resolve(script).toLowerCase() || normalize(fs.readFileSync(script, 'utf8')) !== normalize(await git(root, ['show', row.commit + ':' + relative]))) throw Error('source_changed')
    const quote = value => "'" + value.replace(/'/g, "''") + "'"
    const executable = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
    const command = 'Start-Process -FilePath ' + quote(executable) + " -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','RemoteSigned','-File'," + quote(script) + ",'-RunId'," + quote(row.id) + ') -ErrorAction Stop | Out-Null'
    // UAC is Owner-operated. No arbitrary command, policy weakening, scheduled
    // task elevation or service-account credential copying is reachable here.
    await new Promise((resolve, reject) => run(executable, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 180000 }, error => error ? reject(Error('administrator_reload_required')) : resolve()))
    return { requested: true, protectionBypassed: false }
  }
}
module.exports = { createLoader }
