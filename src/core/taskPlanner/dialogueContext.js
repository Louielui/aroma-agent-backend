'use strict'
const { hash } = require('./contract')
const TTL = 30 * 60 * 1000
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === names.slice().sort().join()
const strings = v => Array.isArray(v) && v.length <= 12 && v.every(s => typeof s === 'string' && s.trim() && s.length <= 4000)
function seal (value) { const v = structuredClone(value); delete v.digest; return { ...v, digest: hash(JSON.stringify(v)) } }
function validContext (v, revision, conversationId, now = Date.now()) {
  if (!keys(v, ['version', 'profile', 'revision', 'conversationId', 'createdAt', 'ownerRequests', 'proposals', 'language', 'digest']) || v.version !== 1 || !['interface', 'chat'].includes(v.profile) || v.revision !== revision || !/^[a-f0-9]{40}$/.test(v.revision || '') || v.conversationId !== conversationId || !['en', 'zh'].includes(v.language) || !strings(v.ownerRequests) || !v.ownerRequests.length || !strings(v.proposals) || !Number.isFinite(Date.parse(v.createdAt)) || now - Date.parse(v.createdAt) < 0 || now - Date.parse(v.createdAt) > TTL) return false
  return seal(v).digest === v.digest
}
function validDialogue (v, revision, conversationId, profile) {
  if (!keys(v, ['context', 'contextDigest', 'ownerRequests', 'proposals', 'confirmation', 'language']) || typeof v.confirmation !== 'string' || !v.confirmation.trim() || v.confirmation.length > 2000 || !validContext(v.context, revision, conversationId) || v.context.profile !== profile) return false
  return v.contextDigest === v.context.digest && JSON.stringify(v.ownerRequests) === JSON.stringify(v.context.ownerRequests) && JSON.stringify(v.proposals) === JSON.stringify(v.context.proposals) && v.language === v.context.language
}
module.exports = { seal, validContext, validDialogue }
