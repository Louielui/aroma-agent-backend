'use strict'
const fs = require('node:fs'), path = require('node:path'), { execFile } = require('node:child_process')
const { FILES, MUTABLE, hash } = require('./contract')
const { SOURCE } = require('./acceptance')
const SOURCE_REVISION = '2b5b2ea0dd16582e1768c8ad0cb6bb681abcdb58'
const SECRET = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bya29\.[A-Za-z0-9_-]{25,})/
const readGit = (root, args) => new Promise((resolve, reject) => execFile('git', ['-C', root, ...args], { windowsHide: true, timeout: 5000, maxBuffer: 120000, encoding: 'utf8' }, (e, out) => e ? reject(Error('context_unavailable')) : resolve(out)))
async function readProfile (repo, bootCommit) {
 const top = (await readGit(repo, ['rev-parse', '--show-toplevel'])).trim(), headCommit = (await readGit(repo, ['rev-parse', 'HEAD'])).trim(), revision = SOURCE_REVISION
 if (fs.realpathSync(repo).toLowerCase() !== fs.realpathSync(top).toLowerCase() || headCommit !== bootCommit || !/^[a-f0-9]{40}$/.test(headCommit)) throw Error('evidence_changed')
 const files = []; let size = 0
 for (const file of FILES) {
  if ((await readGit(repo, ['cat-file', '-t', revision + ':' + file])).trim() !== 'blob') throw Error('context_unavailable')
  const content = (await readGit(repo, ['show', revision + ':' + file])).replace(/\r\n/g, '\n'); size += Buffer.byteLength(content)
  if (!content || content.includes('\0') || SECRET.test(content) || Buffer.byteLength(content) > 100000 || size > 260000) throw Error('source_sensitive')
  files.push({ path: file, content, sha256: hash(content), mutable: MUTABLE.includes(file) })
 }
 if ((await readGit(repo, ['rev-parse', 'HEAD'])).trim() !== headCommit) throw Error('evidence_changed')
 const packet = { revision, headCommit, files, hash: hash(JSON.stringify(files.map(({ content, ...meta }) => meta))) }
 require('./recipes').reviewed(packet)
 return packet
}
function createWorkspace (root, packet) {
 fs.mkdirSync(root, { recursive: true }); const dir = fs.mkdtempSync(path.join(root, 'repair-'))
 for (const file of packet.files) { const target = path.join(dir, file.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, file.content, { flag: 'wx' }) }
 fs.writeFileSync(path.join(dir, 'acceptance.test.js'), SOURCE, { flag: 'wx' }); fs.mkdirSync(path.join(dir, 'scratch'))
 return dir
}
function regular (dir, file) {
 const target = path.join(dir, file), st = fs.lstatSync(target)
 if (!st.isFile() || st.isSymbolicLink() || st.size > 100000 || !fs.realpathSync(target).toLowerCase().startsWith(fs.realpathSync(dir).toLowerCase() + path.sep)) throw Error('scope_changed')
 return fs.readFileSync(target, 'utf8')
}
function checkScope (dir, packet, replacements = null) {
 for (const file of packet.files) {
  const expected = replacements?.find(r => r.path === file.path)?.content || file.content
  if (regular(dir, file.path) !== expected) throw Error('scope_changed')
 }
 if (regular(dir, 'acceptance.test.js') !== SOURCE) throw Error('scope_changed')
 const allowed = new Set([...FILES, 'acceptance.test.js'])
 function walk (base, relative = '') {
  for (const name of fs.readdirSync(base)) {
   const rel = relative ? relative + '/' + name : name, st = fs.lstatSync(path.join(base, name))
   if (st.isSymbolicLink()) throw Error('scope_changed')
   if (rel === 'scratch') continue
   if (st.isDirectory()) walk(path.join(base, name), rel)
   else if (!st.isFile() || !allowed.has(rel)) throw Error('scope_changed')
  }
 }
 walk(dir)
}
function applyReplacements (dir, packet, result) {
 if (!result || Object.keys(result).sort().join(',') !== 'files,summary' || typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 4000 || !Array.isArray(result.files) || result.files.length !== MUTABLE.length || new Set(result.files.map(f => f.path)).size !== MUTABLE.length) throw Error('invalid_worker_result')
 for (const file of result.files) if (!file || Object.keys(file).sort().join(',') !== 'content,path' || !MUTABLE.includes(file.path) || typeof file.content !== 'string' || !file.content || file.content.includes('\0') || SECRET.test(file.content) || Buffer.byteLength(file.content) > 100000) throw Error('invalid_worker_result')
 checkScope(dir, packet)
 for (const file of result.files) fs.writeFileSync(path.join(dir, file.path), file.content)
 checkScope(dir, packet, result.files)
 return result.files.filter(f => f.content !== packet.files.find(x => x.path === f.path).content).map(f => ({ path: f.path, beforeHash: hash(packet.files.find(x => x.path === f.path).content), afterHash: hash(f.content), before: packet.files.find(x => x.path === f.path).content, after: f.content }))
}
module.exports = { SOURCE_REVISION, readProfile, createWorkspace, checkScope, applyReplacements }
