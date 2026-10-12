'use strict'
const TEST = 'acceptance/chat-browser.test.cjs'
const NAMES = Object.freeze(['zh', 'en'].flatMap(locale => [1280, 390].map(width => `browser-${locale}-${width}.png`)))
const CHECKS = ['startup','labels','fiveDepths','mediumDefault','solDefault','layout','keyboard','picker','chatScope','explicitConfirmation','noPageErrors','onlyFixtureRequests']
const CHECKS_V2 = ['startup','labels','claudeDefault','providerIsolation','modelEfforts','catalogueFailureHandled','layout','keyboard','picker','chatScope','explicitConfirmation','noPageErrors','onlyFixtureRequests']
const ROUTES = ['/demo','/api/v1/demo/models','/api/v1/demo/greeting','/api/v1/demo/version','/api/v1/conversations','/api/v1/home/settings','/manifest.webmanifest','/api/v1/demo/intake','/api/v1/task-plan/00000000-0000-4000-8000-000000000001']
function validate (p) {
  const checks = p?.engine === 'edge-headless-offline-v2' ? CHECKS_V2 : p?.engine === 'edge-headless-offline-v1' ? CHECKS : null
  if (!p || !NAMES.includes(p.name) || p.name !== `browser-${p.locale}-${p.width}.png` || !checks || typeof p.browserVersion !== 'string' || !/^Edg\/[0-9.]+$/.test(p.browserVersion) || p.height !== 900 || p.failedReads !== (p.locale === 'zh' && p.width === 390) || !/^[a-f0-9]{64}$/.test(p.pageHash || '') || !/^[a-f0-9]{64}$/.test(p.screenshotHash || '') || !Number.isSafeInteger(p.screenshotBytes) || p.screenshotBytes < 1001 || p.screenshotBytes > 2000000 || Object.keys(p.checks || {}).length !== checks.length || !checks.every(k => p.checks[k] === true) || !Array.isArray(p.routes) || !p.routes.includes('/demo') || p.routes.length > 100 || p.routes.some(n => !ROUTES.includes(n))) throw Error('invalid_sandbox_evidence')
  return p
}
function complete (rows) {
  try { if (!Array.isArray(rows) || rows.length !== 4 || new Set(rows.map(p => p.name)).size !== 4) return false; rows.forEach(validate); return true } catch (_) { return false }
}
function screenshot (receipt, name) {
  if (!NAMES.includes(name) || !complete(receipt?.browser)) throw Error('invalid_sandbox_evidence')
  const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto'), hash = b => createHash('sha256').update(b).digest('hex')
  const root = path.resolve(receipt.workspace || '')
  if (!path.basename(root).startsWith('offline-') || fs.realpathSync(root).toLowerCase() !== root.toLowerCase()) throw Error('invalid_sandbox_evidence')
  const read = file => { const st = fs.lstatSync(file); if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 2000000) throw Error('invalid_sandbox_evidence'); return fs.readFileSync(file) }
  const dir = path.join(root, 'output')
  if (fs.realpathSync(dir).toLowerCase() !== dir.toLowerCase()) throw Error('invalid_sandbox_evidence')
  if (hash(read(path.join(dir, 'evidence.json'))) !== receipt.evidenceHash) throw Error('invalid_sandbox_evidence')
  const proof = receipt.browser.find(p => p.name === name), bytes = read(path.join(dir, name))
  if (bytes.length !== proof.screenshotBytes || hash(bytes) !== proof.screenshotHash) throw Error('invalid_sandbox_evidence')
  return { name, content: bytes.toString('base64') }
}
module.exports = { TEST, NAMES, validate, complete, screenshot }
