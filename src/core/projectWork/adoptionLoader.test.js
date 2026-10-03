'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process'), { randomUUID } = require('node:crypto')
const { createLoader } = require('./adoptionLoader'), { FILE } = require('./contract')
test('reload requests only the committed fixed helper through UAC, and rejects dirty helpers or source', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adoption-loader-')), script = path.join(root, 'scripts/subscription/restartAdoption.ps1'), target = path.join(root, FILE)
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); fs.rmSync(root, { recursive: true, force: true }) })
  const git = args => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', windowsHide: true }); git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'core.autocrlf', 'false'])
  fs.mkdirSync(path.dirname(script), { recursive: true }); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(script, '# fixture, never executed\n'); fs.writeFileSync(target, 'candidate\n'); git(['add', '.']); git(['commit', '-qm', 'fixture'])
  const row = { id: randomUUID(), commit: git(['rev-parse', 'HEAD']).trim(), state: 'awaiting_restart', after: 'candidate\n' }, calls = []
  const loader = createLoader({ root, run: (exe, args, options, callback) => { calls.push({ exe, args, options }); callback(null) } })
  await loader(row); assert.equal(calls.length, 1); assert.match(calls[0].exe, /WindowsPowerShell/); assert.match(calls[0].args[3], /-Verb RunAs -WindowStyle Hidden/); assert.match(calls[0].args[3], /RemoteSigned/); assert.doesNotMatch(calls[0].args[3], /Bypass|ScheduledTask|Credential/)
  fs.appendFileSync(script, '# modified'); await assert.rejects(loader(row), /source_changed/); assert.equal(calls.length, 1); fs.writeFileSync(script, '# fixture, never executed\n')
  fs.writeFileSync(target, 'dirty\n'); await assert.rejects(loader(row), /source_changed/); assert.equal(calls.length, 1)
  await assert.rejects(loader({ ...row, id: "'; anything" }), /invalid_request/)
})
