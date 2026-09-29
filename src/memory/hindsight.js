'use strict'
const { fencedFetch } = require('../adapters/liveEgressFence')
const { checkRedLine } = require('../intake/redlinePolicy')
const ID = /^xx-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
function validText (s) {
  return typeof s === 'string' && s.trim().length > 1 && s.length <= 2000 && !checkRedLine(s).blocked && !/(?:password|secret|api[_ -]?key|access[_ -]?token)\s*[:=]/i.test(s)
}
function createHindsight ({ env = process.env, transport = fencedFetch('hindsight') } = {}) {
  function config () {
    if (env.XIANGXIANG_MEMORY !== 'on') throw Error('memory_disabled')
    let u; try { u = new URL(env.HINDSIGHT_URL) } catch (_) { throw Error('memory_not_configured') }
    if (u.origin !== 'http://127.0.0.1:8888' || u.pathname !== '/' || u.search || u.hash || u.username || u.password ||
        !/^xiangxiang-(?:owner|test-[a-z0-9-]+)$/.test(env.HINDSIGHT_BANK || '') || !env.HINDSIGHT_TOKEN) throw Error('memory_not_configured')
    return { url: u.origin + '/v1/default/banks/' + env.HINDSIGHT_BANK, bank: env.HINDSIGHT_BANK }
  }
  async function call (path, method = 'GET', body, timeout = 5000, absent = false) {
    const c = config()
    try {
      const res = await transport(c.url + path, { method, redirect: 'error', signal: AbortSignal.timeout(timeout),
        headers: { authorization: 'Bearer ' + env.HINDSIGHT_TOKEN, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
      if (res.status === 404 && absent) return null
      if (!res.ok) throw Error('memory_unavailable')
      const raw = await res.text(); if (raw.length > 1000000) throw Error('memory_invalid_result')
      return JSON.parse(raw)
    } catch (_) { throw Error('memory_unavailable') }
  }
  function docId (id) { if (!ID.test(id || '')) throw Error('memory_invalid_id'); return id }
  async function get (id) {
    const c = config(); const d = await call('/documents/' + docId(id), 'GET', undefined, 5000, true)
    if (!d) return null
    if (d.id !== id || d.bank_id !== c.bank || typeof d.original_text !== 'string' || !Number.isInteger(d.memory_unit_count)) throw Error('memory_invalid_result')
    return { id, text: d.original_text, facts: d.memory_unit_count, createdAt: d.created_at || null, updatedAt: d.updated_at || null }
  }
  return {
    engine: 'hindsight', get,
    async list () {
      const d = await call('/documents?limit=50&offset=0')
      if (!Array.isArray(d.items) || !Number.isInteger(d.total)) throw Error('memory_invalid_result')
      const rows = await Promise.all(d.items.filter(r => ID.test(r.id)).map(r => get(r.id)))
      if (rows.some(r => !r)) throw Error('memory_changed_retry')
      return { items: rows, total: d.total, limit: 50 }
    },
    async retain (id, text) {
      docId(id); if (!validText(text)) throw Error('memory_invalid_text')
      const c = config()
      const r = await call('/memories', 'POST', { async: false, items: [{ document_id: id, content: text,
        context: 'Explicit owner-authored memory; advisory, not approval or current business evidence.', timestamp: 'unset', tags: ['owner-explicit'] }] }, 120000)
      if (r.success !== true || r.async !== false || r.bank_id !== c.bank || r.items_count !== 1) throw Error('memory_unconfirmed')
      const doc = await get(id)
      if (!doc || doc.text !== text || doc.facts < 1) throw Error('memory_unconfirmed')
      return doc
    },
    async forget (id) {
      const r = await call('/documents/' + docId(id), 'DELETE', undefined, 30000)
      if (r.success !== true || await get(id) !== null) throw Error('memory_unconfirmed')
      return { id, state: 'deleted' }
    },
    async recall (query) {
      if (!validText(query)) throw Error('memory_invalid_text')
      const r = await call('/memories/recall', 'POST', { query, budget: 'low', max_tokens: 800, types: ['world', 'experience'], tags: ['owner-explicit'], tags_match: 'all_strict' }, 6000)
      if (!Array.isArray(r.results)) throw Error('memory_invalid_result')
      return r.results.slice(0, 5).map(row => {
        if (typeof row.id !== 'string' || typeof row.text !== 'string' || !ID.test(row.document_id || '')) throw Error('memory_invalid_result')
        return { id: row.id, documentId: row.document_id, text: row.text.slice(0, 600), date: row.mentioned_at || null, source: 'hindsight' }
      })
    }
  }
}
module.exports = { createHindsight, validText, ID }
