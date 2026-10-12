'use strict'

/**
 * openClawInstanceManager.js — WHO THE EXECUTOR IS, RECORDED BEFORE IT CAN EXIST. INERT.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * C2-B2-B2C measured that the shared OpenClaw gateway offers NO scoped primitive that makes
 * one agent identity unaddressable while preserving its workspace: `agents delete` is
 * documented as "Delete an agent and prune workspace/state" with no --keep-workspace flag,
 * and `agents unbind` only rewrites route bindings — the direct invocation path
 * (`openclaw agent --agent <id> --session-key <key>`) contains ZERO references to the
 * bindings module, so unbinding gates nothing.
 *
 * So retirement stops being an OpenClaw question and becomes an OS one: one approval gets one
 * gateway instance in its own transient systemd --user service, and retirement is proven by
 * that service's control group being empty — evidence from the operating system, not an
 * absence reported by the thing being audited.
 *
 * This module owns ONLY identity and its lifecycle. It launches nothing, reads no OS state,
 * and — deliberately — cannot conclude that anything has been retired.
 *
 * ── THE RULE THAT SHAPES EVERYTHING HERE ────────────────────────────────────
 * ⛔ THERE MUST BE NO WINDOW IN WHICH AN EXECUTOR CAN EXIST THAT AROMA CANNOT NAME.
 * The durable record — including the unit name that will later be stopped — is written BEFORE
 * anything can be launched. A crash between "record written" and "process spawned" leaves a
 * record for a run that never started, which is recoverable. The reverse leaves a process
 * nobody can find, which is not.
 *
 * ⛔ AND A PREDICTED CONTROL GROUP IS NOT A MEASURED ONE.
 * The cgroup path is predictable from the unit name, and it would have been convenient to
 * write it at prepare time. It is not recorded then, because a predicted path proves nothing
 * about where systemd actually put the process. `observedControlGroup` starts null and may be
 * written exactly once, from a positive observation. If a launch may have happened and the
 * control group could never be established, the instance is UNRETIRABLE by construction.
 */

/**
 * ⛔ FIXED TRUSTED ROOTS. THESE ARE NOT CONFIGURABLE, AND THAT IS THE POINT.
 *
 * Review finding F1: the first version accepted stateRoot / configPath / envelopeRoot /
 * repoRoot from the caller. Those four strings are exactly what the retirement verifier later
 * scans for holders and stat()s for object identity — so a caller that nominated the wrong
 * roots would produce a verifier looking in the wrong place that could still return RETIRED.
 * Security-relevant paths are now DERIVED, exactly as openClawWslWorkspace.js derives its
 * sandbox paths from a fixed DISTRO and SANDBOX_ROOT. There is no option to override them,
 * no constructor parameter, and no store record that can disagree.
 */
const INSTANCE_ROOT = '/home/openclaw/.aroma/instances'
const SANDBOX_ROOT = '/home/openclaw/.aroma/sandboxes'

/** The ledger's own safe-id alphabet. Identity must be expressible in both stores. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * ⛔ instanceId IS the approvalId in V1, deliberately.
 * A `<approvalId>-<counter>` scheme was rejected: a global counter is durable state of its own
 * that can be lost, rolled back or raced — a second source of truth for identity, which is
 * exactly what identity must not have. The approvalId is already unique and non-reusable
 * under the quarantine design, so it is the whole identity.
 */
const instanceIdFor = (approvalId) => approvalId
const unitNameFor = (approvalId) => `aroma-oc-${approvalId}.service`
const instanceMarkerFor = (approvalId) => approvalId

/** Every security-relevant path, derived from the fixed roots and the approvalId. */
function derivedPathsFor (approvalId) {
  return {
    stateRoot: `${INSTANCE_ROOT}/${approvalId}/state`,
    configPath: `${INSTANCE_ROOT}/${approvalId}/config/openclaw.json`,
    envelopeRoot: `${SANDBOX_ROOT}/${approvalId}`,
    repoRoot: `${SANDBOX_ROOT}/${approvalId}/repo`
  }
}

