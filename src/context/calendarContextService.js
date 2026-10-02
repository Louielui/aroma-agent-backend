'use strict'
const { validateCalendarRequest } = require('./calendarContext')
function calendarIntent (message) {
  if (typeof message !== 'string') return null
  const value = message.trim().replace(/[。！!？?]+$/, '').trim().replace(/^香香[，,\s]*/, '')
  if (/^(?:(?:請|幫我)?(?:查看|列出|查詢)今天(?:的)?行程|今天有什麼行程|今日有咩行程)$/.test(value) || /^show today(?:'s)? calendar$/i.test(value)) return { operation: 'list', input: { window: 'today' } }
  if (/^(?:(?:請|幫我)?(?:查看|列出|查詢)本週(?:的)?行程|本週有哪些(?:會議和截止事項|行程)|這星期有什麼行程)$/.test(value) || /^show this week(?:'s)? calendar$/i.test(value)) return { operation: 'list', input: { window: 'this_week' } }
  const match = value.match(/^(?:請|幫我)?查看活動 ([A-Za-z0-9_-]{1,256}) 詳情$/)
  return match ? { operation: 'get', input: { eventId: match[1] } } : null
}
function createCalendarContextService ({ gateway, scope }) {
  const verify = () => scope.lease().verify()
  return Object.freeze({ verify, captureAccess: () => { const lease = scope.lease(); return () => lease.verify() }, async read (actor, operation, input = {}) {
    if (actor?.role !== 'owner') throw Error('permission_denied')
    const normalized = validateCalendarRequest(operation, input), lease = scope.lease()
    const pack = await gateway[operation](actor, 'calendar.owner_events', normalized); lease.verify()
    return { version: 1, pack, queryTimeZone: 'America/Winnipeg', modelCalls: 0 }
  } })
}
module.exports = { calendarIntent, createCalendarContextService }
