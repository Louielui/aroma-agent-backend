'use strict'
const { fencedFetch } = require('../adapters/liveEgressFence')
const BRIDGE = 'http://127.0.0.1:8091/memory-store'
const HINDSIGHT = 'http://127.0.0.1:8888'
const result = (state, reason = null, alive = null) => ({ state, reason, alive })
async function readResponse(res) {
  const raw = await res.text()
  if (raw.length > 64000) throw Error('invalid_response')
  return JSON.parse(raw)
}
function failure(e) {
  return result('unavailable', e?.cause?.code === 'ECONNREFUSED' || e?.code === 'ECONNREFUSED' ? 'not_running' : ['AbortError', 'TimeoutError'].includes(e?.name) ? 'probe_timeout' : 'probe_unavailable',
    e?.cause?.code === 'ECONNREFUSED' || e?.code === 'ECONNREFUSED' ? false : null)
}
async function probeBridge({ env = process.env, transport = fencedFetch('memory_gateway') } = {}) {
  if (env.XIANGXIANG_MEMORY !== 'on') return { bridge: result('disabled', 'memory_disabled'), database: result('disabled', 'memory_disabled') }
  if (!/^[a-f0-9]{64}$/.test(env.CODEX_CHAT_BRIDGE_TOKEN || '')) return { bridge: result('unavailable', 'not_configured'), database: result('unavailable', 'not_configured') }
  try {
    const res = await transport(BRIDGE, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { authorization: 'Bearer ' + env.CODEX_CHAT_BRIDGE_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ op: 'health' }) })
    if ([401, 403].includes(res.status)) return { bridge: result('unavailable', 'authorization_failed'), database: result('unavailable', 'bridge_unavailable') }
    const value = await readResponse(res)
    if (res.ok && value.error === 'memory_database_unavailable') return { bridge: result('degraded', 'database_unavailable', true), database: result('unavailable', 'database_unavailable') }
    const db = value.result
    if (!res.ok || db?.state !== 'connected' || db.database !== 'xiangxiang_memory_core' || typeof db.vector !== 'boolean')
      return { bridge: result('foreign', 'identity_mismatch'), database: result('unavailable', 'bridge_unavailable') }
    return { bridge: result('ready', null, true), database: result(db.vector ? 'ready' : 'degraded', db.vector ? null : 'vector_unavailable', true) }
  } catch (e) { return { bridge: failure(e), database: result('unavailable', 'bridge_unavailable') } }
}
async function probeHindsight({ env = process.env, transport = fencedFetch('hindsight') } = {}) {
  if (env.XIANGXIANG_MEMORY !== 'on') return result('disabled', 'memory_disabled')
  let url
  try { url = new URL(env.HINDSIGHT_URL) } catch (_) { return result('unavailable', 'not_configured') }
  if (url.origin !== HINDSIGHT || url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
    !/^xiangxiang-(?:owner|test-[a-z0-9-]+)$/.test(env.HINDSIGHT_BANK || '') || !env.HINDSIGHT_TOKEN) return result('unavailable', 'not_configured')
  const get = path => transport(HINDSIGHT + path, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { authorization: 'Bearer ' + env.HINDSIGHT_TOKEN } })
  let alive = false
  try {
    const live = await get('/health/live')
    if ([401, 403].includes(live.status)) return result('unavailable', 'authorization_failed')
    const value = await readResponse(live)
    if (!live.ok || value.status !== 'alive' || typeof value.version !== 'string' || !value.version || !Number.isFinite(value.uptime_seconds)) return result('foreign', 'identity_mismatch')
    alive = true
    // A live event loop with an unavailable database must not be restarted.
    const ready = await get('/health'); const health = await readResponse(ready)
    if (!ready.ok || health.status !== 'healthy' || health.database !== 'connected') return result('degraded', 'database_unavailable', true)
    const auth = await get('/v1/default/banks/' + env.HINDSIGHT_BANK + '/stats')
    if ([401, 403].includes(auth.status)) return result('unavailable', 'authorization_failed', true)
    if (auth.status === 404) return result('degraded', 'index_missing', true)
    const stats = await readResponse(auth)
    if (!auth.ok || stats.bank_id !== env.HINDSIGHT_BANK || !Number.isInteger(stats.total_documents) || stats.total_documents < 0) return result('foreign', 'identity_mismatch', true)
    return result('ready', null, true)
  } catch (e) { return alive ? result('degraded', 'database_unavailable', true) : failure(e) }
}
async function probeMemoryServices(options = {}) {
  const [{ bridge, database }, hindsight] = await Promise.all([probeBridge(options), probeHindsight(options)])
  const services = { bridge, database, hindsight }
  const rows = Object.values(services)
  const state = rows.every(r => r.state === 'disabled') ? 'disabled' : rows.every(r => r.state === 'ready') ? 'ready' :
    rows.some(r => r.state === 'ready' || r.state === 'degraded') ? 'degraded' : 'unavailable'
  return { checkedAt: new Date().toISOString(), state, services }
}
module.exports = { probeMemoryServices, probeBridge, probeHindsight }
