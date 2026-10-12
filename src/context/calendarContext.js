'use strict'
const { readAccessEnabled } = require('./flags')
const { makeContextResult, ENTITY_TYPES } = require('./contextResult')
const { createOwnerCalendarReader } = require('./calendarReadOnlyClient')
const TIME_ZONE = 'America/Winnipeg', ID = /^[A-Za-z0-9_-]{1,256}$/
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
function calendarWindow (label, now) {
  if (!['today', 'this_week'].includes(label) || !Number.isFinite(Date.parse(now))) throw Error('invalid_request')
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const parts = time => Object.fromEntries(formatter.formatToParts(new Date(time)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]))
  const local = parts(now)
  let civil = Date.UTC(local.year, local.month - 1, local.day)
  if (label === 'this_week') civil -= ((new Date(civil).getUTCDay() + 6) % 7) * 86400000
  function midnight (civilTime) {
    let candidate = civilTime
    for (let i = 0; i < 4; i++) {
      const p = parts(candidate), rendered = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
      const delta = civilTime - rendered
      if (delta === 0) return new Date(candidate).toISOString()
      candidate += delta
    }
    throw Error('timezone_boundary_unavailable')
  }
  return { start: midnight(civil), end: midnight(civil + (label === 'this_week' ? 7 : 1) * 86400000), timeZone: TIME_ZONE, label }
}
function validateCalendarRequest (operation, input) {
  if (!['list', 'search', 'get', 'readMetadata'].includes(operation) || !input || typeof input !== 'object' || Array.isArray(input)) throw Error('invalid_request')
  const keys = operation === 'search' ? ['window', 'query'] : operation === 'list' ? ['window'] : operation === 'get' ? ['eventId'] : []
  if (Object.keys(input).some(k => !keys.includes(k))) throw Error('invalid_request')
  if (operation === 'get') {
    if (typeof input.eventId !== 'string' || !ID.test(input.eventId)) throw Error('invalid_request')
    return { eventId: input.eventId }
  }
  if (operation === 'readMetadata') return {}
  const window = input.window === undefined ? 'today' : input.window
  if (!['today', 'this_week'].includes(window)) throw Error('invalid_request')
  if (operation === 'search') {
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 80 || /[\x00-\x1f\x7f]/.test(input.query)) throw Error('invalid_request')
    return { window, query: input.query.trim() }
  }
  return { window }
}
function createOwnerCalendarScope ({ registry, env = process.env, credentials = require('./googleAuth').credentialConfiguration }) {
  function projection () {
    const owner = registry.snapshot({ readOnly: true }).users.find(u => u.id === 'owner' && u.role === 'owner')
    return { owner: owner ? { email: owner.email, suspended: owner.suspended } : null, enabled: readAccessEnabled(env, 'calendar'), credentials: credentials() }
  }
  function valid (p) { return p.enabled && p.credentials?.client && p.credentials.token && typeof p.credentials.revision === 'string' && !p.owner?.suspended && typeof p.owner?.email === 'string' && p.owner.email.includes('@') }
  return Object.freeze({ lease () {
    const p = projection(); if (!valid(p)) throw Error('source_access_unavailable')
    const revision = JSON.stringify(p)
    return { ownerEmail: p.owner.email.toLowerCase(), verify () {
      const current = projection(); if (!valid(current) || JSON.stringify(current) !== revision) throw Error('source_access_changed')
    } }
  } })
}
function dateValue (value) {
  if (value == null) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || !/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) throw Error('invalid_source_date')
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== value.slice(0, 10)) throw Error('invalid_source_date')
  return value
}
function sourceLink (value) {
  if (!value) return null
  try { const u = new URL(value); if (u.protocol === 'https:' && !u.username && !u.password && ['www.google.com', 'google.com', 'calendar.google.com'].includes(u.hostname) && /^\/(?:calendar\/)?event$/.test(u.pathname)) return u.href } catch (_) {}
  throw Error('invalid_source_link')
}
function createCalendarContextAdapter ({ scope, readerFactory = createOwnerCalendarReader, clock = () => new Date().toISOString() }) {
  async function retrieve (operation, input) {
    const normalized = validateCalendarRequest(operation, input), lease = scope.lease(), reader = readerFactory()
    const identity = await reader.identity(); lease.verify()
    if (!Array.isArray(identity?.scopes) || !identity.scopes.includes(CALENDAR_SCOPE) || identity.scopes.some(s => /^https:\/\/www\.googleapis\.com\/auth\/calendar(?:\.|$)/.test(s) && !s.endsWith('.readonly'))) throw Error('readonly_scope_required')
    const metadata = await reader.metadata(); lease.verify()
    if (typeof metadata?.id !== 'string' || metadata.id.toLowerCase() !== lease.ownerEmail) throw Error('source_identity_mismatch')
    const retrievedAt = clock()
    const text = (value, bytes) => {
      if (value == null) return { value: null, truncated: false }
      if (typeof value !== 'string') throw Error('invalid_source_text')
      if (Buffer.byteLength(value, 'utf8') <= bytes) return { value, truncated: false }
      let clipped = Buffer.from(value).subarray(0, bytes)
      while (clipped.length) { try { return { value: new TextDecoder('utf-8', { fatal: true }).decode(clipped), truncated: true } } catch (_) { clipped = clipped.subarray(0, clipped.length - 1) } }
      return { value: '', truncated: true }
    }
    const row = event => {
      if (!event || !ID.test(event.id || '')) throw Error('invalid_source_event')
      const title = text(event.summary, 1000), description = text(event.description, 16000), location = text(event.location, 2000)
      const start = dateValue(event.start?.dateTime || event.start?.date), end = dateValue(event.end?.dateTime || event.end?.date)
      return { ...makeContextResult({ source: 'calendar', sourceId: event.id, title: title.value, originalDate: dateValue(event.updated), retrievedAt,
        content: description.value || '', link: sourceLink(event.htmlLink), entityType: ENTITY_TYPES.EVENT,
        truncated: title.truncated || description.truncated || location.truncated,
        fields: { start, end, allDay: event.start?.date ? true : event.start?.dateTime ? false : null,
          endExclusive: true, status: typeof event.status === 'string' ? event.status : null, location: location.value,
          created: dateValue(event.created), updated: dateValue(event.updated), timeZone: event.start?.timeZone || metadata.timeZone || null,
          recurringEventId: event.recurringEventId || null, originalStart: dateValue(event.originalStartTime?.dateTime || event.originalStartTime?.date) } }), truncated: title.truncated || description.truncated || location.truncated }
    }
    if (operation === 'readMetadata') return { results: [makeContextResult({ source: 'calendar', sourceId: 'primary', title: text(metadata.summary, 1000).value,
      originalDate: null, retrievedAt, content: '', entityType: ENTITY_TYPES.EVENT, fields: { timeZone: metadata.timeZone || null, queryTimeZone: TIME_ZONE, calendar: 'primary', scope: 'calendar.readonly', maxRows: 100 } })],
      evidence: { completeWithinScope: true, queryScope: { window: 'primary calendar metadata', timeZone: TIME_ZONE }, revision: metadata.etag || null } }
    if (operation === 'get') {
      const event = await reader.getEvent(normalized.eventId); lease.verify()
      if (event?.id !== normalized.eventId) throw Error('source_event_mismatch')
      return { results: [row(event)], evidence: { completeWithinScope: true, queryScope: { window: 'primary event ' + normalized.eventId, timeZone: TIME_ZONE }, sourceTotal: 1 } }
    }
    const window = calendarWindow(normalized.window, retrievedAt), rows = [], ids = new Set(), tokens = new Set()
    let pageToken, complete = null, truncated = false, dataAsOf = null
    for (let page = 0; page < 2; page++) {
      const data = await reader.listEvents({ timeMin: window.start, timeMax: window.end, ...(normalized.query ? { q: normalized.query } : {}), ...(pageToken ? { pageToken } : {}) }); lease.verify()
      if (!data || !Array.isArray(data.items) || data.items.length > 50) throw Error('invalid_source_page')
      for (const event of data.items) {
        if (event.status === 'cancelled') throw Error('unexpected_deleted_event')
        if (ids.has(event.id)) throw Error('duplicate_source_event')
        ids.add(event.id); rows.push(row(event))
      }
      dataAsOf = dateValue(data.updated)
      if (!data.nextPageToken) { complete = typeof data.nextSyncToken === 'string' && !!data.nextSyncToken ? true : null; break }
      if (typeof data.nextPageToken !== 'string' || data.nextPageToken.length > 4000 || tokens.has(data.nextPageToken)) throw Error('invalid_source_page_token')
      tokens.add(data.nextPageToken); pageToken = data.nextPageToken; complete = false; truncated = true
      if (page === 0) truncated = false
    }
    lease.verify()
    return { results: rows, evidence: { completeWithinScope: complete, truncated, sourceTotal: null, returnedRows: rows.length, dataAsOf,
      queryScope: { window: window.start + '..' + window.end, range: { start: window.start, end: window.end }, timeZone: TIME_ZONE,
        calendarId: 'primary', declaredBy: 'adapter', selection: 'events_overlapping_window', label: normalized.window, searchApplied: operation === 'search' },
      provenance: 'Google Calendar events.list', selection: operation === 'search' ? 'bounded_provider_search' : 'bounded_live_pages' } }
  }
  const methods = Object.freeze({ listCalendarEvents: input => retrieve('list', input), searchCalendarEvents: input => retrieve('search', input),
    getCalendarEvent: input => retrieve('get', input), readCalendarMetadata: input => retrieve('readMetadata', input) })
  return Object.freeze({ source: 'calendar', methods, readTimeoutMs: 35000, rowLimits: Object.freeze({ listCalendarEvents: 100, searchCalendarEvents: 100, getCalendarEvent: 1, readCalendarMetadata: 1 }) })
}
function calendarResources () {
  return [{ id: 'calendar.owner_events', source: 'calendar', scope: 'owner_primary', sensitivity: 'private', layer: 'truth',
    operations: { list: { method: 'listCalendarEvents', params: input => validateCalendarRequest('list', input) }, search: { method: 'searchCalendarEvents', params: input => validateCalendarRequest('search', input) },
      get: { method: 'getCalendarEvent', params: input => validateCalendarRequest('get', input) }, readMetadata: { method: 'readCalendarMetadata', params: input => validateCalendarRequest('readMetadata', input) } } }]
}
module.exports = { calendarWindow, validateCalendarRequest, createOwnerCalendarScope, createCalendarContextAdapter, calendarResources }
