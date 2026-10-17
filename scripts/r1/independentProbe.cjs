'use strict'
// Bounded disposable acceptance process, controlled only by its test parent.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const asyncHooks = require('node:async_hooks'), observed = {}
const hook = asyncHooks.createHook({ init(_id, type) { observed[type] = (observed[type] || 0) + 1 } }); hook.enable()
function inventory(root, prefix = '') {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory() ? inventory(path.join(root, e.name), prefix + e.name + '/') : [{ file: prefix + e.name, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, e.name))).digest('hex') }])
}
let instance, held = null, releaseRead = null
// Test-only local adapter observation. No Node globals or application contract is patched.
const adapterModule = require('./independentAdapters.cjs'), originalFactory = adapterModule.createSyntheticAdapters
adapterModule.createSyntheticAdapters = () => {
  const adapters = originalFactory(), createContext = adapters.createContext
  return { ...adapters, createContext(options) {
    const context = createContext(options), drive = context.drive
    return { drive: { ...drive, async read(...args) {
      const result = await drive.read(...args)
      if (held === 'source') { held = 'source_reached'; await new Promise(resolve => { releaseRead = resolve }) }
      return result
    } } }
  } }
}
process.on('message', async message => {
  try {
    if (message.op === 'start') {
      instance = await require('./startIndependent.cjs').startIndependent(message.options)
      process.send({ id: message.id, origin: instance.origin, pid: process.pid, mode: instance.mode, cookieName: instance.cookieName })
    } else if (message.op === 'snapshot') {
      process.send({ id: message.id, choice: instance.choice, roots: instance.roots,
        calls: instance.calls, modelCalls: instance.modelCalls, files: inventory(message.root), observed,
        resources: process.getActiveResourcesInfo(), held, activeRequests: instance.activeRequests(), imports: Object.keys(require.cache), tasks: instance.store.listTasks() })
    } else if (message.op === 'holdSource') { held = 'source'; process.send({ id: message.id, held })
    } else if (message.op === 'releaseSource') { if (!releaseRead) throw Error('probe_not_held'); releaseRead(); releaseRead = null; held = null; process.send({ id: message.id, released: true })
    } else if (message.op === 'holdPersistence') {
      const barrier = message.barrier, temporary = path.dirname(path.dirname(instance.roots.data))
      if (!['task','browserResult'].includes(message.stage) || typeof barrier !== 'string' || !path.relative(temporary, barrier).startsWith('r1-persistence-')) throw Error('invalid_probe_barrier')
      const pause = () => {
        fs.writeFileSync(barrier + '.reached', JSON.stringify({ stage: message.stage, at: new Date().toISOString() }), { flag: 'wx' })
        const end = Date.now() + 10000
        while (!fs.existsSync(barrier + '.release')) { if (Date.now() > end) throw Error('probe_barrier_deadline'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10) }
      }
      if (message.stage === 'task') { const original = instance.store.linkUnifiedAttempt; let once = false; instance.store.linkUnifiedAttempt = (...args) => { if (!once) { once = true; pause() } return original(...args) } }
      else { const original = instance.reads.save; let once = false; instance.reads.save = record => { if (!once && record.state === 'completed') { once = true; pause() } return original(record) } }
      process.send({ id: message.id, armed: true })
    } else if (message.op === 'observerControl') {
      const response = await fetch(instance.origin + '/owner/login'); await response.text()
      await new Promise((resolve, reject) => fs.readFile(path.join(instance.roots.config, 'model-selection.json'), error => error ? reject(error) : resolve()))
      await new Promise((resolve, reject) => require('node:child_process').execFile(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true, timeout: 5000 }, error => error ? reject(error) : resolve()))
      process.send({ id: message.id, observed })
    } else if (message.op === 'crash') {
      // Deliberate self-exit of this disposable test child, never an external kill.
      process.exitCode = 73; hook.disable(); process.disconnect(); instance.server.unref()
    } else if (message.op === 'close') { const receipt = await instance.close(); process.send({ id: message.id, closed: true, receipt }); hook.disable(); process.disconnect() }
    else throw Error('unsupported_probe_operation')
  } catch (e) { process.send({ id: message.id, error: e.message }); if (!instance) process.disconnect() }
})
