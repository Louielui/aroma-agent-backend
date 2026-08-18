'use strict'

/**
 * CONNECTION STATE — FOUR SEPARATE TRUTHS, AND NOT ONE OF THEM IS 「CONNECTED」.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THERE IS NO `connected` BOOLEAN, PROVEN BY THE REPOSITORY ITSELF.
 *
 * Every combination below is a real state this build can be in RIGHT NOW:
 *
 *   flag on, no credential          github / aroma_system with no env var
 *   credential present, not usable  google files exist; the refresh token may be dead
 *   credential + flag, still off     public_knowledge with A4_KNOWLEDGE_ROUTING off
 *   in the catalogue, no builder     development_record — measured, see below
 *
 * A single boolean would have to pick one of those to lie about — and `development_record`
 * needs no credential at all, which no boolean can say. So `enabled`, `credentialState`
 * (present | missing | not_required), `registered` and `health` stay separate, and a future UI
 * derives its wording from them rather than from a flag.
 *
 * ⛔ credentialState 'present' IS PRESENCE, NEVER VALIDITY. `googleAuth.credsPresent()` tests that two
 * files exist. It cannot know whether the refresh token still works, whether the account is
 * still authorised, or whether Google is reachable. So it may never imply health:'up'.
 *
 * ⛔ health IS 'unknown' AND THAT IS THE HONEST ANSWER. Nothing in this build probes a data
 * source for liveness. Deriving health from `registered` would mean 「we built an object,
 * therefore the far end is well」, which is exactly the class of claim this project keeps
 * removing.
 *
 * ⛔ NO PROCESS-LIFETIME CACHE, AND A TEST THAT PROVES IT. Owner Settings applies a source
 * switch by writing process.env, and flag readers look at process.env at call time, so a
 * change takes effect on the NEXT TURN with no restart. A projection that snapshotted state at
 * startup would silently break that promise while every other test stayed green. Case I below
 * mutates the flag between two projections and fails if the second one does not move.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { projectConnections, REASON, HEALTH, CREDENTIAL, BUILDABLE_SOURCES } = require('./connectionState')
const { ALL_SOURCES } = require('./liveClients')

/** All flags on, so each case below turns exactly one thing off. */
const ON = () => ({
  READ_ACCESS: 'on',
  CONTEXT_DRIVE: 'on',
  CONTEXT_GMAIL: 'on',
  CONTEXT_CALENDAR: 'on',
  CONTEXT_GITHUB: 'on',
  CONTEXT_AROMA_SYSTEM: 'on',
  CONTEXT_DEVELOPMENT_RECORD: 'on',
  CONTEXT_PUBLIC_KNOWLEDGE: 'on',
  GITHUB_READ_TOKEN: 'x',
  AROMA_SYSTEM_KEY: 'x',
  OPENAI_API_KEY: 'x',
  A4_KNOWLEDGE_ROUTING: 'on'
})

/** Deps injected so nothing here touches the real filesystem or a real Google client. */
const deps = (over = {}) => Object.assign({
  credsPresent: () => true,
  googleServiceFn: () => ({}),
  now: () => '2026-08-18T00:00:00.000Z'
}, over)

const by = (list, key) => list.find((c) => c.key === key)

/* ═══ A — the master gate ═══════════════════════════════════════════════════ */

test('*** ⛔ READ_ACCESS OFF — every source is disabled and nothing claims to be up ***', () => {
  const env = Object.assign(ON(), { READ_ACCESS: 'off' })
  const out = projectConnections(env, deps())
  assert.equal(out.length, ALL_SOURCES.length, 'every catalogue source must be represented')
  for (const c of out) {
    assert.equal(c.enabled, false, c.key)
    assert.equal(c.registered, false, c.key)
    assert.equal(c.reason, REASON.MASTER_DISABLED, c.key)
    assert.equal(c.health, HEALTH.UNKNOWN, '⛔ ' + c.key + ' claimed a health it cannot know')
  }
})

/* ═══ B — one source switched off ═══════════════════════════════════════════ */

