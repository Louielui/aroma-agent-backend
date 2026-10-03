'use strict'
const fs = require('node:fs'), path = require('node:path'), { execFile } = require('node:child_process'), { randomUUID } = require('node:crypto')
const { FILE } = require('./contract'), { digest } = require('../../workers/execution/windowsSandbox')
const normalize = text => text.replace(/\r\n/g, '\n')
function git (root, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)))
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' })
  return new Promise((resolve, reject) => execFile('git', ['--no-replace-objects', '-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', '-C', root, ...args],
    { env, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 5000000 }, (error, out) => error ? reject(Error('repository_unavailable')) : resolve(out)))
}
function createRepository ({ root, source, command = git }) {
  const target = path.join(root, FILE)
  const head = async () => (await command(root, ['rev-parse', 'HEAD'])).trim()
  const outside = async () => JSON.stringify(await Promise.all([
    command(root, ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--', '.', ':(exclude)' + FILE]),
    command(root, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', '--', '.', ':(exclude)' + FILE]),
    command(root, ['status', '--porcelain=v1', '--untracked-files=all', '--', '.', ':(exclude)' + FILE])
  ]))
  function replace (content) {
    // One fixed tracked path only; never a model-supplied path or a directory move.
    const original = fs.lstatSync(target)
    if (!original.isFile() || original.isSymbolicLink() || original.nlink !== 1 || fs.realpathSync(target).toLowerCase() !== path.resolve(target).toLowerCase()) throw Error('source_changed')
    const temp = target + '.adoption-' + randomUUID() + '.tmp'
    try { fs.writeFileSync(temp, content, { flag: 'wx', mode: original.mode & 0o777 }); fs.renameSync(temp, target) }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  }
  async function apply ({ snapshot, before, after, id, action }) {
    if (!/^[a-f0-9-]{36}$/.test(id || '') || !['adopt', 'rollback'].includes(action) || snapshot.order.files[FILE] !== before || !after || Buffer.byteLength(after) > 100000) throw Error('invalid_request')
    await source.verify(snapshot)
    const previous = snapshot.evidence.revision, unaffected = await outside(), originalBytes = fs.readFileSync(target)
    if (await head() !== previous || normalize(originalBytes.toString()) !== before) throw Error('source_changed')
    let written = false, committed = false
    try {
      replace(after); written = true
      if (await head() !== previous || normalize(fs.readFileSync(target, 'utf8')) !== after) throw Error('source_changed')
      // --only commits exactly this file, preserving unrelated staged and unstaged
      // changes. Hooks and signing are disabled; model text never becomes a command.
      await command(root, ['-c', 'user.name=Xiangxiang', '-c', 'user.email=xiangxiang@localhost', 'commit', '--only', '-m', 'Xiangxiang Owner-approved ' + action + ' ' + id, '--', FILE])
      const commit = await head(); committed = commit !== previous
      if (!committed || (await command(root, ['rev-parse', commit + '^'])).trim() !== previous ||
          (await command(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', commit])).trim() !== FILE ||
          normalize(await command(root, ['show', commit + ':' + FILE])) !== after || await outside() !== unaffected) throw Error('adoption_inspection_required')
      return { commit, parentCommit: previous, file: FILE, beforeHash: digest(before), afterHash: digest(after), unaffectedHash: digest(unaffected) }
    } catch (error) {
      // Restore only our own uncommitted bytes after a proven commit failure.
      // Ambiguous commits or concurrent edits require inspection; never reset HEAD.
      if (written && !committed && await head() === previous && normalize(fs.readFileSync(target, 'utf8')) === after) replace(originalBytes)
      else if (written) throw Error('adoption_inspection_required')
      throw error
    }
  }
  async function verifyLoaded (row) {
    const fresh = await source.read(row.commit)
    if (fresh.order.files[FILE] !== row.after || digest(row.after) !== row.change.afterHash) throw Error('source_changed')
    return { bootCommit: fresh.evidence.bootCommit, sourceHash: digest(row.after) }
  }
  return { apply, verifyLoaded, head }
}
module.exports = { createRepository, git, normalize }
