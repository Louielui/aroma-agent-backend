'use strict'

/**
 * settingsBlankWrite.test.js — what an unloaded page would actually have written.
 *
 * The client guard (`demo/settingsSaveGuard.test.js`) proves the page will no longer submit a
 * state it never read. This proves the other half: that submitting one WOULD have destroyed
 * real settings, and exactly how much. Without this, 「it would overwrite your settings with
 * blanks」 is a claim about code I read rather than a measured outcome.
 *
 * ⛔ THROWAWAY ROOT, NEVER THE OWNER'S. Owner: 「Do not test the POST against my real settings.
 * If proving the gate requires a write, use a throwaway path — the same discipline as the
 * payment probe on a disposable profile.」 `save()`/`load()` take `opts.root`, so every write
 * below lands in an os.tmpdir() directory that is removed in `finally`. `applyFlags` likewise
 * takes an `env` object, so no test here touches `process.env`.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { load, save, applyFlags } = require('./ownerSettings')

function tmpRoot () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-blankwrite-'))
}
function rm (root) {
  try { fs.rmSync(root, { recursive: true, force: true }) } catch (_) {}
}

test('*** ⛔ THE HAZARD WAS REAL: empty strings overwrite real settings ***', () => {
  const root = tmpRoot()
  try {
    // What the Owner actually has: instructions he wrote and relies on.
    const first = save({ style: 'REAL STYLE', preferences: 'REAL PREFERENCES' }, { root, env: {} })
    assert.equal(first.ok, true)
    assert.equal(load({ root }).style, 'REAL STYLE')

    // What an unloaded page submits: the empty textareas, verbatim.
    const blanked = save({ style: '', preferences: '' }, { root, env: {} })

    assert.equal(blanked.ok, true, 'the server ACCEPTS it — an empty string IS a string')
    assert.equal(load({ root }).style, '', 'his standing instruction, gone')
    assert.equal(load({ root }).preferences, '', 'and his preferences with it')
  } finally { rm(root) }
})

test('*** an ABSENT field is left alone — the accept is specific to empty-string, not to omission ***', () => {
  const root = tmpRoot()
  try {
    save({ style: 'REAL STYLE', preferences: 'REAL PREFERENCES' }, { root, env: {} })
    save({ style: 'CHANGED' }, { root, env: {} }) // preferences omitted entirely
    assert.equal(load({ root }).style, 'CHANGED')
    assert.equal(load({ root }).preferences, 'REAL PREFERENCES',
      'omission means 「no opinion」 and is correctly preserved — which is why the empty STRING is the trap')
  } finally { rm(root) }
})

/**
 * ── THE FLAGS RULING, PROVEN RATHER THAN ARGUED ──────────────────────────────
 *
 * > Owner: 「Say whether merge is the right fix or whether wholesale replacement is deliberate
 * > — do not change it on my say-so if there is a reason I cannot see.」
 *
 * Wholesale replacement is deliberate and merge would be WRONG. The reason is below, in the
 * one behaviour that makes it visible: an empty {} does NOT wipe the running configuration,
 * because `applyFlags` only ever WRITES the keys present. The saved flags object is therefore
 * a set of OVERRIDES the Owner has chosen, not a state vector — and with merge, a flag could
 * never leave that set, so 「I no longer have an opinion on this switch」 would be inexpressible.
 */
test('*** an empty {} does NOT wipe the running config — applyFlags only ever writes ***', () => {
  const env = { CONVERSATION_RECALL: 'on', CONTEXT_DRIVE: 'on', DECISION_RECALL: 'on' }
  applyFlags({}, env)
  assert.deepEqual(env, { CONVERSATION_RECALL: 'on', CONTEXT_DRIVE: 'on', DECISION_RECALL: 'on' },
    'the live process is untouched — this is why 「config wipe」 was the wrong description')
})

test('*** an empty {} DOES clear the persisted record of what he chose ***', () => {
  const root = tmpRoot()
  try {
    save({ flags: { CONVERSATION_RECALL: 'on', DECISION_RECALL: 'off' } }, { root, env: {} })
    assert.deepEqual(load({ root }).flags, { CONVERSATION_RECALL: 'on', DECISION_RECALL: 'off' })

    save({ flags: {} }, { root, env: {} })
    assert.deepEqual(load({ root }).flags, {},
      'wholesale replacement: the set of overrides is now empty. This is the real loss — the ' +
      'record of which switches he had an opinion about, not the switches themselves.')
  } finally { rm(root) }
})

test('*** replacement is what makes UN-setting possible — the reason merge would be wrong ***', () => {
  const root = tmpRoot()
  try {
    save({ flags: { CONVERSATION_RECALL: 'on' } }, { root, env: {} })
    // Under MERGE this would be impossible: CONVERSATION_RECALL could never leave the set,
    // and `setByOwner` would be permanently true for every switch ever touched.
    save({ flags: { DECISION_RECALL: 'on' } }, { root, env: {} })
    const after = load({ root }).flags
    assert.deepEqual(after, { DECISION_RECALL: 'on' })
    assert.equal(Object.prototype.hasOwnProperty.call(after, 'CONVERSATION_RECALL'), false,
      'the Owner can withdraw an override and fall back to whatever the launcher sets')
  } finally { rm(root) }
})
