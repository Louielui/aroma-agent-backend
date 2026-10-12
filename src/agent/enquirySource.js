'use strict'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { isExecutableIdentity } = require('../projects/repositoryIdentity')
const { isForbiddenFile, EXPECTED_SHA_RE } = require('./workOrder')
const MAX_BYTES = 180000
function createEnquirySource ({ repoRoot = path.resolve(__dirname, '../..') } = {}) {
  const git = args => execFileSync('git', ['-c', 'safe.directory=' + repoRoot, ...args], { cwd: repoRoot, windowsHide: true, shell: false, maxBuffer: MAX_BYTES + 10000 })
  return async function source ({ dir, projectId, repoFullName, expectedSha, allowedFiles }) {
    try {
      if (!isExecutableIdentity({ projectId, repoFullName }) || !EXPECTED_SHA_RE.test(expectedSha || '')) throw Error()
      if (!Array.isArray(allowedFiles) || !allowedFiles.length || allowedFiles.length > 8 || new Set(allowedFiles).size !== allowedFiles.length) throw Error()
      if (process.platform === 'win32' && new Set(allowedFiles.map(f => String(f).toLowerCase())).size !== allowedFiles.length) throw Error()
      if (fs.readdirSync(dir).length) throw Error()
      if (git(['rev-parse', expectedSha + '^{commit}']).toString().trim() !== expectedSha) throw Error()
      const files = []; let total = 0
      for (const file of allowedFiles) {
        if (typeof file !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(file) || file.startsWith('/') || file.startsWith('-') || file.split('/').some(s => !s || s === '.' || s === '..' || s === '.git') || isForbiddenFile(file)) throw Error()
        const entry = git(['ls-tree', '-z', expectedSha, '--', file]).toString()
        const m = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)\0$/.exec(entry)
        if (!m || m[3] !== file) throw Error()
        const bytes = git(['cat-file', 'blob', m[2]]); total += bytes.length
        if (total > MAX_BYTES || bytes.includes(0)) throw Error()
        files.push({ path: file, bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), blob: m[2] })
      }
      // Validate the entire approved snapshot before publishing any of it.
      for (const file of files) { const dest = path.join(dir, file.path); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, file.bytes, { flag: 'wx' }) }
      return { ok: true, revision: expectedSha, fileCount: files.length, files: files.map(({ bytes, ...f }) => ({ ...f, size: bytes.length })) }
    } catch (_) { return { ok: false, reason: 'approved_source_unavailable' } }
  }
}
module.exports = { createEnquirySource, MAX_BYTES }
