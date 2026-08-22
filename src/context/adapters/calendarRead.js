'use strict'

/**
 * calendarRead.js — READ-ONLY Google Calendar adapter (scope calendar.readonly).
 * Only list/get read methods; NO insert/update/delete/move surface. The authed
 * `calendar` service is injected (fake in tests). Fails-closed to 'unavailable'
 * when the service is absent.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ X4.3 — THIS ADAPTER NOW SAYS WHAT ITS READ WAS.
 *
 * Production ad10ec74: it returned 2 events for a 14-day window under a cap of 10 and described
 * none of that. Because it handed back a bare array, `describeRead` filled in its default shape
 * — window null, limit null, truncated null, retrieval completeness `unknown` — and the SCOPE
 * line then printed CONTEXT completeness as a bare 「complete」 beside 「total unknown」. The model
 * was told two opposite things at once and reflected both back: an absence claim in the lead and
 * 「無法確認清單是否涵蓋全部內容」 in the limitations.
 *
 * `readConnector` has always accepted `{ results, evidence }` from an adapter that wants to
 * describe its own read — `aromaSystemRead` uses it. This one now does too.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { makeContextResult, ENTITY_TYPES } = require('../contextResult')

/**
 * ⛔ THE PAGINATION CONTRACT, STATED RATHER THAN GUESSED.
 *
 * Google returns `nextPageToken` when, and only when, further pages exist for the query. So:
 *
 *   token present                    → more rows exist            → NOT complete
 *   token absent, returned < cap     → the page was the last one  → complete for this window
 *   token absent, returned >= cap    → UNKNOWN, and refused
 *
 * ⛔ THE THIRD CASE IS THE ONE THAT MATTERS. A full page with no token is the shape a silently
 * dropped field produces, and it is indistinguishable from a genuine exact fit. Calling it
 * complete would be inferring completeness from `returnedRows < maxResults` — arithmetic
 * dressed as evidence — so it fails closed instead.
 *
 * ⛔ AND THE RESPONSE MUST ACTUALLY CARRY THE FIELD. If `nextPageToken` is not observable on the
 * response object at all, token ABSENCE proves nothing, and everything is unknown.
 */
function completenessOf (data, returnedRows, cap) {
  const has = data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'nextPageToken')
  const token = has ? data.nextPageToken : undefined
  if (token) return { truncated: true, completeWithinScope: false, retrievalCompleteness: 'incomplete' }
  if (!has) return { truncated: null, completeWithinScope: null, retrievalCompleteness: 'unknown' }
  if (Number.isFinite(cap) && returnedRows >= cap) {
    return { truncated: null, completeWithinScope: null, retrievalCompleteness: 'unknown' }
  }
  return { truncated: false, completeWithinScope: true, retrievalCompleteness: 'complete' }
}

function createCalendarReadAdapter (options = {}) {
  const now = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()
  const calendar = options.client || null
  function ensure () { if (!calendar) throw new Error('calendar service unavailable (no google credentials)'); return calendar }
  const startOf = (e) => (e && e.start && (e.start.dateTime || e.start.date)) || null
  const toRow = (e, retrievedAt) => makeContextResult({ source: 'calendar', sourceId: e.id, title: e.summary || null, originalDate: startOf(e), content: e.description || '', link: e.htmlLink, retrievedAt, entityType: ENTITY_TYPES.EVENT, fields: { summary: e.summary || null, start: startOf(e), location: (e.location || null) } })

  const methods = {
    async listEvents ({ calendarId = 'primary', timeMin, timeMax, maxResults = 25 } = {}) {
      const r = await ensure().events.list({ calendarId, timeMin, timeMax, maxResults, singleEvents: true, orderBy: 'startTime' })
      const data = (r && r.data) || {}
      const items = data.items || []
      const retrievedAt = now()
      const c = completenessOf(data, items.length, maxResults)
      return {
        results: items.map((e) => toRow(e, retrievedAt)),
        /**
         * ⛔ THE WINDOW IS ECHOED FROM WHAT WAS ACTUALLY SENT, not recomputed. `range` carries
         * the machine-comparable boundaries the negative-existence gate needs; `window` is the
         * same fact as the human/model-facing string the SCOPE line already knows how to print.
         *
         * ⛔ AND `sourceTotal` STAYS null ON PURPOSE. Completeness WITHIN a bounded window and
         * the size of the whole calendar are different questions; answering the second is not
         * required to answer the first, and pretending to know it would be the original defect
         * in a new place.
         */
        evidence: {
          source: 'calendar',
          entityType: ENTITY_TYPES.EVENT,
          endpoint: 'calendar.events.list',
          returnedRows: items.length,
          shownCount: items.length,
          matchingTotal: c.completeWithinScope === true ? items.length : null,
          sourceTotal: null,
          queryScope: {
            field: 'start',
            window: (timeMin && timeMax) ? `${timeMin}..${timeMax}` : (timeMin ? `${timeMin}..(unbounded)` : null),
            range: (timeMin && timeMax) ? { start: timeMin, end: timeMax } : null,
            calendarId,
            declaredBy: 'adapter'
          },
          filtersApplied: ['singleEvents', 'orderBy=startTime'],
          limit: Number.isFinite(maxResults) ? maxResults : null,
          limitKnown: Number.isFinite(maxResults),
          truncated: c.truncated,
          completeWithinScope: c.completeWithinScope,
          completeness: c.retrievalCompleteness,
          rowShape: { hasLocation: true, hasAsOf: false, note: null },
          metrics: {},
          rankedBy: 'startTime',
          dataAsOf: null,
          retrievedAt,
          trust: 'live',
          provenance: 'calendar'
        }
      }
    },
    async getEvent ({ calendarId = 'primary', eventId } = {}) {
      const r = await ensure().events.get({ calendarId, eventId })
      const e = r.data
      return makeContextResult({ source: 'calendar', sourceId: e.id, title: e.summary || null, originalDate: startOf(e), content: e.description || '', link: e.htmlLink, retrievedAt: now(), entityType: ENTITY_TYPES.EVENT, fields: { summary: e.summary || null, start: startOf(e), location: (e.location || null) } })
    }
  }

  return { source: 'calendar', methods, ready: () => !!calendar }
}

module.exports = { createCalendarReadAdapter, completenessOf }
