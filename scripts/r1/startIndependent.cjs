'use strict'
// Manual synthetic-only entry. Requires a verified disposable OS boundary.
const http = require('node:http'), fixture = require('./independentFixture.cjs')
const codes = new Set(['EEXIST','independent_fixture_identity_required','independent_fixture_invalid','independent_fixture_changed','independent_resume_refused','independent_root_alias','independent_root_required','independent_root_overlap','independent_clean_environment_required','independent_model_config_invalid','independent_auth_required','independent_port_invalid','offline_dependencies_fixed','offline_dependencies_required','synthetic_source_required','independent_ownership_changed','independent_recovery_required','independent_diagnostic_unavailable','EADDRINUSE'])
codes.add('independent_offline_boundary_required')
codes.add('independent_input_invalid')
const safeCode = e => ['ENOENT','EACCES','EPERM','EIO'].includes(e?.code) ? 'independent_storage_unavailable' : codes.has(e?.code || e?.message) ? e.code || e.message : 'independent_startup_unavailable'
async function startIndependent(options = {}) {
  const { port = 0, ...composition } = options
  if (!Number.isInteger(port) || port < 0 || port > 65535 || [8081,8090,8091,8888].includes(port)) throw Error('independent_port_invalid')
  const instance = require('../../src/intake/independentOwner').createIndependentOwner(composition)
  const server = http.createServer(instance.app)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  let closed
  return { ...instance, server, origin: 'http://127.0.0.1:' + server.address().port,
    close() {
      if (closed) return closed
      instance.beginClose()
      closed = new Promise((resolve, reject) => {
        let expired = false
        // Deadline refuses release; it never cancels a task or kills a process.
        const deadline = setTimeout(() => { expired = true; reject(Error('independent_recovery_required')) }, 15000)
        server.close(error => {
          clearTimeout(deadline)
          if (error || expired) return reject(Error('independent_recovery_required'))
          try { const receipt = instance.checkpoint(); instance.releaseOwnership(); resolve(receipt) } catch (e) { reject(e) }
        })
      })
      return closed
    }
  }
}
function rejectPreload() {
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH || process.execArgv.some(a => /^(?:--require|-r|--import|--loader|--experimental-loader)(?:=|$)/.test(a))) throw Error('independent_clean_environment_required')
}
if (require.main === module) {
  // This cannot undo a preload. The external trusted invocation must exclude it
  // before this parent starts; the operational child receives a fresh allowlist.
  try { rejectPreload() } catch (e) { process.stderr.write(JSON.stringify({ error: safeCode(e) }) + '\n'); process.exitCode = 1 }
  if (!process.exitCode) {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', data => { text += data; if (text.length > 8000) { text = ''; process.exitCode = 2; process.stdin.destroy() } })
    process.stdin.on('end', async () => {
      if (process.exitCode) return
      try {
        let options
        try { options = JSON.parse(text) } catch (_) { throw Error('independent_input_invalid') }
        if (process.argv[2] !== '--operational') {
          const child = require('node:child_process').fork(__filename, ['--operational'], { execArgv: [], cwd: options.root,
            env: fixture.cleanEnvironment(options.root), windowsHide: true, stdio: ['pipe','pipe','pipe','ipc'] })
          child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr); child.stdin.end(JSON.stringify(options))
          child.on('error', () => { process.stderr.write(JSON.stringify({ error: 'independent_child_unavailable' }) + '\n'); process.exitCode = 1 })
          child.on('exit', code => { process.exitCode = code === 0 ? 0 : 1; if (process.connected) process.disconnect() })
          for (const signal of ['SIGINT','SIGTERM','SIGBREAK']) process.on(signal, () => { if (child.connected) child.send({ op: 'close' }) })
          process.on('message', m => { if (m?.op === 'close' && child.connected) child.send({ op: 'close' }) })
        } else {
          const instance = await startIndependent(options)
          let shutting = false
          const close = async () => {
            if (shutting) return; shutting = true
            try { const receipt = await instance.close(); process.stdout.write(JSON.stringify({ event: 'closed', receipt }) + '\n'); if (process.connected) process.disconnect() }
            catch (e) { process.stderr.write(JSON.stringify({ error: safeCode(e) }) + '\n'); process.exitCode = 1 }
          }
          for (const signal of ['SIGINT','SIGTERM','SIGBREAK']) process.on(signal, close)
          process.on('message', m => { if (m?.op === 'close') close() })
          process.stdout.write(JSON.stringify({ event: 'ready', origin: instance.origin, mode: instance.mode, realModelInvocation: 'BLOCKED' }) + '\n')
        }
      } catch (e) { process.stderr.write(JSON.stringify({ error: safeCode(e) }) + '\n'); process.exitCode = 1; if (process.connected) process.disconnect() }
    })
  }
}
module.exports = { startIndependent, safeCode }
