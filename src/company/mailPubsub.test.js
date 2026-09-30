'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createMailPubsub } = require('./mailPubsub')
function fixture () {
  let grant; let consent; let policyWrites = 0; let creates = 0; let claims = {}; const policy = { etag: 'keep', version: 3, bindings: [{ role: 'roles/viewer', members: ['user:other@example.test'] }] }
  const client = { generateAuthUrl: value => { consent = value; return 'https://accounts.google.com/auth?state=' + value.state },
    getToken: async () => ({ tokens: { id_token: 'id', access_token: 'access', refresh_token: 'private' } }),
    verifyIdToken: async () => ({ getPayload: () => ({ email: 'owner@example.test', email_verified: true, hd: 'example.test', sub: 'owner-sub', nonce: consent.nonce, ...claims }) }),
    getTokenInfo: async () => ({ scopes: ['https://www.googleapis.com/auth/pubsub'] }), setCredentials: () => {} }
  const missing = async () => { throw Object.assign(Error('missing'), { code: 404 }) }
  const api = { projects: { topics: { get: missing, create: async () => { creates++; return { data: {} } },
    getIamPolicy: async value => { assert.equal(value['options.requestedPolicyVersion'], 3); return { data: structuredClone(policy) } }, setIamPolicy: async value => { policyWrites++; Object.assign(policy, value.requestBody.policy) } },
  subscriptions: { get: missing, create: async value => { creates++; return { data: value.requestBody } }, pull: async () => ({ data: { receivedMessages: [] } }), acknowledge: async () => {} } } }
  const secrets = { present: () => !!grant, save: value => { grant = value }, load: () => grant, clear: () => { grant = null } }
  const pubsub = createMailPubsub({ registry: { snapshot: () => ({ tenantDomain: 'example.test', users: [{ role: 'owner', email: 'owner@example.test' }] }) },
    factory: () => ({ client, audience: 'client', project: 'aroma-test' }), secrets, service: () => api })
  const authorize = async () => { const start = pubsub.begin(); await pubsub.finish({ state: consent.state, cookie: start.cookie, code: 'code' }) }
  return { pubsub, authorize, claims: value => { claims = value }, grant: () => grant, consent: () => consent, creates: () => creates, policy, policyWrites: () => policyWrites, api }
}
test('separate Owner consent provisions only dedicated topic/subscription and preserves existing IAM', async () => {
  const f = fixture(); assert.equal(f.pubsub.status().configured, false)
  await f.authorize(); assert.equal(f.pubsub.status().state, 'setup_required')
  await Promise.all([f.pubsub.prepare(), f.pubsub.prepare()]); assert.equal(f.creates(), 2); assert.equal(f.policyWrites(), 1)
  assert.deepEqual(f.policy.bindings[0], { role: 'roles/viewer', members: ['user:other@example.test'] })
  assert.equal(f.policy.etag, 'keep'); assert.deepEqual(f.policy.bindings[1].members, ['serviceAccount:gmail-api-push@system.gserviceaccount.com'])
  assert.equal(f.pubsub.status().state, 'ready'); assert.equal(JSON.stringify(f.pubsub.status()).includes('private'), false)
  assert.equal(f.consent().scope.includes('https://www.googleapis.com/auth/gmail.modify'), false)
  await f.pubsub.prepare(); assert.equal(f.creates(), 2)
})
test('OAuth rejects wrong Owner, nonce, flow cookie and revoked pending consent', async () => {
  for (const claims of [{ email: 'other@example.test' }, { nonce: 'forged' }, { hd: 'other.test' }]) {
    const f = fixture(); f.claims(claims); await assert.rejects(f.authorize()); assert.equal(f.grant(), undefined)
  }
  const f = fixture(); const start = f.pubsub.begin(); const state = f.consent().state
  await assert.rejects(f.pubsub.finish({ state, cookie: 'wrong', code: 'code' }))
  f.pubsub.disconnect(); await assert.rejects(f.pubsub.finish({ state, cookie: start.cookie, code: 'code' }))
})
test('wrong existing subscription destination fails rather than adopting a push or unrelated source', async () => {
  const f = fixture(); await f.authorize()
  f.api.projects.subscriptions.get = async () => ({ data: { topic: 'projects/other/topics/mail' } })
  await assert.rejects(f.pubsub.prepare(), /subscription_configuration/)
  assert.equal(f.pubsub.status().state, 'setup_required')
})

test('live credential and SDK helpers refuse the test process before reading credentials', () => {
  const auth = require('../context/googleAuth')
  for (const invoke of [() => auth.createPubsubConsentClient(), () => auth.pubsubWithOAuth({}), () => auth.pubsubGrantStore.load(),
    () => auth.pubsubGrantStore.save({}), () => auth.pubsubGrantStore.clear()]) {
    assert.throws(invoke, e => e.googleLiveAuthBlocked === true)
  }
})