/**
 * ⛔ THE MANAGER HAS NO 'RETIRED' STATE, AND THAT ABSENCE IS DELIBERATE.
 *
 * Review finding F3: an earlier version had STATES.RETIRED and markRetired(), which set it
 * with no OS evidence and no verifier call. It could not release the quarantine lock, but two
 * different things were named RETIRED with very different authority behind them — an invitation
 * for a later caller to read the cheap one as the real one.
 *
 * Semantic retirement belongs to openClawRetirementVerifier.evaluate(); governance retirement
 * belongs to quarantine.retire() -> EXECUTOR_RETIRED. This module records only identity,
 * launch, observation and the fact that a stop was requested. There is deliberately no
 * `retired`, `isRetired` or `retiredAt` field anywhere in this file.
 */
const STATES = Object.freeze({
  PREPARED: 'PREPARED',
  LAUNCH_ATTEMPTED: 'LAUNCH_ATTEMPTED',
  OBSERVED: 'OBSERVED',
  STOP_REQUESTED: 'STOP_REQUESTED'
})

const ORDER = Object.freeze([
  STATES.PREPARED, STATES.LAUNCH_ATTEMPTED, STATES.OBSERVED, STATES.STOP_REQUESTED
])

/**
 * Fields this module authors. A caller may never supply them — not as metadata, not in the
 * spec. Includes every derived path (the F1 fix) and createdAt, which is a stamp this module
 * makes rather than a fact anyone reports.
 */
const RESERVED = Object.freeze([
  'approvalId', 'instanceId', 'unitName', 'instanceMarker', 'state', 'updatedAt', 'createdAt',
  'observedControlGroup', 'mainPid', 'observedPids', 'restartPolicy',
  'stateRoot', 'configPath', 'envelopeRoot', 'repoRoot'
])

/**
 * ⛔ THE PRE-SPAWN MEASUREMENTS. WRITTEN ONCE, FROM THE SPEC, AND NEVER AGAIN.
 *
 * These three come from outside — the port from the trusted allocation seam, the two object
 * identities from stat() before anything ran — so they cannot be derived, and they cannot live
 * in RESERVED because prepare() screens the SPEC against that list. After prepare they are
 * exactly as authoritative as a derived field: the verifier stats the recorded dev/ino to
 * decide whether the workspace in front of it is the one that was prepared, so a later call
 * able to rewrite that baseline could make ANY directory pass as "the prepared object".
 *
 * They are therefore refused in the metadata of every method, and compared on every write.
 */
const MEASURED = Object.freeze(['gatewayPort', 'envelopeObject', 'repoObject'])

/** What no caller may supply once the record exists. */
const PROTECTED = Object.freeze(RESERVED.concat(MEASURED))

/** The fields whose value must be identical for the whole life of the record. */
const IMMUTABLE = Object.freeze(MEASURED.concat(['createdAt']))

/**
 * ⛔ THE BASELINE IS COMPARED, NOT MERELY SCREENED — PURE, AND DELIBERATELY REACHABLE.
 *
 * The metadata screen is the first defence; this is the second, and it is independent, because
 * it compares against the record that already exists rather than trusting what was filtered.
 * Exported so a test can hand it a mutated pair directly — otherwise the screen stops anything
 * from ever reaching it, which is the shape that has now hidden three defects in this project.
 */
function assertBaselineUnchanged (prev, next) {
  for (const k of IMMUTABLE) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
      throw new Error(
        "refuse: '" + k + "' is a pre-spawn measurement and can never be changed (" +
        JSON.stringify(prev[k]) + ' -> ' + JSON.stringify(next[k]) + ')'
      )
    }
  }
  return next
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * ⛔ THE STORE READ BOUNDARY: GENUINE DATA OBJECTS, OWN DATA AUTHORITY ONLY.
 *
 * assertStore used to read rec.approvalId, rec.unitName, rec.stateRoot and the rest directly,
 * while isPlainObject accepted ANY non-array object. Two consequences were reproduced:
 *
 *   - a record on a custom prototype passed validation on INHERITED fields while owning none;
 *   - Object.prototype pollution filled a MISSING field, so a record with no own
 *     observedControlGroup validated with a forged one.
 *
 * Either turns the store — the thing that names what must be retired — into something an
 * unrelated write can shape. And a getter would be worse still: a field could validate as one
 * value and be used as another, so an accessor is refused outright rather than sampled.
 */
