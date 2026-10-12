'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { createOwnerDriveReader, boundedText, TEXT_LIMIT, DOC } = require('./driveReadOnlyClient')
test('Drive reader exposes only fixed Google read calls and keeps credentials inside the closure', async () => {
  const calls = []
  const oauth = { transporter: { defaults: {} }, getAccessToken: async () => ({ token: 'SECRET_TOKEN' }), getTokenInfo: async token => {
    assert.equal(token, 'SECRET_TOKEN'); return { scopes: ['https://www.googleapis.com/auth/drive.readonly'] } } }
  const client = { about: { get: async (p,o) => { calls.push(['about',p,o]); return { data: { user: { emailAddress: 'owner@example.com' } } } } },
    files: { get: async (p,o) => { calls.push(['get',p,o]); return { data: p.alt ? Readable.from(['native text']) : { id: p.fileId } } },
      list: async (p,o) => { calls.push(['list',p,o]); return { data: { files: [] } } },
      export: async (p,o) => { calls.push(['export',p,o]); return { data: Readable.from(['document text']) } } } }
  const reader = createOwnerDriveReader({ oauthFactory: () => oauth, serviceFactory: (name,version,auth) => { assert.equal(name,'drive'); assert.equal(version,'v3'); assert.equal(auth,oauth); return client } })
  const who = await reader.identity(); assert.equal(who.email,'owner@example.com'); assert.doesNotMatch(JSON.stringify(who),/SECRET/)
  await reader.getFile('doc'); await reader.listFiles({ corpora:'drive',driveId:'root' })
  assert.equal((await reader.readText({id:'doc',mimeType:DOC})).text,'document text')
  assert.equal((await reader.readText({id:'plain',mimeType:'text/plain'})).text,'native text')
  await assert.rejects(reader.readText({id:'pdf',mimeType:'application/pdf'}),/unsupported_format/)
  assert.deepEqual(Object.keys(reader).sort(),['getFile','identity','listFiles','readText'])
  assert.ok(Object.isFrozen(reader)); assert.equal(reader.client,undefined); assert.equal(reader.token,undefined)
  for (const [method,params,options] of calls) { assert.equal(options.retry,false); assert.equal(options.maxRedirects,0); assert.ok(options.signal); assert.equal(options.timeout,8000); if(method==='get')assert.equal(params.supportsAllDrives,true) }
  assert.equal(calls.find(c=>c[0]==='export')[1].mimeType,'text/plain')
})
test('text read is byte bounded, closes a truncated stream, preserves UTF-8 and rejects binary content', async () => {
  const stream=Readable.from([Buffer.from('香'.repeat(10000))])
  const body=await boundedText(stream)
  assert.equal(body.truncated,true); assert.equal(body.bytes,TEXT_LIMIT); assert.ok(Buffer.byteLength(body.text)<=TEXT_LIMIT)
  assert.ok(!body.text.includes('\uFFFD')); assert.equal(stream.destroyed,true)
  assert.deepEqual(await boundedText(Readable.from([''])),{text:'',bytes:0,truncated:false})
  await assert.rejects(boundedText(Readable.from([Buffer.from([0xff])])),/invalid_text_encoding/)
  await assert.rejects(boundedText(Readable.from(['abc\u0000'])),/invalid_text_encoding/)
})
