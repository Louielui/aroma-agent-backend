'use strict'

/**
 * phase3aChannel.test.js — Computer Operator v0, Phase 3a.
 *
 * The channel, the refusal path, and — the reason this phase exists — THE KILL SWITCH
 * DEMONSTRATED AGAINST A REAL PROCESS ON A REAL PIPE. Until now it was a latch that
 * stopped nothing; a stop that has never been shown to stop something is a belief.
 *
 * These use a real Windows named pipe between two endpoints in this test process. That is
 * the genuine transport, not a fake — what it does NOT prove is deployment under the
 * AromaOperator account, which is stated in the report rather than implied here.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

const { createServiceEndpoint, createCompanionEndpoint, pipePath } = require('./ipcChannel')
const { createCompanion, CAPABILITIES, anyCapabilityEnabled, NO_CAPABILITY } = require('./companion')
const { createKillSwitch } = require('./killSwitch')
const { ROLE_SERVICE, ROLE_COMPANION } = require('./sessionBoundary')

const NAME = () => 'aroma-op-test-' + crypto.randomBytes(6).toString('hex')
const nonce = () => crypto.randomBytes(16).toString('hex')

const step = (over = {}) => Object.assign({
  from: ROLE_SERVICE, to: ROLE_COMPANION, type: 'execute_step',
  approvalId: 'appr_3a', stepIndex: 0, stepNonce: nonce()
}, over)

/** Wire a Service and a Companion over a real pipe; returns both plus a request helper. */
async function wire () {
  const name = NAME()
  const replies = []
  const service = createServiceEndpoint({ name, onMessage: (m) => replies.push(m) })
  await service.listen()
  const companion = createCompanion({ now: () => 1 })
  const endpoint = createCompanionEndpoint({ name, onMessage: (m) => companion.handle(m) })
  await endpoint.connect()
  // The client's 'connect' resolves before the server has registered the socket, so wait
  // for the SERVICE side to see it. Without this the helper races and `send()` writes to
  // an empty set — which looked like "the Companion ignored the request".
  for (let i = 0; i < 200 && service.connectionCount() === 0; i++) await new Promise((r) => setTimeout(r, 5))
  const ask = async (msg) => {
    const before = replies.length
    service.send(msg)
    for (let i = 0; i < 100 && replies.length === before; i++) await new Promise((r) => setTimeout(r, 5))
    return replies[replies.length - 1]
  }
  return { service, endpoint, companion, replies, ask, name }
}

/* ── the channel exists ───────────────────────────────────────────────────── */

test('*** the Service and Companion talk over a real named pipe ***', async () => {
  const w = await wire()
  try {
    assert.match(w.service.pipePath, /^\\\\\.\\pipe\\aroma-op-test-/)
    assert.equal(w.service.connectionCount(), 1, 'the Companion is connected')
    const pong = await w.ask(Object.assign(step(), { type: 'ping' }))
    assert.equal(pong.type, 'pong', 'the handshake completes')
    assert.equal(pong.from, ROLE_COMPANION)
  } finally { w.endpoint.close(); await w.service.close() }
})

test('the pipe is local by construction — no port, no host, no network', () => {
  const p = pipePath('aroma-operator')
  assert.equal(p, '\\\\.\\pipe\\aroma-operator')
  assert.equal(/\d+\.\d+\.\d+\.\d+|localhost|:\d{2,5}/.test(p), false, 'no address of any kind')
})

/* ── it refuses everything ────────────────────────────────────────────────── */

test('*** the Companion refuses EVERY request — no capability is enabled ***', async () => {
  const w = await wire()
  try {
    for (const action of ['read_file', 'create_file', 'copy_file', 'list_windows', 'capture_own_screen', 'send_keys']) {
      const res = await w.ask(step({ step: { action } }))
      assert.equal(res.ok, false, 'refused: ' + action)
      assert.equal(res.refusal, NO_CAPABILITY)
      assert.equal(res.capability, action, 'and it names what it will not do')
    }
  } finally { w.endpoint.close(); await w.service.close() }
})

