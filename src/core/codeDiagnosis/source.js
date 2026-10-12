'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { FILES, digest } = require('./contract')
const SHA = /^[a-f0-9]{40}$/
const SECRET = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bya29\.[A-Za-z0-9_-]{25,})/
function gitRead (root, args, signal) {
  return new Promise((resolve, reject) => execFile('git', ['-C', root, ...args], { windowsHide: true, timeout: 5000, maxBuffer: 100000, encoding: 'utf8', signal }, (error, stdout) => error ? reject(Error('context_unavailable')) : resolve(stdout)))
}
function createCodeSource ({ root = path.resolve(__dirname, '../../..'), env = process.env, bootCommit, readGit = gitRead, clock = () => new Date().toISOString() } = {}) {
  function verify (actor) {
    if (actor?.id !== 'owner' || actor.role !== 'owner') throw Error('permission_denied')
    if (env.READ_ACCESS !== 'on') throw Error('read_access_disabled')
  }
  async function read (actor, { signal } = {}) {
    verify(actor)
    const top = (await readGit(root, ['rev-parse', '--show-toplevel'], signal)).trim()
    if (fs.realpathSync(top).toLowerCase() !== fs.realpathSync(root).toLowerCase()) throw Error('context_unavailable')
    const revision = (await readGit(root, ['rev-parse', 'HEAD'], signal)).trim()
    if (!SHA.test(revision) || !SHA.test(bootCommit || '')) throw Error('context_unavailable')
    const files = []; let bytes = 0
    for (const file of FILES) {
      verify(actor)
      const objectType = (await readGit(root, ['cat-file', '-t', revision + ':' + file], signal)).trim()
      if (objectType !== 'blob') throw Error('context_unavailable')
      // No working tree, arbitrary paths, .env, logs, credentials, business data,
      // submodules or symlink traversal. git show reads exact committed blobs.
      const content = (await readGit(root, ['show', revision + ':' + file], signal)).replace(/\r\n/g, '\n')
      bytes += Buffer.byteLength(content)
      if (!content || content.includes('\0') || Buffer.byteLength(content) > 70000 || bytes > 170000) throw Error('context_unavailable')
      if (SECRET.test(content)) throw Error('source_sensitive')
      files.push({ evidenceId: 'code-' + files.length, path: file, sha256: digest(content), lineCount: content.split('\n').length, content })
    }
    if ((await readGit(root, ['rev-parse', 'HEAD'], signal)).trim() !== revision) throw Error('evidence_changed')
    const evidence = { project: 'xiangxiang-backend', profile: 'dispatch-v1', revision, bootCommit, committedOnly: true, scope: 'eight fixed committed dispatch source/test files; no whole-repository, working-tree, runtime, business or credential access', files }
    return { state: 'ok', retrievedAt: clock(), evidence, hash: digest(JSON.stringify(evidence)) }
  }
  return { verify, read }
}
module.exports = { createCodeSource }
