'use strict'
// Isolated explicit-admission fixture. This file is never imported by Imagine.
const fs = require('node:fs')
const path = require('node:path')
const { createGate } = require('./quiescence')
const [root, mode, parentId] = process.argv.slice(2)
const gate = createGate({ directory: path.join(root, 'gate'), participants: ['offline-host'], ownerPassword: () => 'fixture-owner-password', serviceCredentials: () => ['fixture-service-token'] })
async function retryBusy (operation) {
  const deadline = Date.now() + 5000
  while (true) {
    try { return operation() } catch (error) {
      if (error.message !== 'gate_busy' || Date.now() >= deadline) throw error
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
}
if (mode === 'crash') {
  gate.admit('offline-host')
  fs.writeFileSync(path.join(root, 'ready'), '')
  process.reallyExit(23) // isolated fixture crash, deliberately bypassing exit hooks
} else if (mode === 'leased-descendant') {
  const lease = gate.admit('offline-host')
  const child = require('node:child_process').spawn(process.execPath, [__filename, root, 'finish-child', lease.id], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  const wait = setInterval(() => { if (fs.existsSync(path.join(root, 'child-ready'))) { clearInterval(wait); retryBusy(() => lease.finish()).catch(() => { process.exitCode = 3 }) } }, 10)
} else if (mode === 'finish-child') {
  ;(async () => {
    const lease = await retryBusy(() => gate.admit('offline-host', parentId))
    fs.writeFileSync(path.join(root, 'child-ready'), '')
    setTimeout(async () => {
      try { await retryBusy(() => lease.write(() => {
        const authorization = path.join(root, 'protected', 'company-access.json')
        if (fs.existsSync(authorization)) require('../company/access').createRegistry({ file: authorization }).recordMailState('connected')
        fs.writeFileSync(path.join(root, 'protected', 'finished'), 'descendant final persistence')
      })); await retryBusy(() => lease.finish()) }
      catch (_) { process.exitCode = 3 }
    }, 700)
  })().catch(() => { process.exitCode = 3 })
} else if (mode === 'descendant') {
  const child = require('node:child_process').spawn(process.execPath, ['-e', "setTimeout(()=>require('fs').writeFileSync(process.argv[1],'delayed'),700)", path.join(root, 'protected', 'delayed')], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
} else if (mode === 'http') {
  const initial = gate.admit('offline-host')
  const server = require('node:http').createServer(async (req, res) => {
    if (req.url === '/read') return res.end(fs.readFileSync(path.join(root, 'protected', 'tasks.json')))
    if (req.url === '/stop') {
      if (req.headers.authorization !== 'Owner fixture-owner-password' || gate.status().phase !== 'draining' || gate.status().leases.length) { res.statusCode = 403; return res.end() }
      res.end(); server.close(); return
    }
    if (req.headers.authorization !== 'Bearer fixture-service-token') { res.statusCode = 401; return res.end() }
    let lease
    try { lease = gate.admit('offline-host') } catch { res.statusCode = 503; return res.end('maintenance') }
    try {
      await new Promise(resolve => setTimeout(resolve, 300))
      fs.writeFileSync(path.join(root, 'protected', 'http-complete'), req.method)
      res.end('complete')
    } finally { lease.finish() }
  })
  server.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(path.join(root, 'http-port'), String(server.address().port))
    initial.finish()
  })
} else {
  if (['new', 'rollback'].includes(mode)) {
    require('./offlineStartup.cjs').runEntrypoint({ gate, participant: 'offline-host', entry: path.join(root, mode === 'rollback' ? 'old-entry.cjs' : 'entry.cjs'), maintenanceDirectory: root })
    return
  }
  // The old/new application is imported only inside the durable admission lease.
  // A failed admission exits before initialization or recovery writes.
  const lease = gate.admit('offline-host')
  if (mode === 'hold') {
    fs.writeFileSync(path.join(root, 'ready'), '')
    setTimeout(() => { fs.writeFileSync(path.join(root, 'protected', 'finished'), 'complete'); lease.finish() }, 500)
  } else {
    fs.writeFileSync(path.join(root, 'protected', 'initialized'), mode)
    lease.finish()
  }
}
