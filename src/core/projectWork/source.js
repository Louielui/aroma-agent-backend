'use strict'
const fs = require('node:fs'), path = require('node:path'), { execFile } = require('node:child_process')
const { PROJECT, RECIPE, recipe } = require('./contract')
const { digest } = require('../../workers/execution/windowsSandbox')
const SHA = /^[a-f0-9]{40}$/
const SECRET = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bya29\.[A-Za-z0-9_-]{25,})/
function gitRead (root, args, signal) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)))
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' })
  return new Promise((resolve, reject) => execFile('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=', '-C', root, ...args],
    { env, signal, windowsHide: true, timeout: 5000, maxBuffer: 700000, encoding: 'utf8' }, (error, out) => error ? reject(Error('source_unavailable')) : resolve(out)))
}
function regular (root, name) {
  let current = root
  for (const part of name.split('/')) {
    current = path.join(current, part)
    const st = fs.lstatSync(current)
    if (st.isSymbolicLink() || (current === path.join(root, name) && (!st.isFile() || st.nlink !== 1))) throw Error('source_unavailable')
    if (path.resolve(fs.realpathSync(current)).toLowerCase() !== path.resolve(current).toLowerCase()) throw Error('source_unavailable')
  }
}
// The host binds its own backend root at composition. Project IDs in the truth
// registry do not become execution roots; Aroma System has no adapter here.
function createSource ({ root, resolveRecipe = recipe, readGit = gitRead, health = async () => {
  const response = await fetch('http://127.0.0.1:8090/health', { signal: AbortSignal.timeout(3000) })
  if (!response.ok) throw Error('source_unavailable')
  return response.json()
} }) {
  const resolved = path.resolve(root)
  async function read (bootCommit, signal, recipeId = RECIPE) {
    const { workOrder, tests } = resolveRecipe(recipeId)
    if (!SHA.test(bootCommit || '')) throw Error('invalid_request')
    if (fs.realpathSync(resolved).toLowerCase() !== resolved.toLowerCase()) throw Error('source_unavailable')
    const top = (await readGit(resolved, ['rev-parse', '--show-toplevel'], signal)).trim()
    if (path.resolve(top).toLowerCase() !== resolved.toLowerCase()) throw Error('source_unavailable')
    const head = (await readGit(resolved, ['rev-parse', 'HEAD'], signal)).trim()
    const runtime = await health()
    if (head !== bootCommit || runtime.status !== 'ok' || runtime.bootCommit !== head) throw Error('source_changed')
    const files = {}, sourceFiles = []
    for (const name of [...workOrder.allowedFiles, ...(workOrder.readonlyFiles || [])]) {
      regular(resolved, name)
      const mode = (await readGit(resolved, ['ls-tree', head, '--', name], signal)).trim()
      if (!/^100644 blob [a-f0-9]{40}\t/.test(mode)) throw Error('source_unavailable')
      if ((await readGit(resolved, ['status', '--porcelain=v1', '--untracked-files=all', '--', name], signal)).trim()) throw Error('source_dirty')
      const bytes = (await readGit(resolved, ['show', head + ':' + name], signal)).replace(/\r\n/g, '\n')
      if (!bytes || bytes.includes('\0') || Buffer.byteLength(bytes) > require('../../workers/execution/packageLimits').fileLimit(name) || SECRET.test(bytes)) throw Error('source_sensitive')
      if (fs.readFileSync(path.join(resolved, name), 'utf8').replace(/\r\n/g, '\n') !== bytes) throw Error('source_dirty')
      files[name] = bytes; sourceFiles.push({ path: name, blob: mode.split(/\s+/)[2], sha256: digest(bytes) })
    }
    if ((await readGit(resolved, ['rev-parse', 'HEAD'], signal)).trim() !== head) throw Error('source_changed')
    const evidence = { projectId: PROJECT, recipe: recipeId, revision: head, bootCommit: runtime.bootCommit,
      sourceFiles: sourceFiles.filter(f => workOrder.allowedFiles.includes(f.path)),
      ...(workOrder.readonlyFiles ? { dependencyFiles: sourceFiles.filter(f => workOrder.readonlyFiles.includes(f.path)) } : {}),
      acceptanceFiles: Object.entries(tests).map(([name, text]) => ({ path: name, sha256: digest(text) })), committedOnly: true, dirtyScope: false }
    return { evidence, hash: digest(JSON.stringify(evidence)), order: { goal: workOrder.goal, files: { ...files, ...tests },
      editable: [...workOrder.allowedFiles], tests: Object.keys(tests), expectedTests: workOrder.expectedTests, sourceRevision: head,
      ...(workOrder.effort ? { effort: workOrder.effort } : {}) } }
  }
  async function verify (snapshot, signal) {
    const fresh = await read(snapshot.evidence.bootCommit, signal, snapshot.evidence.recipe)
    if (fresh.hash !== snapshot.hash || JSON.stringify(fresh.order) !== JSON.stringify(snapshot.order)) throw Error('source_changed')
  }
  return { read, verify }
}
module.exports = { createSource, gitRead }
