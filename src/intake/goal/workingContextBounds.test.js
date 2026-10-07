'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { buildWorkingContext, MAX_MESSAGE_CHARS } = require('./workingContext')
test('a long preceding answer keeps both its opening topic and final follow-up referent inside the existing budget', () => {
 const text = 'Failed task context: ' + 'x'.repeat(2000) + ' Last discussed task: original-failure.'
 const x = buildWorkingContext([{ role: 'assistant', text }])
 assert.match(x.block, /Failed task context/); assert.match(x.block, /original-failure/)
 assert.ok(x.chars <= MAX_MESSAGE_CHARS); assert.match(x.block, /omitted/)
})
