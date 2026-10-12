'use strict'
// Runs inside the disposable OS only. Host never executes supplied source.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const net = require('node:net'), cp = require('node:child_process'), crypto = require('node:crypto')
const TOOLS = 'C:/XiangTools', INPUT = 'C:/XiangInput', OUTPUT = 'C:/XiangOutput'
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
const manifest = JSON.parse(fs.readFileSync(TOOLS + '/manifest.json', 'utf8'))
const denied = fn => { try { fn(); return false } catch (_) { return true } }
const connectionDenied = (host, port) => new Promise(resolve => {
  const socket = net.createConnection({ host, port }); let done = false
  const finish = value => { if (done) return; done = true; socket.destroy(); resolve(value) }
  socket.setTimeout(1500, () => finish(true)); socket.once('error', () => finish(true)); socket.once('connect', () => finish(false))
})
async function main () {
  const boundary = {
    noExternalInterfaces: Object.values(os.networkInterfaces()).flat().every(a => a.internal),
    cleanIdentity: /WDAGUtilityAccount/i.test(os.userInfo().username),
    secretsAbsent: !Object.keys(process.env).some(k => /(?:API_KEY|TOKEN|PASSWORD|CODEX_HOME|GOOGLE_APPLICATION_CREDENTIALS)/i.test(k)),
    hostReadDenied: denied(() => fs.readFileSync(manifest.sentinel)),
    hostWriteDenied: denied(() => fs.writeFileSync(manifest.sentinel, 'changed', { flag: 'r+' })),
    readonlyInputDenied: denied(() => fs.appendFileSync(path.join(INPUT, manifest.tests[0]), 'tamper')),
    readonlyToolsDenied: denied(() => fs.appendFileSync(TOOLS + '/manifest.json', 'tamper')),
    loopbackDenied: await connectionDenied('127.0.0.1', manifest.hostLoopbackPort),
    ipv6LoopbackDenied: await connectionDenied('::1', manifest.hostLoopbackPort),
    internetDenied: await connectionDenied('1.1.1.1', 443)
  }
  if (Object.values(boundary).some(v => v !== true)) throw Error('sandbox_failed')
  const inputHashes = Object.fromEntries(Object.keys(manifest.hashes).map(n => [n, hash(fs.readFileSync(path.join(INPUT, n)))]))
  if (JSON.stringify(inputHashes) !== JSON.stringify(manifest.hashes)) throw Error('scope_changed')
  const scratch = 'C:/XiangScratch'; fs.mkdirSync(scratch, { recursive: true })
  // Node permissions are an additional guard only. The security boundary is the
  // offline VM, including children. Test isolation keeps test stdout separated
  // from reporter statistics. No npm, shell, hooks or network install command.
  const result = await new Promise((resolve, reject) => cp.execFile(TOOLS + '/node.exe', ['--permission', '--allow-fs-read=' + INPUT, '--allow-fs-read=' + scratch, '--allow-fs-write=' + scratch, '--allow-child-process', '--test', '--test-reporter=tap', ...manifest.tests], { cwd: INPUT, env: { SystemRoot: 'C:/Windows', TEMP: scratch, TMP: scratch, PATH: TOOLS }, windowsHide: true, timeout: 120000, maxBuffer: 400000, encoding: 'utf8' }, (err, stdout, stderr) => err && !Number.isInteger(err.code) ? reject(Error('test_evidence_unavailable')) : resolve({ exitCode: err ? err.code : 0, stdout, stderr })))
  const count = key => { const matches = [...result.stdout.matchAll(new RegExp('^# ' + key + ' (\\d+)$', 'gm'))]; if (matches.length !== 1) throw Error('test_evidence_unavailable'); return Number(matches[0][1]) }
  const tests = { exitCode: result.exitCode, total: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), cancelled: count('cancelled'), stdout: result.stdout, stderr: result.stderr }
  if (manifest.browser) {
    tests.browser = []
    for (const locale of ['zh', 'en']) for (const width of [1280, 390]) {
      const stem = 'browser-' + locale + '-' + width
      if (!fs.existsSync(scratch + '/' + stem + '.json')) continue
      const p = JSON.parse(fs.readFileSync(scratch + '/' + stem + '.json', 'utf8')), png = fs.readFileSync(scratch + '/' + stem + '.png')
      if (png.length > 2000000) throw Error('invalid_sandbox_evidence')
      fs.writeFileSync(OUTPUT + '/' + stem + '.png', png, { flag: 'wx' }); tests.browser.push({ ...p, name: stem + '.png' })
    }
  }
  for (const [n, h] of Object.entries(inputHashes)) if (hash(fs.readFileSync(path.join(INPUT, n))) !== h) throw Error('scope_changed')
  const value = { id: manifest.id, engine: manifest.engine, boundary, inputHashes, tests, at: new Date().toISOString() }
  fs.writeFileSync(OUTPUT + '/evidence.tmp', JSON.stringify(value), { flag: 'wx' }); fs.renameSync(OUTPUT + '/evidence.tmp', OUTPUT + '/evidence.json')
}
main().catch(e => { fs.writeFileSync(OUTPUT + '/error.json', JSON.stringify({ id: manifest.id, error: e.message })); process.exitCode = 1 })
