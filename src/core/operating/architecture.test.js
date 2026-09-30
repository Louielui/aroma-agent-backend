'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

test('architecture page is owner-gated, distinguishes pilot memory, and does not run tools', async t => {
  const { createApp } = require('../../app')
  let reads = 0
  const app = createApp({ ownerPassword: 'fixture-owner', serviceToken: 'fixture-service', runPersistence: false, proposalPersistence: false,
    workerDeps: { artifactStore: null, runner: null },
    operatingManager: { registry: () => { reads++; return {} }, activity: () => { reads++; return [] }, briefing: async () => { reads++; return {} } }
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const url = 'http://127.0.0.1:' + server.address().port
  assert.equal((await fetch(url + '/architecture')).status, 401)
  const response = await fetch(url + '/architecture', { headers: { authorization: 'Bearer fixture-service' } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const html = await response.text()
  assert.equal((html.match(/data-component=/g) || []).length, 9)
  assert.match(html, /data-component="mail-memory" data-state="partial"/)
  assert.match(html, /最近 30 天/)
  assert.match(html, /電郵 Hindsight 語意索引/)
  assert.match(html, /data-component="memory" data-state="partial"/)
  assert.match(html, /Hindsight/)
  assert.match(html, /尚未接通/)
  assert.match(html, /不是即時連線健康檢查/)
  assert.match(html, /記憶不能取代營運事實，也不代表執行批准/)
  assert.match(html, /href="\/manager"/)
  assert.equal((html.match(/data-connection=/g) || []).length, 12)
  assert.match(html, /data-connection="10" data-state="partial"/)
  assert.match(html, /data-connection="09" data-state="partial"/)
  assert.match(html, /data-connection="12" data-state="foundation"/)
  assert.equal((html.match(/data-phase=/g) || []).length, 9)
  assert.equal((html.match(/data-capability=/g) || []).length, 8)
  assert.match(html, /不會自動切換到付費 API/)
  assert.match(html, /連接歸香香統一管理/)
  assert.match(html, /href="\/connections"/)
  assert.match(html, /data-connection="05" data-state="foundation"/)
  assert.match(html, /Google 真實重新授權.*待驗收/)
  assert.match(html, /Manus.*Grok/)
  assert.doesNotMatch(html, /<script|<form|<button/)
  assert.equal(reads, 0)
})

test('architecture remains readable in English and uses the shared integration registry', () => {
  const { buildArchitectureHtml } = require('./architectureView')
  const previous = process.env.XIANGXIANG_LOCALE
  process.env.XIANGXIANG_LOCALE = 'en'
  try {
    const html = buildArchitectureHtml()
    assert.match(html, /<html lang="en"/)
    assert.match(html, /Architecture inventory/)
    assert.match(html, /Hindsight.*Partially/)
    assert.match(html, /7shifts.*Not connected/)
    assert.match(html, /QBO.*Not connected/)
    assert.doesNotMatch(html, /\[missing|undefined|\/\*LABELS\*\//)
  } finally {
    if (previous === undefined) delete process.env.XIANGXIANG_LOCALE
    else process.env.XIANGXIANG_LOCALE = previous
  }
})
