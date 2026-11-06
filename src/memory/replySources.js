'use strict'
// Presentation pointers only. These receipts prove which canonical rows were
// loaded, not that model prose is correct. Follow-ups always re-read the gateway.
const ID = /^xx-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const MARKER = /\[memory:(xx-[a-f0-9-]{36})\]/g
const keysAre = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === keys.slice().sort().join()
function validItem (item) {
  return keysAre(item, ['documentId', 'date', 'version', 'scope']) && ID.test(item.documentId) && item.scope === 'private:owner' &&
    (item.date === null || (typeof item.date === 'string' && item.date.length <= 40 && Number.isFinite(Date.parse(item.date)))) &&
    (item.version === null || (Number.isSafeInteger(item.version) && item.version > 0))
}
function validReceipt (value) {
  return keysAre(value, ['kind', 'claimsVerified', 'items']) && value.kind === 'memory_references_v1' && value.claimsVerified === false &&
    Array.isArray(value.items) && value.items.length > 0 && value.items.length <= 12 && value.items.every(validItem) &&
    new Set(value.items.map(r => r.documentId)).size === value.items.length
}
function present (reply, rows) {
  const unchanged = { reply, memorySources: null }
  if (typeof reply !== 'string' || !Array.isArray(rows)) return unchanged
  const available = new Map(), conflicts = new Set()
  for (const row of rows) {
    if (row?.source !== 'memory_gateway' || row.status !== 'active' || row.scope !== 'private:owner') continue
    const item = { documentId: row.documentId, date: row.date ?? null, version: row.version ?? null, scope: row.scope }
    if (!validItem(item)) continue
    if (available.has(item.documentId) && JSON.stringify(available.get(item.documentId)) !== JSON.stringify(item)) conflicts.add(item.documentId)
    available.set(item.documentId, item)
  }
  const used = new Map()
  const text = reply.replace(MARKER, (marker, id) => {
    if (!available.has(id) || conflicts.has(id) || (!used.has(id) && used.size >= 12)) return marker
    used.set(id, available.get(id)); return ''
  })
  if (!used.size || !text.trim()) return unchanged
  return { reply: text, memorySources: { kind: 'memory_references_v1', claimsVerified: false, items: [...used.values()] } }
}
function savedReferences (conversation) {
  return [...new Set((Array.isArray(conversation?.messages) ? conversation.messages : []).slice(-4)
    .filter(row => row?.role === 'assistant' && !require('./capturePolicy').exclusionReason(typeof row.text === 'string' ? row.text : row.content || '') && validReceipt(row.memorySources))
    .flatMap(row => row.memorySources.items.map(item => item.documentId)))].slice(0, 4)
}
module.exports = { present, validReceipt, savedReferences, ID }
