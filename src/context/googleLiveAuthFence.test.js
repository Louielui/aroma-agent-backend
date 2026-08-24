'use strict'

/**
 * googleLiveAuthFence.test.js — A TEST MAY NOT USE THE OWNER'S GOOGLE REFRESH TOKEN.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED, NOT SUSPECTED. An instrumented canonical run made **30 live authenticated
 * requests to `oauth2.googleapis.com` per run**, using the real refresh token on this
 * machine. It happened with and without any model credential, so it was never about the
 * model tranche. And one test's OUTCOME depended on it: blocking the traffic flipped
 * `chatBrainAuthoritySeparation.test.js:213` from `distill_with_answer_plan` to `null`.
 *
 * The path, and note that it is TWO events at two depths:
 *
 *     processIntake → read-context layer (intakeService.js:1238)
 *       connector = (deps && deps.connector) || createLiveReadConnector({env})
 *         → liveClients builders.drive|gmail|calendar → googleAuth.service(...)
 *           → createOAuthClient()
 *               fs.readFileSync(CLIENT_FILE)   ◀ SECRET CONTENT INTO TEST MEMORY
 *               fs.readFileSync(TOKEN_FILE)    ◀ THE REFRESH TOKEN ITSELF
 *         → drive.files.list() → google-auth-library → oauth2.googleapis.com  ◀ EGRESS
 *
 * ⛔ SO THE GUARD IS THE FIRST EXECUTABLE ACTION OF `createOAuthClient`, NOT MERELY BEFORE
 * THE READ. Blocking only the socket would still pull the Owner's refresh token into a test
 * process's memory, where a later edit could log, serialise or leak it. **A token that was
 * never read cannot leak.** That is the property this file's headline test asserts, and it is
 * the property that distinguishes this design from a network-only fence.
 *
 * ⛔ AND GOOGLE HAS ITS OWN AUTHORITY. `RUN_PAID_E2E` is permission to spend money on a model
 * provider. It is NOT permission to use the Owner's Google identity. Two different risks, two
 * different switches: `RUN_LIVE_GOOGLE_E2E`, literal `'1'`, and nothing else.
 *
 * ⛔ NOT ONE GOOGLE CALL RUNS HERE, and no credential content is ever read: every case is a
 * pure decision, an injected fake, or an assertion that the real files were NOT opened.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const googleAuth = require('./googleAuth')
const {
  googleLiveAuthAllowed, createOAuthClient, credsPresent,
  CLIENT_FILE, TOKEN_FILE, GOOGLE_LIVE_OPT_IN, GOOGLE_BLOCKED_MARKER
} = googleAuth
const { createLiveReadConnector } = require('./liveClients')
const { createDriveReadAdapter } = require('./adapters/driveRead')
const { createGmailReadAdapter } = require('./adapters/gmailRead')
const { createCalendarReadAdapter } = require('./adapters/calendarRead')

const TEST_CTX = { NODE_TEST_CONTEXT: 'child-v8' }
const PROD_ARGV = ['node', 'C:/Aroma/aroma-agent-backend/src/index.js']
const PROD_MAIN = 'C:/Aroma/aroma-agent-backend/src/index.js'

async function withEnv (over, fn) {
  const saved = {}
  for (const k of Object.keys(over)) { saved[k] = process.env[k]; if (over[k] === null) delete process.env[k]; else process.env[k] = over[k] }
  try { return await fn() } finally { for (const k of Object.keys(over)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
}

async function captureStderr (fn) {
  const lines = []
  const real = console.error
  console.error = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
  try { return { value: await fn(), lines } } catch (e) { return { error: e, lines } } finally { console.error = real }
}

/* ═══ A — THE DECISION MATRIX. Pure; no filesystem, no SDK, no socket. ══ */

