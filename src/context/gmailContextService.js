'use strict'
const { validateGmailRequest } = require('./gmailContext')
function gmailMailbox (resource) { if (!['gmail.owner_mail', 'gmail.admin_mail'].includes(resource)) throw Error('invalid_request'); return resource === 'gmail.owner_mail' ? 'owner' : 'admin' }
function gmailIntent (message) {
  if (typeof message !== 'string') return null
  const value = message.trim().replace(/[。！!？?]+$/, '').trim().replace(/^香香[，,\s]*/, '')
  const original = value.match(/^Read (my|administrative) email original ([a-f0-9]{1,100})$/i)
  if (original) return { resource: original[1].toLowerCase() === 'my' ? 'gmail.owner_mail' : 'gmail.admin_mail', operation: 'get', input: { messageId: original[2] } }
  let match = value.match(/^(?:請|幫我)?(?:查看|列出|查詢)(今天)?(我的|行政部)(今天|未讀|最新)?(?:的)?(?:電郵|郵件)$/)
  if (match) return { resource: match[2] === '我的' ? 'gmail.owner_mail' : 'gmail.admin_mail', operation: 'list', input: { window: match[1] || match[3] === '今天' ? 'today' : match[3] === '未讀' ? 'unread' : 'latest' } }
  match = value.match(/^(?:請|幫我)?查看(我的|行政部)(?:電郵|郵件)原文 ([a-f0-9]{1,100})$/i)
  if (match) return { resource: match[1] === '我的' ? 'gmail.owner_mail' : 'gmail.admin_mail', operation: 'get', input: { messageId: match[2] } }
  match = value.match(/^(?:請|幫我)?搜尋(我的|行政部)(?:電郵|郵件)(主題|寄件者)?[：:]\s*(.+)$/)
  if (!match) return null
  const input = { query: match[3], field: match[2] === '主題' ? 'subject' : match[2] === '寄件者' ? 'from' : 'keyword' }
  try { return { resource: match[1] === '我的' ? 'gmail.owner_mail' : 'gmail.admin_mail', operation: 'search', input: validateGmailRequest('search', input) } } catch (_) { return null }
}
function createGmailContextService ({ gateway, scope }) {
  return Object.freeze({ captureAccess (resource) { const lease = scope.lease(gmailMailbox(resource)); return () => lease.verify() }, async read (actor, resource, operation, input = {}) {
    if (actor?.role !== 'owner') throw Error('permission_denied')
    const mailbox = gmailMailbox(resource), normalized = validateGmailRequest(operation, input), lease = scope.lease(mailbox)
    const pack = await gateway[operation](actor, resource, normalized); lease.verify()
    return { version: 1, mailbox, pack, queryTimeZone: 'America/Winnipeg', modelCalls: 0 }
  } })
}
module.exports = { gmailMailbox, gmailIntent, createGmailContextService }
