'use strict'
// Decode only inline MIME text. No attachment fetches, HTML rendering or URL loads.
function decodeBody (payload) {
  let visited = 0; let truncated = false; let excluded = false; let unsupported = false
  function walk (part, depth = 0) {
    if (!part) return ''
    if (++visited > 100 || depth > 12) { truncated = true; return '' }
    if (part.filename || /attachment/i.test((part.headers || []).find(h => h.name?.toLowerCase() === 'content-disposition')?.value || '')) { excluded = true; return '' }
    if (part.mimeType?.startsWith('multipart/')) {
      const children = part.parts || []
      if (part.mimeType === 'multipart/alternative') {
        const chosen = children.find(p => p.mimeType === 'text/plain' && p.body?.data) || children.find(p => p.mimeType === 'text/html' && p.body?.data) || children[0]
        return walk(chosen, depth + 1)
      }
      return children.map(p => walk(p, depth + 1)).filter(Boolean).join('\n')
    }
    if (!['text/plain', 'text/html'].includes(part.mimeType)) { unsupported = true; return '' }
    if (!part.body?.data) { if (part.body?.attachmentId) excluded = true; return '' }
    const encoded = part.body.data
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9_\-\s=]*$/.test(encoded)) { unsupported = true; return '' }
    if (encoded.length > 262144) truncated = true
    const contentType = (part.headers || []).find(h => h.name?.toLowerCase() === 'content-type')?.value || ''
    const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1] || 'utf-8'
    let value
    try { value = new TextDecoder(charset, { fatal: true }).decode(Buffer.from(encoded.slice(0, 262144), 'base64url')) }
    catch (_) { unsupported = true; return '' }
    if (part.mimeType === 'text/html') {
      value = value.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<!--[^]*?-->/g, '').replace(/<\/?(?:p|div|br|li|tr|h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
        .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const v = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : '' })
        .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[n])
    }
    return value.replace(/\r\n/g, '\n').trim()
  }
  const body = walk(payload)
  return { body: body.slice(0, 48000), bodyTruncated: truncated || body.length > 48000,
    bodyState: body ? (unsupported ? 'partial' : 'available') : 'unavailable', attachmentsExcluded: excluded }
}
module.exports = { decodeBody }
