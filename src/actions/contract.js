'use strict'
const TARGETS = Object.freeze([
  Object.freeze({ id: 'errand-recall', taskPath: '\\', taskName: 'AromaXiangXiang-ErrandRecall', effect: 'Future deterministic recall checks only; no model inference or termination of running work.' }),
  Object.freeze({ id: 'gateway-acceptance', taskPath: '\\AromaXiangXiang\\', taskName: 'ActionGatewayAcceptance', effect: 'Dedicated inert acceptance task; no business work.' })
])
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const HASH = /^[a-f0-9]{64}$/
const hash = value => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex')
function target (id) { const t = TARGETS.find(t => t.id === id); if (!t) throw Error('target_not_allowed'); return t }
function validInput (b) {
  const shapes = { inspect: ['op'], list: ['op'], get: ['op','id'], prepare: ['op','inspectionId','targetId','action'], approve: ['op','id','hash','nonce'], restore: ['op','id'] }
  return !!b && !Array.isArray(b) && Object.hasOwn(shapes,b.op) && Object.keys(b).sort().join(',') === shapes[b.op].sort().join(',') &&
    (!['get','approve','restore'].includes(b.op) || ID.test(b.id || '')) && (!b.inspectionId || ID.test(b.inspectionId)) &&
    (b.op !== 'prepare' || TARGETS.some(t => t.id === b.targetId) && ['scheduler.pause','scheduler.resume'].includes(b.action) && ID.test(b.inspectionId)) &&
    (b.op !== 'approve' || HASH.test(b.hash) && /^[a-f0-9]{48}$/.test(b.nonce))
}
module.exports = { TARGETS, ID, HASH, hash, target, validInput }
