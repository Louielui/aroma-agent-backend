'use strict'
// A second, host-reviewed work order exercises the generic engine without any
// production imports, account data, network operation or existing fixed recipe.
const SOURCE = "'use strict'\nfunction chooseLatestPack (records, source) { return records[0] || null }\nmodule.exports = { chooseLatestPack }\n"
const TESTS = `
'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {chooseLatestPack}=require('./chooseLatestPack')
const pack=(source,originalDate,retrievedAt='2026-10-01T00:00:00Z')=>({source,originalDate,retrievedAt})
test('matches only the requested source',()=>{const a=pack('drive','2026-10-02'),b=pack('github','2026-10-01');assert.equal(chooseLatestPack([a,b],'github'),b)})
test('uses newest original source date',()=>{const a=pack('github','2026-09-01'),b=pack('github','2026-10-01');assert.equal(chooseLatestPack([a,b],'github'),b)})
test('retrieval date breaks equal original dates',()=>{const a=pack('github','2026-10-01','2026-10-01T01:00:00Z'),b=pack('github','2026-10-01','2026-10-01T02:00:00Z');assert.equal(chooseLatestPack([a,b],'github'),b)})
test('original date takes precedence over retrieval date',()=>{const a=pack('github','2026-10-02','2026-10-01T01:00:00Z'),b=pack('github','2026-10-01','2026-10-02T02:00:00Z');assert.equal(chooseLatestPack([a,b],'github'),a)})
test('ignores malformed records and source dates',()=>{const b=pack('github','2026-10-01');assert.equal(chooseLatestPack([null,pack('github','bad'),b],'github'),b)})
test('empty/unmatched source returns null and input is unchanged',()=>{const records=[pack('drive','2026-10-01')],saved=JSON.stringify(records);assert.equal(chooseLatestPack(records,'github'),null);assert.equal(chooseLatestPack([],'github'),null);assert.equal(JSON.stringify(records),saved)})
test('invalid arguments are rejected',()=>{assert.throws(()=>chooseLatestPack(null,'github'),TypeError);assert.throws(()=>chooseLatestPack({},'github'),TypeError);assert.throws(()=>chooseLatestPack([],''),TypeError);assert.throws(()=>chooseLatestPack([],undefined),TypeError)})
`
const WORK_ORDER = { goal: 'Fix chooseLatestPack(records, source). Validate records is an array and source a nonblank string, throwing TypeError otherwise. Filter records by source and a parseable originalDate; ignore null/malformed records. Return the original object with newest originalDate; use newest parseable retrievedAt to break ties (invalid retrieval dates count as -Infinity). Never mutate the array or its objects. Empty/no matching valid records returns null.', files: { 'chooseLatestPack.js': SOURCE, 'chooseLatestPack.test.js': TESTS }, tests: ['chooseLatestPack.test.js'], editable: ['chooseLatestPack.js'], expectedTests: 7, sourceRevision: 'host-reviewed-latest-context-fixture-v1' }
module.exports = { SOURCE, TESTS, WORK_ORDER }
