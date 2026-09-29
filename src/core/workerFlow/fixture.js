'use strict'
const SOURCE = "'use strict'\nfunction formatDuration (seconds) { throw new Error('Not implemented') }\nmodule.exports = { formatDuration }\n"
const TESTS = `
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { formatDuration } = require('./duration')
test('zero', () => assert.equal(formatDuration(0), '0:00'))
test('seconds and minute boundary', () => { assert.equal(formatDuration(9), '0:09'); assert.equal(formatDuration(59), '0:59'); assert.equal(formatDuration(60), '1:00') })
test('fractional seconds round down', () => assert.equal(formatDuration(61.99), '1:01'))
test('minutes continue beyond an hour', () => assert.equal(formatDuration(3661), '61:01'))
test('invalid inputs are rejected', () => { for (const value of [-1, NaN, Infinity, '5', null, undefined]) assert.throws(() => formatDuration(value), RangeError) })
`
module.exports = { SOURCE, TESTS }
