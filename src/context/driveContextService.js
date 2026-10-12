'use strict'
const { ID } = require('./driveScope')
function validateDriveRequest (operation, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('invalid_request')
  const keys = operation === 'list' ? ['folderId'] : operation === 'search' ? ['query'] : ['fileId']
  if (!['list','search','get','readMetadata'].includes(operation) || Object.keys(input).some(k => !keys.includes(k))) throw Error('invalid_request')
  if (operation === 'search') {
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 80 || /[\x00-\x1f\x7f]/.test(input.query)) throw Error('invalid_request')
    return { query: input.query.trim() }
  }
  const key = keys[0]
  if ((operation === 'get' || input[key] !== undefined) && (typeof input[key] !== 'string' || !ID.test(input[key]))) throw Error('invalid_request')
  return { ...input }
}
function driveIntent (message) {
  if (typeof message !== 'string') return null
  const value = message.trim().replace(/[。！!？?]+$/, '').trim()
  if (/^(?:香香[，,\s]*)?(?:請|幫我)?(?:列出|查看)公司文件$/u.test(value) || /^list company files$/i.test(value)) return { operation: 'list', input: {} }
  const match = /^(?:香香[，,\s]*)?(?:請|幫我)?搜尋公司文件[：:]\s*(.{1,80})$/u.exec(value) || /^search company files:\s*(.{1,80})$/i.exec(value)
  if (!match || /[;；\r\n]/.test(match[1])) return null
  try { return { operation: 'search', input: validateDriveRequest('search', { query: match[1] }) } } catch (_) { return null }
}
function createDriveContextService ({ gateway, scope }) {
  return Object.freeze({ describe () {
    const source = scope.source()
    return source ? { id: source.id, name: source.name, rootId: source.rootId, registered: source.state === 'registered',
      access: 'owner_only', textFormats: ['google_document','plain_text'], textByteLimit: 16000 } : null
  }, async read (actor, operation, input = {}) {
    if (actor?.role !== 'owner') throw Error('permission_denied')
    const normalized = validateDriveRequest(operation, input), lease = scope.lease()
    lease.verify()
    const pack = await gateway[operation](actor, 'drive.company_files', normalized)
    lease.verify()
    return { version: 1, pack, source: { id: lease.source.id, name: lease.source.name, rootId: lease.source.rootId }, modelCalls: 0 }
  } })
}
module.exports = { createDriveContextService, validateDriveRequest, driveIntent }
