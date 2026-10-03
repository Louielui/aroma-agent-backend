'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..'), id = process.argv[2]
assert.match(id || '', /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
// Verify required host code before importing it in the administrator process.
for (const name of ['src/core/projectTasks/contract.js', 'src/core/projectWork/contract.js', 'src/core/operating/runStore.js', 'src/workers/execution/windowsSandbox.js', 'src/store/dataDir.js']) {
  const file = path.join(root, name), st = fs.lstatSync(file)
  assert.ok(st.isFile() && !st.isSymbolicLink() && st.nlink === 1)
  assert.equal(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), execFileSync('git', ['--no-replace-objects', '-C', root, 'show', 'HEAD:' + name], { windowsHide: true, encoding: 'utf8' }).replace(/\r\n/g, '\n'))
}
const dir = path.join(process.env.LOCALAPPDATA, 'AromaXiangXiang', 'worker-flow')
const read = (folder, key) => { assert.match(key || '', /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/); const file = path.join(dir, folder, key + '.json'), st = fs.lstatSync(file); assert.ok(st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.size < 5000000); return JSON.parse(fs.readFileSync(file, 'utf8')) }
const row = read('adoptions', id), work = read('project-runs', row.workRunId)
const registration = require('../../src/core/projectTasks/contract').createRegistry({ get: key => read('project-tasks', key) }).resolve(row.source.evidence.recipe)
assert.deepEqual(work.workOrder, registration.workOrder)
assert.deepEqual(Object.keys(row.after).sort(), registration.workOrder.allowedFiles.slice().sort())
assert.deepEqual(Object.keys(registration.tests), work.workOrder.protectedFiles)
console.log('registered_reload_validated')
