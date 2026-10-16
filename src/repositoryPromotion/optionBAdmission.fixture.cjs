'use strict'
// Design experiment only: no Imagine entrypoint imports this file.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createGate } = require('./quiescence')
const [root, boundary] = process.argv.slice(2)
if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(os.tmpdir()) ||
    !/^imagine-adapter-[a-f0-9-]{36}$/.test(path.basename(root))) throw Error('disposable_scope_required')
const boundaries = ['backend', 'bridge', 'native-host', 'scheduled-task', 'supervisor', 'background', 'hindsight', 'independent-entry']
if (!boundaries.includes(boundary)) throw Error('unknown_boundary')
const gate = createGate({ directory: path.join(root, 'gate'), participants: ['offline-host'],
  ownerPassword: () => 'fixture-owner-password', serviceCredentials: () => ['fixture-service-token'] })
const reply = value => process.send(value)
process.on('message', async input => {
  if (input === 'exit') { process.disconnect(); return }
  if (input === 'startup') {
    try {
      require('./offlineStartup.cjs').runEntrypoint({ gate, participant: 'offline-host', entry: path.join(root, 'entry.cjs') })
      reply({ result: 'initialized' })
    } catch (error) { reply({ result: error.message }) }
    return
  }
  if (!['write', 'complete'].includes(input)) return
  if (input === 'complete') return
  let lease
  try { lease = gate.admit('offline-host') } catch (error) { reply({ result: error.message }); return }
  reply({ result: 'admitted' })
  // Wait for explicit completion so the parent can prove prepare overlaps work.
  await new Promise(resolve => {
    const listener = message => { if (message === 'complete') { process.off('message', listener); resolve() } }
    process.on('message', listener)
  })
  try { fs.writeFileSync(path.join(root, 'protected', boundary), 'final persistence') }
  finally { lease.finish() }
  reply({ result: 'finished' })
})
reply({ result: 'ready' })
