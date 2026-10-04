'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { PROFILES, READ_PROFILES, hash } = require('./contract')
const { numberedEvidence } = require('./numberedEvidence')
test('sidebar planning reads existing markup, event handlers and layout without expanding editable files', () => {
  assert.deepEqual(PROFILES.interface, ['src/demo/assets/sidebar.js', 'src/demo/assets/sidebar.css'])
  assert.deepEqual(READ_PROFILES.interface, [...PROFILES.interface, 'src/demo/assets/index.html', 'src/demo/assets/app.js', 'src/demo/assets/app.css'])
  const files = READ_PROFILES.interface.map((p, i) => { const content = fs.readFileSync(path.join(__dirname, '../../..', p), 'utf8').replace(/\r\n/g, '\n'); return { path: p, evidenceId: 'plan-' + i, sha256: hash(content), lineCount: content.split('\n').length, content } })
  const e = { profile: 'interface', files }, inputHash = hash(JSON.stringify(e)), prompt = numberedEvidence(e)
  assert.equal(hash(JSON.stringify(e)), inputHash)
  const js = prompt.files.find(f => f.path.endsWith('/app.js'))
  assert.equal(js.readOnly, true); assert.equal(js.excerpt, true); assert.match(js.source, /open-manager/); assert.match(js.source, /addEventListener/); assert.match(js.source, /manager-label/)
  assert.ok(js.source.length < files.find(f => f.path === js.path).content.length / 2)
  for (const f of prompt.files) { const original = files.find(o => o.path === f.path).content.split('\n'); for (const line of f.source.split('\n')) { const m = /^(\d+) \| (.*)$/.exec(line); assert.ok(m); assert.equal(m[2], original[Number(m[1]) - 1]) } }
})
