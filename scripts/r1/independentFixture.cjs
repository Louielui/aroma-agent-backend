'use strict'
// Disposable fixture qualification and the explicit environment for its child.
// These checks are not an OS sandbox. The caller must supply the existing offline host boundary.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
const ROOT_FILE = '.independent-fixture.json'
const subdirs = ['data','artifacts','config','profile','profile/roaming','profile/local','temp','logs','lab']
function directory(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.resolve(file) !== file) throw Error('independent_root_required')
  for (let p = file; ; p = path.dirname(p)) {
    const s = fs.lstatSync(p)
    if (!s.isDirectory() || s.isSymbolicLink()) throw Error('independent_root_alias')
    if (path.dirname(p) === p) break
  }
  if (fs.realpathSync(file).toLowerCase() !== file.toLowerCase()) throw Error('independent_root_alias')
  return file
}
function inventory(root) {
  let count = 0
  function walk(dir, prefix = '') {
    return fs.readdirSync(dir).sort().flatMap(n => {
      if (++count > 5000) throw Error('independent_root_too_large')
      const file = path.join(dir, n), s = fs.lstatSync(file), rel = prefix + n
      if (s.isSymbolicLink() || (!s.isDirectory() && (!s.isFile() || s.nlink !== 1))) throw Error('independent_root_alias')
      if (s.isDirectory()) return [[rel + '/', 'directory'], ...walk(file, rel + '/')]
      if (s.size > 4000000) throw Error('independent_root_too_large')
      return rel === '.independent-process.json' ? [] : [[rel, hash(fs.readFileSync(file))]]
    })
  }
  return Object.fromEntries(walk(root))
}
function createFixture(parent, { effort = 'high', sharing = {}, sourceGranted = true, ownerSuspended = false } = {}) {
  directory(parent)
  const root = fs.mkdtempSync(path.join(parent, 'i-')), id = crypto.randomUUID()
  for (const d of subdirs) fs.mkdirSync(path.join(root, d), { recursive: true })
  const write = (name, data) => fs.writeFileSync(path.join(root, name), JSON.stringify(data), { flag: 'wx', mode: 0o600 })
  write('config/model-selection.json', { version: 1, mode: 'synthetic_fixture', brain: { model: 'gpt-6-astra', effort } })
  write('config/synthetic-source.json', { mode: 'synthetic_fixture', sourceId: 'synthetic_tea', content: 'Steep synthetic tea for four minutes.' })
  write('data/company-access.json', { version: 1, revision: 0, users: [{ id: 'owner', role: 'owner', email: 'owner@fixture.invalid', grants: sourceGranted ? ['company-drive'] : [], verified: true, suspended: ownerSuspended }],
    sources: [{ id: 'company-drive', name: 'Synthetic files', kind: 'drive', state: 'registered', rootId: 'synthetic_root', driveId: 'synthetic_root' }], audit: [] })
  const initial = inventory(root)
  const manifest = { version: 1, mode: 'synthetic_fixture', id, root: directory(root), initial,
    sharing: { goal: sharing.goal === true, content: sharing.content === true, source: sharing.source === true } }
  write(ROOT_FILE, manifest)
  const manifestHash = hash(fs.readFileSync(path.join(root, ROOT_FILE)))
  // Trusted fixture host retains this independently of the mutable application root.
  // Its path/hash is invocation authority; neither HTTP nor a resume receipt supplies it.
  const evidence = { version: 1, instanceId: id, root, manifestHash, initial, generation: 0, closeHash: null }
  const hostFile = path.join(parent, id + '.host-0.json')
  fs.writeFileSync(hostFile, JSON.stringify(evidence), { flag: 'wx', mode: 0o600 })
  return { root, manifestHash, sharing: manifest.sharing, hostEvidence: { path: hostFile, sha256: hash(fs.readFileSync(hostFile)) } }
}
function trustedHost(root, pin) {
  if (!pin || Object.keys(pin).sort().join(',') !== 'path,sha256' || typeof pin.path !== 'string' || !path.isAbsolute(pin.path) || !/^[a-f0-9]{64}$/.test(pin.sha256 || '')) throw Error('independent_host_evidence_required')
  directory(path.dirname(pin.path))
  if (path.relative(root, pin.path).split(path.sep)[0] !== '..') throw Error('independent_host_evidence_required')
  const st = fs.lstatSync(pin.path)
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 50000) throw Error('independent_host_evidence_required')
  const raw = fs.readFileSync(pin.path)
  if (hash(raw) !== pin.sha256) throw Error('independent_host_evidence_required')
  return JSON.parse(raw)
}
function permittedFiles(m, files) {
  for (const [name, value] of Object.entries(files || {})) {
    if (Object.hasOwn(m.initial, name) || name === ROOT_FILE) continue
    if (value === 'directory' && ['data/browser-context-reads/','data/context-activity/','data/conversations/'].includes(name)) continue
    if (name === 'data/aroma-truth.json' || /^data\/(?:browser-context-reads|context-activity|conversations)\/[a-z0-9-]{8,64}\.json$/.test(name) || /^logs\/diagnostic-(?:[0-9]|[1-5][0-9]|6[0-3])\.json$/.test(name)) continue
    throw Error('independent_resume_refused')
  }
  for (const [name, pin] of Object.entries(m.initial)) if (files[name] !== pin) throw Error('independent_fixture_changed')
}
function qualify({ root, manifestHash, resumeReceipt, hostEvidence }) {
  root = directory(root)
  // A retained writer marker is a recovery condition before any inventory comparison.
  if (fs.existsSync(path.join(root, '.independent-process.json'))) { const e = Error('EEXIST'); e.code = 'EEXIST'; throw e }
  const file = path.join(root, ROOT_FILE), st = fs.lstatSync(file)
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 20000) throw Error('independent_fixture_invalid')
  const raw = fs.readFileSync(file)
  if (!/^[a-f0-9]{64}$/.test(manifestHash || '') || hash(raw) !== manifestHash || raw.length > 20000) throw Error('independent_fixture_identity_required')
  const m = JSON.parse(raw)
  if (m.version !== 1 || m.mode !== 'synthetic_fixture' || m.root !== root || !/^[a-f0-9-]{36}$/.test(m.id) || !m.sharing ||
      Object.keys(m.initial || {}).filter(k => !k.endsWith('/')).sort().join(',') !== 'config/model-selection.json,config/synthetic-source.json,data/company-access.json' ||
      Object.keys(m.initial || {}).filter(k => k.endsWith('/')).sort().join(',') !== subdirs.map(k => k + '/').sort().join(',')) throw Error('independent_fixture_invalid')
  const host = trustedHost(root, hostEvidence)
  if (host.version !== 1 || host.root !== root || host.instanceId !== m.id || host.manifestHash !== manifestHash || JSON.stringify(host.initial) !== JSON.stringify(m.initial) || !Number.isSafeInteger(host.generation)) throw Error('independent_host_evidence_required')
  const own = inventory(root)
  const expected = resumeReceipt ? resumeReceipt.files : { ...m.initial, [ROOT_FILE]: manifestHash }
  if (resumeReceipt && (host.generation < 1 || host.closeHash !== hash(JSON.stringify(resumeReceipt)) || resumeReceipt.root !== root || resumeReceipt.instanceId !== m.id || resumeReceipt.manifestHash !== manifestHash || resumeReceipt.safeClosed !== true)) throw Error('independent_resume_refused')
  if (!resumeReceipt && host.generation !== 0) throw Error('independent_resume_refused')
  permittedFiles(m, expected)
  if (JSON.stringify(Object.entries(own).sort()) !== JSON.stringify(Object.entries(expected || {}).sort())) throw Error('independent_fixture_changed')
  for (const d of subdirs) directory(path.join(root, d))
  return m
}
function checkpoint(root, manifestHash, instanceId) {
  const files = inventory(root), raw = fs.readFileSync(path.join(root, ROOT_FILE)), m = JSON.parse(raw)
  if (hash(raw) !== manifestHash || m.id !== instanceId || m.root !== root) throw Error('independent_fixture_identity_required')
  permittedFiles(m, files)
  return { version: 1, instanceId, root, manifestHash, closeId: crypto.randomUUID(), safeClosed: true, files }
}
function retainClose(owned, receipt) {
  // Called by the trusted fixture host AFTER the operational child exits safely.
  // No runtime route, model/tool or operational child invokes this authority.
  const host = trustedHost(owned.root, owned.hostEvidence)
  const m = JSON.parse(fs.readFileSync(path.join(owned.root, ROOT_FILE)))
  if (hash(fs.readFileSync(path.join(owned.root, ROOT_FILE))) !== host.manifestHash || JSON.stringify(m.initial) !== JSON.stringify(host.initial)) throw Error('independent_host_evidence_required')
  if (fs.existsSync(path.join(owned.root, '.independent-process.json')) || receipt?.safeClosed !== true || receipt.root !== owned.root || receipt.instanceId !== host.instanceId || receipt.manifestHash !== host.manifestHash || owned.manifestHash !== host.manifestHash) throw Error('independent_resume_refused')
  permittedFiles(m, receipt.files)
  if (JSON.stringify(inventory(owned.root)) !== JSON.stringify(receipt.files)) throw Error('independent_fixture_changed')
  const next = { ...host, generation: host.generation + 1, closeHash: hash(JSON.stringify(receipt)) }
  const file = path.join(path.dirname(owned.hostEvidence.path), host.instanceId + '.host-' + next.generation + '.json')
  fs.writeFileSync(file, JSON.stringify(next), { flag: 'wx', mode: 0o600 })
  return { path: file, sha256: hash(fs.readFileSync(file)) }
}
function cleanEnvironment(root) {
  return { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', COMSPEC: 'C:\\Windows\\System32\\cmd.exe', PATHEXT: '.COM;.EXE;.BAT;.CMD',
    SYSTEMDRIVE: 'C:', HOMEDRIVE: path.parse(root).root.slice(0, 2), HOMEPATH: path.join(root, 'profile').slice(2),
    USERNAME: 'synthetic-offline', USERDOMAIN: 'SYNTHETIC', LOGONSERVER: '\\\\SYNTHETIC',
    PATH: path.dirname(process.execPath) + path.delimiter + 'C:\\Windows\\System32',
    HOME: path.join(root, 'profile'), USERPROFILE: path.join(root, 'profile'), APPDATA: path.join(root, 'profile/roaming'), LOCALAPPDATA: path.join(root, 'profile/local'),
    TEMP: path.join(root, 'temp'), TMP: path.join(root, 'temp'), AROMA_DATA_DIR: path.join(root, 'data'), AROMA_ARTIFACT_DIR: path.join(root, 'artifacts'),
    XIANGXIANG_LAB_ROOT: path.join(root, 'lab'), XIANGXIANG_LOCALE: 'en' }
}
function verifyEnvironment(root) {
  const expected = cleanEnvironment(root)
  if (process.execArgv.some(x => /^(?:--require|-r|--import|--loader|--experimental-loader)(?:=|$)/.test(x)) ||
      Object.keys(process.env).some(k => !Object.keys(expected).some(e => e.toLowerCase() === k.toLowerCase())) ||
      Object.entries(expected).some(([k,v]) => process.env[k] !== v)) throw Error('independent_clean_environment_required')
}
module.exports = { createFixture, qualify, checkpoint, retainClose, cleanEnvironment, verifyEnvironment, inventory, directory, hash }