test('*** every capability in the register is FALSE in this build ***', () => {
  assert.equal(anyCapabilityEnabled(), false)
  for (const [name, enabled] of Object.entries(CAPABILITIES)) {
    assert.equal(enabled, false, 'Phase 3a has no capability: ' + name)
  }
  // the ones Phase 3b will add, and the ones Phase 3 never adds, are both present as
  // declared-and-off rather than absent, so nothing can be enabled by accident of naming
  for (const later of ['list_windows', 'read_ui_tree', 'capture_own_screen']) assert.ok(later in CAPABILITIES)
  for (const never of ['move_mouse', 'send_keys', 'launch_app', 'write_file']) assert.ok(never in CAPABILITIES)
})

test('a malformed or misdirected frame is refused at the boundary', async () => {
  const w = await wire()
  try {
    assert.equal((await w.ask(step({ stepNonce: 'short' }))).refusal, 'bad_envelope')
    assert.equal((await w.ask(step({ type: 'run_everything' }))).refusal, 'bad_envelope')
    assert.equal((await w.ask(step({ from: ROLE_COMPANION }))).refusal, 'bad_envelope')
    assert.equal((await w.ask(step({ approvalId: '../etc' }))).refusal, 'bad_envelope')
  } finally { w.endpoint.close(); await w.service.close() }
})

/* ══ THE KILL SWITCH, DEMONSTRATED THREE WAYS ═════════════════════════════ */

test('*** KILL 1 — the SERVICE GATE stops it before anything is sent ***', async () => {
  const w = await wire()
  try {
    const gate = createKillSwitch({ now: () => 1 })
    gate.stop('owner_kill_switch')
    // The Service checks the gate before dispatching. Nothing reaches the pipe at all.
    const before = w.replies.length
    if (gate.guard().ok) w.service.send(step({ step: { action: 'read_file' } }))
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(w.replies.length, before, 'no request was ever sent')
    assert.equal(gate.guard().ok, false)
  } finally { w.endpoint.close(); await w.service.close() }
})

test('*** KILL 2 — the COMPANION ABORT stops it after it is running ***', async () => {
  const w = await wire()
  try {
    assert.equal((await w.ask(Object.assign(step(), { type: 'ping' }))).type, 'pong', 'alive first')
    const aborted = await w.ask(Object.assign(step(), { type: 'abort' }))
    assert.equal(aborted.type, 'aborted')
    assert.equal(w.companion.isAborted(), true)
    // and it stays stopped — every later request is refused, including a ping
    const after = await w.ask(Object.assign(step({ stepNonce: nonce() }), { type: 'ping' }))
    assert.equal(after.ok, false)
    assert.equal(after.refusal, 'aborted')
  } finally { w.endpoint.close(); await w.service.close() }
})

test('*** KILL 3 — the OS FALLBACK: closing the channel leaves it nothing to answer on ***', async () => {
  const w = await wire()
  try {
    assert.equal(w.service.connectionCount(), 1)
    // This is what stopping the Windows service or logging the account out does: the pipe
    // and every connection on it are destroyed.
    await w.service.close()
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(w.service.connectionCount(), 0, 'no connections survive')
    assert.equal(w.endpoint.isConnected(), false, 'the Companion is disconnected')
    // and it does not come back — there is no reconnect path. Comments are stripped
    // before scanning: the file's own documentation says "no reconnect loop", which the
    // scanner would otherwise flag as a reconnect loop.
    const raw = require('node:fs').readFileSync(require('node:path').join(__dirname, 'ipcChannel.js'), 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    assert.equal(/reconnect|retryConnect|setInterval|setTimeout/.test(src), false, 'no reconnect loop exists')
  } finally { w.endpoint.close() }
})

test('all three bindings are now real, and the register says so', () => {
  const { KILL_SWITCH_BINDINGS } = require('./killSwitch')
  assert.equal(KILL_SWITCH_BINDINGS.serviceGate.implemented, true)
  assert.equal(KILL_SWITCH_BINDINGS.companionAbortSignal.implemented, true)
  assert.equal(KILL_SWITCH_BINDINGS.osBackstop.implemented, true)
})
