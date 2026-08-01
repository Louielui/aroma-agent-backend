'use strict'

/**
 * machineProbe.js — the Companion's real view of its own machine.
 *
 * Implements the `machine` interface that companionCanaryRunner's preflight consumes. Until now
 * that interface existed only as a fake in tests; this is the half that talks to Windows.
 *
 * ── IT ASKS AS ITSELF ──────────────────────────────────────────────────────
 * Every probe here runs in the Companion's own process, with the operator's own token. That is
 * the whole point: the Owner's side could not read the folder ACL, and the failure said more
 * about who was asking than about the folder. "Can I read this" and "can I write here" are only
 * meaningful questions when the asker is the one who will act.
 *
 * ── THE RUNNER SPAWNS NOTHING ─────────────────────────────────────────────
 * The process runner is injected, exactly as the desktop adapter's is, so the rules stay
 * testable without a machine and this module imports nothing that could execute.
 */

const REQUIRED_OPS = Object.freeze(['acl', 'listdir', 'fileexists', 'writable', 'staging', 'notepads', 'auditwritable'])

// A SCRIPT ID, not a path. The shared runner owns the frozen id->path map, so nothing here
// can name a file to execute.
const DEFAULT_SCRIPT = 'machine-probe'

/**
 * @param {{run:Function}} deps.runner  run(scriptPath, payload) -> parsed result
 */
function createMachineProbe (deps = {}) {
  const runner = deps.runner
  if (!runner || typeof runner.run !== 'function') throw new Error('no_runner: the probe cannot measure without an injected runner')
  const scriptPath = deps.scriptPath || DEFAULT_SCRIPT

  const call = (op, payload) => {
    if (!REQUIRED_OPS.includes(op)) throw new Error('unknown_probe_op: ' + op)
    // The shared runner returns a TRANSPORT envelope: { ok, result }. A transport failure and
    // a probe refusal are different facts, so they are unwrapped separately — reporting 'the
    // probe said no' when the probe never ran would be a lie about what was measured.
    const env = runner.run(scriptPath, Object.assign({ op }, payload))
    if (!env || typeof env !== 'object') return { ok: false, reason: 'probe_no_result' }
    if (env.ok !== true) return { ok: false, reason: 'transport_' + (env.refusal || 'failed') }
    const r = env.result
    return (r && typeof r === 'object') ? r : { ok: false, reason: 'probe_no_result' }
  }

  return {
    /**
     * The ACL as the operator sees it. A failure here is reported as a failure, never as an
     * empty ACL — an unreadable descriptor scored as "no Deny ACEs found" would be the exact
     * vacuous pass this project keeps hunting.
     */
    readAcl (dir) {
      const r = call('acl', { path: dir })
      if (r.ok !== true) return { ok: false, reason: r.reason || 'acl_unreadable' }
      return {
        ok: true,
        protected: r.protected === true,
        inheritedCount: Number.isInteger(r.inheritedCount) ? r.inheritedCount : -1,
        denyCount: Number.isInteger(r.denyCount) ? r.denyCount : -1,
        aces: r.aces || {}
      }
    },

    /** null on failure, never [] — "could not read" must not read as "empty". */
    listDir (dir) {
      const r = call('listdir', { path: dir })
      return r.ok === true && Array.isArray(r.entries) ? r.entries : null
    },

    fileExists (p) {
      const r = call('fileexists', { path: p })
      return r.ok === true ? r.exists === true : true // unknown counts as present: refuse rather than overwrite
    },

    /** Which of the probed paths the operator can actually write to. */
    /**
     * Which paths outside the approved one the operator can write to.
     *
     * ── IT NO LONGER RETURNS BARE null ─────────────────────────────────────
     * It used to return the array on success and `null` on anything else, which
     * flattened three different situations into one: the transport died, the script refused with
     * a stated reason, or the answer was malformed. The probe was changed to refuse with
     * `probe_file_not_removed` and a path — and that reason reached nothing, because this line
     * threw it away. The operator's screen said "not measured", which is true and useless.
     *
     * The shape is now {ok, paths, residue, notProbed} or {ok:false, reason, transport}. A
     * refusal keeps its name all the way to the person reading it.
     */
    probeWritable () {
      const env = runner.run(scriptPath, { op: 'writable' })
      if (!env || typeof env !== 'object') return { ok: false, reason: 'probe_no_result', transport: true }
      // TRANSPORT FAILURE AND PROBE REFUSAL ARE DIFFERENT FACTS. One means the question never
      // reached the machine; the other means the machine answered and said no.
      if (env.ok !== true) return { ok: false, reason: 'transport_' + (env.refusal || 'failed'), transport: true }
      const r = env.result
      if (!r || typeof r !== 'object') return { ok: false, reason: 'probe_no_result', transport: true }
      if (r.ok !== true) return { ok: false, reason: r.reason || 'probe_refused', detail: r.detail || null, transport: false }
      if (!Array.isArray(r.paths)) return { ok: false, reason: 'probe_malformed', transport: false }
      return {
        ok: true,
        paths: r.paths,
        residue: Array.isArray(r.residue) ? r.residue : [],
        notProbed: Array.isArray(r.notProbed) ? r.notProbed : []
      }
    },

    stagedClosure () {
      const r = call('staging', {})
      return r.ok === true ? { ok: true } : { ok: false, reason: r.reason || 'staging_unverified' }
    },

    notepadCount () {
      const r = call('notepads', {})
      return r.ok === true && Number.isInteger(r.count) ? r.count : -1 // -1 never equals 0, so it refuses
    },

    auditWritable () {
      const r = call('auditwritable', {})
      return r.ok === true && r.writable === true
    }
  }
}

module.exports = { createMachineProbe, REQUIRED_OPS, DEFAULT_SCRIPT }
