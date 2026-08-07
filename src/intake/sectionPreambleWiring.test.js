'use strict'
/**
 * sectionPreambleWiring.test.js — does the envelope actually REACH the prompt?
 *
 * ⛔ Five components this month passed their own tests and were reached by nothing. The
 * attachment builder is proven by its own file; this proves the seam.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { processIntake } = require('./intakeService')

/** An adapter that records the prompt it was handed and answers nothing. */
function spyAdapter (seen) {
  return {
    name: 'spy',
    async complete (prompt, system) { seen.prompt = prompt; seen.system = system; return { text: 'ok', usage: {} } },
    async generate (prompt, system) { seen.prompt = prompt; seen.system = system; return { text: 'ok', usage: {} } }
  }
}

describe('the section envelope reaches the model prompt', () => {
  test('⛔ what was attached appears in the prompt the adapter is handed', async () => {
    const seen = {}
    await processIntake('點解青蔥查唔到', spyAdapter(seen), [], {
      requestId: 'r1', interactionMode: 'chat', demo: true,
      sectionPreamble: '<section_context>\n測試紀錄\n</section_context>\n\n'
    }).catch(() => {})
    assert.ok(seen.prompt, 'the adapter must have been called')
    assert.match(seen.prompt, /section_context/, 'if this is absent the attachment is wired to nothing')
    assert.match(seen.prompt, /測試紀錄/)
  })

  test('the envelope comes BEFORE the message — it is background, not the turn', async () => {
    const seen = {}
    await processIntake('點解青蔥查唔到', spyAdapter(seen), [], {
      requestId: 'r2', interactionMode: 'chat', demo: true,
      sectionPreamble: '<section_context>\nX\n</section_context>\n\n'
    }).catch(() => {})
    assert.ok(seen.prompt.indexOf('section_context') < seen.prompt.indexOf('點解青蔥查唔到'))
  })

  test('⛔ no attachment means no envelope — an empty block would still frame the turn', async () => {
    const seen = {}
    await processIntake('普通問題', spyAdapter(seen), [], { requestId: 'r3', interactionMode: 'chat', demo: true }).catch(() => {})
    // ⛔ `|| ''` meant this passed if the adapter was NEVER CALLED — the strongest possible
    // failure looked identical to the behaviour under test.
    assert.strictEqual(typeof seen.prompt, 'string', 'the adapter must have been called at all')
    assert.ok(!/section_context/.test(seen.prompt))
  })
})
