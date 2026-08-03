'use strict'

/**
 * driveRead.js — READ-ONLY Google Drive adapter (scope drive.readonly). Only
 * search/get read methods; NO create/update/delete/share surface. The authed
 * `drive` service is injected (fake in tests; built from googleAuth in live use).
 * v1 returns file metadata + link (content bounded/empty; text export is a later
 * add). Fails-closed to 'unavailable' when the service is absent.
 */

const { makeContextResult, ENTITY_TYPES } = require('../contextResult')

function createDriveReadAdapter (options = {}) {
  const now = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()
  const drive = options.client || null
  function ensure () { if (!drive) throw new Error('drive service unavailable (no google credentials)'); return drive }

  const methods = {
    // `orderBy` is a READ-only sort hint (e.g. 'modifiedTime desc') — it grants no
    // additional access and is what makes the recent-items fallback meaningful.
    async searchFiles ({ q, pageSize = 25, orderBy } = {}) {
      const args = { q, pageSize, fields: 'files(id,name,mimeType,modifiedTime,webViewLink)' }
      if (orderBy) args.orderBy = orderBy
      const r = await ensure().files.list(args)
      return ((r.data && r.data.files) || []).map((f) => makeContextResult({ source: 'drive', sourceId: f.id, title: f.name, originalDate: f.modifiedTime, content: f.mimeType || '', link: f.webViewLink, retrievedAt: now(), entityType: ENTITY_TYPES.FILE, fields: { name: f.name, mimeType: f.mimeType || null, modifiedTime: f.modifiedTime || null } }))
    },
    async listFiles ({ pageSize = 25, orderBy } = {}) {
      const args = { pageSize, fields: 'files(id,name,mimeType,modifiedTime,webViewLink)' }
      if (orderBy) args.orderBy = orderBy
      const r = await ensure().files.list(args)
      return ((r.data && r.data.files) || []).map((f) => makeContextResult({ source: 'drive', sourceId: f.id, title: f.name, originalDate: f.modifiedTime, content: f.mimeType || '', link: f.webViewLink, retrievedAt: now(), entityType: ENTITY_TYPES.FILE, fields: { name: f.name, mimeType: f.mimeType || null, modifiedTime: f.modifiedTime || null } }))
    },
    async getFile ({ fileId } = {}) {
      const r = await ensure().files.get({ fileId, fields: 'id,name,mimeType,modifiedTime,webViewLink' })
      const f = r.data
      return makeContextResult({ source: 'drive', sourceId: f.id, title: f.name, originalDate: f.modifiedTime, content: f.mimeType || '', link: f.webViewLink, retrievedAt: now(), entityType: ENTITY_TYPES.FILE, fields: { name: f.name, mimeType: f.mimeType || null, modifiedTime: f.modifiedTime || null } })
    }
  }

  return { source: 'drive', methods, ready: () => !!drive }
}

module.exports = { createDriveReadAdapter }
