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
  assert.equal((html.match(/data-component=/g) || []).length, 14)
  assert.match(html, /data-component="project-adoption" data-state="partial"/)
  assert.match(html, /data-component="project-work" data-state="partial"/)
  assert.match(html, /data-component="worker-isolation" data-state="connected"/)
  assert.match(html, /Windows Sandbox/)
  assert.match(html, /已實測主機檔案讀寫拒絕/)
  assert.match(html, /7 項測試由 6 項失敗變成全數通過/)
  assert.match(html, /data-component="development-plan" data-state="partial"/)
  assert.match(html, /data-component="code-repair" data-state="partial"/)
  assert.match(html, /經 Owner 授權與人工核對，首輪三項修正已納入本機香香/)
  assert.match(html, /任意改碼/)
  assert.match(html, /自動套用/)
  assert.match(html, /來源核對及真實方案回傳，以工作單實測為準/)
  assert.match(html, /每次回覆重新檢查 credits、花費及個人用量上限/)
  assert.match(html, /GPT-6.1 Sol、GPT-6 Astra、GPT-6 Luna、GPT-6 Sol/)
  assert.match(html, /未開放的模型標記不可用/)
  assert.match(html, /聊天選擇不改背景記憶或工作角色/)
  assert.match(html, /href="\/development-plan"/)
  assert.match(html, /data-component="mail-memory" data-state="partial"/)
  assert.match(html, /最近 30 天/)
  assert.match(html, /電郵 Hindsight 語意索引/)
  assert.match(html, /不覆寫 Owner 已確認事項/)
  assert.match(html, /今日營運簡報接入/)
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
  assert.match(html, /data-connection="05" data-state="partial"/)
  assert.match(html, /href="\/gmail-context"/)
  assert.match(html, /原文最多 16 KB/)
  assert.match(html, /Google 真實重新授權.*待驗收/)
  assert.match(html, /不含本文的版本清單/)
  assert.match(html, /送往 Hindsight 前及保存結果時再次重讀原信/)
  assert.match(html, /電郵語意搜尋最多等待 10 秒/)
  assert.match(html, /超時會明示語意搜尋不可用/)
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