function isDataObject (v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * Read one authoritative field as an OWN DATA property. Returns { value } or null; the caller
 * decides what a missing field means, so the error messages stay specific.
 */
function ownData (o, key) {
  const d = Object.getOwnPropertyDescriptor(o, key)
  if (!d || typeof d.get === 'function' || typeof d.set === 'function') return null
  return { value: d.value }
}

/** Every authoritative field of a record, read exactly once, or a refusal. */
function authorityOf (key, rec, fields) {
  const out = Object.create(null)
  for (const f of fields) {
    const got = ownData(rec, f)
    if (got === null) {
      throw new Error(`refuse: instance record '${key}' has no own data property '${f}' (inherited or accessor fields are never store authority)`)
    }
    out[f] = got.value
  }
  return out
}

/**
 * The WHOLE record as own data, once. authorityOf proves the required fields are present;
 * this proves nothing else in the record arrives by inheritance or by property access either.
 */
function stableRecord (key, raw) {
  if (Object.getOwnPropertySymbols(raw).length > 0) {
    throw new Error(`refuse: instance record '${key}' carries symbol properties`)
  }
  const out = Object.create(null)
  for (const f of Object.getOwnPropertyNames(raw)) {
    const got = ownData(raw, f)
    if (got === null) {
      throw new Error(`refuse: instance record '${key}' field '${f}' is not an own data property`)
    }
    out[f] = got.value
  }
  return out
}

/**
 * ⛔ A SHALLOW SNAPSHOT IS NOT A SNAPSHOT.
 *
 * stableRecord copies the record's own top-level data properties, but dev/ino objects and the
 * pid array were still the STORE'S objects. With a store that retains references — and the
 * injected store contract never promised cloning — all four of these were reproduced:
 *
 *   prepare(...).envelopeObject.dev = '999'   -> a later record() read '999'
 *   observePids(...).observedPids.length = 0  -> a later record() had LOST pid 93018
 *   record().repoObject.ino = '777'           -> the next record() read '777'
 *   all()[id].envelopeObject.dev = '555'      -> the next record() read '555'
 *
 * Every one of those is a caller silently rewriting the identity the verifier will later
 * compare against, or erasing the survivor list it will later scan, without passing through
 * this module at all. Reference separation is the fix; freezing would only hide it.
 */
function detachIdentity (v) {
  // the caller has already proven this is a data object with own canonical dev/ino
  const out = Object.create(null)
  out.dev = ownData(v, 'dev').value
  out.ino = ownData(v, 'ino').value
  return out
}

/**
 * ⛔ THE PID LIST IS EVIDENCE, SO IT IS VALIDATED WHOLE AND COPIED WHOLE.
 *
 * Array.isArray was the only check, so an array of accessors, a holed array, or one holding
 * '93018' / 0 / -1 / 1.5 all passed. Elements are read through their DESCRIPTORS — an accessor
 * is refused without ever being invoked — and a hole is a missing measurement, not a zero.
 *
 * ⛔ AND NOTHING IS FILTERED. Dropping a bad entry would record a PARTIAL observation as
 * though it were complete, and the entry we dropped is exactly where a survivor hides.
 */
/**
 * ⛔ ELEMENTS ARE DEFINED, NEVER ASSIGNED.
 *
 * `out.push(pid)` is an ordinary assignment, so an inherited numeric SETTER on Array.prototype
 * swallowed it: the pid array came back with length 1 and NO own index 0. Worse, detachPids
 * validates its INPUT, so nothing threw here — put() wrote that malformed record to the store
 * and only the second validation, afterwards, noticed. defineProperty creates an own data
 * property and no inherited setter can intercept it.
 */
function defineElement (out, i, value) {
  Object.defineProperty(out, i, { value, writable: true, enumerable: true, configurable: true })
}

function detachPids (key, v) {
  if (!Array.isArray(v)) {
    throw new Error(`refuse: instance record '${key}' has no observedPids array`)
  }
  const length = v.length
  const out = []
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(v, i)
    if (!d) {
      throw new Error(`refuse: instance record '${key}' observedPids has a hole at index ${i}`)
    }
    if (typeof d.get === 'function' || typeof d.set === 'function') {
      throw new Error(`refuse: instance record '${key}' observedPids[${i}] is an accessor, not a measurement`)
    }
    if (!Number.isInteger(d.value) || d.value <= 0) {
      throw new Error(`refuse: instance record '${key}' observedPids[${i}] is not a positive integer pid (${JSON.stringify(d.value)})`)
    }
    defineElement(out, i, d.value)
  }
  // ⛔ AND THE RESULT IS CHECKED, NOT ASSUMED: if the copy is not what we just built, refuse.
  if (out.length !== length) {
    throw new Error(`refuse: instance record '${key}' observedPids could not be copied intact`)
  }
  for (let i = 0; i < length; i++) {
    if (!Object.prototype.hasOwnProperty.call(out, i)) {
      throw new Error(`refuse: instance record '${key}' observedPids[${i}] did not survive the copy`)
    }
  }
  return out
}

