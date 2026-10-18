'use strict'
// Private Independent composition boundary. No operational imports or alternate store.
const fs = require('node:fs'), { randomUUID } = require('node:crypto'), { AsyncLocalStorage } = require('node:async_hooks')
function storageError(message, reason, code) {
  return Object.assign(Error(message), { reason, ...(code ? { code } : {}) })
}
function loadTaskStore(file, load, read = fs.readFileSync) {
  try {
    let raw
    try { raw = read(file, 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
    if (raw !== undefined) {
      let db
      try { db = JSON.parse(raw) } catch { throw storageError('independent_storage_corrupt', 'corrupt_json') }
      // These are the existing store's arrays; absent arrays retain its first-run defaults.
      if (!db || typeof db !== 'object' || Array.isArray(db) || ['decisions','tasks','events','llm_usage','dispatches'].some(k => Object.hasOwn(db,k) && !Array.isArray(db[k]))) throw storageError('independent_storage_corrupt', 'invalid_schema')
    }
    return load()
  } catch (e) {
    if (e?.message === 'independent_storage_corrupt' && ['corrupt_json','invalid_schema'].includes(e.reason)) throw e
    if ((typeof e?.code === 'string' && /^E[A-Z0-9]+$/.test(e.code) && typeof e.syscall === 'string') || ['EACCES','EPERM','EIO','ENOENT','ENOTDIR','EBUSY'].includes(e?.code)) {
      throw storageError('independent_storage_unavailable', e.code, e.code)
    }
    throw storageError('independent_startup_unavailable', 'unknown_internal', e?.code === 'MODULE_NOT_FOUND' ? e.code : undefined)
  }
}
const expected = new Map([
  ['owner_session_required',403], ['selection_not_authorized',403], ['clarification_not_authorized',403],
  ['permission_denied',403], ['selection_scope_changed',403], ['source_access_changed',403], ['task_scope_changed',403], ['cross_source_not_authorized',403],
  ['synthesis_not_authorized',403], ['task_not_authorised',403],
  ['subscription_login_required',503], ['subscription_limit_reached',503], ['subscription_model_unavailable',503], ['subscription_unavailable',503],
  ['read_timeout',504]
])
function createFailureBoundary(diagnostic) {
  const requests = new AsyncLocalStorage()
  const codeOf = e => e?.code || e?.message
  return Object.freeze({
    within: execute => requests.run({}, execute),
    async observe(execute, record) {
      try { return await execute() } catch (e) {
        // The shared Browser Read contract deliberately folds unknown codes.
        // Retain only the safe original enum in this one request, never a global last error.
        const scope = requests.getStore(), code = codeOf(e)
        if (expected.has(code)) {
          if (scope) scope.expected = code
          // Use the existing attempt timeline so a replay does not relabel a denial as internal.
          if (record) record({ stage: 'independent_failure_classified', error: code })
        }
        throw e
      }
    },
    projectResult(result) {
      if (result?.state !== 'failed' || result.error !== 'read_unavailable') return result
      const event = result.timeline?.findLast(e => e.stage === 'independent_failure_classified')
      return expected.has(event?.error) ? { ...result, error: event.error } : result
    },
    reportFailure(res, error, projection = {}) {
      let code = codeOf(error)
      if (code === 'read_unavailable' && requests.getStore()?.expected) code = requests.getStore().expected
      const ordinary = expected.has(code), audit = code === 'audit_unavailable'
      if (!ordinary && !audit) code = 'independent_unavailable'
      try { return res.status(ordinary ? expected.get(code) : 503).json({ ...projection, error: code, correlationId: ordinary ? randomUUID() : diagnostic(code) }) }
      catch { return res.status(503).json({ error: 'diagnostic_unavailable' }) }
    }
  })
}
module.exports = { loadTaskStore, createFailureBoundary }
