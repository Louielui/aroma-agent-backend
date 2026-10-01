'use strict'
const auth = require('./googleAuth')
const FILE_FIELDS = 'id,name,mimeType,parents,driveId,trashed,createdTime,modifiedTime,version,size,capabilities(canDownload)'
const TEXT_LIMIT = 16000
const TEXT_TYPES = Object.freeze(['text/plain', 'text/markdown', 'text/csv', 'application/json'])
const DOC = 'application/vnd.google-apps.document'
async function boundedText (stream, limit = TEXT_LIMIT) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') throw Error('invalid_text_stream')
  const chunks = []; let bytes = 0, truncated = false
  for await (const chunk of stream) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const remaining = limit - bytes
    if (b.length > remaining) { chunks.push(b.subarray(0, remaining)); bytes += remaining; truncated = true; break }
    chunks.push(b); bytes += b.length
  }
  let buffer = Buffer.concat(chunks)
  let text = null
  for (let trim = 0; trim <= (truncated ? 3 : 0); trim++) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, buffer.length - trim)); break } catch (_) {}
  }
  if (text === null || text.includes('\u0000')) throw Error('invalid_text_encoding')
  return { text, truncated, bytes }
}
// The SDK and OAuth objects stay in this closure. Only fixed read requests are
// exposed; no credentials, raw request method, URL or mutation reaches callers.
function createOwnerDriveReader ({ oauthFactory = auth.createOAuthClient, serviceFactory = auth.serviceWithOAuth } = {}) {
  const oauth = oauthFactory()
  Object.assign(oauth.transporter.defaults, { timeout: 8000, retry: false })
  const client = serviceFactory('drive', 'v3', oauth)
  const signal = AbortSignal.timeout(25000)
  const options = extra => ({ timeout: 8000, retry: false, maxRedirects: 0, signal, ...extra })
  return Object.freeze({
    async identity () {
      const token = await oauth.getAccessToken()
      if (!token?.token) throw Error('identity_unavailable')
      const info = await oauth.getTokenInfo(token.token)
      const data = (await client.about.get({ fields: 'user(emailAddress)' }, options())).data
      return { email: data.user?.emailAddress || null, scopes: info.scopes || null }
    },
    async getFile (id) { return (await client.files.get({ fileId: id, fields: FILE_FIELDS, supportsAllDrives: true }, options())).data },
    async listFiles (args) { return (await client.files.list({ ...args, fields: 'files(' + FILE_FIELDS + '),nextPageToken,incompleteSearch' }, options())).data },
    async readText (file) {
      let response
      if (file.mimeType === DOC) response = await client.files.export({ fileId: file.id, mimeType: 'text/plain' }, options({ responseType: 'stream' }))
      else if (TEXT_TYPES.includes(file.mimeType)) response = await client.files.get({ fileId: file.id, alt: 'media', supportsAllDrives: true }, options({ responseType: 'stream' }))
      else throw Error('unsupported_format')
      return boundedText(response.data)
    }
  })
}
module.exports = { createOwnerDriveReader, boundedText, FILE_FIELDS, TEXT_LIMIT, TEXT_TYPES, DOC }
