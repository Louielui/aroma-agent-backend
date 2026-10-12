'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { complete, validate } = require('./browserEvidence')
function fixture () {
  return ['zh', 'en'].flatMap(locale => [1280, 390].map(width => ({ name: `browser-${locale}-${width}.png`, engine: 'edge-headless-offline-v1', browserVersion: 'Edg/154.0', locale, width, height: 900, failedReads: locale === 'zh' && width === 390, pageHash: 'a'.repeat(64), screenshotHash: 'b'.repeat(64), screenshotBytes: 2000, checks: Object.fromEntries(['startup','labels','fiveDepths','mediumDefault','solDefault','layout','keyboard','picker','chatScope','explicitConfirmation','noPageErrors','onlyFixtureRequests'].map(k => [k, true])), routes: ['/demo'] })))
}
test('chat requires four distinct complete browser proofs; absence or false claims fail closed', () => {
  const rows = fixture(); assert.equal(complete(rows), true)
  for (const bad of [undefined, [], rows.slice(1), [...rows.slice(1), rows[1]], rows.map((r, i) => i ? r : { ...r, checks: {} }), rows.map((r, i) => i ? r : { ...r, failedReads: true })]) assert.equal(complete(bad), false)
})
test('browser proof rejects foreign routes, unbounded metadata and bad hashes', () => {
  const good = fixture()[0]; assert.doesNotThrow(() => validate(good))
  for (const edit of [{ name: '../proof.png' }, { routes: ['https://external.invalid'] }, { screenshotBytes: 9000000 }, { pageHash: 'not a digest' }, { height: 500 }, { locale: 'fr' }]) assert.throws(() => validate({ ...good, ...edit }), /invalid_sandbox_evidence/)
})

test('provider-aware evidence is versioned and cannot reuse the legacy assertions', () => {
  const checks = ['startup','labels','claudeDefault','providerIsolation','modelEfforts','catalogueFailureHandled','layout','keyboard','picker','chatScope','explicitConfirmation','noPageErrors','onlyFixtureRequests']
  const rows = fixture().map(p => ({ ...p, engine: 'edge-headless-offline-v2', checks: Object.fromEntries(checks.map(k => [k, true])) }))
  assert.equal(complete(rows), true)
  assert.equal(complete(fixture()), true)
  for (const bad of [{ ...rows[0], checks: fixture()[0].checks }, { ...rows[0], checks: { ...rows[0].checks, modelEfforts: false } }, { ...rows[0], engine: 'edge-headless-offline-v3' }]) assert.throws(() => validate(bad), /invalid_sandbox_evidence/)
})
