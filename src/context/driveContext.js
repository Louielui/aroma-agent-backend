'use strict'
const { makeContextResult, ENTITY_TYPES } = require('./contextResult')
const { ID } = require('./driveScope')
const { DOC, TEXT_TYPES, TEXT_LIMIT } = require('./driveReadOnlyClient')
const FOLDER = 'application/vnd.google-apps.folder'
const SHORTCUT = 'application/vnd.google-apps.shortcut'
const READONLY = 'https://www.googleapis.com/auth/drive.readonly'
function exact (input, keys) { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !keys.includes(k))) throw Error('invalid_request') }
function fileId (input, key, optional = false) { exact(input, [key]); if ((!optional || input[key] !== undefined) && (typeof input[key] !== 'string' || !ID.test(input[key]))) throw Error('invalid_request'); return input[key] }
function searchInput (input) { exact(input, ['query']); if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 80 || /[\x00-\x1f\x7f]/.test(input.query)) throw Error('invalid_request'); return input.query.trim() }
const escapeQuery = value => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
function createDriveContextAdapter ({ scope, readerFactory = require('./driveReadOnlyClient').createOwnerDriveReader, clock = () => new Date().toISOString() }) {
  let retryAt = 0
  async function retrieve (operation, input) {
    if (Date.parse(clock()) < retryAt) throw Error('source_rate_limited')
    try {
      const lease = scope.lease(); lease.verify()
      const reader = readerFactory(), identity = await reader.identity(); lease.verify()
      if (identity?.email?.toLowerCase() !== lease.ownerEmail || !Array.isArray(identity.scopes) || !identity.scopes.includes(READONLY) ||
        identity.scopes.some(s => typeof s !== 'string' || (s.startsWith('https://www.googleapis.com/auth/drive') && s !== READONLY && !s.endsWith('.readonly')))) throw Error('read_identity_unconfirmed')
      const root = lease.source.rootId, driveId = lease.source.driveId, cache = new Map()
      async function metadata (id, fresh = false) {
        if (fresh || !cache.has(id)) cache.set(id, Promise.resolve().then(() => reader.getFile(id)))
        const file = await cache.get(id); lease.verify()
        if (!file || file.id !== id || file.trashed || file.mimeType === SHORTCUT || file.driveId !== driveId || !ID.test(file.id || '')) throw Error('source_scope_unconfirmed')
        return file
      }
      async function within (id, known) {
        let current = id; const seen = new Set(); let original
        if (known) cache.set(id, Promise.resolve(known))
        for (let depth = 0; depth < 40; depth++) {
          if (!ID.test(current || '') || seen.has(current)) throw Error('source_scope_unconfirmed')
          seen.add(current); const file = await metadata(current)
          if (!original) original = file
          if (current === root) { if (file.mimeType !== FOLDER) throw Error('source_root_unconfirmed'); return original }
          if (!Array.isArray(file.parents) || file.parents.length !== 1) throw Error('source_scope_unconfirmed')
          current = file.parents[0]
        }
        throw Error('source_scope_unconfirmed')
      }
      const row = (file, body = null, reason = 'metadata_requested') => ({ ...makeContextResult({ source: 'drive', sourceId: file.id,
        title: typeof file.name === 'string' ? file.name : file.id, originalDate: file.modifiedTime || null, retrievedAt: clock(),
        content: body?.text || '', link: file.mimeType === FOLDER ? 'https://drive.google.com/drive/folders/' + file.id : 'https://drive.google.com/file/d/' + file.id + '/view',
        entityType: ENTITY_TYPES.FILE, truncated: body?.truncated === true,
        fields: { mimeType: file.mimeType || null, createdTime: file.createdTime || null, modifiedTime: file.modifiedTime || null,
          version: file.version || null, contentState: body ? 'text' : 'metadata_only', contentReason: body ? null : reason,
          textByteLimit: TEXT_LIMIT, textBytes: body?.bytes ?? null, textProjection: body ? (file.mimeType === DOC ? 'drive_text_plain_export' : 'utf8_original') : null,
          documentTabsCoverage: null, consistency: body ? 'metadata_checked_before_and_after' : 'source_metadata' } }), truncated: body?.truncated === true })
      let result
        await within(root)
        if (operation === 'list' || operation === 'search') {
          const id = operation === 'list' ? (input.folderId || root) : null
          if (id && (await within(id)).mimeType !== FOLDER) throw Error('folder_required')
          const page = await reader.listFiles({ corpora: 'drive', driveId, supportsAllDrives: true, includeItemsFromAllDrives: true,
            pageSize: 25, orderBy: operation === 'list' ? 'folder,name_natural' : 'modifiedTime desc',
            q: 'trashed = false and ' + (id ? "'" + id + "' in parents" : "fullText contains '" + escapeQuery(input.query) + "'") })
          lease.verify()
          if (!page || !Array.isArray(page.files) || page.files.length > 25) throw Error('invalid_source_page')
          const rows = []; let excluded = 0
          for (const file of page.files) {
            if (file?.mimeType === SHORTCUT) { excluded++; continue }
            if (!ID.test(file?.id || '')) throw Error('invalid_source_file')
            const original = await within(file.id, file)
            if (id && !original.parents?.includes(id)) throw Error('foreign_folder_result')
            rows.push(row(original))
          }
          const truncated = !!page.nextPageToken || page.incompleteSearch === true
          result = { results: rows, evidence: { queryScope: { window: operation === 'list' ? 'folder ' + id + ': first 25 children' : 'shared drive ' + root + ': first 25 fullText matches' },
            sourceTotal: null, excludedCount: excluded, completeWithinScope: truncated || excluded ? false : page.incompleteSearch === false ? true : null, truncated } }
        } else {
          const file = await within(input.fileId || root)
          let body = null, reason = 'metadata_requested'
          if (operation === 'get') {
            reason = file.mimeType === FOLDER ? 'folder' : ![DOC, ...TEXT_TYPES].includes(file.mimeType) ? 'unsupported_format'
              : file.capabilities?.canDownload !== true ? 'download_not_allowed' : !/^\d+$/.test(file.version || '') ? 'source_revision_unavailable' : null
            if (!reason) {
              body = await reader.readText(file); lease.verify()
              if (typeof body?.text !== 'string' || !Number.isInteger(body.bytes) || body.bytes < 0 || Buffer.byteLength(body.text, 'utf8') > TEXT_LIMIT || typeof body.truncated !== 'boolean') throw Error('invalid_source_body')
              cache.clear(); const after = await within(file.id)
              if (file.version !== after.version || file.modifiedTime !== after.modifiedTime || file.mimeType !== after.mimeType) throw Error('source_revision_changed')
            }
          }
          result = { results: [row(file, body, reason)], evidence: { queryScope: { window: (operation === 'get' ? 'text projection (document tabs, images, comments and layout not verified) for file ' : 'file metadata ') + file.id },
            completeWithinScope: operation !== 'get' || (body !== null && !body.truncated), sourceTotal: 1, revision: file.version || null, excludedCount: 0 } }
        }
        lease.verify(); return result
    } catch (error) {
      if (error.response?.status === 429 || error.code === 429 || error.response?.data?.error?.errors?.some(e => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(e.reason))) {
        const seconds = Number(error.response?.headers?.['retry-after'])
        retryAt = Date.parse(clock()) + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60000)
      }
      throw error
    }
  }
  const methods = Object.freeze({
    listScopedFiles: input => { fileId(input, 'folderId', true); return retrieve('list', input) },
    searchScopedFiles: input => retrieve('search', { query: searchInput(input) }),
    getScopedFile: input => { fileId(input, 'fileId'); return retrieve('get', input) },
    readFileMetadata: input => { fileId(input, 'fileId', true); return retrieve('metadata', input) }
  })
  return Object.freeze({ source: 'drive', methods, ready: () => true, readTimeoutMs: 30000 })
}
function driveResources (source) {
  if (!source || !ID.test(source.rootId || '') || source.rootId !== source.driveId) throw Error('source_not_configured')
  return [{ id: 'drive.company_files', source: 'drive', layer: 'knowledge', scope: source.rootId, sensitivity: 'private',
    link: 'https://drive.google.com/drive/folders/' + source.rootId,
    validateRow: r => ID.test(r.sourceId || '') && (r.link === 'https://drive.google.com/file/d/' + r.sourceId + '/view' || r.link === 'https://drive.google.com/drive/folders/' + r.sourceId),
    operations: { list: { method: 'listScopedFiles', params: input => { fileId(input, 'folderId', true); return { ...input } } },
      search: { method: 'searchScopedFiles', params: input => ({ query: searchInput(input) }) },
      get: { method: 'getScopedFile', params: input => ({ fileId: fileId(input, 'fileId') }) },
      readMetadata: { method: 'readFileMetadata', params: input => { fileId(input, 'fileId', true); return { ...input } } } } }]
}
module.exports = { createDriveContextAdapter, driveResources, FOLDER }
