
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { preference } = require('./experimentPreference')

test('uses an isolated existing model-center file and requires a current revision', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiangxiang-phase1-pref-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const original = path.join(root, 'model-center-local.json')
  fs.writeFileSync(original, 'formal-fixture')
  const store = preference(root)
  assert.deepEqual(store.read(), { selected: 'default', revision: 0 })
  await assert.rejects(store.save({ selected: 'cloud', revision: 0 }), /experiment_input_invalid/)
  assert.deepEqual(await store.save({ selected: 'B', revision: 0 }), { selected: 'B', revision: 1 })
  assert.deepEqual(preference(root).read(), { selected: 'B', revision: 1 })
  await assert.rejects(store.save({ selected: 'P', revision: 0 }), /revision_conflict/)
  assert.deepEqual(await store.save({ selected: 'default', revision: 1 }), { selected: 'default', revision: 2 })
  assert.equal(fs.readFileSync(original, 'utf8'), 'formal-fixture')
})
