'use strict'
const { readAccessEnabled } = require('./flags'), { makeContextResult, ENTITY_TYPES } = require('./contextResult')
const { createGmailReader } = require('./gmailReadOnlyClient'), { calendarWindow } = require('./calendarContext'), { decodeBody } = require('../company/mailBody')
const ID = /^[a-f0-9]{1,100}$/i, EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
function validateGmailRequest (operation, input) {
  if (!['list', 'search', 'get', 'readMetadata'].includes(operation) || !input || typeof input !== 'object' || Array.isArray(input)) throw Error('invalid_request')
  const keys = operation === 'list' ? ['window'] : operation === 'search' ? ['query', 'field'] : operation === 'get' ? ['messageId'] : []
  if (Object.keys(input).some(k => !keys.includes(k))) throw Error('invalid_request')
  if (operation === 'readMetadata') return {}
  if (operation === 'get') { if (typeof input.messageId !== 'string' || !ID.test(input.messageId)) throw Error('invalid_request'); return { messageId: input.messageId } }
  if (operation === 'list') { const window = input.window ?? 'today'; if (!['today', 'unread', 'latest'].includes(window)) throw Error('invalid_request'); return { window } }
  const field = input.field ?? 'keyword'
  if (!['keyword', 'subject', 'from'].includes(field) || typeof input.query !== 'string' || !input.query.trim() || input.query.length > 80 || /[\x00-\x1f\x7f:"\\{}()]/.test(input.query)) throw Error('invalid_request')
  return { query: input.query.trim(), field }
}
function createGmailScope ({ registry, env = process.env, credentials = mailbox => mailbox === 'owner' ? require('./googleAuth').credentialConfiguration() : require('./googleAuth').adminMailCredentialConfiguration() }) {
  function projection (mailbox) {
    if (!['owner', 'admin'].includes(mailbox)) throw Error('invalid_mailbox')
    const snapshot = registry.snapshot({ readOnly: true }), owner = snapshot.users.find(u => u.id === 'owner' && u.role === 'owner'), source = snapshot.sources.find(s => s.id === 'admin-mail')
    return { enabled: readAccessEnabled(env, 'gmail'), credentials: credentials(mailbox), owner: owner ? { email: owner.email, suspended: !!owner.suspended, adminGrant: owner.grants?.includes('admin-mail') === true } : null,
      mailbox, email: mailbox === 'owner' ? owner?.email : source?.mailbox, connected: mailbox === 'owner' || (!!source && ['connected', 'failed'].includes(source.state) && owner?.grants?.includes('admin-mail') === true) }
  }
  const valid = p => p.enabled && p.credentials?.client && p.credentials.token && typeof p.credentials.revision === 'string' && p.owner && !p.owner.suspended && p.connected && typeof p.email === 'string' && EMAIL.test(p.email)
  return Object.freeze({ lease (mailbox) {
    const p = projection(mailbox); if (!valid(p)) throw Error('source_access_unavailable')
    const revision = JSON.stringify(p)
    return { email: p.email.toLowerCase(), verify () { const current = projection(mailbox); if (!valid(current) || JSON.stringify(current) !== revision) throw Error('source_access_changed') } }
  } })
}
function clip (value, bytes) {
  if (value == null) return { value: null, truncated: false }
  if (typeof value !== 'string') throw Error('invalid_source_text')
  if (Buffer.byteLength(value) <= bytes) return { value, truncated: false }
  let buffer = Buffer.from(value).subarray(0, bytes)
  for (let n = 0; n < 4; n++) { try { return { value: new TextDecoder('utf-8', { fatal: true }).decode(buffer), truncated: true } } catch (_) { buffer = buffer.subarray(0, buffer.length - 1) } }
  throw Error('invalid_source_text')
}
function originalDate (value) {
  if (value == null) return null
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value) || !Number.isSafeInteger(Number(value)) || !Number.isFinite(new Date(Number(value)).getTime())) throw Error('invalid_source_date')
  return new Date(Number(value)).toISOString()
}
function createGmailContextAdapter ({ scope, readerFactory = createGmailReader, clock = () => new Date().toISOString() }) {
  async function retrieve (mailbox, operation, input) {
    const normalized = validateGmailRequest(operation, input), lease = scope.lease(mailbox), reader = readerFactory(mailbox)
    const identity = await reader.identity(); lease.verify()
    const ro = 'https://www.googleapis.com/auth/gmail.readonly'
    if (!Array.isArray(identity?.scopes) || !identity.scopes.includes(ro) || identity.scopes.some(s => s === 'https://mail.google.com/' || (s.startsWith('https://www.googleapis.com/auth/gmail.') && !['readonly', 'metadata'].includes(s.split('.').at(-1))))) throw Error('readonly_scope_required')
    const metadata = await reader.metadata(); lease.verify()
    if (typeof metadata?.emailAddress !== 'string' || metadata.emailAddress.toLowerCase() !== lease.email) throw Error('source_identity_mismatch')
    const retrievedAt = clock(), queryScope = { window: 'INBOX', mailbox, timeZone: 'America/Winnipeg', maxRows: 10, excludes: ['spam', 'trash', 'sent_only', 'attachments'], declaredBy: 'adapter' }
    function row (message, full = false) {
      if (!message || typeof message.id !== 'string' || !ID.test(message.id)) throw Error('invalid_source_message')
      const headers = message.payload?.headers
      if (headers !== undefined && !Array.isArray(headers)) throw Error('invalid_source_headers')
      const header = name => { const values = (headers || []).filter(h => typeof h.name === 'string' && h.name.toLowerCase() === name); if (values.length > 1) throw Error('duplicate_source_header'); return clip(values[0]?.value, 1000) }
      const title = header('subject'), from = header('from'), to = header('to'), headerDate = header('date'), decoded = full ? decodeBody(message.payload) : null
      const body = clip(full ? decoded.body : message.snippet, full ? 16000 : 2000)
      const truncated = title.truncated || from.truncated || to.truncated || headerDate.truncated || body.truncated || decoded?.bodyTruncated === true
      return { ...makeContextResult({ source: 'gmail', sourceId: message.id, title: title.value, originalDate: originalDate(message.internalDate), retrievedAt,
        content: body.value || '', entityType: ENTITY_TYPES.MAIL, link: 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(lease.email) + '#all/' + message.id,
        fields: { mailbox, from: from.value, to: to.value, headerDate: headerDate.value, unread: Array.isArray(message.labelIds) ? message.labelIds.includes('UNREAD') : null,
          bodyState: full ? (body.truncated ? 'partial' : decoded.bodyState) : 'not_requested', attachmentsExcluded: full ? decoded.attachmentsExcluded : null,
          originalBodyComplete: full ? decoded.bodyState === 'available' && !truncated && !decoded.attachmentsExcluded : null } }), truncated }
    }
    if (operation === 'readMetadata') return { results: [makeContextResult({ source: 'gmail', sourceId: mailbox + '_profile', title: lease.email, retrievedAt, originalDate: null, content: '', entityType: ENTITY_TYPES.MAIL,
      fields: { mailbox, messagesTotal: Number.isInteger(metadata.messagesTotal) && metadata.messagesTotal >= 0 ? metadata.messagesTotal : null, threadsTotal: Number.isInteger(metadata.threadsTotal) && metadata.threadsTotal >= 0 ? metadata.threadsTotal : null, scope: 'gmail.readonly' } })], evidence: { completeWithinScope: true, queryScope: { ...queryScope, window: mailbox + ' mailbox metadata' } } }
    if (operation === 'get') {
      const message = await reader.getMessage(normalized.messageId, true); lease.verify()
      if (message?.id !== normalized.messageId) throw Error('source_message_mismatch')
      const item = row(message, true)
      return { results: [item], evidence: { completeWithinScope: item.fields.originalBodyComplete, sourceTotal: 1, queryScope: { ...queryScope, window: mailbox + ' message ' + normalized.messageId, excludes: ['attachments'] }, provenance: 'Gmail messages.get' } }
    }
    let q = '', range = null
    if (operation === 'search') q = (normalized.field === 'keyword' ? '' : normalized.field + ':') + '"' + normalized.query + '"'
    else if (normalized.window === 'unread') q = 'is:unread'
    else if (normalized.window === 'today') { range = calendarWindow('today', retrievedAt); q = 'after:' + (Math.floor(Date.parse(range.start) / 1000) - 1) + ' before:' + Math.floor(Date.parse(range.end) / 1000) }
    const data = await reader.listMessages({ q }); lease.verify()
    const ids = Array.isArray(data?.messages) ? data.messages : data?.resultSizeEstimate === 0 && !data?.nextPageToken ? [] : null
    if (!ids || ids.length > 10 || ids.some(m => typeof m?.id !== 'string' || !ID.test(m.id)) || new Set(ids.map(m => m.id)).size !== ids.length || (ids.length === 0 && data.resultSizeEstimate > 0)) throw Error('invalid_source_page')
    if (data.nextPageToken != null && (typeof data.nextPageToken !== 'string' || !data.nextPageToken || data.nextPageToken.length > 4000)) throw Error('invalid_source_page')
    const rows = []
    // Two bounded waves; the reader deadline covers all requests, including token refresh.
    for (let i = 0; i < ids.length; i += 5) {
      const batch = await Promise.all(ids.slice(i, i + 5).map(async ({ id }) => {
        const message = await reader.getMessage(id, false); lease.verify()
        if (message?.id !== id || !Array.isArray(message.labelIds) || !message.labelIds.includes('INBOX') || (normalized.window === 'unread' && !message.labelIds.includes('UNREAD'))) throw Error('source_selection_changed')
        const item = row(message)
        if (range && (!item.originalDate || Date.parse(item.originalDate) < Date.parse(range.start) || Date.parse(item.originalDate) >= Date.parse(range.end))) throw Error('source_selection_changed')
        return item
      })); rows.push(...batch)
    }
    lease.verify()
    return { results: rows, evidence: { completeWithinScope: !data.nextPageToken, truncated: !!data.nextPageToken, sourceTotal: null, returnedRows: rows.length,
      queryScope: { ...queryScope, window: range ? range.start + '..' + range.end : normalized.window === 'unread' ? 'INBOX unread' : operation === 'search' ? 'INBOX literal ' + normalized.field + ' search' : 'INBOX bounded list', range,
        resultSizeEstimate: Number.isInteger(data.resultSizeEstimate) && data.resultSizeEstimate >= 0 ? data.resultSizeEstimate : null },
      provenance: 'Gmail messages.list + messages.get metadata', selection: 'bounded_provider_pages', rankingCompleteWithinScope: null } }
  }
  const methods = {}, rowLimits = {}
  for (const mailbox of ['owner', 'admin']) for (const [op, prefix] of [['list', 'list'], ['search', 'search'], ['get', 'get'], ['readMetadata', 'read']]) {
    const method = prefix + (mailbox === 'owner' ? 'Owner' : 'Admin') + 'Mail' + (op === 'readMetadata' ? 'Metadata' : '')
    methods[method] = input => retrieve(mailbox, op, input); rowLimits[method] = op === 'get' || op === 'readMetadata' ? 1 : 10
  }
  return Object.freeze({ source: 'gmail', methods: Object.freeze(methods), rowLimits: Object.freeze(rowLimits), readTimeoutMs: 35000 })
}
function gmailResources () {
  return ['owner', 'admin'].map(mailbox => ({ id: 'gmail.' + mailbox + '_mail', source: 'gmail', scope: mailbox + '_mailbox', sensitivity: mailbox === 'owner' ? 'private' : 'company', layer: 'truth',
    validateRow: row => row.fields?.mailbox === mailbox,
    operations: Object.fromEntries([['list', 'list'], ['search', 'search'], ['get', 'get'], ['readMetadata', 'read']].map(([op, prefix]) => [op, {
      method: prefix + (mailbox === 'owner' ? 'Owner' : 'Admin') + 'Mail' + (op === 'readMetadata' ? 'Metadata' : ''), params: input => validateGmailRequest(op, input) }])) }))
}
module.exports = { validateGmailRequest, createGmailScope, createGmailContextAdapter, gmailResources }