test('*** A SOURCE SWITCH OFF IS ITS OWN REASON, NOT A MISSING CREDENTIAL ***', () => {
  const env = Object.assign(ON(), { CONTEXT_GMAIL: 'off' })
  const out = projectConnections(env, deps())
  const gmail = by(out, 'gmail')
  assert.equal(gmail.enabled, false)
  assert.equal(gmail.registered, false)
  assert.equal(gmail.reason, REASON.SOURCE_DISABLED)
  // and the others are unaffected
  assert.equal(by(out, 'drive').enabled, true)
})

/* ═══ C/D — flag on, credential absent ══════════════════════════════════════ */

test('*** ⛔ ENABLED IS NOT CREDENTIALLED IS NOT REGISTERED ***', () => {
  for (const [key, envVar] of [['github', 'GITHUB_READ_TOKEN'], ['aroma_system', 'AROMA_SYSTEM_KEY']]) {
    const env = ON()
    delete env[envVar]
    const c = by(projectConnections(env, deps()), key)
    assert.equal(c.enabled, true, key + ' is switched on')
    assert.equal(c.credentialState, CREDENTIAL.MISSING, key + ' has no credential material')
    assert.equal(c.registered, false, key + ' cannot have been built')
    assert.equal(c.reason, REASON.CREDENTIAL_MISSING, key)
    assert.equal(c.health, HEALTH.UNKNOWN, key)
  }
})

/* ═══ E — Google files absent ═══════════════════════════════════════════════ */

test('*** GOOGLE CREDENTIAL FILES ABSENT IS credentialState=missing, NOT AN ERROR ***', () => {
  const out = projectConnections(ON(), deps({ credsPresent: () => false }))
  for (const key of ['drive', 'gmail', 'calendar']) {
    const c = by(out, key)
    assert.equal(c.enabled, true, key)
    assert.equal(c.credentialState, CREDENTIAL.MISSING, key)
    assert.equal(c.registered, false, key)
    assert.equal(c.reason, REASON.CREDENTIAL_MISSING, key)
  }
})

test('*** ⛔ credentialState=present STILL MEANS NOTHING ABOUT HEALTH ***', () => {
  // The files exist and the adapters build — and the far end is still unproven.
  const out = projectConnections(ON(), deps())
  for (const key of ['drive', 'gmail', 'calendar']) {
    const c = by(out, key)
    assert.equal(c.credentialState, CREDENTIAL.PRESENT, key)
    assert.equal(c.registered, true, key)
    assert.equal(c.health, HEALTH.UNKNOWN,
      '⛔ ' + key + ' inferred health from a constructed object — the token may be dead')
  }
})

/* ═══ F — governance, not credentials ══════════════════════════════════════ */

test('*** ⛔ A GOVERNANCE BLOCK IS NOT A MISSING CREDENTIAL ***', () => {
  const env = Object.assign(ON(), { A4_KNOWLEDGE_ROUTING: 'off' })
  const c = by(projectConnections(env, deps()), 'public_knowledge')
  assert.equal(c.enabled, true)
  assert.equal(c.credentialState, CREDENTIAL.PRESENT, 'the API key IS present')
  assert.equal(c.registered, false)
  assert.equal(c.reason, REASON.GOVERNANCE_DISABLED, '⛔ an egress governance stop was reported as a missing key')
  assert.notEqual(c.reason, REASON.CREDENTIAL_MISSING)
  assert.equal(c.egress, true, 'and it is still the one source that sends words outward')
})

/* ═══ G — development_record: honest, and NOT activated ════════════════════ */

