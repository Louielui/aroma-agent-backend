'use strict'
const PROJECT = 'aroma-agent-backend', RECIPE = 'context-fields-snapshot-v1'
const FILE = 'src/context/contextResult.js', TEST = 'acceptance/context-fields.test.cjs'
// Host-reviewed acceptance; this is an actual current-source defect, never a
// broken fixture substituted for a repository file. Tests cannot be model edits.
const TESTS = `'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { makeContextResult, makeUnavailable, ENTITY_TYPES } = require('../src/context/contextResult.js')
const row = fields => makeContextResult({ source:'github', retrievedAt:'2026-10-03T00:00:00Z', fields })
test('top-level values are a read-time snapshot', () => { const f={state:'open'}; const r=row(f); f.state='closed'; assert.equal(r.fields.state,'open') })
test('nested values are a read-time snapshot', () => { const f={commit:{sha:'original'}}; const r=row(f); f.commit.sha='changed'; assert.equal(r.fields.commit.sha,'original') })
test('arrays inside fields are detached', () => { const f={labels:['bug']}; const r=row(f); f.labels.push('changed'); assert.deepEqual(r.fields.labels,['bug']) })
test('changing a returned nested field cannot mutate the source', () => { const f={item:{quantity:3}}; const r=row(f); r.fields.item.quantity=9; assert.equal(f.item.quantity,3) })
test('separate reads do not share nested fields', () => { const f={item:{quantity:3}}; const a=row(f),b=row(f); a.fields.item.quantity=9; assert.equal(b.fields.item.quantity,3) })
test('primitive and array fields retain empty-object semantics', () => { for(const f of [null,undefined,7,'x',[]]) assert.deepEqual(row(f).fields,{}) })
test('source metadata and values remain unchanged', () => { const f={zero:0,no:false,empty:null}; const r=row(f); assert.deepEqual(r.fields,f); assert.equal(r.source,'github'); assert.equal(r.trust,'live'); assert.equal(r.retrievedAt,'2026-10-03T00:00:00Z'); assert.equal(r.error,null); assert.equal(ENTITY_TYPES.COMMIT,'commit') })
test('unavailable context retains its honest failure shape', () => { const r=makeUnavailable({source:'github',reason:'offline',retrievedAt:'now'}); assert.equal(r.trust,'unavailable'); assert.equal(r.error,'offline'); assert.deepEqual(r.fields,{}) })
`
const WORK_ORDER = Object.freeze({ projectId: PROJECT, recipe: RECIPE, version: 1,
  title: 'Context Pack field snapshot repair',
  goal: 'Fix the actual current makeContextResult fields aliasing defect. For object fields, capture an independent deep snapshot: later source mutation cannot change the returned context, and returned fields cannot mutate the source or another read. Preserve existing metadata, unavailable results, and empty-object semantics for invalid fields. Do not freeze caller data. Change only the approved source file; retain existing exports. No dependencies.',
  allowedFiles: [FILE], protectedFiles: [TEST], expectedTests: 8,
  scope: 'current_committed_backend_source_offline_nodejs', appliedToLive: false,
  providers: ['codex', 'claude'], billing: 'subscriptions_no_api_fallback' })
module.exports = { PROJECT, RECIPE, FILE, TEST, TESTS, WORK_ORDER }
