'use strict'
// Complete encrypted snapshots for the existing disposable maintenance controller.
// No production paths or general-purpose snapshot/restore command are exposed.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const crypto = require('node:crypto'), zlib = require('node:zlib'), cp = require('node:child_process')
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const MAX = 256 * 1024 * 1024
function regular (file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX) throw Error('snapshot_file_untrusted')
  return fs.readFileSync(file)
}
function durableNew (file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600)
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
function createSnapshots ({ root, inventory, powershell, script }) {
  if (fs.realpathSync(root) !== path.resolve(root) || path.dirname(root) !== fs.realpathSync(os.tmpdir()) || !/^imagine-offline-[a-f0-9-]{36}$/.test(path.basename(root))) throw Error('disposable_scope_required')
  const tools = [powershell, script].map(file => [file, hash(regular(file))])
  const directory = path.join(root, 'snapshots')
  if (!fs.existsSync(directory)) fs.mkdirSync(directory)
  if (fs.realpathSync(directory) !== directory) throw Error('snapshot_directory_untrusted')
  function crypt (operation, bytes) {
    for (const [file, pin] of tools) if (hash(regular(file)) !== pin) throw Error('snapshot_tool_changed')
    return Buffer.from(cp.execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-File', script, operation], {
      input: bytes.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 30000,
      maxBuffer: 64 * 1024 * 1024, env: { SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir() }, stdio: ['pipe', 'pipe', 'pipe']
    }).trim(), 'base64')
  }
  function read (receipt, binding) {
    if (!receipt || !/^[a-f0-9-]{36}\.dpapi$/.test(receipt.file || '')) throw Error('snapshot_receipt_invalid')
    const bytes = regular(path.join(directory, receipt.file))
    if (hash(bytes) !== receipt.encryptedSha256) throw Error('snapshot_identity_changed')
    const raw = zlib.gunzipSync(crypt('unprotect', bytes), { maxOutputLength: MAX })
    if (hash(raw) !== receipt.rawSha256) throw Error('snapshot_identity_changed')
    const payload = JSON.parse(raw)
    if (payload.schema !== 'offline-complete-snapshot-v1' || JSON.stringify(payload.binding) !== JSON.stringify(binding)) throw Error('snapshot_binding_changed')
    for (const group of Object.values(payload.groups)) {
      if (JSON.stringify(Object.keys(group.files).sort()) !== JSON.stringify(Object.keys(group.hashes).sort())) throw Error('snapshot_membership_changed')
      for (const [name, entry] of Object.entries(group.files)) if (hash(Buffer.from(entry.bytes, 'base64')) !== group.hashes[name]) throw Error('snapshot_contents_changed')
    }
    return payload
  }
  function directories (source) {
    const result = []
    function walk (directory, prefix) {
      for (const name of fs.readdirSync(directory).sort()) {
        const full = path.join(directory, name), stat = fs.lstatSync(full), relative = prefix + name
        if (stat.isSymbolicLink()) throw Error('snapshot_file_untrusted')
        if (stat.isDirectory()) { result.push(relative); walk(full, relative + '/') }
      }
    }
    walk(source, ''); return result
  }
  function verifyGroup (group, source) {
    if (JSON.stringify(inventory(source)) !== JSON.stringify(group.hashes) || JSON.stringify(directories(source)) !== JSON.stringify(group.directories)) throw Error('snapshot_source_changed')
    for (const [name, entry] of Object.entries(group.files)) {
      const stat = fs.statSync(path.join(source, name), { bigint: true })
      if (String(stat.ino) !== entry.ino || String(stat.mtimeNs) !== entry.mtimeNs || String(stat.birthtimeNs) !== entry.birthtimeNs || stat.size !== BigInt(entry.size)) throw Error('snapshot_source_identity_changed')
    }
  }
  function seal ({ groups, logical, binding }) {
    const payload = { schema: 'offline-complete-snapshot-v1', binding, logical, groups: {} }
    let total = 0
    for (const [name, source] of Object.entries(groups)) {
      const relative = path.relative(root, source)
      if (!relative || path.isAbsolute(relative) || relative.startsWith('..')) throw Error('snapshot_scope_invalid')
      const hashes = inventory(source), entries = []
      for (const [file, expected] of Object.entries(hashes)) {
        const full = path.join(source, file), before = fs.statSync(full, { bigint: true }), bytes = regular(full), after = fs.statSync(full, { bigint: true })
        total += bytes.length
        if (total > MAX / 2 || hash(bytes) !== expected || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs) throw Error('snapshot_source_changed')
        entries.push([file, { bytes: bytes.toString('base64'), size: bytes.length, ino: String(after.ino), birthtimeNs: String(after.birthtimeNs), mtimeNs: String(after.mtimeNs) }])
      }
      if (JSON.stringify(inventory(source)) !== JSON.stringify(hashes)) throw Error('snapshot_source_changed')
      payload.groups[name] = { hashes, directories: directories(source), files: Object.fromEntries(entries) }
      verifyGroup(payload.groups[name], source)
    }
    const raw = Buffer.from(JSON.stringify(payload))
    if (raw.length > MAX) throw Error('snapshot_size_limit')
    const encrypted = crypt('protect', zlib.gzipSync(raw))
    const receipt = { file: crypto.randomUUID() + '.dpapi', encryptedSha256: hash(encrypted), rawSha256: hash(raw) }
    durableNew(path.join(directory, receipt.file), encrypted)
    if (JSON.stringify(read(receipt, binding)) !== JSON.stringify(payload)) throw Error('snapshot_roundtrip_failed')
    return receipt
  }
  return Object.freeze({ seal, read, verifyGroup, tools })
}
module.exports = { createSnapshots, durableNew }
