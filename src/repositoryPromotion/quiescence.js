'use strict'

// Host-composed protocol, deliberately not a route or model tool. This module
// does not install itself: callers must account for every writer before using
// it as a deployment fence. See docs/DEPLOYMENT-QUIESCENCE.md.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { passwordMatches, MIN_PASSWORD_CHARS } = require('../governance/ownerAuth')
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const NAME = /^[a-z][a-z0-9-]{0,63}$/
const VERSION = 'deployment-quiescence-v1'

function createGate ({ directory, participants, ownerPassword, clock = () => new Date().toISOString() }) {
  if (!path.isAbsolute(directory || '') || !Array.isArray(participants) || participants.length === 0 ||
      participants.some(p => !NAME.test(p)) || new Set(participants).size !== participants.length || typeof ownerPassword !== 'function') throw Error('invalid_gate_configuration')
  const expected = [...participants].sort()
  const file = path.join(directory, 'gate.json')
  const lock = path.join(directory, 'gate.lock')
  // No environment switch, service token, HTTP credential or request body can
  // substitute for the Owner secret in the host control interface.
  function authorize (credentials) {
    const secret = ownerPassword()
    if (typeof secret !== 'string' || secret.length < MIN_PASSWORD_CHARS || !passwordMatches(credentials?.password, secret)) throw Error('deployment_control_unauthorized')
  }
  function regular (target) {
    const st = fs.lstatSync(target)
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw Error('gate_integrity_unconfirmed')
  }
  function read () {
    try {
      regular(file)
      const s = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (s.schema !== VERSION || !['open', 'draining', 'frozen'].includes(s.phase) || !Number.isSafeInteger(s.generation) || s.generation < 0 ||
          JSON.stringify(s.participants) !== JSON.stringify(expected) || !Array.isArray(s.leases) || !Array.isArray(s.acknowledged) || !Array.isArray(s.events) ||
          (s.phase === 'open' ? s.run !== null : !UUID.test(s.run || '')) ||
          s.leases.some(l => !UUID.test(l.id || '') || !expected.includes(l.participant) || !Number.isSafeInteger(l.pid) || l.pid < 1) ||
          new Set(s.leases.map(l => l.id)).size !== s.leases.length ||
          s.acknowledged.some(p => !expected.includes(p)) || new Set(s.acknowledged).size !== s.acknowledged.length ||
          (s.phase === 'frozen' && (s.leases.length || s.acknowledged.length !== expected.length))) throw Error()
      return s
    } catch (_) { throw Error('gate_integrity_unconfirmed') }
  }
  function save (s) {
    const temporary = file + '.' + randomUUID() + '.tmp'
    let fd
    try {
      fd = fs.openSync(temporary, 'wx', 0o600)
      fs.writeFileSync(fd, JSON.stringify(s) + '\n')
      fs.fsyncSync(fd)
      fs.closeSync(fd); fd = undefined
      fs.renameSync(temporary, file)
      if (JSON.stringify(read()) !== JSON.stringify(s)) throw Error('gate_integrity_unconfirmed')
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
  }
  function exclusive (fn) {
    // A crashed or held lock is a refusal, never a timeout-based lock steal.
    // Deployment waits/retries outside this synchronous atomic section.
    let fd
    try {
      if (fs.lstatSync(directory).isSymbolicLink()) throw Error('gate_integrity_unconfirmed')
      fd = fs.openSync(lock, 'wx', 0o600)
    } catch (e) { throw Error(e.code === 'EEXIST' ? 'gate_busy' : 'gate_integrity_unconfirmed') }
    try { return fn() } finally { fs.closeSync(fd); fs.unlinkSync(lock) }
  }
  function event (s, name, details = {}) { s.events.push({ name, at: clock(), ...details }) }
  function check (s, request, phase) {
    if (s.generation !== request.expectedGeneration || s.run !== request.run || s.phase !== phase) throw Error('gate_identity_changed')
  }
  function participant (value) { if (!expected.includes(value)) throw Error('unknown_gate_participant') }
  function initialize (credentials) {
    authorize(credentials)
    fs.mkdirSync(directory, { recursive: true })
    return exclusive(() => {
      if (fs.existsSync(file)) return read()
      const s = { schema: VERSION, phase: 'open', generation: 0, run: null, participants: expected, leases: [], acknowledged: [], events: [] }
      event(s, 'initialized'); save(s); return s
    })
  }
  function admit (name) {
    participant(name)
    const id = randomUUID()
    exclusive(() => {
      const s = read()
      if (s.phase !== 'open') throw Error('deployment_' + s.phase)
      s.leases.push({ id, participant: name, pid: process.pid })
      s.acknowledged = []; save(s)
    })
    let finished = false
    function write (operation) {
      if (typeof operation !== 'function' || operation.constructor.name === 'AsyncFunction') throw Error('synchronous_writer_required')
      return exclusive(() => {
        const s = read()
        if (finished || s.phase === 'frozen' || !s.leases.some(l => l.id === id && l.participant === name && l.pid === process.pid)) throw Error('writer_not_admitted')
        // Completion writes during draining invalidate every previous idle ack.
        // A participant cannot attest idle and subsequently finish another write.
        if (s.acknowledged.length) { s.acknowledged = []; save(s) }
        return operation()
      })
    }
    function finish () {
      if (finished) return
      exclusive(() => {
        const s = read(), lease = s.leases.find(l => l.id === id)
        if (!lease || lease.pid !== process.pid || lease.participant !== name) throw Error('writer_identity_changed')
        s.leases = s.leases.filter(l => l.id !== id)
        s.acknowledged = []; save(s); finished = true
      })
    }
    return Object.freeze({ id, write, finish })
  }
  async function run (name, operation) {
    const lease = admit(name)
    try { return await operation(lease) } finally { lease.finish() }
  }
  function prepare (request) {
    authorize(request)
    if (!UUID.test(request.run || '')) throw Error('invalid_deployment_run')
    return exclusive(() => {
      const s = read()
      if (s.phase !== 'open' || s.generation !== request.expectedGeneration) throw Error('gate_identity_changed')
      s.phase = 'draining'; s.run = request.run; s.generation++; s.acknowledged = []
      event(s, 'draining', { run: s.run }); save(s); return s
    })
  }
  function acknowledge (name, inspect) {
    participant(name)
    return exclusive(() => {
      const s = read()
      if (s.phase !== 'draining' || s.leases.length) throw Error('writers_not_drained')
      // Host composition supplies a synchronous inspection, not a client claim.
      // Unknown, null, asynchronous and pending-consent observations fail closed.
      const result = inspect()
      if (result?.idle !== true || typeof result.then === 'function') throw Error('participant_not_idle')
      if (!s.acknowledged.includes(name)) s.acknowledged.push(name)
      event(s, 'idle_acknowledged', { participant: name }); save(s)
      return s
    })
  }
  function freeze (request) {
    authorize(request)
    return exclusive(() => {
      const s = read(); check(s, request, 'draining')
      if (s.leases.length) throw Error('writers_not_drained')
      if (expected.some(p => !s.acknowledged.includes(p))) throw Error('participants_unconfirmed')
      s.phase = 'frozen'; s.generation++
      event(s, 'frozen', { run: s.run }); save(s); return s
    })
  }
  function release (request, verifyRecovery) {
    authorize(request)
    return exclusive(() => {
      const s = read(); check(s, request, 'frozen')
      const evidence = verifyRecovery()
      if (evidence?.verified !== true || !/^[a-f0-9]{64}$/.test(evidence.receiptHash || '') || typeof evidence.then === 'function') throw Error('recovery_unverified')
      event(s, 'released', { run: s.run, receiptHash: evidence.receiptHash })
      s.phase = 'open'; s.run = null; s.generation++; s.acknowledged = []; save(s); return s
    })
  }
  // The factory is never imported/evaluated during frozen or draining startup.
  // An external immutable launcher must use this before *both* versions' imports.
  const start = (name, factory) => run(name, factory)
  return Object.freeze({ initialize, status: () => exclusive(read), admit, run, start, prepare, acknowledge, freeze, release })
}
module.exports = { createGate }
