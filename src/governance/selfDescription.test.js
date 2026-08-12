'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { selfDescription, describe, namesInternalSystem } = require('./selfDescription')

test('*** ⛔ THE ACCEPTANCE CASE — she never has to ask what Aroma System is ***', () => {
  // 「你講嘅 Aroma System 係我哋內部使用嘅系統，定係外部公司／服務嘅網站？」 must be unaskable.
  assert.equal(namesInternalSystem('給我 Aroma System 的 website'), true)
  assert.equal(namesInternalSystem('aroma_system 有咩'), true)
  assert.equal(namesInternalSystem('我哋個系統點'), true)
  const d = selfDescription({ env: {} })
  assert.equal(d.aromaSystem.isInternal, true, 'it is HIS system, and that is a fact she holds')
})

test('*** an unrelated proper noun is NOT hers ***', () => {
  for (const s of ['Costco 有冇貨', '睇下 Google 地圖', '']) {
    assert.equal(namesInternalSystem(s), false, s)
  }
})

test('*** ⛔ PROHIBITION 1 — the BOUND port wins over the requested one ***', () => {
  // src/index.js reads `process.env.PORT || 8081`, the live port is 8090, and 8081 is a real
  // different service. A description built from the source constant would be confidently wrong.
  const bound = selfDescription({ env: { PORT: '8090' }, server: { address: () => ({ port: 8090 }) } })
  assert.equal(bound.port, 8090)
  assert.equal(bound.portSource, 'bound_socket', 'the socket, not the request')

  const noServer = selfDescription({ env: { PORT: '8090' } })
  assert.equal(noServer.port, 8090)
  assert.equal(noServer.portSource, 'env', 'and it says which it used')
})

test('*** ⛔ an unknowable value is null, never a default wearing a fact\'s clothes ***', () => {
  const d = selfDescription({ env: {} })
  assert.equal(d.port, null, 'no PORT and no socket means we do not know — not 8081')
  assert.equal(d.portSource, null)
  assert.equal(d.bindHost, null)
})

test('*** ⛔ PROHIBITION 3 — reachable is ALWAYS null; a flag never answers a capability ***', () => {
  // A flag says what was CONFIGURED, not what WORKS. Conflating them rebuilds the
  // 401-read-as-empty defect one layer up.
  const d = selfDescription({ env: { CONTEXT_AROMA_SYSTEM: 'on', READ_ACCESS: 'on' } })
  for (const o of d.aromaSystem.operations.concat(d.publicOperations)) {
    assert.equal(o.reachable, null, '⛔ ' + o.operation + ' claimed reachability from a flag')
  }
  assert.ok(d.cannot.some((c) => /live read, not a flag/.test(c)), 'and it says so out loud')
})

test('*** ⛔ PROHIBITION 2 — the sentence is derived, so a count cannot drift ***', () => {
  const d = selfDescription({ env: {} })
  const s = describe({ env: {} })
  assert.ok(s.includes(String(d.aromaSystem.operations.length) + '個'),
    'the number in the sentence IS the array length, not a word someone typed')
  assert.ok(s.includes('內部系統'), 'and it states the thing she asked him about')
  assert.ok(/唔會用設定嚟當答案/.test(s), 'and refuses to answer reachability from configuration')
})

test('*** the base URL reports which source it came from ***', () => {
  const fromEnv = selfDescription({ env: { AROMA_SYSTEM_URL: 'https://example.invalid' } })
  assert.equal(fromEnv.aromaSystem.baseUrl, 'https://example.invalid')
  assert.equal(fromEnv.aromaSystem.baseUrlSource, 'env')
  assert.equal(selfDescription({ env: {} }).aromaSystem.baseUrlSource, 'default',
    '⛔ a fallback is labelled a fallback — it is not a fact about the running system')
})

test('*** ⛔ what she CANNOT answer is named, not left to be discovered ***', () => {
  const d = selfDescription({ env: {} })
  assert.ok(d.cannot.length >= 3)
  assert.ok(d.cannot.some((c) => /source code|version/.test(c)))
})
