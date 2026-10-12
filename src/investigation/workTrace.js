'use strict'
// Host-generated metadata. Source text, mailbox, file paths and credentials are
// never part of a receipt. Work identity is revision-scoped; run identity is an
// individual host attempt, not a model phase or a claimed scheduler trigger.
const { AsyncLocalStorage } = require('node:async_hooks')
const { createHash, createHmac, randomUUID, timingSafeEqual } = require('node:crypto')
const { UUID } = require('./invocationContext')
const context = new AsyncLocalStorage()
const KINDS = ['mail_analysis', 'mail_index', 'memory_index', 'memory_consolidation']
const PHASES = ['analysis', 'extraction', 'consolidation']
function validWorkTrace(t) {
  return !!t && typeof t === 'object' && !Array.isArray(t) &&
    Object.keys(t).sort().join(',') === 'attempt,kind,phase,recordId,runId,workId' &&
    typeof t.workId === 'string' && /^work:[a-f0-9]{64}$/.test(t.workId) &&
    typeof t.runId === 'string' && UUID.test(t.runId) && KINDS.includes(t.kind) &&
    PHASES.includes(t.phase) && Number.isSafeInteger(t.attempt) && t.attempt >= 1 &&
    (t.recordId===null||(typeof t.recordId==='string'&&/^xx-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(t.recordId)))
}
function createWorkTrace(kind, identity, phase, attempt = 1, recordId = null) {
  if (!KINDS.includes(kind) || typeof identity !== 'string' || !identity || identity.length > 100000) throw Error('invalid_work_identity')
  const trace = { workId: 'work:' + createHash('sha256').update(JSON.stringify([kind, identity])).digest('hex'), runId: randomUUID(), kind, phase, attempt,recordId }
  if (!validWorkTrace(trace)) throw Error('invalid_work_trace')
  return trace
}
function withWorkTrace(trace, fn) {
  if (!validWorkTrace(trace)) throw Error('invalid_work_trace')
  return context.run(Object.freeze({ ...trace }), fn)
}
function currentWorkTrace() { return context.getStore() || null }
function encodeWorkTrace(trace, token) {
  if (!validWorkTrace(trace) || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null
  const payload = Buffer.from(JSON.stringify(trace)).toString('base64url')
  return payload + '.' + createHmac('sha256', token).update('xiangxiang-work-v1:' + payload).digest('hex')
}
function decodeWorkTrace(header, token) {
  if (typeof header !== 'string' || header.length > 700 || !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(header) || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null
  const [payload, signature] = header.split('.')
  const expected = createHmac('sha256', token).update('xiangxiang-work-v1:' + payload).digest('hex')
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  try { const trace = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return validWorkTrace(trace) ? trace : null } catch (_) { return null }
}
const OUTCOMES=['ready','saved','raw_only','done','empty','unconfirmed','failed','yielded']
function validOutcome(o){return !!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')==='at,state'&&OUTCOMES.includes(o.state)&&typeof o.at==='string'&&Number.isFinite(Date.parse(o.at))}
async function reportWorkOutcome(trace,state,{env=process.env,request=null}={}){
  if(!validWorkTrace(trace)||!OUTCOMES.includes(state))return false
  if(!request&&(require('../testProcess').isTestProcess()||!/^[a-f0-9]{64}$/.test(env.CODEX_CHAT_BRIDGE_TOKEN||'')))return false
  try{return (await (request||require('../adapters/CodexSubscriptionAdapter').localRequest)('/work-outcome',{workTrace:trace,outcome:{state,at:new Date().toISOString()}},env,AbortSignal.timeout(5000))).recorded===true}catch(_){return false}
}
module.exports = { createWorkTrace, validWorkTrace, withWorkTrace, currentWorkTrace, encodeWorkTrace, decodeWorkTrace,validOutcome,reportWorkOutcome }
