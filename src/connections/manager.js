'use strict'
const { SOURCE_FLAG, readAccessEnabled } = require('../context/flags')
const SOURCES = Object.freeze(['gmail', 'drive', 'calendar'])
const ERROR_CODES = ['auth', 'permission', 'timeout', 'configuration', 'error']
function sourceKey (source) { if (!SOURCES.includes(source)) throw Error('invalid_source'); return source }
function createManager ({ env = process.env, provider, store, settings, clock = () => Date.now() }) {
  let busy = false
  function list () {
    const config = provider.configuration(); const saved = store.load()
    return { masterEnabled: env.READ_ACCESS === 'on', canAuthorize: config.canAuthorize,
      connections: SOURCES.map(source => {
        const old = saved[source]; const lastProbe = old && old.revision === config.revision ? old : null
        const enabled = readAccessEnabled(env, source)
        const state = !enabled ? 'disabled' : !config.client ? 'configuration' : !config.token ? 'auth'
          : !lastProbe ? 'unverified' : clock() - Date.parse(lastProbe.at) > 900000 ? 'stale' : lastProbe.state
        return { source, enabled, sourceEnabled: env[SOURCE_FLAG[source]] === 'on', state,
          credentialPresent: config.token, account: lastProbe ? lastProbe.account : null,
          scopes: lastProbe ? lastProbe.scopes : null, lastProbe,
          lastSuccessAt: lastProbe ? lastProbe.lastSuccessAt : null }
      }) }
  }
  function invalidate () { store.save({}) }
  async function test (source) {
    sourceKey(source)
    if (busy) throw Error('busy')
    if (!readAccessEnabled(env, source)) throw Error('disabled')
    busy = true; let timer
    const config = provider.configuration(); const started = clock()
    try {
      store.event({ source, action: 'probe_started', at: new Date(started).toISOString() })
      let result; let state = 'connected'
      try {
        result = await Promise.race([provider.probe(source), new Promise((resolve, reject) => { timer = setTimeout(() => reject(Object.assign(Error('timeout'), { connectionCode: 'timeout' })), 25000) })])
        if (!result || !Number.isInteger(result.count) || result.count < 0 || !Array.isArray(result.scopes) || result.scopes.some(s => typeof s !== 'string') || (result.account !== null && typeof result.account !== 'string')) throw Error('invalid_result')
      } catch (e) { state = ERROR_CODES.includes(e.connectionCode) ? e.connectionCode : 'error'; result = { account: null, scopes: null, count: null } }
      if (!readAccessEnabled(env, source) || config.revision !== provider.configuration().revision) throw Error('state_changed')
      const saved = store.load(); const previous = saved[source]
      const at = new Date(clock()).toISOString()
      const row = { state, at, revision: config.revision, account: result.account, scopes: result.scopes,
        count: result.count, durationMs: clock() - started,
        lastSuccessAt: state === 'connected' ? at : previous && previous.revision === config.revision ? previous.lastSuccessAt : null }
      store.event({ source, action: 'probe_finished', state, count: row.count, at })
      store.save({ ...saved, [source]: row })
      return list().connections.find(r => r.source === source)
    } finally { clearTimeout(timer); busy = false }
  }
  function toggle (source, enabled) {
    sourceKey(source); if (typeof enabled !== 'boolean') throw Error('invalid_enabled')
    if (busy) throw Error('busy')
    store.event({ source, action: enabled ? 'enable_requested' : 'disable_requested', at: new Date(clock()).toISOString() })
    const saved = store.load(); delete saved[source]; store.save(saved)
    const result = settings.save({ flags: { ...settings.load().flags, [SOURCE_FLAG[source]]: enabled ? 'on' : 'off' } })
    if (!result || result.ok !== true) throw Error('settings_failed')
    store.event({ source, action: enabled ? 'enabled' : 'disabled', at: new Date(clock()).toISOString() })
    return list()
  }
  return { list, test, toggle, invalidate }
}
function createRuntimeManager () {
  return createManager({ provider: require('./googleProvider').createGoogleProvider(), store: require('./store').createStore(), settings: require('../persona/ownerSettings') })
}
module.exports = { SOURCES, createManager, createRuntimeManager }
