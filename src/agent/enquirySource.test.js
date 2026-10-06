'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process')
const { createEnquirySource } = require('./enquirySource')
test('approved enquiry copies only exact regular files from the sealed commit, with hashes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enquiry-source-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const repo = path.join(root, 'repo'), out = path.join(root, 'copy'); fs.mkdirSync(repo); fs.mkdirSync(out)
  const git = (...args) => execFileSync('git', args, { cwd: repo, windowsHide: true, encoding: 'utf8' }).trim()
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid')
  fs.writeFileSync(path.join(repo, 'readme.md'), 'original evidence\n'); fs.writeFileSync(path.join(repo, '.env'), 'PRIVATE')
  git('add', '.'); git('commit', '-qm', 'fixture'); const sha = git('rev-parse', 'HEAD')
  fs.writeFileSync(path.join(repo, 'readme.md'), 'unapproved edits')
  const read = createEnquirySource({ repoRoot: repo })
  const input = { dir: out, projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend', expectedSha: sha, allowedFiles: ['readme.md'] }
  const result = await read(input)
  assert.equal(result.ok, true); assert.equal(result.fileCount, 1)
  assert.equal(fs.readFileSync(path.join(out, 'readme.md'), 'utf8'), 'original evidence\n')
  assert.deepEqual(fs.readdirSync(out), ['readme.md']); assert.match(result.files[0].sha256, /^[a-f0-9]{64}$/)
  assert.equal(result.revision, sha)
  for (const allowedFiles of [['.env'], ['../outside'], ['*'], ['readme.md', 'missing.txt']]) {
    const badOut = fs.mkdtempSync(path.join(root, 'bad-'))
    assert.equal((await read({ ...input, dir: badOut, allowedFiles })).ok, false)
    assert.deepEqual(fs.readdirSync(badOut), [])
  }
  assert.equal((await read({ ...input, projectId: 'aroma-system' })).ok, false)
  assert.equal((await read({ ...input, expectedSha: '--help' })).ok, false)
})
