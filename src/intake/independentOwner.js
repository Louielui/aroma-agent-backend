'use strict'
// Offline-only leaf composition. No service entry, dotenv, modelCenter, live
// connector factory, scheduler or default subscription transport is started.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
let configured = false
const under = (base, file) => { const r = path.relative(base, file); return r !== '' && !r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r) }
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
function json(file, code = 'independent_config_invalid') {
  try {
    const s = fs.lstatSync(file)
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 100000) throw Error(code)
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (_) { throw Error(code) }
}
function createIndependentOwner(options = {}) {
  if (Object.keys(options).some(k => !['root','password','cookieName','enabled','manifestHash','resumeReceipt','hostEvidence','sharing'].includes(k))) throw Error('offline_dependencies_fixed')
  // Only the already-supported disposable Windows Sandbox is accepted here.
  // Its mapped folders/configuration still require independent host verification.
  const os = require('node:os')
  if (!/WDAGUtilityAccount/i.test(os.userInfo().username) || !Object.values(os.networkInterfaces()).flat().every(n => n.internal)) throw Error('independent_offline_boundary_required')
  let { root, password, cookieName, enabled = true, manifestHash, resumeReceipt, hostEvidence, sharing = {} } = options
  const fixture = require('../../scripts/r1/independentFixture.cjs')
  // One process, one instance. Existing authoritative store modules bind their
  // root at import time. Never switch them between instances in one process.
  if (configured || Object.keys(require.cache).some(p => /[/\\](?:app\.js|index\.js|store[/\\](?:store|dataDir|conversationStore)\.js)$/.test(p) && p.startsWith(path.resolve(__dirname, '..')))) throw Error('independent_process_required')
  root = directory(root)
  const codeRoot = path.resolve(__dirname, '../..')
  if (root === codeRoot || under(codeRoot, root) || under(root, codeRoot) || /^C:[/\\]Aroma(?:[/\\]|$)/i.test(root)) throw Error('independent_root_overlap')
  fixture.verifyEnvironment(root)
  const manifest = fixture.qualify({ root, manifestHash, resumeReceipt, hostEvidence })
  if (typeof password !== 'string' || password.length < 8 || typeof cookieName !== 'string' || !/^aroma_independent_[A-Za-z0-9_-]{1,36}$/.test(cookieName)) throw Error('independent_auth_required')
  cookieName += '_' + crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 24)
  if (typeof enabled !== 'boolean' || !sharing || Object.keys(sharing).some(k => !['goal','content','source'].includes(k)) || Object.values(sharing).some(v => typeof v !== 'boolean')) throw Error('offline_dependencies_required')
  const roots = Object.fromEntries(['data', 'artifacts', 'config', 'profile', 'temp', 'logs', 'lab'].map(k => [k, directory(path.join(root, k))]))
  const profileRoots = Object.fromEntries(['roaming', 'local'].map(k => [k, directory(path.join(roots.profile, k))]))
  let entries = 0
  const inspect = dir => {
    for (const name of fs.readdirSync(dir)) {
      if (++entries > 5000) throw Error('independent_root_too_large')
      const file = path.join(dir, name), s = fs.lstatSync(file)
      if (s.isSymbolicLink() || (!s.isDirectory() && (!s.isFile() || s.nlink !== 1))) throw Error('independent_root_alias')
      if (s.isDirectory()) inspect(file)
    }
  }
  inspect(root)
  const selectionFile = path.join(roots.config, 'model-selection.json'), authorizationFile = path.join(roots.data, 'company-access.json')
  const config = json(selectionFile), authorization = json(authorizationFile, 'independent_authorization_invalid')
  if (!config || Object.keys(config).sort().join(',') !== 'brain,mode,version' || config.version !== 1 || config.mode !== 'synthetic_fixture' || Object.keys(config.brain || {}).sort().join(',') !== 'effort,model') throw Error('independent_model_config_invalid')
  if (!authorization || authorization.version !== 1 || !Number.isInteger(authorization.revision) || !Array.isArray(authorization.users) || !Array.isArray(authorization.sources) || !Array.isArray(authorization.audit)) throw Error('independent_authorization_invalid')
  // A private installed dependency bundle is mandatory; NODE_PATH must never
  // quietly resolve these libraries through the legacy installation.
  for (const name of ['express', 'uuid']) if (!under(path.join(codeRoot, 'node_modules'), fs.realpathSync(require.resolve(name)))) throw Error('independent_dependencies_required')
  const models = require('../subscription/chatModels')
  if (!models.isBrainModel(config.brain.model) || !models.REASONING_EFFORTS.includes(config.brain.effort)) throw Error('independent_model_config_invalid')
  const choice = Object.freeze({ ...config.brain })
  // Credential-bearing ambient environment is not an input to this instance.
  if (Object.keys(process.env).some(k => /(?:TOKEN|PASSWORD|API_KEY|CREDENTIAL|CODEX_HOME|CLAUDE_CONFIG_DIR)$/i.test(k))) throw Error('independent_clean_environment_required')
  // Refuse a second writer to this same private instance before recovery can
  // inspect its tasks. No stale-PID/timeout inference or automatic crash unlock.
  const ownershipFile = path.join(root, '.independent-process.json')
  const ownership = JSON.stringify({ version: 1, pid: process.pid, id: crypto.randomUUID(), mode: 'synthetic_fixture' })
  const fd = fs.openSync(ownershipFile, 'wx', 0o600)
  try { fs.writeFileSync(fd, ownership); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  const releaseOwnership = () => {
    if (!closing || diagnosticFailed || activeRequests !== 0) throw Error('independent_recovery_required')
    if (fs.readFileSync(ownershipFile, 'utf8') !== ownership) throw Error('independent_ownership_changed')
    fs.unlinkSync(ownershipFile)
  }
  Object.assign(process.env, { AROMA_DATA_DIR: roots.data, AROMA_ARTIFACT_DIR: roots.artifacts,
    HOME: roots.profile, USERPROFILE: roots.profile, APPDATA: profileRoots.roaming, LOCALAPPDATA: profileRoots.local,
    TEMP: roots.temp, TMP: roots.temp, XIANGXIANG_LAB_ROOT: roots.lab, XIANGXIANG_LOCALE: 'en' })
  configured = true
  const express = require('express'), auth = require('../governance/ownerAuth')
  let store
  try { store = require('../store/store'); store.listTasks() } catch (_) { throw Error('independent_storage_corrupt') }
  const sharedConversations = require('../store/conversationStore'), originalConversations = sharedConversations.createConversationStore({ dataDir: roots.data })
  // Strict private-instance scan; do not change the shared store's lenient list contract.
  const conversations = { ...originalConversations, list() {
    const dir = path.join(roots.data, 'conversations')
    let names
    try { names = fs.readdirSync(dir) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
    const out = []
    for (const name of names) {
      if (!name.endsWith('.json') || !sharedConversations.isValidId(name.slice(0, -5))) throw Error('independent_storage_corrupt')
      const file = path.join(dir, name), s = fs.lstatSync(file)
      if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw Error('independent_storage_corrupt')
      const c = originalConversations.get(name.slice(0, -5))
      if (!c || c.id !== name.slice(0, -5)) throw Error('independent_storage_corrupt')
      out.push({ id: c.id, title: c.title || require('../i18n/t').t('store.newConversation'), createdAt: c.createdAt || null, updatedAt: c.updatedAt || c.createdAt || null, messageCount: c.messages.length })
    }
    return out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  } }
  const registry = require('../company/access').createRegistry({ file: authorizationFile })
  const audit = require('../core/operating/activityStore').createActivityStore({ dir: path.join(roots.data, 'context-activity'), workflow: 'drive_context', reason: 'synthetic_offline_investigation' })
  const adapters = require('../../scripts/r1/independentAdapters.cjs').createSyntheticAdapters()
  const { createContext, request } = adapters
  const liveContext = createContext({ registry, audit, roots })
  if (!liveContext?.drive || Object.keys(liveContext).some(k => k !== 'drive')) throw Error('offline_dependencies_required')
  const reads = require('../browserRead/store').createStore(path.join(roots.data, 'browser-context-reads'))
  const intake = require('./unifiedIntake').createUnifiedIntake({ store, reads, enabled: () => enabled })
  const syntheticEvents = []
  // Existing model identity/billing validation is retained by ownerIntegration.
  // All transport results here are explicitly synthetic, never billing proof.
  const transport = async (...args) => {
    syntheticEvents.push({ phase: args[0], mode: 'synthetic_fixture' })
    return request(...args)
  }
  const integration = require('./ownerIntegration').createOwnerIntegration({ liveContext, registry, enabled: () => enabled,
    selection: () => choice, request: transport, evidenceMode: 'synthetic_fixture',
    env: Object.freeze({
      OWNER_TASK_GOAL_SHARING: sharing.goal === true && manifest.sharing.goal === true ? 'true' : 'false',
      OWNER_TASK_CONTENT_SHARING: sharing.content === true && manifest.sharing.content === true ? 'true' : 'false',
      CONTEXT_DRIVE_OPENAI: sharing.source === true && manifest.sharing.source === true ? 'on' : 'off',
      CONTEXT_DRIVE_CLAUDE: 'off'
    }) })
  const browserRead = require('../browserRead/service').createBrowserRead({ store: reads, selection: () => choice,
    provider: () => { throw Error('native_transport_disabled') }, mainTaskRunner: integration.runner,
    mainTaskEnabled: () => enabled, mainProvider: integration.provider, unifiedIntake: intake })
  const sessions = auth.createSessionStore(), app = express()
  let closing = false, diagnosticFailed = false, activeRequests = 0
  const idleWaiters = new Set(), DIAGNOSTIC_LIMIT = 64
  let diagnosticCount = fs.readdirSync(roots.logs).length
  const diagnostic = code => {
    const correlationId = crypto.randomUUID()
    try {
      // One bounded ring in the existing private log directory. No request bodies/paths.
      const slot = diagnosticCount++ % DIAGNOSTIC_LIMIT
      fs.writeFileSync(path.join(roots.logs, 'diagnostic-' + slot + '.json'), JSON.stringify({ correlationId, code, mode: 'synthetic_fixture', at: new Date().toISOString() }), { mode: 0o600 })
    } catch (_) { diagnosticFailed = true; throw Error('independent_diagnostic_unavailable') }
    return correlationId
  }
  app.disable('x-powered-by'); app.locals.ownerSessions = sessions; app.locals.conversationDemo = enabled
  const authenticated = req => sessions.valid(auth.readCookie(req, cookieName)) === true
  const reportFailure = (res, error, projection = {}) => {
    const code = error?.message === 'audit_unavailable' ? 'audit_unavailable' : 'independent_unavailable'
    try { return res.status(503).json({ ...projection, error: code, correlationId: diagnostic(code) }) }
    catch (_) { return res.status(503).json({ error: 'diagnostic_unavailable' }) }
  }
  const operation = async (req, res, execute) => {
    res.locals.independentOperation.running = true
    try { return await execute() } finally { res.locals.independentOperation.release() }
  }
  app.use((req, res, next) => {
    if (closing || diagnosticFailed) return res.status(503).json({ error: 'independent_closed' })
    const host = '127.0.0.1:' + req.socket.localPort
    if (req.get('host') !== host || (req.method !== 'GET' && req.method !== 'HEAD' &&
        (req.get('origin') !== 'http://' + host || ['cross-site', 'same-site'].includes(req.get('sec-fetch-site'))))) return res.status(403).json({ error: 'owner_origin_required' })
    activeRequests++
    let finished = false
    const release = () => { if (!finished) { finished = true; activeRequests--; if (activeRequests === 0) { for (const resolve of idleWaiters) resolve(); idleWaiters.clear() } } }
    res.locals.independentOperation = { running: false, release }
    const finish = () => { if (!res.locals.independentOperation.running) release() }
    res.once('finish', finish); res.once('close', finish)
    res.set('Cache-Control', 'no-store'); next()
  })
  // No unauthenticated work request reaches a parser or persistent diagnostics.
  app.use((req, res, next) => ['GET','HEAD'].includes(req.method) || req.path.startsWith('/owner/') || authenticated(req) ? next() : res.status(403).json({ error: 'owner_session_required' }))
  app.use(express.urlencoded({ extended: false, limit: '8kb' })); app.use(express.json({ limit: '32kb' }))
  app.use(require('../routes/ownerAuthRouter').createOwnerAuthRouter({ sessions, cookieName, isConfigured: () => true, resolvePassword: () => password }))
  const ownerOnly = auth.createRequireOwner({ sessions, cookieName, isConfigured: () => true })
  app.get('/demo', ownerOnly, (_req, res) => res.type('html').send(require('../demo/demoHtml').DEMO_HTML.replace('data-unified-task-intake="false"', 'data-unified-task-intake="true"')))
  app.get('/api/v1/conversations', ownerOnly, (_req, res, next) => { try { res.json({ ok: true, conversations: conversations.list() }) } catch (e) { next(e) } })
  app.get('/api/v1/independent/configuration', ownerOnly, (_req, res) => res.json({ mode: 'synthetic_fixture', brain: choice, realModelInvocation: 'BLOCKED', enabled }))
  app.get(['/api/v1/independent/conversations/:id', '/api/v1/conversations/:id'], ownerOnly, (req, res) => {
    try {
      const value = conversations.get(req.params.id)
      if (value === null) return res.status(404).json({ error: 'conversation_not_found' })
      return res.json({ ok: true, conversation: value })
    } catch (_) {
      try { return res.status(503).json({ error: 'conversation_unavailable', correlationId: diagnostic('conversation_unavailable') }) }
      catch (_) { return res.status(503).json({ error: 'diagnostic_unavailable' }) }
    }
  })
  app.use(require('./unifiedRoutes').createRouter({ intake, browserRead, conversations, withOwner: integration.withOwner, cookieName, operation, reportFailure }))
  app.use((_req, res) => res.status(404).json({ error: 'route_unavailable' }))
  app.use((error, req, res, _next) => {
    const invalid = error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large'
    if (!authenticated(req) || invalid) return res.status(invalid ? 400 : 503).json({ error: invalid ? 'independent_request_invalid' : 'independent_unavailable' })
    try { res.status(invalid ? 400 : 503).json({ error: invalid ? 'independent_request_invalid' : 'independent_unavailable', correlationId: diagnostic(invalid ? 'invalid_input' : 'internal_unavailable') }) }
    catch (_) { res.status(503).json({ error: 'diagnostic_unavailable' }) }
  })
  return Object.freeze({ app, roots: Object.freeze(roots), choice, cookieName, releaseOwnership, sessions, reads, store, conversations, registry,
    ...adapters, beginClose: () => { closing = true }, activeRequests: () => activeRequests,
    whenIdle: () => activeRequests === 0 ? Promise.resolve() : new Promise(resolve => idleWaiters.add(resolve)),
    checkpoint: () => { if (!closing || diagnosticFailed || activeRequests !== 0) throw Error('independent_recovery_required'); return fixture.checkpoint(root, manifestHash, manifest.id) },
    syntheticEvents, mode: 'synthetic_fixture', realModelInvocation: 'BLOCKED' })
}
module.exports = { createIndependentOwner }