test('*** A — a test process is BLOCKED on every signal the shared detector trusts ***', () => {
  assert.equal(googleLiveAuthAllowed(TEST_CTX, [], null), false, 'NODE_TEST_CONTEXT')
  assert.equal(googleLiveAuthAllowed({}, ['node', '--test', 'x'], null), false, 'the runner process itself')
  assert.equal(googleLiveAuthAllowed({}, [], 'C:/x/foo.test.js'), false, 'node foo.test.js directly')
  assert.equal(googleLiveAuthAllowed({}, [], 'C:/x/foo.test.cjs'), false)
  assert.equal(googleLiveAuthAllowed({}, [], 'C:/x/foo.test.mjs'), false)
})

test('*** A — ORDINARY RUNTIME IS NEVER BLOCKED. The production non-impact assertion ***', () => {
  assert.equal(googleLiveAuthAllowed({}, PROD_ARGV, PROD_MAIN), true)
  assert.equal(googleLiveAuthAllowed({ SOMETHING: 'x' }, PROD_ARGV, PROD_MAIN), true)
})

test('*** A — the ONLY key is RUN_LIVE_GOOGLE_E2E === "1", literally ***', () => {
  assert.equal(googleLiveAuthAllowed(Object.assign({}, TEST_CTX, { [GOOGLE_LIVE_OPT_IN]: '1' }), [], null), true)
  for (const v of [undefined, '', '0', 'true', 'yes', 'TRUE', ' 1', '1 ', 'on']) {
    const env = Object.assign({}, TEST_CTX)
    if (v !== undefined) env[GOOGLE_LIVE_OPT_IN] = v
    assert.equal(googleLiveAuthAllowed(env, [], null), false, '⛔ «' + String(v) + '» must not unlock the Owner\'s Google identity')
  }
})

test('*** A — THE MODEL OPT-IN IS NOT GOOGLE AUTHORITY. Two risks, two switches ***', () => {
  // ⛔ Permission to spend money on Anthropic is not permission to use Louie's Google account.
  const env = Object.assign({}, TEST_CTX, { RUN_PAID_E2E: '1' })
  assert.equal(googleLiveAuthAllowed(env, [], null), false,
    '⛔ RUN_PAID_E2E must never grant Google live auth')
})

test('*** A — CREDENTIAL FILES EXISTING GRANTS NOTHING. This is the defect, as an assertion ***', () => {
  // The real files are on this machine. Presence is not permission.
  assert.equal(googleLiveAuthAllowed(TEST_CTX, [], null), false)
})

/* ═══ B — THE HEADLINE: THE SECRET CONTENT IS NEVER READ ══════════════════
 *
 * ⛔ THE REAL FILES ARE PRESENT ON THIS MACHINE AND THIS TEST DOES NOT OPEN THEM. The spy
 * counts by PATH and never touches, returns or prints a byte of either file.
 */

/** Count content reads of the two credential paths. Never reads or returns their bytes. */
function withReadFileSpy (fn) {
  const realRead = fs.readFileSync
  const seen = { client: 0, token: 0, other: 0 }
  const norm = (p) => String(p).replace(/\//g, '\\').toLowerCase()
  const CLIENT = norm(CLIENT_FILE)
  const TOKEN = norm(TOKEN_FILE)
  fs.readFileSync = function (p, ...rest) {
    const n = norm(p)
    if (n === CLIENT) seen.client++
    else if (n === TOKEN) seen.token++
    else seen.other++
    return realRead.call(this, p, ...rest)
  }
  try { return { result: fn(), seen } } catch (e) { return { error: e, seen } } finally { fs.readFileSync = realRead }
}

test('*** B — a blocked call reads ZERO bytes of either credential file ***', async () => {
  await withEnv({ [GOOGLE_LIVE_OPT_IN]: null }, async () => {
    // Precondition, honestly stated: this only means something if the files are really here.
    assert.equal(credsPresent(), true, 'precondition: the real credential files are present')

    const { error, seen } = withReadFileSpy(() => createOAuthClient())
    assert.ok(error, '⛔ createOAuthClient must refuse inside a test process')
    assert.equal(error.googleLiveAuthBlocked, true, 'the refusal must be deterministically markable')
    assert.equal(seen.client, 0, '⛔ the OAuth client file was opened by a test')
    assert.equal(seen.token, 0, '⛔ THE OWNER\'S REFRESH TOKEN WAS READ INTO A TEST PROCESS')
  })
})

test('*** B — EARN THE ZERO: the spy can record non-zero, so the zero above is a measurement ***', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gauth-spy-')), 'decoy.json')
  fs.writeFileSync(tmp, '{"not":"a secret"}')
  const { seen } = withReadFileSpy(() => fs.readFileSync(tmp, 'utf8'))
  assert.equal(seen.other, 1, '⛔ a spy that cannot count is not evidence of zero')
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
})

