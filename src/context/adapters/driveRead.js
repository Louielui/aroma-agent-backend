'use strict'

/**
 * driveRead.js — READ-ONLY Google Drive adapter (scope drive.readonly). Only
 * search/get read methods; NO create/update/delete/share surface. The authed
 * `drive` service is injected (fake in tests; built from googleAuth in live use).
 * v1 returns file metadata + link (content bounded/empty; text export is a later
 * add). Fails-closed to 'unavailable' when the service is absent.
 */

const { makeContextResult } = require('../contextResult')

function createDriveReadAdapter (options = {}) {
  const now = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()
  const drive = options.client || null
  function ensure () { if (!drive) throw new Error('drive service unavailable (no google credentials)'); return drive }

  const methods = {
    async searchFiles ({ q, pageSize = 25 } = {}) {
      const r = await ensure().files.list({ q, pageSize, fields: 'files(id,name,mimeType,modifiedTime,webViewLink)' })
      return ((r.data && r.data.files) || []).map((f) => makeContextResult({ source: 'drive', sourceId: f.id, title: f.name, originalDate: f.modifiedTime, content: f.mimeType || '', link: f.webViewLink, retrievedAt: now() }))
    },
    async listFiles ({ pageSize = 25 } = {}) {
      const r = await ensure().files.list({ pageSize, fields: 'files(id,name,mimeType,modifiedTime,webViewLink)' })
      return ((r.data && r.data.files) || []).map((f) => makeContextResult({ source: 'drive', sourceId: f.id, title: f.name, originalDate: f.modifiedTime, content: f.mimeType || '', link: f.webViewLink, retrievedAt: now() }))
    },
    async getFile ({ fileId } = {}) {
      const r = await ensure().files.get({ fileId, fields: 'id,name,mimeType,modifiedTime,webViewLink' })
      const f = r.data
      return makeContextResult({ source: 'drive', sourceId: f.id, title: f.name, originalDate: f.modifiedTime, content: f.mimeType || '', link: f.webViewLink, retrievedAt: now() })
    }
  }

  return { source: 'drive', methods, ready: () => !!drive }
}

module.exports = { createDriveReadAdapter }