/**
 * ⛔ A MEASUREMENT IS READ ONCE, BEFORE IT IS VALIDATED.
 *
 * prepare() validated `spec.envelopeObject` and then buildInstanceRecord read `spec.envelopeObject`
 * AGAIN. With a getter on the spec, the first read returned the real identity and the second
 * returned a different, equally valid-looking one — so the record persisted a forged dev/ino
 * that the verifier would later compare against. The same held for repoObject and gatewayPort.
 *
 * Everything the caller measures is captured here, once, through own DATA descriptors, and
 * only the capture is used from that point on.
 */
/**
 * Read one field exactly once. An ACCESSOR is refused outright — a value that can change
 * between the read that validates it and the read that uses it is not a measurement.
 *
 * A MISSING field is not judged here: it is captured as undefined and refused by the existing
 * checks, so "you gave me no ino" keeps saying that rather than becoming a property-descriptor
 * complaint. Capture answers "what was there, once"; the checks below answer "is it valid".
 */
function captureOwn (obj, key, where) {
  const d = Object.getOwnPropertyDescriptor(obj, key)
  if (d && (typeof d.get === 'function' || typeof d.set === 'function')) {
    throw new Error(`refuse: ${where} must be an own data property (an accessor is not a measurement)`)
  }
  return d ? d.value : undefined
}

function captureMeasurements (spec) {
  const capture = Object.create(null)
  capture.gatewayPort = captureOwn(spec, 'gatewayPort', 'prepare gatewayPort')

  for (const field of ['envelopeObject', 'repoObject']) {
    const obj = captureOwn(spec, field, 'prepare ' + field)
    // anything that is not a genuine data object is passed straight through to isObjectIdentity,
    // which already refuses it — and which is the only place that message should come from
    if (!isDataObject(obj)) {
      capture[field] = obj
      continue
    }
    const identity = Object.create(null)
    identity.dev = captureOwn(obj, 'dev', 'prepare ' + field + '.dev')
    identity.ino = captureOwn(obj, 'ino', 'prepare ' + field + '.ino')
    capture[field] = identity
  }
  return capture
}

const RECORD_AUTHORITY = Object.freeze([
  'approvalId', 'instanceId', 'unitName', 'instanceMarker', 'state',
  'stateRoot', 'configPath', 'envelopeRoot', 'repoRoot',
  'envelopeObject', 'repoObject', 'gatewayPort', 'observedPids', 'observedControlGroup'
])

/**
 * ⛔ DEVICE AND INODE ARE CANONICAL DECIMAL STRINGS, NEVER NUMBERS.
 *
 * Review finding F2: they were JavaScript Numbers. Linux st_ino is 64-bit, and above
 * Number.MAX_SAFE_INTEGER two distinct inodes collapse onto the same Number — on the one check
 * whose entire purpose is to be exact. "9007199254740992" and "9007199254740993" are different
 * files and must stay different values.
 *
 * Canonical means: digits only, no sign, no whitespace, no exponent, no decimal point, and no
 * leading zeros (except "0" itself), so that string equality IS numeric equality.
 */
const CANONICAL_UINT = /^(0|[1-9][0-9]*)$/
const isCanonicalUint = (v) => typeof v === 'string' && CANONICAL_UINT.test(v)
const isObjectIdentity = (v) => {
  if (!isDataObject(v)) return false
  const dev = ownData(v, 'dev')
  const ino = ownData(v, 'ino')
  return dev !== null && ino !== null && isCanonicalUint(dev.value) && isCanonicalUint(ino.value)
}

/**
 * Build the record for a new instance — PURE, AND DELIBERATELY REACHABLE.
 *
 * The derived paths are written here and the spec is read ONLY for its measurements. A caller
 * cannot contribute a path even if the reserved-key screen on prepare() were removed: this
 * function never spreads the spec.
 *
 * It is exported because that independence is otherwise untestable — the screen refuses a
 * path-bearing spec before this code ever sees one, so a mutant that merged the spec over the
 * derivation survived the whole suite. Third time this project has met that shape (mergeRecord
 * in the quarantine, isRetirementAuthority in the verifier): a second line of defence that
 * nothing can reach is not a defence.
 */
