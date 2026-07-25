'use strict'

/**
 * gmailRead.js — READ-ONLY Gmail adapter (scope gmail.readonly). Only search/get
 * read methods; NO send/reply/forward/modify/label/delete/trash surface. The authed
 * `gmail` service is injected (fake in tests). Messages are fetched with
 * format:'metadata' + snippet so no body/attachment is pulled and content stays
 * bounded. Fails-closed to 'unavailable' when the service is absent.
 */

const { makeContextResult } = require('../contextResult')

function createGmailReadAdapter (options = {}) {
  const now = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()
  const gmail = options.client || null
  function ensure () { if (!gmail) throw new Error('gmail service unavailable (no google credentials)'); return gmail }
  const header = (m, name) => {
    const h = (m && m.payload && m.payload.headers) || []
    const f = h.find((x) => x.name === name)
    return f ? f.value : null
  }
  const linkFor = (id) => `https://mail.google.com/mail/u/0/#all/${id}`

  const methods = {
    async searchMessages ({ q, maxResults = 25 } = {}) {
      const r = await ensure().users.messages.list({ userId: 'me', q, maxResults })
      return ((r.data && r.data.messages) || []).map((m) => makeContextResult({ source: 'gmail', sourceId: m.id, title: null, content: '', link: linkFor(m.id), retrievedAt: now() }))
    },
    async getMessage ({ id } = {}) {
      const r = await ensure().users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] })
      const m = r.data
      return makeContextResult({ source: 'gmail', sourceId: m.id, title: header(m, 'Subject'), originalDate: header(m, 'Date'), content: m.snippet || '', link: linkFor(m.id), retrievedAt: now() })
    },
    async getThread ({ id } = {}) {
      const r = await ensure().users.threads.get({ userId: 'me', id, format: 'metadata' })
      const t = r.data
      const count = (t.messages || []).length
      return makeContextResult({ source: 'gmail', sourceId: t.id, title: null, content: `${count} message(s) in thread`, link: linkFor(t.id), retrievedAt: now() })
    }
  }

  return { source: 'gmail', methods, ready: () => !!gmail }
}

module.exports = { createGmailReadAdapter }
