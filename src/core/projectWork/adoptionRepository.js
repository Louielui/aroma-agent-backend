'use strict'
const fs = require('node:fs'), path = require('node:path'), { execFile } = require('node:child_process'), { randomUUID } = require('node:crypto')
const { RECIPE, recipe, sourceValues } = require('./contract'), { digest } = require('../../workers/execution/windowsSandbox')
const normalize = text => text.replace(/\r\n/g, '\n')
function git (root, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)))
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' })
  return new Promise((resolve, reject) => execFile('git', ['--no-replace-objects', '-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', '-C', root, ...args],
    { env, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 5000000 }, (error, out) => error ? reject(Error('repository_unavailable')) : resolve(out)))
}
function createRepository ({ root, source, command = git, resolveRecipe = recipe }) {
  const head = async () => (await command(root, ['rev-parse', 'HEAD'])).trim()
  const outside = async names => JSON.stringify(await Promise.all([
    command(root, ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--', '.', ...names.map(n => ':(exclude)' + n)]),
    command(root, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', '--', '.', ...names.map(n => ':(exclude)' + n)]),
    command(root, ['status', '--porcelain=v1', '--untracked-files=all', '--', '.', ...names.map(n => ':(exclude)' + n)])
  ]))
  function regular (name) {
    let current = root
    for (const part of name.split('/')) {
      current = path.join(current, part); const st = fs.lstatSync(current)
      if (st.isSymbolicLink() || path.resolve(fs.realpathSync(current)).toLowerCase() !== path.resolve(current).toLowerCase() || (current === path.join(root, name) && (!st.isFile() || st.nlink !== 1))) throw Error('source_changed')
    }
    return fs.lstatSync(current)
  }
  function replace (name, content) {
    const target = path.join(root, name), original = regular(name), temp = target + '.adoption-' + randomUUID() + '.tmp'
    try { fs.writeFileSync(temp, content, { flag: 'wx', mode: original.mode & 0o777 }); fs.renameSync(temp, target) }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  }
  async function apply ({ snapshot, before, after, id, action }) {
    const recipeId = snapshot?.evidence?.recipe || RECIPE, names = resolveRecipe(recipeId).workOrder.allowedFiles
    const oldFiles = sourceValues(recipeId, before, resolveRecipe), newFiles = sourceValues(recipeId, after, resolveRecipe)
    if (!/^[a-f0-9-]{36}$/.test(id || '') || !['adopt', 'rollback'].includes(action) || names.some(n => snapshot.order.files[n] !== oldFiles[n] || oldFiles[n] === newFiles[n])) throw Error('invalid_request')
    await source.verify(snapshot)
    const previous = snapshot.evidence.revision, unaffected = await outside(names), originalBytes = {}
    for (const name of names) { regular(name); originalBytes[name] = fs.readFileSync(path.join(root, name)); if (normalize(originalBytes[name].toString()) !== oldFiles[name]) throw Error('source_changed') }
    if (await head() !== previous) throw Error('source_changed')
    const written = []; let committed = false
    try {
      for (const name of names) {
        if (await head() !== previous || normalize(fs.readFileSync(path.join(root, name), 'utf8')) !== oldFiles[name]) throw Error('source_changed')
        replace(name, newFiles[name]); written.push(name)
      }
      if (await head() !== previous || names.some(n => normalize(fs.readFileSync(path.join(root, n), 'utf8')) !== newFiles[n]) || await outside(names) !== unaffected) throw Error('source_changed')
      // One --only commit includes the complete registered set; unrelated index
      // entries, untracked files and working bytes are never reset or staged.
      await command(root, ['-c', 'user.name=Xiangxiang', '-c', 'user.email=xiangxiang@localhost', 'commit', '--only', '-m', 'Xiangxiang Owner-approved ' + action + ' ' + id, '--', ...names])
      const commit = await head(); committed = commit !== previous
      const changed = (await command(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', commit])).trim().split(/\r?\n/).sort()
      if (!committed || (await command(root, ['rev-parse', commit + '^'])).trim() !== previous || JSON.stringify(changed) !== JSON.stringify(names.slice().sort()) || await outside(names) !== unaffected) throw Error('adoption_inspection_required')
      for (const name of names) if (normalize(await command(root, ['show', commit + ':' + name])) !== newFiles[name]) throw Error('adoption_inspection_required')
      const files = names.map(file => ({ file, beforeHash: digest(oldFiles[file]), afterHash: digest(newFiles[file]) }))
      return { commit, parentCommit: previous, ...(recipeId === RECIPE ? files[0] : { recipe: recipeId, files }), unaffectedHash: digest(unaffected) }
    } catch (error) {
      // Restore all OUR uncommitted writes only if every byte and HEAD still
      // match our transaction. Ambiguous commits/concurrent edits require inspection.
      if (written.length && !committed && await head() === previous && written.every(n => normalize(fs.readFileSync(path.join(root, n), 'utf8')) === newFiles[n])) {
        for (const name of written.reverse()) replace(name, originalBytes[name])
      } else if (written.length) throw Error('adoption_inspection_required')
      throw error
    }
  }
  async function verifyLoaded (row) {
    const recipeId = row.source?.evidence.recipe || RECIPE, fresh = await source.read(row.commit, undefined, recipeId), values = sourceValues(recipeId, row.after, resolveRecipe)
    const expected = recipeId === RECIPE ? [row.change] : row.change.files
    if (recipeId !== RECIPE && (!Array.isArray(expected) || JSON.stringify(expected.map(c => c?.file).sort()) !== JSON.stringify(Object.keys(values).sort()))) throw Error('source_changed')
    if (!Array.isArray(expected) || expected.length !== Object.keys(values).length || expected.some(c => !c || !Object.hasOwn(values, c.file || resolveRecipe(recipeId).workOrder.allowedFiles[0]) || digest(values[c.file || resolveRecipe(recipeId).workOrder.allowedFiles[0]]) !== c.afterHash) || Object.entries(values).some(([n, text]) => fresh.order.files[n] !== text)) throw Error('source_changed')
    return { bootCommit: fresh.evidence.bootCommit, ...(recipeId === RECIPE ? { sourceHash: digest(row.after) } : { sourceHashes: Object.fromEntries(Object.entries(values).map(([n, text]) => [n, digest(text)])) }) }
  }
  return { apply, verifyLoaded, head }
}
module.exports = { createRepository, git, normalize }