function buildInstanceRecord (approvalId, spec, meta, stamp) {
  const paths = derivedPathsFor(approvalId)
  return Object.assign({}, meta, {
    approvalId,
    instanceId: instanceIdFor(approvalId),
    unitName: unitNameFor(approvalId),
    instanceMarker: instanceMarkerFor(approvalId),
    stateRoot: paths.stateRoot,
    configPath: paths.configPath,
    envelopeRoot: paths.envelopeRoot,
    repoRoot: paths.repoRoot,
    // ⛔ `spec` here is the CAPTURE, never the caller's object: no field is read twice.
    gatewayPort: spec.gatewayPort,
    envelopeObject: { dev: spec.envelopeObject.dev, ino: spec.envelopeObject.ino },
    repoObject: { dev: spec.repoObject.dev, ino: spec.repoObject.ino },
    restartPolicy: 'no',
    observedControlGroup: null,
    mainPid: null,
    observedPids: [],
    state: STATES.PREPARED,
    createdAt: stamp,
    updatedAt: stamp
  })
}

/**
 * ⛔ A RECORD WE CANNOT ACCOUNT FOR IS NOT AN EMPTY STORE.
 * Same reasoning as the quarantine ledger: `[]`, `null` and `"abc"` are all valid JSON, and
 * silently becoming "no instances" is the one answer that would let a second launch proceed
 * for an approval that already has a live executor.
 */
/**
 * ⛔ WHAT COMES BACK IS THE VALIDATED SNAPSHOT, NOT THE OBJECT WE WERE HANDED.
 *
 * assertStore used to return `parsed` itself, still rooted at Object.prototype, and record()
 * reads it as `all()[approvalId]`. Two things were reproduced from that one fact:
 *
 *   - with Object.prototype[approvalId] set, record() returned a WHOLLY FORGED record that
 *     assertStore had never seen — getOwnPropertyNames does not walk the prototype, so the
 *     validation loop skipped the only entry the caller would go on to read;
 *   - with an inherited SETTER for that key, put()'s `s[approvalId] = next` was swallowed:
 *     assertStore then validated a store with no such record and prepare() reported success
 *     while writing {}. The record that blocks a second launch had silently vanished.
 *
 * A null-prototype container of null-prototype records inherits nothing and traps nothing, so
 * a later read can only see what this function actually validated.
 */
function assertStore (parsed) {
  if (!isDataObject(parsed)) {
    throw new Error(`refuse: instance store is not a data object (got ${Array.isArray(parsed) ? 'array' : typeof parsed})`)
  }
  const snapshot = Object.create(null)
  for (const key of Object.getOwnPropertyNames(parsed)) {
    if (!SAFE_ID.test(key)) throw new Error(`refuse: instance store has an unsafe approvalId key '${key}'`)
    const slot = ownData(parsed, key)
    if (slot === null) throw new Error(`refuse: instance store entry '${key}' is not an own data property`)
    const raw = slot.value
    if (!isDataObject(raw)) throw new Error(`refuse: instance record '${key}' is not a data object`)
    // ⛔ EVERY AUTHORITATIVE FIELD IS READ ONCE, AS AN OWN DATA PROPERTY, BEFORE ANY CHECK.
    // Nothing below can be supplied by a prototype or recomputed by a getter.
    const rec = stableRecord(key, raw)
    authorityOf(key, rec, RECORD_AUTHORITY)
    snapshot[key] = rec
    if (rec.approvalId !== key) {
      throw new Error(`refuse: instance record '${key}' declares approvalId '${rec.approvalId}'`)
    }
    if (rec.instanceId !== instanceIdFor(key)) {
      throw new Error(`refuse: instance record '${key}' has a non-derived instanceId '${rec.instanceId}'`)
    }
    if (rec.unitName !== unitNameFor(key)) {
      throw new Error(`refuse: instance record '${key}' has a non-derived unitName '${rec.unitName}'`)
    }
    if (rec.instanceMarker !== instanceMarkerFor(key)) {
      throw new Error(`refuse: instance record '${key}' has a non-derived instanceMarker '${rec.instanceMarker}'`)
    }
    // ⛔ A STORED PATH THAT DISAGREES WITH THE DERIVATION IS REFUSED, NOT OBEYED.
    // Without this, editing the store by hand would still redirect the verifier's scans.
    const derived = derivedPathsFor(key)
    for (const p of ['stateRoot', 'configPath', 'envelopeRoot', 'repoRoot']) {
      if (rec[p] !== derived[p]) {
        throw new Error(`refuse: instance record '${key}' has a non-derived ${p} '${rec[p]}'`)
      }
    }
    if (!ORDER.includes(rec.state)) {
      throw new Error(`refuse: instance record '${key}' has unknown state '${rec.state}'`)
    }
    if (!isObjectIdentity(rec.envelopeObject)) {
      throw new Error(`refuse: instance record '${key}' has no canonical envelopeObject{dev,ino} strings`)
    }
    if (!isObjectIdentity(rec.repoObject)) {
      throw new Error(`refuse: instance record '${key}' has no canonical repoObject{dev,ino} strings`)
    }
    if (!Number.isInteger(rec.gatewayPort)) throw new Error(`refuse: instance record '${key}' has no gatewayPort`)
    if (rec.observedControlGroup !== null && typeof rec.observedControlGroup !== 'string') {
      throw new Error(`refuse: instance record '${key}' has a non-string observedControlGroup`)
    }
    // ⛔ A CONTROL GROUP CANNOT PRECEDE A LAUNCH.
    if (rec.observedControlGroup && rec.state === STATES.PREPARED) {
      throw new Error(`refuse: instance record '${key}' is PREPARED but already names a control group`)
    }
    // ⛔ THE NESTED AUTHORITY IN THE SNAPSHOT IS OURS, NOT THE STORE'S.
    // Done last, so the specific refusals above still fire first and say what is wrong.
    rec.envelopeObject = detachIdentity(rec.envelopeObject)
    rec.repoObject = detachIdentity(rec.repoObject)
    rec.observedPids = detachPids(key, rec.observedPids)
  }
  return snapshot
}