/* ═══ C — THE GOOGLE CLIENT IS NEVER CONSTRUCTED ═════════════════════════
 *
 * ⛔ STRUCTURAL, NOT INFERRED. `loadGoogleapis()` is `require('googleapis')`. If the SDK is
 * absent from the require cache after a blocked call, that line never executed — which is a
 * fact about the process, not a claim about the source.
 */

const googleapisInCache = () => Object.keys(require.cache).some((k) => /[\\/]node_modules[\\/]googleapis[\\/]/.test(k))

test('*** C — a blocked call never loads the googleapis SDK ***', async () => {
  await withEnv({ [GOOGLE_LIVE_OPT_IN]: null }, async () => {
    const before = googleapisInCache()
    try { createOAuthClient() } catch (e) { assert.equal(e.googleLiveAuthBlocked, true) }
    assert.equal(googleapisInCache(), before,
      '⛔ the SDK was loaded — the guard is not the FIRST action in createOAuthClient')
  })
})

test('*** C — service() is covered too: it reaches createOAuthClient and stops there ***', async () => {
  await withEnv({ [GOOGLE_LIVE_OPT_IN]: null }, async () => {
    const { error, seen } = withReadFileSpy(() => googleAuth.service('drive', 'v3'))
    assert.ok(error && error.googleLiveAuthBlocked === true, '⛔ service() must not build a live client in a test')
    assert.equal(seen.client + seen.token, 0)
  })
})

/* ═══ D — EVERY EXISTING FAKE SEAM STILL WORKS, WITH NO OPT-IN ══════════ */

const FAKE_DRIVE = { files: { list: async () => ({ data: { files: [] } }) } }
const FAKE_GMAIL = { users: { messages: { list: async () => ({ data: { messages: [] } }) } } }
const FAKE_CAL = { events: { list: async () => ({ data: { items: [] } }) } }

test('*** D — adapter { client } injection is untouched ***', async () => {
  await withEnv({ [GOOGLE_LIVE_OPT_IN]: null }, async () => {
    assert.doesNotThrow(() => createDriveReadAdapter({ client: FAKE_DRIVE }))
    assert.doesNotThrow(() => createGmailReadAdapter({ client: FAKE_GMAIL }))
    assert.doesNotThrow(() => createCalendarReadAdapter({ client: FAKE_CAL }))
  })
})

test('*** D — googleServiceFn injection registers all three sources with NO opt-in ***', async () => {
  await withEnv({ [GOOGLE_LIVE_OPT_IN]: null }, async () => {
    const asked = []
    const { registered, skipped } = createLiveReadConnector({
      env: { READ_ACCESS: 'on', CONTEXT_DRIVE: 'on', CONTEXT_GMAIL: 'on', CONTEXT_CALENDAR: 'on' },
      googleServiceFn: (name, version) => { asked.push(name + ':' + version); return name === 'gmail' ? FAKE_GMAIL : (name === 'drive' ? FAKE_DRIVE : FAKE_CAL) }
    })
    assert.deepEqual(asked.slice().sort(), ['calendar:v3', 'drive:v3', 'gmail:v1'])
    for (const s of ['drive', 'gmail', 'calendar']) {
      assert.ok(registered.includes(s), '⛔ ' + s + ' must still be buildable from an injected service: ' + JSON.stringify(skipped))
    }
  })
})

test('*** D — googleAuthMod injection is untouched ***', async () => {
  await withEnv({ [GOOGLE_LIVE_OPT_IN]: null }, async () => {
    const { registered } = createLiveReadConnector({
      env: { READ_ACCESS: 'on', CONTEXT_DRIVE: 'on' },
      googleAuthMod: { service: () => FAKE_DRIVE }
    })
    assert.deepEqual(registered, ['drive'])
  })
})

