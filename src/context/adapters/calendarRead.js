'use strict'

/**
 * calendarRead.js — READ-ONLY Google Calendar adapter (scope calendar.readonly).
 * Only list/get read methods; NO insert/update/delete/move surface. The authed
 * `calendar` service is injected (fake in tests). Fails-closed to 'unavailable'
 * when the service is absent.
 */

const { makeContextResult, ENTITY_TYPES } = require('../contextResult')

function createCalendarReadAdapter (options = {}) {
  const now = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()
  const calendar = options.client || null
  function ensure () { if (!calendar) throw new Error('calendar service unavailable (no google credentials)'); return calendar }
  const startOf = (e) => (e && e.start && (e.start.dateTime || e.start.date)) || null

  const methods = {
    async listEvents ({ calendarId = 'primary', timeMin, timeMax, maxResults = 25 } = {}) {
      const r = await ensure().events.list({ calendarId, timeMin, timeMax, maxResults, singleEvents: true, orderBy: 'startTime' })
      return ((r.data && r.data.items) || []).map((e) => makeContextResult({ source: 'calendar', sourceId: e.id, title: e.summary || null, originalDate: startOf(e), content: e.description || '', link: e.htmlLink, retrievedAt: now(), entityType: ENTITY_TYPES.EVENT, fields: { summary: e.summary || null, start: startOf(e), location: (e.location || null) } }))
    },
    async getEvent ({ calendarId = 'primary', eventId } = {}) {
      const r = await ensure().events.get({ calendarId, eventId })
      const e = r.data
      return makeContextResult({ source: 'calendar', sourceId: e.id, title: e.summary || null, originalDate: startOf(e), content: e.description || '', link: e.htmlLink, retrievedAt: now(), entityType: ENTITY_TYPES.EVENT, fields: { summary: e.summary || null, start: startOf(e), location: (e.location || null) } })
    }
  }

  return { source: 'calendar', methods, ready: () => !!calendar }
}

module.exports = { createCalendarReadAdapter }
