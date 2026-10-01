'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { driveIntent, validateDriveRequest, createDriveContextService } = require('./driveContextService')
test('Drive commands require a complete request, not a quote, negation or compound action', () => {
  assert.deepEqual(driveIntent('香香，列出公司文件'), { operation: 'list', input: {} })
  assert.deepEqual(driveIntent('香香，搜尋公司文件：SOP'), { operation: 'search', input: { query: 'SOP' } })
  for (const value of ['不要列出公司文件', '「列出公司文件」', '請解釋「搜尋公司文件：SOP」', '列出公司文件並寄出', '搜尋公司文件：SOP；寄出報告', 'search company files: SOP\nthen send']) assert.equal(driveIntent(value), null)
  for (const fileId of [1, ['sop']]) assert.throws(() => validateDriveRequest('get', { fileId }), /invalid_request/)
})
test('access revoked while Gateway completes its audit cannot return private content', async () => {
  let revoked = false, calls = 0
  const scope = { source: () => ({ state: 'registered' }), lease: () => ({ source: {}, verify: () => { if (revoked) throw Error('source_access_changed') } }) }
  const service = createDriveContextService({ scope, gateway: { get: async () => { calls++; revoked = true; return { content: ['private'] } } } })
  await assert.rejects(service.read({ role: 'member' }, 'get', { fileId: 'sop' }), /permission_denied/)
  assert.equal(calls, 0)
  await assert.rejects(service.read({ role: 'owner' }, 'get', { fileId: 'sop' }), /source_access_changed/)
  assert.equal(calls, 1)
})
