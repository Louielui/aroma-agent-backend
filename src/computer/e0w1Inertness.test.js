'use strict'

/**
 * e0w1Inertness.test.js — E0-W1 COMMIT C. What this tranche must NOT have become.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Two jobs, both of them the kind that is easy to assume and expensive to assume wrongly.
 *
 * 1. THE SPENT LEDGER HAS NO TEST ON THE REFERENCE BRANCH. `orderRegistry.js` gained a
 *    single-use ledger, `retire()`, `invalidate()` and `approval_id_already_used` — and
 *    `orderRegistry.test.js` is BYTE-IDENTICAL between the two branches. A safety mechanism
 *    shipped with no proof, so the proof is written here rather than inherited.
 *
 * 2. INERTNESS IS A CLAIM ABOUT THE WHOLE REPOSITORY, not about one module. Every previous
 *    round of this project found a control that existed and was never reached. These assert
 *    reach, from the running application inward.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..')
const DIR = __dirname

const codeOf = (name) => fs.readFileSync(path.join(DIR, name), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/* ═══ R1–R3 — the spent ledger, which arrived without a test ═════════════════ */

const { createOrderRegistry } = require('./orderRegistry')
const OPEN = { approvalId: 'a1', workOrderHash: 'h1', stepCount: 2, timeoutSec: 60 }

test('*** R1. ⛔ AN APPROVAL ID CANNOT BE REUSED AFTER close() ***', () => {
  const r = createOrderRegistry({ now: () => 1000 })
  assert.equal(r.admit(OPEN).ok, true)
  assert.equal(r.close('a1').ok, true)
  const again = r.admit(OPEN)
  assert.equal(again.ok, false, '⛔ a closed order was reopened')
  assert.equal(again.reason, 'approval_id_already_used')
  assert.equal(again.priorReason, 'closed')
})

test('*** R2. ⛔ NOR AFTER IT EXPIRES ***', () => {
  // ⛔ Expiry is the quieter path: nobody calls anything, the order just ages out. If the
  // ledger only retired on close, a timed-out approval would be replayable forever.
  let t = 1000
  const r = createOrderRegistry({ now: () => t })
  assert.equal(r.admit({ approvalId: 'a2', workOrderHash: 'h', stepCount: 1, timeoutSec: 1 }).ok, true)
  t += 5000
  const again = r.admit({ approvalId: 'a2', workOrderHash: 'h', stepCount: 1, timeoutSec: 60 })
  assert.equal(again.ok, false, '⛔ an expired approval id was reusable')
  assert.equal(again.reason, 'approval_id_already_used')
  assert.equal(again.priorReason, 'expired')
})

test('*** R3. ⛔ A DIFFERENT ORDER REUSING AN ID IS DISTINGUISHED, AND STILL REFUSED ***', () => {
  /**
   * ⛔ BOTH HALVES MATTER. Refusing is the safety property. Reporting `hashMatches` is what
   * tells a repair whether this was the same order retried or a DIFFERENT order wearing a
   * spent id — which are an operational mistake and an attack, and they should not read alike.
   */
  const r = createOrderRegistry({ now: () => 1000 })
  r.admit(OPEN)
  r.close('a1')
  const same = r.admit({ approvalId: 'a1', workOrderHash: 'h1', stepCount: 2, timeoutSec: 60 })
  assert.equal(same.ok, false)
  assert.equal(same.hashMatches, true, 'the same order retried')
  const different = r.admit({ approvalId: 'a1', workOrderHash: 'DIFFERENT', stepCount: 2, timeoutSec: 60 })
  assert.equal(different.ok, false)
  assert.equal(different.hashMatches, false, '⛔ a different order reusing a spent id looked identical')
})

test('*** R3b. THE DRY-RUN SEAM IS PRESERVED — singleUse:false is deliberate ***', () => {
  // ⛔ The supervisor opts out on purpose: a dry run is not an execution and must be repeatable.
  // Pinned so the opt-out cannot be "tidied away" later, and so it cannot silently widen either.
  const r = createOrderRegistry({ now: () => 1000, singleUse: false })
  assert.equal(r.admit(OPEN).ok, true)
  r.close('a1')
  assert.equal(r.admit(OPEN).ok, true, 'a dry run may repeat')
  assert.ok(codeOf('computerSupervisor.js').includes('singleUse: false'),
    'and the supervisor is where that opt-out lives')
})

