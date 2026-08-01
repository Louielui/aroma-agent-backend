'use strict'

/**
 * identityFieldContract.test.js — the collector and its readers must agree on field NAMES.
 *
 * ── WHAT THIS WOULD HAVE CAUGHT ────────────────────────────────────────────
 * On the first real AromaOperator login, all three tools failed closed and the screen said:
 *
 *     Account              -      OK
 *     Own desktop session  yes    <-- PROBLEM
 *     RESULT: The account name does not match the account this is meant to be.
 *
 * Three separate contradictions, one cause. collect-identity.ps1 emits `account`, `isElevated`
 * and `isInteractive`; the display read `name`, `elevated` and `interactive`. Every one of those
 * reads returned `undefined`:
 *
 *   . `s.name` -> undefined -> printed "-", while the OK marker was computed from `s.sid`,
 *     which was correct. A blank value with a tick beside it.
 *   . `s.interactive` -> undefined -> `undefined === true` is false -> a correct row marked
 *     PROBLEM.
 *   . `s.elevated` -> undefined -> printed "no" and ticked OK. THE WORST OF THE THREE, and the
 *     one nobody saw: that row would have said "no / OK" for an ELEVATED token, because it was
 *     never reading anything at all.
 *
 * A field-name mismatch across a language boundary produces no error anywhere. JavaScript hands
 * back `undefined` and every expression built on it keeps working — quietly, and with a
 * plausible answer.
 *
 * ── SO THE NAMES ARE CHECKED AGAINST THE COLLECTOR'S OWN SOURCE ────────────
 * The `Emit @{ ... }` block in the .ps1 is parsed here and treated as the contract. No
 * PowerShell runs; this is a source-level check, so it works on any machine, in any session,
 * with no operator account and no login. Which is exactly the property the tools lacked.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')
const COLLECTOR = path.join(REPO, 'scripts', 'computer', 'collect-identity.ps1')
const TOOLS = path.join(REPO, 'scripts', 'computer', 'operatorToolsCommon.js')

const { REQUIRED_FIELDS } = require('./identityAttestation')
const { IDENTITY_ROWS } = require('../../scripts/computer/operatorToolsCommon')

/**
 * The field names the collector actually emits, read from its `Emit @{ ... }` block.
 *
 * Deliberately not a hand-kept list: a second copy of the contract is the thing that drifts.
 */
function emittedFields () {
  const src = fs.readFileSync(COLLECTOR, 'utf8').replace(/<#[\s\S]*?#>/g, '').replace(/#.*$/gm, '')
  const start = src.indexOf('Emit @{')
  assert.ok(start > 0, 'the collector has an Emit block')
  // Balance braces from the opening one, so a nested hashtable cannot end the block early.
  let depth = 0
  let end = -1
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  assert.ok(end > start, 'the Emit block closes')
  const body = src.slice(start, end)
  const names = new Set()
  for (const m of body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) names.add(m[1])
  return names
}

test('*** the collector emits every field the judge requires ***', () => {
  const emitted = emittedFields()
  const missing = REQUIRED_FIELDS.filter((f) => !emitted.has(f))
  assert.deepEqual(missing, [],
    'the judge requires fields the collector never sends — every snapshot would be incomplete_attestation')
})

test('*** the collector emits every field the DISPLAY reads ***', () => {
  // The three that were wrong. Declared per row, so a new row cannot add a name without this
  // noticing.
  const emitted = emittedFields()
  const declared = IDENTITY_ROWS.flatMap((r) => r.fields)
  const missing = declared.filter((f) => !emitted.has(f))
  assert.deepEqual(missing, [], 'a display row reads a field the collector does not send')

  // Named individually, because these are the actual three:
  for (const f of ['account', 'isElevated', 'isInteractive']) {
    assert.ok(emitted.has(f), 'the collector emits: ' + f)
    assert.ok(declared.includes(f), 'and a row declares it: ' + f)
  }
  for (const wrong of ['name', 'elevated', 'interactive']) {
    assert.equal(emitted.has(wrong), false, 'the collector does NOT emit: ' + wrong)
    assert.equal(declared.includes(wrong), false, 'and no row reads it any more: ' + wrong)
  }
})

test('*** every snapshot field the tools touch by name exists in the Emit block ***', () => {
  // The catch-all. The two tests above cover declared lists; this one scans the source for any
  // `s.<field>` or `snapshot.<field>` access, so a field read inline — as all three broken ones
  // were — cannot slip past a declaration.
  const emitted = emittedFields()
  const src = fs.readFileSync(TOOLS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const NOT_SNAPSHOT_FIELDS = new Set(['ok', 'refusal', 'human', 'detail', 'reason', 'result', 'snapshot', 'verdict', 'length', 'files', 'receipt', 'packageHash', 'changedFiles', 'rows', 'path', 'writable', 'count', 'entries', 'protected', 'inheritedCount', 'denyCount', 'aces', 'value', 'label', 'key', 'fields', 'owns', 'render'])
  const read = new Set()
  for (const m of src.matchAll(/\bs\.([A-Za-z_][A-Za-z0-9_]*)/g)) read.add(m[1])
  for (const m of src.matchAll(/\bsnapshot\.([A-Za-z_][A-Za-z0-9_]*)/g)) read.add(m[1])
  const suspects = [...read].filter((f) => !NOT_SNAPSHOT_FIELDS.has(f))
  assert.ok(suspects.length >= 3, 'the scan found snapshot reads at all — not a vacuous pass: ' + suspects.join(', '))

  const unknown = suspects.filter((f) => !emitted.has(f))
  assert.deepEqual(unknown, [], 'these are read off the snapshot and never emitted: ' + unknown.join(', '))
})

test('*** POSITIVE CONTROL — reading a field the collector does not emit turns this RED ***', () => {
  // Without this, "no unknown fields" could mean the parser returned everything, or nothing.
  const emitted = emittedFields()
  assert.ok(emitted.size >= 12, 'the Emit block really was parsed: ' + emitted.size + ' fields')
  assert.ok(emitted.has('account'), 'and it contains a known field')

  // The exact three mistakes, asserted to be detectable.
  for (const invented of ['name', 'elevated', 'interactive', 'userName', 'isAdmin']) {
    assert.equal(emitted.has(invented), false,
      'a field name that does not exist must not be reported as present: ' + invented)
  }

  // And the rule applied to a synthetic reader proves the comparison itself works.
  const fakeReads = ['account', 'name']
  const fakeUnknown = fakeReads.filter((f) => !emitted.has(f))
  assert.deepEqual(fakeUnknown, ['name'], 'the check catches a reader using the old wrong name')
})

test('the Emit block is the only place field names are defined', () => {
  // If the collector grew a second emit path, the contract would cover one of them.
  const src = fs.readFileSync(COLLECTOR, 'utf8').replace(/#.*$/gm, '')
  assert.equal((src.match(/Emit @\{/g) || []).length, 1, 'exactly one Emit block')
})