/**
 * @param {{
 *   store: { read: function, write: function },   REQUIRED. Injected; there is no default.
 *   now?: function
 * }} deps
 */
function createOpenClawInstanceManager (deps = {}) {
  const { store } = deps
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') {
    throw new TypeError('openClawInstanceManager requires an injected record store')
  }
  const now = typeof deps.now === 'function' ? deps.now : () => new Date().toISOString()

  const all = () => assertStore(store.read())

  function assertId (approvalId) {
    if (typeof approvalId !== 'string' || !SAFE_ID.test(approvalId)) {
      throw new Error(`refuse: unsafe approvalId ${JSON.stringify(String(approvalId).slice(0, 40))}`)
    }
  }

  function assertNoReservedKeys (meta, keys = PROTECTED, where = 'instance metadata') {
    if (!isPlainObject(meta)) return
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(meta, k)) {
        throw new Error(`refuse: '${k}' is authoritative and cannot be supplied as ${where}`)
      }
    }
  }

  /**
   * The ONE way this module changes an existing record: screen the metadata, apply the change,
   * then prove the pre-spawn baseline survived it. Every post-prepare method goes through here.
   */
  function mutate (approvalId, rec, meta, changes) {
    assertNoReservedKeys(meta)
    const next = Object.assign({}, rec, meta, changes, { updatedAt: now() })
    assertBaselineUnchanged(rec, next)
    return put(approvalId, next)
  }

  /**
   * ⛔ NEVER WRITE A RECORD WE WOULD REFUSE TO READ.
   *
   * assertStore() validated the store on the way IN; validating the result on the way OUT is
   * the second, independent guarantee that the derivation is authoritative. Without it, the
   * derivation was protected only by the reserved-key screen on the caller spec — one defence
   * wearing two hats, and a mutant that let a spec override the derived paths survived the
   * entire suite because the screen happened to block it first.
   */
  /**
   * ⛔ WRITE THE CANONICAL SNAPSHOT, AND RETURN A DIFFERENT ONE.
   *
   * This used to validate `s` and then write and return the PRE-canonical objects, discarding
   * everything assertStore had detached. So prepare() and observePids() handed the caller the
   * very objects the store kept, and mutating a return value rewrote persistent state.
   *
   * assertStore is run a second time on the canonical snapshot purely to mint an independent
   * object graph for the caller: same rules, no shared references, and it double-checks that
   * what we just wrote is something we would still accept on the way back in.
   */
  function put (approvalId, next) {
    const s = all()
    s[approvalId] = next
    // ⛔ NOTHING IS PERSISTED UNTIL EVERY VALIDATION HAS PASSED.
    // These ran either side of the write, so a canonical snapshot that was itself malformed —
    // an Array.prototype setter swallowing the pid copy produced exactly that — reached the
    // store first and was only rejected afterwards. The store had already kept it.
    const canonical = assertStore(s)
    const returned = assertStore(canonical)
    store.write(canonical)
    return returned[approvalId]
  }

  function record (approvalId) {
    assertId(approvalId)
    return all()[approvalId] || null
  }

  /**
   * Write the durable record. Nothing may be launched for this approval before this returns.
   *
   * ⛔ THE SPEC CARRIES MEASUREMENTS, NEVER PATHS.
   * gatewayPort comes from the trusted allocation seam (it is corroborating evidence, not
   * identity authority), and the two object identities are measured on disk before execution.
   * Every path is derived here and cannot be influenced by the caller.
   *
   * ⛔ A SECOND PREPARE FOR THE SAME APPROVAL IS REFUSED, ALWAYS.
   * Not "unless the first is finished" — always. A record that already exists is the
   * structural control that stops a retired identity being resurrected by a fresh launch
   * after the verifier has already looked at the world.
   */
  function prepare (approvalId, spec = {}, meta = {}) {
    assertId(approvalId)
    // metadata may carry neither an authored field NOR a pre-spawn measurement
    assertNoReservedKeys(meta)
    // the spec carries the three measurements and nothing else; a path or a stamp arriving
    // here is a caller trying to choose something this module authors
    assertNoReservedKeys(spec, RESERVED, 'spec')
    if (all()[approvalId]) {
      throw new Error(`refuse: approval '${approvalId}' already has an instance record; identity is never reused`)
    }
    // ⛔ CAPTURE FIRST, VALIDATE THE CAPTURE, BUILD FROM THE CAPTURE.
    // Nothing below ever touches `spec` again.
    const measured = captureMeasurements(spec)
    if (!Number.isInteger(measured.gatewayPort)) throw new Error('refuse: prepare requires an integer gatewayPort')
    // ⛔ THE OBJECT IDENTITY IS RECORDED BEFORE EXECUTION, NOT AFTER.
    // A baseline taken afterwards would be a baseline of whatever is standing there now.
    if (!isObjectIdentity(measured.envelopeObject)) {
      throw new Error('refuse: prepare requires envelopeObject {dev, ino} as canonical decimal strings')
    }
    if (!isObjectIdentity(measured.repoObject)) {
      throw new Error('refuse: prepare requires repoObject {dev, ino} as canonical decimal strings')
    }

    return put(approvalId, buildInstanceRecord(approvalId, measured, meta, now()))
  }

  /** The boundary: after this returns, an executor may exist. Monotonic. */
  function launchAttempted (approvalId, meta = {}) {
    assertId(approvalId); assertNoReservedKeys(meta)
    const rec = record(approvalId)
    if (!rec) throw new Error(`refuse: approval '${approvalId}' has no instance record; nothing may be launched`)
    if (rec.state !== STATES.PREPARED) {
      throw new Error(`refuse: '${approvalId}' is ${rec.state}; a launch may be attempted exactly once`)
    }
    return mutate(approvalId, rec, meta, { state: STATES.LAUNCH_ATTEMPTED })
  }

  /**
   * ⛔ APPEND-ONCE, AND ONLY FROM A POSITIVE OBSERVATION.
   * Rewriting this later would let a caller re-aim the stop at a different cgroup after the
   * fact — the one field where being wrong means signalling somebody else's processes.
   */
  function observeControlGroup (approvalId, controlGroup, meta = {}) {
    assertId(approvalId); assertNoReservedKeys(meta)
    const rec = record(approvalId)
    if (!rec) throw new Error(`refuse: approval '${approvalId}' has no instance record`)
    if (typeof controlGroup !== 'string' || controlGroup === '') {
      throw new Error('refuse: observeControlGroup requires the measured control group path')
    }
    if (rec.state === STATES.PREPARED) {
      throw new Error(`refuse: '${approvalId}' has not attempted a launch; there is no control group to observe`)
    }
    if (rec.observedControlGroup !== null) {
      if (rec.observedControlGroup === controlGroup) return rec
      throw new Error(`refuse: '${approvalId}' already observed control group '${rec.observedControlGroup}'; it is append-once`)
    }
    const next = ORDER.indexOf(rec.state) < ORDER.indexOf(STATES.OBSERVED) ? STATES.OBSERVED : rec.state
    return mutate(approvalId, rec, meta, { observedControlGroup: controlGroup, state: next })
  }

  /**
   * Append-only, de-duplicated. Sampling cannot be complete — X2-B watched short-lived `sleep`
   * children appear and vanish between samples — so this set corroborates, and the control
   * group remains the boundary.
   */
  /**
   * One descriptor-based read of the caller's measurement, validated as it is captured.
   * A scalar is a single pid; an array must be complete own data, positive integers only.
   */
  function captureIncomingPids (pids) {
    const refuse = (v) => new Error('refuse: observePids requires positive integer pids; got ' +
      JSON.stringify(v) + ' — the whole observation is refused')
    if (!Array.isArray(pids)) {
      if (!Number.isInteger(pids) || pids <= 0) throw refuse(pids)
      const one = []
      defineElement(one, 0, pids)
      return one
    }
    const length = pids.length
    const out = []
    for (let i = 0; i < length; i++) {
      const d = Object.getOwnPropertyDescriptor(pids, i)
      if (!d) {
        throw new Error(`refuse: observePids received a hole at index ${i}; the whole observation is refused`)
      }
      if (typeof d.get === 'function' || typeof d.set === 'function') {
        throw new Error(`refuse: observePids[${i}] is an accessor, not a measurement; the whole observation is refused`)
      }
      if (!Number.isInteger(d.value) || d.value <= 0) throw refuse(d.value)
      defineElement(out, i, d.value)
    }
    if (out.length !== length) throw new Error('refuse: observePids measurement could not be copied intact')
    return out
  }

  function observePids (approvalId, pids, meta = {}) {
    assertId(approvalId); assertNoReservedKeys(meta)
    const rec = record(approvalId)
    if (!rec) throw new Error(`refuse: approval '${approvalId}' has no instance record`)
    if (rec.state === STATES.PREPARED) {
      throw new Error(`refuse: '${approvalId}' has not attempted a launch; it can have no processes`)
    }
    // ⛔ A MALFORMED MEASUREMENT REFUSES THE WHOLE OBSERVATION.
    // Silently dropping bad entries would record a PARTIAL observation as though it were a
    // complete one — and this set is exactly what the verifier later checks for survivors.
    // Half a sample that looks whole is worse than a refusal, so nothing is written at all.
    // ⛔ THE MEASUREMENT IS SNAPSHOTTED BEFORE IT IS VALIDATED.
    // With an accessor element the caller's array returned 93018 to the validator and 4242 to
    // everything afterwards, so the record persisted observedPids [4242] / mainPid 4242 — a
    // survivor list built from a value that was never checked.
    const incoming = captureIncomingPids(pids)
    const merged = Array.from(new Set(rec.observedPids.concat(incoming))).sort((a, b) => a - b)
    const mainPid = rec.mainPid === null && incoming.length ? incoming[0] : rec.mainPid
    return mutate(approvalId, rec, meta, { observedPids: merged, mainPid })
  }

  /**
   * One stop is requested; the manager records the intent, never the outcome.
   * This is the LAST state this module has. What happened afterwards is a question only the
   * retirement verifier may answer, from the operating system.
   */
  function requestStop (approvalId, meta = {}) {
    assertId(approvalId); assertNoReservedKeys(meta)
    const rec = record(approvalId)
    if (!rec) throw new Error(`refuse: approval '${approvalId}' has no instance record`)
    if (ORDER.indexOf(rec.state) < ORDER.indexOf(STATES.LAUNCH_ATTEMPTED)) {
      throw new Error(`refuse: '${approvalId}' is ${rec.state}; nothing was launched to stop`)
    }
    return mutate(approvalId, rec, meta, { state: STATES.STOP_REQUESTED })
  }

  return {
    STATES,
    prepare,
    launchAttempted,
    observeControlGroup,
    observePids,
    requestStop,
    record,
    all
  }
}

module.exports = {
  createOpenClawInstanceManager,
  instanceIdFor,
  unitNameFor,
  instanceMarkerFor,
  derivedPathsFor,
  buildInstanceRecord,
  assertBaselineUnchanged,
  assertStore,
  isCanonicalUint,
  STATES,
  SAFE_ID,
  INSTANCE_ROOT,
  SANDBOX_ROOT
}