/* ═══ C7 — no request field can turn a capability on ════════════════════════ */

test('*** C7. ⛔ NOTHING IN A REQUEST CAN ENABLE A CAPABILITY ***', () => {
  const { createCompanion, CAPABILITIES } = require('./companion')
  const audits = []
  const c = createCompanion({ now: () => 1, onAudit: (a) => audits.push(a) })
  // Every shape a caller might hope turns something on.
  for (const step of [
    { action: 'list_windows', enable: true },
    { action: 'open_app', capabilities: { open_app: true } },
    { action: 'send_keys', flag: 'on', COMPUTER_OPERATOR: 'on' }
  ]) {
    const reply = c.handle({ from: 'service', to: 'companion', type: 'execute_step', approvalId: 'a', stepIndex: 0, step })
    const body = reply && (reply.result || reply)
    assert.notEqual(body && body.ok, true, '⛔ a request field enabled something: ' + JSON.stringify(step))
  }
  assert.equal(Object.values(CAPABILITIES).some((v) => v === true), false, '⛔ a register value became true')
})

/* ═══ I1–I5 — inertness, asserted from the application inward ═══════════════ */

test('*** I1. ⛔ app.js HAS ZERO REACH INTO ANY W1 CAPABILITY ***', () => {
  const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8')
  for (const name of ['computer/', 'observation', 'observerKill', 'sealedOrderGate', 'companion', 'COMPUTER_OPERATOR']) {
    assert.equal(app.includes(name), false, '⛔ app.js reaches ' + name)
  }
})

test('*** I2. ⛔ COMPUTER_OPERATOR IS STILL ZERO-EFFECT AT RUNTIME ***', () => {
  /**
   * ⛔ MEASURED FROM THE CALLERS, NOT FROM THE COMMENT. The flag file has always SAID it is
   * read by nobody; the question is who calls `resolveComputerOperator` now. After Commit C
   * exactly one module does — the Companion, which no runtime path constructs — so setting
   * the variable still changes nothing in the running backend.
   */
  const callers = []
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      if (fs.statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.js$/.test(n) || /\.test\.js$/.test(n)) continue
      if (n === 'computerOperatorFlag.js') continue
      if (/resolveComputerOperator/.test(fs.readFileSync(p, 'utf8'))) callers.push(n)
    }
  }
  walk(SRC)
  assert.deepEqual(callers, ['companion.js'], 'only the Companion reads it: ' + callers.join(', '))
  // and nothing in the running application builds a Companion
  const builders = []
  const walk2 = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      if (fs.statSync(p).isDirectory()) { walk2(p); continue }
      if (!/\.js$/.test(n) || /\.test\.js$/.test(n)) continue
      if (n === 'companion.js' || n === 'companion-entry.js') continue
      // ⛔ THE CALL, NOT THE PREFIX. `createCompanionEndpoint` in ipcChannel.js is the IPC
      // listener — a different thing entirely — and a loose match reported it as a builder that
      // constructs a Companion. A false positive here would have hidden the real question.
      if (/createCompanion\s*\(/.test(fs.readFileSync(p, 'utf8'))) builders.push(n)
    }
  }
  walk2(SRC)
  assert.deepEqual(builders, [], '⛔ something in src/ constructs a Companion: ' + builders.join(', '))
})

test('*** I3. ⛔ NO OBSERVATION CAPABILITY IS ENABLED, IN EITHER REGISTER ***', () => {
  const { OBSERVATION_CAPABILITIES, anyObservationEnabled } = require('./observation')
  const { CAPABILITIES, anyCapabilityEnabled } = require('./companion')
  assert.deepEqual(OBSERVATION_CAPABILITIES, { list_windows: false, read_uia_tree: false, capture_screen: false })
  assert.equal(anyObservationEnabled(), false)
  assert.equal(CAPABILITIES.list_windows, false)
  assert.equal(CAPABILITIES.read_ui_tree, false)
  assert.equal(CAPABILITIES.capture_own_screen, false)
  assert.equal(anyCapabilityEnabled(), false)
})

