'use strict'

/**
 * distillParse.robustness.test.js — B2-2 Slice A (Option C).
 *
 * Locks the strict Distill output-contract parser. Built-in JSON.parse owns all
 * JSON grammar and value-boundary decisions; a dedicated scanner enforces
 * all-depth duplicate-key rejection with DECODED-key equality. Taxonomy:
 *   empty_response | fence_malformed | invalid_json | not_single_object | duplicate_keys
 * Precedence (stage order): envelope → JSON.parse → top-level object → duplicate keys.
 *
 *   Run: node --test src/intake/distillParse.robustness.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { parseDistillResponse, DistillParseError, REJECT_REASONS } = require('./distillPrompt')

function reject (text, reason) {
  let err
  try { parseDistillResponse(text) } catch (e) { err = e }
  assert.ok(err instanceof DistillParseError, `expected DistillParseError, got ${err && err.name}`)
  assert.equal(err.reason, reason)
  // safe disclosure: .message must NOT carry raw model text; raw lives in diagnostic only
  assert.ok(!/rawSample/.test(err.message), 'message must not leak raw sample')
  assert.equal(err.message, `distill parse rejected: ${reason}`)
}
function accept (text) {
  const out = parseDistillResponse(text)
  assert.ok(out && typeof out.mode === 'string', 'accepted payload should normalize to an object')
  return out
}

// --- empty ------------------------------------------------------------------
test('empty_response: empty / JSON-whitespace-only', () => {
  reject('', REJECT_REASONS.EMPTY_RESPONSE)
  reject('   ', REJECT_REASONS.EMPTY_RESPONSE)
  reject('\n\t\r ', REJECT_REASONS.EMPTY_RESPONSE)
})

// --- envelope / fence -------------------------------------------------------
test('fence policy: bare / json / JSON / no-lang accepted; other lang + malformed rejected', () => {
  accept('{"intent":"greeting","mode":"chat","reply":"hi"}')                 // bare
  accept('```json\n{"mode":"chat","reply":"hi"}\n```')                        // json fence, LF
  accept('```JSON\n{"mode":"chat","reply":"hi"}\n```')                        // case-insensitive
  accept('```\n{"mode":"chat","reply":"hi"}\n```')                            // empty language tag
  accept('```json\r\n{"mode":"chat","reply":"hi"}\r\n```')                    // CRLF fence
  accept('```json\n{"mode":"chat","reply":"hi"}\n```\n   ')                   // trailing whitespace after close
  reject('```python\n{"mode":"chat"}\n```', REJECT_REASONS.FENCE_MALFORMED)   // other language
  reject('```json\n{"mode":"chat"}\n```\ntrailing prose', REJECT_REASONS.FENCE_MALFORMED) // prose after close
  reject('```json\n{"a":1}\n```\n```\n{"b":2}\n```', REJECT_REASONS.FENCE_MALFORMED)       // multiple fences
  reject('```json\n{"a":1}', REJECT_REASONS.FENCE_MALFORMED)                  // no closing fence
})

test('envelope edge cases: whitespace / same-line / empty-fence / array-primitive-inside / external junk', () => {
  // opening fence padded by standard whitespace → ACCEPT
  accept('   \n```json\n{"mode":"chat","reply":"hi"}\n```   \n')
  // legal fence wrapping an array / primitive → not_single_object (top-level type gate)
  reject('```json\n[1,2]\n```', REJECT_REASONS.NOT_SINGLE_OBJECT)
  reject('```json\n123\n```', REJECT_REASONS.NOT_SINGLE_OBJECT)
  // empty / whitespace-only fence → PINNED to invalid_json (inner is not valid JSON;
  // the empty_response gate runs on the OUTER text, which is a non-empty fence)
  reject('```\n```', REJECT_REASONS.INVALID_JSON)
  reject('```json\n\n```', REJECT_REASONS.INVALID_JSON)
  reject('```json\n   \n```', REJECT_REASONS.INVALID_JSON)
  // JSON on the SAME line as the opening fence → info-string non-empty/non-"json" → fence_malformed
  reject('```{"mode":"chat"}\n```', REJECT_REASONS.FENCE_MALFORMED)
  // non-whitespace BEFORE the opening fence → not recognized as a fence → treated as bare → invalid_json
  reject('junk ```json\n{"a":1}\n```', REJECT_REASONS.INVALID_JSON)
})

// --- top-level type ---------------------------------------------------------
test('not_single_object: valid JSON that is not an object', () => {
  reject('true', REJECT_REASONS.NOT_SINGLE_OBJECT)
  reject('123', REJECT_REASONS.NOT_SINGLE_OBJECT)
  reject('"text"', REJECT_REASONS.NOT_SINGLE_OBJECT)
  reject('null', REJECT_REASONS.NOT_SINGLE_OBJECT)
  reject('[1,2]', REJECT_REASONS.NOT_SINGLE_OBJECT)
  reject('[{"a":1}]', REJECT_REASONS.NOT_SINGLE_OBJECT)
})

// --- invalid_json (syntax / boundary / truncation all lumped) ---------------
test('invalid_json: syntax errors', () => {
  reject('{"a":tru}', REJECT_REASONS.INVALID_JSON)
  reject('{"a":1e}', REJECT_REASONS.INVALID_JSON)
  reject('{"a":01}', REJECT_REASONS.INVALID_JSON)
  reject('{"a":1,}', REJECT_REASONS.INVALID_JSON)
  reject('{"a" 1}', REJECT_REASONS.INVALID_JSON)
  reject('{a:1}', REJECT_REASONS.INVALID_JSON)
  reject('{"a":"\\u00G1"}', REJECT_REASONS.INVALID_JSON) // malformed unicode escape
})
test('invalid_json: leading/trailing/multiple/truncated fold into invalid_json', () => {
  reject('some prose {"a":1}', REJECT_REASONS.INVALID_JSON)   // leading content
  reject('{"a":1} trailing', REJECT_REASONS.INVALID_JSON)     // trailing content
  reject('{"a":1} 123', REJECT_REASONS.INVALID_JSON)          // object then primitive
  reject('{"a":1}{"b":2}', REJECT_REASONS.INVALID_JSON)       // two objects
  reject('{"a":1', REJECT_REASONS.INVALID_JSON)               // truncated (unclosed object)
  reject('{"a":"text', REJECT_REASONS.INVALID_JSON)           // truncated (unclosed string)
})
test('invalid_json: BOM is not stripped and is rejected', () => {
  reject('﻿{"a":1}', REJECT_REASONS.INVALID_JSON)
})

// --- duplicate keys (all depths, decoded equality) --------------------------
test('duplicate_keys: top-level', () => {
  reject('{"mode":"ask","mode":"commit"}', REJECT_REASONS.DUPLICATE_KEYS)
  reject('{"a":{"b":1},"a":{"c":2}}', REJECT_REASONS.DUPLICATE_KEYS)
})
test('duplicate_keys: nested object (depth 2)', () => {
  reject('{"decision":{"status":"pending","status":"approved"}}', REJECT_REASONS.DUPLICATE_KEYS)
})
test('duplicate_keys: object inside array (depth 3)', () => {
  reject('{"items":[{"id":"1","id":"2"}]}', REJECT_REASONS.DUPLICATE_KEYS)
})
test('duplicate_keys: decoded-key equality (unicode-escaped key equals literal)', () => {
  reject('{"a":1,"\\u0061":2}', REJECT_REASONS.DUPLICATE_KEYS)
  reject('{"\\u0061":1,"a":2}', REJECT_REASONS.DUPLICATE_KEYS)
})
test('duplicate_keys: surrogate-pair escape decodes to the same char as a literal emoji key', () => {
  // "😀" and "😀" both decode to U+1F600 → duplicate.
  reject('{"\\uD83D\\uDE00":1,"😀":2}', REJECT_REASONS.DUPLICATE_KEYS)
})
test('no false positive: escaped backslash — "\\\\u0061" decodes to literal \\u0061, NOT "a"', () => {
  // JSON \\u0061 → backslash + u0061 (six chars), which is not the character "a".
  accept('{"\\\\u0061":1,"a":2}')
})
test('no false positives: fake keys in strings, case-different keys, separate objects', () => {
  accept('{"reply":"字串內的 \\"mode\\":\\"ask\\" 不是 key"}')  // "mode":"ask" is string content
  accept('{"a":"}\\",{\\"b\\":2"}')                             // braces/quotes inside a string value
  accept('{"a":1,"A":2}')                                       // different keys (case-sensitive)
  accept('{"list":[{"k":1},{"k":1}]}')                          // same key in two SEPARATE objects
})

// --- values that are valid JSON must be accepted ----------------------------
test('accept: well-formed values', () => {
  accept('{"a":true}')
  accept('{"a":1e3}')
  accept('{"a":"\\u0041"}') // valid unicode escape → "A"
})

// --- normalization regression (existing semantics unchanged) ----------------
test('normalization unchanged: chat/commit shapes still produced', () => {
  const chat = accept('{"intent":"greeting","mode":"chat","reply":"你好"}')
  assert.equal(chat.mode, 'chat')
  assert.equal(chat.reply, '你好')
  const commit = accept('{"intent":"decision","mode":"commit","reply":"好","tasks":[{"title":"x"}]}')
  assert.equal(commit.mode, 'commit')
  assert.equal(commit.tasks.length, 1)
  assert.equal(commit.tasks[0].title, 'x')
})
