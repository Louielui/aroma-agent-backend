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
  return { root, manifestHash: hash(fs.readFileSync(path.join(root, ROOT_FILE))), sharing: manifest.sharing }
}
function qualify({ root, manifestHash, resumeReceipt }) {
  root = directory(root)
  const file = path.join(root, ROOT_FILE), st = fs.lstatSync(file)
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 20000) throw Error('independent_fixture_invalid')
  const raw = fs.readFileSync(file)
  if (!/^[a-f0-9]{64}$/.test(manifestHash || '') || hash(raw) !== manifestHash || raw.length > 20000) throw Error('independent_fixture_identity_required')
  const m = JSON.parse(raw)
  if (m.version !== 1 || m.mode !== 'synthetic_fixture' || m.root !== root || !/^[a-f0-9-]{36}$/.test(m.id) || !m.sharing ||
      Object.keys(m.initial || {}).filter(k => !k.endsWith('/')).sort().join(',') !== 'config/model-selection.json,config/synthetic-source.json,data/company-access.json' ||
      Object.keys(m.initial || {}).filter(k => k.endsWith('/')).sort().join(',') !== subdirs.map(k => k + '/').sort().join(',')) throw Error('independent_fixture_invalid')
  const own = inventory(root)
  const expected = resumeReceipt ? resumeReceipt.files : { ...m.initial, [ROOT_FILE]: manifestHash }
  if (resumeReceipt && (resumeReceipt.instanceId !== m.id || resumeReceipt.manifestHash !== manifestHash || resumeReceipt.safeClosed !== true)) throw Error('independent_resume_refused')
  if (JSON.stringify(Object.entries(own).sort()) !== JSON.stringify(Object.entries(expected || {}).sort())) throw Error('independent_fixture_changed')
  for (const d of subdirs) directory(path.join(root, d))
  if (fs.existsSync(path.join(root, '.independent-process.json'))) { const e = Error('EEXIST'); e.code = 'EEXIST'; throw e }
  return m
}
function checkpoint(root, manifestHash, instanceId) {
  return { version: 1, instanceId, manifestHash, safeClosed: true, files: inventory(root) }
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
module.exports = { createFixture, qualify, checkpoint, cleanEnvironment, verifyEnvironment, inventory, directory, hash }