test('*** I4. ⛔ NOTHING IN src/computer CAN RUN A TASK, A PROCESS OR POWERSHELL ***', () => {
  /**
   * ⛔ THE WHOLE SUITE RUNS AGAINST FAKES, AND THIS IS WHY THAT IS STRUCTURAL RATHER THAN A
   * HABIT. No module here can spawn anything, so no test COULD have started a real Observer
   * even by mistake. `observerKill.js` takes its OS adapter by injection for exactly this.
   */
  const banned = /child_process|execSync|spawnSync|Stop-ScheduledTask|Start-ScheduledTask|Stop-Process|Register-ScheduledTask/
  const offenders = fs.readdirSync(DIR)
    .filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))
    .filter((n) => banned.test(codeOf(n)))
  assert.deepEqual(offenders, [], '⛔ a module can reach the OS: ' + offenders.join(', '))
})

test('*** I5. THE rootUntouched HELPER AND ITS INVARIANT SURVIVE THE PORT ***', () => {
  // ⛔ The reference branch deleted this file. It is main's, it is kept, and it is still used —
  // "the reference lacks it" is not a reason to drop a guard.
  const helper = path.join(DIR, 'rootUntouched.helper.js')
  assert.equal(fs.existsSync(helper), true, '⛔ rootUntouched.helper.js was lost in the port')
  const consumers = fs.readdirSync(DIR).filter((n) => n.endsWith('.test.js') &&
    fs.readFileSync(path.join(DIR, n), 'utf8').includes('rootUntouched.helper'))
  assert.ok(consumers.length > 0, '⛔ nothing consumes it any more: it would be dead weight')
})

/* ═══ C3 / C4 — the Companion never builds itself an executor ════════════════ */

test('*** C3. ⛔ THE DEFAULT COMPANION CONSTRUCTS NO EXECUTOR ***', () => {
  /**
   * ⛔ WRITTEN BECAUSE A MUTATION SURVIVED. Replacing the `: null` default with a working stub
   * executor left every other test green — the gate refuses a restricted action long before the
   * executor is reached, so no message path can observe the difference. The property is real and
   * only visible in the source, so that is where it is asserted rather than pretended otherwise.
   *
   * It matters because the ordering is the safety: the gate is consulted BEFORE the executor is
   * so much as named. A default executor would mean the only thing standing between a forged
   * order and a desktop action is the gate being correct, instead of the gate being correct AND
   * there being nothing to run.
   */
  const src = codeOf('companion.js')
  assert.match(src, /const executor = \(deps\.executor && typeof deps\.executor\.execute === 'function'\) \? deps\.executor : null/,
    '⛔ the executor default is no longer null — the Companion can build one')
  // and it imports nothing that could execute anything
  for (const forbidden of ['computerExecutor', 'desktopAdapter', 'machineProbe', 'powershellJsonRunner', 'companionProductionFactory']) {
    assert.equal(src.includes(forbidden), false, '⛔ companion.js reaches an execution module: ' + forbidden)
  }
})

test('*** C4. ⛔ AND THE REFUSAL PATH NAMES THE MISSING EXECUTOR RATHER THAN PROCEEDING ***', () => {
  // The branch exists and says `no_executor`. If it were ever removed, an unlocked action would
  // fall through to whatever came next instead of stopping.
  const src = codeOf('companion.js')
  assert.match(src, /if \(!executor\)/, '⛔ the no-executor guard is gone')
  assert.match(src, /refusalReason: 'no_executor'/, '⛔ the refusal is no longer named')
  /**
   * The gate is consulted before the executor is CALLED — asserted on the source order.
   *
   * ⛔ AND ON THE CALL, NOT ON THE STRING. The first draft searched for `executor.execute`,
   * which matches the `typeof deps.executor.execute === 'function'` type-check at the top of
   * the factory — before the gate, and nothing to do with running anything. It reported the
   * invariant broken on correct code. Same loose-match mistake as `createCompanion` above,
   * found twice in one file, which is the reason both are now anchored to the invocation.
   */
  const gateAt = src.indexOf('gate.verifyUnlock')
  const execAt = src.indexOf('executor.execute(envelope.order')
  assert.ok(gateAt > 0, 'the gate is consulted at all')
  assert.ok(execAt > 0, 'the executor is invoked with the order')
  assert.ok(gateAt < execAt, '⛔ the executor is reached before the gate')
})
