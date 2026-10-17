'use strict'
// Bounded disposable acceptance process, controlled only by its test parent.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const asyncHooks = require('node:async_hooks'), observed = {}
const hook = asyncHooks.createHook({ init(_id, type) { observed[type] = (observed[type] || 0) + 1 } }); hook.enable()
function inventory(root, prefix = '') {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory() ? inventory(path.join(root, e.name), prefix + e.name + '/') : [{ file: prefix + e.name, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, e.name))).digest('hex') }])
}
let instance
process.on('message', async message => {
  try {
    if (message.op === 'start') {
      instance = await require('./startIndependent.cjs').startIndependent(message.options)
      process.send({ id: message.id, origin: instance.origin, pid: process.pid, mode: instance.mode, cookieName: instance.cookieName })
    } else if (message.op === 'snapshot') {
      process.send({ id: message.id, choice: instance.choice, roots: instance.roots,
        calls: instance.calls, modelCalls: instance.modelCalls, files: inventory(message.root), observed,
        resources: process.getActiveResourcesInfo(), imports: Object.keys(require.cache), tasks: instance.store.listTasks() })
    } else if (message.op === 'observerControl') {
      const response = await fetch(instance.origin + '/owner/login'); await response.text()
      await new Promise((resolve, reject) => fs.readFile(path.join(instance.roots.config, 'model-selection.json'), error => error ? reject(error) : resolve()))
      await new Promise((resolve, reject) => require('node:child_process').execFile(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true, timeout: 5000 }, error => error ? reject(error) : resolve()))
      process.send({ id: message.id, observed })
    } else if (message.op === 'close') { await instance.close(); process.send({ id: message.id, closed: true }); hook.disable(); process.disconnect() }
    else throw Error('unsupported_probe_operation')
  } catch (e) { process.send({ id: message.id, error: e.message }); if (!instance) process.disconnect() }
})