test('*** D — credsPresent is NOT guarded: presence is not content, and it still answers ***', async () => {
  await withEnv({ [GOOGLE_LIVE_OPT_IN]: null }, async () => {
    // ⛔ Deliberately outside this fix. It opens nothing and calls nothing; guarding it would
    // change what connectionState reports in hundreds of tests for no safety gained.
    assert.doesNotThrow(() => credsPresent())
    assert.equal(typeof credsPresent(), 'boolean')
  })
})

/* ═══ E — WITHOUT AN INJECTED SERVICE, THE SOURCE IS SIMPLY ABSENT ══════ */

test('*** E — the live path fails SOFT: no google source registered, and the reason says why ***', async () => {
  await withEnv({ [GOOGLE_LIVE_OPT_IN]: null }, async () => {
    const { lines, value } = await captureStderr(async () => createLiveReadConnector({
      env: { READ_ACCESS: 'on', CONTEXT_DRIVE: 'on', CONTEXT_GMAIL: 'on', CONTEXT_CALENDAR: 'on' }
    }))
    const { registered, skipped } = value
    for (const s of ['drive', 'gmail', 'calendar']) {
      assert.equal(registered.includes(s), false, '⛔ ' + s + ' was built from the machine credentials')
      const row = skipped.find((x) => x.source === s)
      assert.ok(row && /RUN_LIVE_GOOGLE_E2E/.test(row.reason), '⛔ the skip reason must name the authority: ' + JSON.stringify(row))
    }
    // ⛔ A withheld call may not be silent — the standing defect class in this repository.
    assert.equal(lines.filter((l) => l.includes(GOOGLE_BLOCKED_MARKER)).length, 3,
      '⛔ one marker per blocked construction, no more and no fewer')
  })
})

/* ═══ F — THE MARKER CARRIES NOTHING ════════════════════════════════════ */

test('*** F — the blocked marker names the authority and NOTHING else ***', async () => {
  await withEnv({ [GOOGLE_LIVE_OPT_IN]: null }, async () => {
    const { error, lines } = await captureStderr(async () => createOAuthClient())
    assert.equal(lines.length, 1)
    assert.ok(lines[0].startsWith(GOOGLE_BLOCKED_MARKER))

    // ⛔ ASSERT THE SHAPE, NOT THE ABSENCE OF A STRING. Comparing against the real secret would
    // require reading it — the one thing this whole tranche exists to prevent. So the payload
    // is pinned to an exact key set instead: nothing unexpected can be in a line whose keys are
    // enumerated and whose only value is a variable NAME.
    const payload = JSON.parse(lines[0].slice(GOOGLE_BLOCKED_MARKER.length).trim())
    assert.deepEqual(Object.keys(payload).sort(), ['optIn'])
    assert.equal(payload.optIn, GOOGLE_LIVE_OPT_IN)

    // The error names the variable and the fix; it may not name a path or carry a value.
    assert.match(error.message, /RUN_LIVE_GOOGLE_E2E/)
    const all = lines.join('\n') + '\n' + String(error.message) + '\n' + String(error.stack)
    assert.equal(all.includes('google-refresh-token.json'), false, '⛔ the marker named a credential file')
    assert.equal(all.includes('google-oauth-client.json'), false)
    assert.equal(/client_secret|refresh_token|client_id/.test(all), false, '⛔ a credential field name leaked')
  })
})

/* ═══ G — PRODUCTION IS PERMITTED, PROVEN WITHOUT CALLING GOOGLE ════════ */

test('*** G — a production-shaped process is permitted, and no Google call is made to prove it ***', () => {
  assert.equal(googleLiveAuthAllowed({}, PROD_ARGV, PROD_MAIN), true)
  assert.equal(googleLiveAuthAllowed({ [GOOGLE_LIVE_OPT_IN]: '0' }, PROD_ARGV, PROD_MAIN), true,
    '⛔ the opt-in is a TEST-process key; it may not restrict production')
})