test('*** ⛔ development_record REPORTS THE GAP HONESTLY AND STAYS UNAVAILABLE ***', () => {
  /**
   * ⛔ MEASURED IN PREFLIGHT: it is in ALL_SOURCES, it has a flag, it has an adapter
   * (recordRead), and `liveClients` has NO builder for it — so with the switch ON it is
   * skipped with the JavaScript text 「builders[source] is not a function」. A TypeError is not
   * a connection state.
   *
   * ⛔ AND THIS TRANCHE DOES NOT FIX IT. Adding the builder would turn an unavailable source
   * into a readable one, which is capability activation, not projection. Owner GO required.
   */
  const c = by(projectConnections(ON(), deps()), 'development_record')
  assert.equal(c.enabled, true, 'the switch is on')
  assert.equal(c.registered, false, '⛔ development_record BECAME READABLE — that is activation, not projection')
  assert.equal(c.reason, REASON.NOT_IMPLEMENTED)
  assert.equal(c.local, true, 'it needs no credential: it is this build\'s own docs/')
  assert.equal(c.credentialState, CREDENTIAL.NOT_REQUIRED,
    '⛔ a local source must not be described as having, or lacking, a credential')

  const blob = JSON.stringify(c)
  assert.equal(/builders\[|is not a function|TypeError/.test(blob), false,
    '⛔ raw JavaScript error text reached the connection state: ' + blob)
})

/* ═══ H — a successful build ═══════════════════════════════════════════════ */

test('*** A BUILT ADAPTER IS registered=true AND health STILL unknown ***', () => {
  const c = by(projectConnections(ON(), deps()), 'github')
  assert.equal(c.enabled, true)
  assert.equal(c.credentialState, CREDENTIAL.PRESENT)
  assert.equal(c.registered, true)
  assert.equal(c.reason, REASON.NONE)
  assert.equal(c.health, HEALTH.UNKNOWN)
  assert.equal(c.lastSuccessAt, null, 'nothing in this build records a last success yet')
})

/* ═══ I — THE LOAD-BEARING ONE: no process-lifetime cache ══════════════════ */

test('*** ⛔ AN OWNER SWITCH TAKES EFFECT ON THE NEXT PROJECTION, WITH NO RESTART ***', () => {
  /**
   * ⛔ THIS IS THE TEST THE DESIGN EXISTS FOR. Owner Settings writes process.env and every
   * flag reader looks at it AT CALL TIME, so a switch applies on the next turn. If this
   * projection ever snapshots at startup, that promise breaks silently — the page would say
   * 「off」 for a source the Owner just switched on, and no other test would notice.
   */
  const env = Object.assign(ON(), { CONTEXT_GITHUB: 'off' })
  const before = by(projectConnections(env, deps()), 'github')
  assert.equal(before.enabled, false)
  assert.equal(before.reason, REASON.SOURCE_DISABLED)

  env.CONTEXT_GITHUB = 'on' // exactly what ownerSettings.applyFlags does

  const after = by(projectConnections(env, deps()), 'github')
  assert.equal(after.enabled, true, '⛔ a cached snapshot was introduced — the Owner switch stopped working')
  assert.equal(after.registered, true)
  assert.equal(after.reason, REASON.NONE)
})

/* ═══ K — nothing secret, ever ═════════════════════════════════════════════ */

test('*** ⛔ NO CREDENTIAL VALUE, PATH OR ERROR TEXT MAY APPEAR ***', () => {
  const env = Object.assign(ON(), {
    GITHUB_READ_TOKEN: 'ghp_SECRETVALUE_MUST_NOT_APPEAR',
    AROMA_SYSTEM_KEY: 'aroma_SECRETVALUE_MUST_NOT_APPEAR',
    OPENAI_API_KEY: 'sk-SECRETVALUE_MUST_NOT_APPEAR'
  })
  const blob = JSON.stringify(projectConnections(env, deps()))
  for (const secret of ['ghp_SECRETVALUE_MUST_NOT_APPEAR', 'aroma_SECRETVALUE_MUST_NOT_APPEAR', 'sk-SECRETVALUE_MUST_NOT_APPEAR']) {
    assert.equal(blob.includes(secret), false, '⛔ a credential VALUE reached the state: ' + secret)
  }
  // Nor the secrets directory, nor any filesystem path.
  for (const fragment of ['C:\\\\Aroma\\\\secrets', 'google-refresh-token', 'google-oauth-client', '.json']) {
    assert.equal(blob.includes(fragment), false, '⛔ a credential PATH reached the state: ' + fragment)
  }
})

test('*** THE SHAPE IS CLOSED, AND EVERY REASON/HEALTH IS FROM ITS ENUM ***', () => {
  for (const env of [ON(), Object.assign(ON(), { READ_ACCESS: 'off' })]) {
    for (const c of projectConnections(env, deps())) {
      assert.deepEqual(Object.keys(c).sort(),
        ['credentialState', 'egress', 'enabled', 'health', 'key', 'kind', 'label', 'lastCheckedAt', 'lastSuccessAt', 'local', 'reason', 'registered'].sort(),
        '⛔ a key appeared on ConnectionState: ' + JSON.stringify(Object.keys(c)))
      assert.equal(c.kind, 'data_source')
      assert.ok(Object.values(REASON).includes(c.reason), 'reason must be closed: ' + c.reason)
      assert.ok(Object.values(HEALTH).includes(c.health), 'health must be closed: ' + c.health)
      assert.ok(Object.values(CREDENTIAL).includes(c.credentialState), 'credentialState must be closed: ' + c.credentialState)
      assert.ok(ALL_SOURCES.includes(c.key), 'key must come from the catalogue: ' + c.key)
      assert.equal(typeof c.label, 'string')
      assert.equal(c.lastSuccessAt, null, 'P1-A1 records no last success')
    }
  }
})

/* ═══ the catalogue stays the one authority ════════════════════════════════ */

test('*** ⛔ NO SECOND SOURCE LIST — the projection covers ALL_SOURCES exactly ***', () => {
  const keys = projectConnections(ON(), deps()).map((c) => c.key)
  assert.deepEqual(keys, ALL_SOURCES.slice(), 'the projection must be derived from ALL_SOURCES, in its order')
})

test('*** ⛔ THE BUILDABLE LIST CANNOT DRIFT FROM WHAT liveClients CAN ACTUALLY BUILD ***', () => {
  /**
   * BUILDABLE_SOURCES is the only place this tranche names a subset by hand, and a hand-written
   * subset is precisely how two lists drift apart. So it is measured, not trusted: with every
   * flag on, every credential present and A4 on, whatever liveClients REALLY registers must
   * equal it exactly. Add a builder there without adding it here — or the reverse — and this
   * turns red.
   */
  const { createLiveReadConnector } = require('./liveClients')
  const real = createLiveReadConnector({ env: ON(), googleServiceFn: () => ({}) })
  assert.deepEqual(real.registered.slice().sort(), BUILDABLE_SOURCES.slice().sort(),
    '⛔ BUILDABLE_SOURCES no longer matches what liveClients can construct')
})

/* ═══ J — the existing endpoint keeps its contract ═════════════════════════ */

test('*** ⛔ /api/v1/context/health STAYS COMPATIBLE — connections is ADDITIVE ***', () => {
  /**
   * Existing consumers read `enabled`, `registered`, `skipped` and `caps`. This tranche adds a
   * field beside them; it does not reshape or remove any of them. `skipped` deliberately keeps
   * its raw builder sentences — that is precisely why `connections[].reason` exists as a
   * closed enum instead.
   */
  const { createContextRouter } = require('../routes/contextRouter')

  const saved = { ...process.env }
  Object.assign(process.env, ON())
  let body = null
  try {
    const router = createContextRouter({
      buildConnector: () => ({ connector: {}, registered: ['drive'], skipped: [{ source: 'gmail', reason: 'flag off' }] })
    })
    const layer = router.stack.find((l) => l.route && l.route.path === '/api/v1/context/health')
    assert.ok(layer, 'the health route must still exist')
    // gate() then the handler; both are plain express middlewares.
    const res = { statusCode: 200, json (v) { body = v; return this }, status (c) { this.statusCode = c; return this } }
    const handlers = layer.route.stack.map((s) => s.handle)
    handlers[0]({}, res, () => handlers[1]({}, res))
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }

  assert.ok(body, 'the route must have responded')
  assert.deepEqual(body.enabled !== undefined, true, 'enabled preserved')
  assert.deepEqual(body.registered, ['drive'], 'registered preserved verbatim')
  assert.deepEqual(body.skipped, [{ source: 'gmail', reason: 'flag off' }], 'skipped preserved verbatim')
  assert.ok(body.caps, 'caps preserved')
  assert.ok(Array.isArray(body.connections), '⛔ the new projection did not reach the route')
  assert.equal(body.connections.length, ALL_SOURCES.length)
  for (const c of body.connections) {
    assert.ok(Object.values(REASON).includes(c.reason))
    assert.equal(c.health, HEALTH.UNKNOWN)
  }
})
