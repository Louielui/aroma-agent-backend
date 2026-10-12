'use strict'
const auth = require('./googleAuth')
const EVENT_FIELDS = 'id,summary,description,start,end,location,htmlLink,status,created,updated,recurringEventId,originalStartTime,eventType'
function createOwnerCalendarReader ({ oauthFactory = auth.createOAuthClient, serviceFactory = auth.serviceWithOAuth } = {}) {
  const oauth = oauthFactory()
  Object.assign(oauth.transporter.defaults, { timeout: 8000, retry: false })
  const client = serviceFactory('calendar', 'v3', oauth)
  const signal = AbortSignal.timeout(30000)
  const options = () => ({ timeout: 8000, retry: false, maxRedirects: 0, maxContentLength: 1024 * 1024, signal })
  return Object.freeze({
    async identity () {
      const token = await oauth.getAccessToken()
      if (!token?.token) throw Error('identity_unavailable')
      const info = await oauth.getTokenInfo(token.token)
      return { scopes: Array.isArray(info.scopes) ? info.scopes : null }
    },
    async metadata () { return (await client.calendars.get({ calendarId: 'primary', fields: 'id,summary,timeZone,etag' }, options())).data },
    async listEvents ({ timeMin, timeMax, q, pageToken }) {
      return (await client.events.list({ calendarId: 'primary', timeMin, timeMax, timeZone: 'America/Winnipeg',
        maxResults: 50, singleEvents: true, orderBy: 'startTime', showDeleted: false,
        fields: 'items(' + EVENT_FIELDS + '),nextPageToken,nextSyncToken,timeZone,updated,etag',
        ...(q ? { q } : {}), ...(pageToken ? { pageToken } : {}) }, options())).data
    },
    async getEvent (eventId) { return (await client.events.get({ calendarId: 'primary', eventId, fields: EVENT_FIELDS }, options())).data }
  })
}
module.exports = { createOwnerCalendarReader, EVENT_FIELDS }
