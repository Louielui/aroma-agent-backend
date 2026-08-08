'use strict'

/**
 * strictSchemaCompat.test.js — the fence that should have existed before the live 400.
 *
 * ⛔ WHAT IT COST TO NOT HAVE THIS. OpenAI strict Structured Outputs REJECT any object node
 * whose `properties` are not all listed in `required` — optionality is expressed as a NULL
 * UNION, never by omission. Two additions of mine broke that rule (`answerClaims`, then
 * `nextRead`), and the result was a live HTTP 400 `invalid_json_schema` on EVERY OpenAI turn,
 * silently falling back to Claude.
 *
 * No deterministic test could see it: every fake adapter in this repo returns a canned string
 * and never validates the schema it was handed. Only the live canary found it.
 *
 * This walks the ACTUAL schema that is sent and asserts the constraint at every node.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { DISTILL_WITH_PLAN_SCHEMA, ANSWER_PLAN_SCHEMA, withRowRefs, withReadChoices } = require('./answerPlan')

/** Every object node carrying `properties`, with its path. */
function objectNodes (node, path, out) {
  if (!node || typeof node !== 'object') return out
  if (node.properties && typeof node.properties === 'object') out.push({ path, node })
  for (const k of Object.keys(node)) objectNodes(node[k], path + '.' + k, out)
  return out
}

function violations (schema) {
  return objectNodes(schema, 'root', []).flatMap(({ path, node }) => {
    const req = Array.isArray(node.required) ? node.required : []
    return Object.keys(node.properties)
      .filter((k) => !req.includes(k))
      .map((k) => path + '.' + k)
  })
}

test('*** ⛔ every property is in required, at every node — strict-mode compatibility ***', () => {
  for (const [name, schema] of [['DISTILL_WITH_PLAN_SCHEMA', DISTILL_WITH_PLAN_SCHEMA], ['ANSWER_PLAN_SCHEMA', ANSWER_PLAN_SCHEMA]]) {
    assert.deepEqual(violations(schema), [],
      name + ': a property missing from required is a live 400 from OpenAI, not a style issue')
  }
})

test('*** the SHAPED schema — what is actually sent — is compatible too ***', () => {
  // withRowRefs + withReadChoices rewrite the schema per call. The transform must not
  // reintroduce the defect, which a check on the static object alone would never see.
  for (const choices of [[], ['gmail'], ['aroma_system', 'gmail']]) {
    const shaped = withReadChoices(withRowRefs(DISTILL_WITH_PLAN_SCHEMA, ['aroma_system#1']), choices)
    assert.deepEqual(violations(shaped), [], 'choices=' + JSON.stringify(choices))
  }
})

test('*** optionality is expressed as a NULL UNION, never by omission ***', () => {
  assert.deepEqual(DISTILL_WITH_PLAN_SCHEMA.properties.nextRead.type, ['object', 'null'])
  assert.deepEqual(ANSWER_PLAN_SCHEMA.properties.answerClaims.type, ['array', 'null'])
  assert.equal(DISTILL_WITH_PLAN_SCHEMA.required.includes('nextRead'), true)
  assert.equal(ANSWER_PLAN_SCHEMA.required.includes('answerClaims'), true)
})

test('*** ⛔ SEEN TO FAIL: an omitted property is detected ***', () => {
  const broken = JSON.parse(JSON.stringify(DISTILL_WITH_PLAN_SCHEMA))
  broken.required = broken.required.filter((k) => k !== 'nextRead')
  assert.deepEqual(violations(broken), ['root.nextRead'],
    'if this ever returns [] the fence is dead and the next 400 ships silently')
})

/* ═══ BLOCKER 2 — THE CHOICES SHOWN TO THE MODEL ═══════════════════════════ */

test('*** the model is shown ONLY unread authorised sources ***', () => {
  const shaped = withReadChoices(DISTILL_WITH_PLAN_SCHEMA, ['gmail'])
  assert.deepEqual(shaped.properties.nextRead.properties.capability.enum, ['gmail'],
    'aroma_system was already read this turn, so it is not offered again')
})

test('*** with nothing left to read, nextRead is NULL-ONLY — never an empty enum ***', () => {
  const shaped = withReadChoices(DISTILL_WITH_PLAN_SCHEMA, [])
  assert.equal(shaped.properties.nextRead.type, 'null')
  assert.equal(shaped.properties.nextRead.properties, undefined, 'an empty enum is itself invalid')
  assert.deepEqual(violations(shaped), [])
})

test('*** the source schema is never mutated ***', () => {
  const before = JSON.stringify(DISTILL_WITH_PLAN_SCHEMA)
  withReadChoices(DISTILL_WITH_PLAN_SCHEMA, ['gmail'])
  withReadChoices(DISTILL_WITH_PLAN_SCHEMA, [])
  assert.equal(JSON.stringify(DISTILL_WITH_PLAN_SCHEMA), before, 'shaping is per-call, not global')
})
