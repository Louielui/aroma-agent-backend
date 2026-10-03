'use strict'
const fs = require('node:fs'), path = require('node:path')
const { PROFILES, hash } = require('./contract'), { gitRead } = require('../projectWork/source')
const SECRET = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bya29\.[A-Za-z0-9_-]{25,})/
function createSource ({ root, readGit = gitRead, health = async () => (await fetch('http://127.0.0.1:8090/health', { signal: AbortSignal.timeout(3000) })).json() }) {
  root = path.resolve(root)
  async function read ({ bootCommit, profile }, signal) {
    if (!Object.hasOwn(PROFILES, profile || '') || !/^[a-f0-9]{40}$/.test(bootCommit || '')) throw Error('invalid_request')
    if (fs.realpathSync(root).toLowerCase() !== root.toLowerCase() || path.resolve((await readGit(root, ['rev-parse', '--show-toplevel'], signal)).trim()).toLowerCase() !== root.toLowerCase()) throw Error('context_unavailable')
    const head = (await readGit(root, ['rev-parse', 'HEAD'], signal)).trim(), live = await health()
    if (head !== bootCommit || live.status !== 'ok' || live.bootCommit !== head) throw Error('evidence_changed')
    const files = []
    for (const name of PROFILES[profile]) {
      let current = root
      for (const part of name.split('/')) { current = path.join(current, part); const s = fs.lstatSync(current); if (s.isSymbolicLink() || fs.realpathSync(current).toLowerCase() !== current.toLowerCase() || (current === path.join(root, name) && (!s.isFile() || s.nlink !== 1))) throw Error('context_unavailable') }
      if (!/^100644 blob [a-f0-9]{40}\t/.test((await readGit(root, ['ls-tree', head, '--', name], signal)).trim()) || (await readGit(root, ['status', '--porcelain=v1', '--untracked-files=all', '--', name], signal)).trim()) throw Error('source_dirty')
      const content = (await readGit(root, ['show', head + ':' + name], signal)).replace(/\r\n/g, '\n')
      if (!content || content.includes('\0') || Buffer.byteLength(content) > 100000 || SECRET.test(content)) throw Error('source_sensitive')
      if (fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n') !== content) throw Error('source_dirty')
      files.push({ path: name, evidenceId: 'plan-' + files.length, content, sha256: hash(content), lineCount: content.split('\n').length })
    }
    if ((await readGit(root, ['rev-parse', 'HEAD'], signal)).trim() !== head) throw Error('evidence_changed')
    const evidence = { project: 'aroma-agent-backend', profile, revision: head, bootCommit: head, committedOnly: true, files }
    return { state: 'ok', retrievedAt: new Date().toISOString(), evidence, hash: hash(JSON.stringify(evidence)) }
  }
  return { read }
}
function createRemoteSource ({ bootCommit, env = process.env, request = require('../../adapters/CodexSubscriptionAdapter').localRequest }) {
  const verify = actor => { if (actor?.id !== 'owner' || actor.role !== 'owner') throw Error('permission_denied'); if (env.READ_ACCESS !== 'on') throw Error('read_access_disabled') }
  return { verify, async read (actor, profile, signal) { verify(actor); return request('/task-plan-source', { bootCommit, profile }, env, AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])])) } }
}
module.exports = { createSource, createRemoteSource }
