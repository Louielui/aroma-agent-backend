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
const MULTI_RECIPE = 'context-provenance-snapshot-v2', GATEWAY = 'src/context/toolGateway.js', MULTI_TEST = 'acceptance/context-provenance.test.cjs'
const MULTI_TESTS = `'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { snapshotFields, makeContextResult, makeUnavailable } = require('../src/context/contextResult.js')
const { createToolGateway } = require('../src/context/toolGateway.js')
const OWNER={role:'owner'}
function setup() {
  const fields={commit:{sha:'old'},date:new Date('2026-10-01T00:00:00Z'),optional:undefined}
  const provenance={origin:{revision:'original'},checks:['verified']}, queryScope={window:{days:7}}
  const value={asOf:'2026-10-03T00:00:00Z',results:[makeContextResult({source:'github',sourceId:'commit-1',title:'Commit',fields})],evidence:{provenance,queryScope,completeWithinScope:true}}
  const events=[]
  const gateway=createToolGateway({connector:{read:async()=>value},resources:[{id:'repo',source:'github',scope:'repo-1',sensitivity:'public',operations:{list:{method:'listCommits',params:()=>({})}}}],audit:{append:e=>events.push(e)}})
  return {gateway,value,fields,provenance,queryScope,events}
}
test('shared fields snapshot deeply detaches nested arrays',()=>{const f={nested:{items:[1]}};const s=snapshotFields(f);f.nested.items.push(2);assert.deepEqual(s.nested.items,[1]);s.nested.items.push(3);assert.deepEqual(f.nested.items,[1,2])})
test('shared snapshot preserves structured metadata including dates and undefined',()=>{const d=new Date('2026-10-01T00:00:00Z');const s=snapshotFields({d,optional:undefined});assert.ok(s.d instanceof Date);assert.equal(s.d.toISOString(),d.toISOString());assert.notEqual(s.d,d);assert.ok(Object.hasOwn(s,'optional'))})
test('shared fields snapshot keeps invalid fields empty',()=>{for(const f of [undefined,null,1,'x',[]])assert.deepEqual(snapshotFields(f),{})})
test('gateway retains structured source fields',async()=>{const f=setup(),r=await f.gateway.list(OWNER,'repo');assert.equal(r.state,'ok');assert.ok(r.content[0].fields.date instanceof Date);assert.ok(Object.hasOwn(r.content[0].fields,'optional'))})
test('source mutation cannot rewrite returned provenance',async()=>{const f=setup(),r=await f.gateway.list(OWNER,'repo');f.provenance.origin.revision='changed';f.provenance.checks.push('changed');assert.deepEqual(r.coverage.provenance,{origin:{revision:'original'},checks:['verified']})})
test('returned provenance cannot rewrite source or another read',async()=>{const f=setup(),a=await f.gateway.list(OWNER,'repo'),b=await f.gateway.list(OWNER,'repo');a.coverage.provenance.origin.revision='changed';assert.equal(f.provenance.origin.revision,'original');assert.equal(b.coverage.provenance.origin.revision,'original')})
test('query scope remains detached and absence stays unknown',async()=>{const f=setup(),r=await f.gateway.list(OWNER,'repo');f.queryScope.window.days=99;assert.equal(r.coverage.queryScope.window.days,7);delete f.value.evidence.provenance;assert.equal((await f.gateway.list(OWNER,'repo')).coverage.provenance,null)})
test('gateway keeps read-only provenance, dates and audit sequence',async()=>{const f=setup(),r=await f.gateway.list(OWNER,'repo');assert.equal(r.trust,'source_data');assert.equal(r.retrievedAt,f.value.asOf);assert.equal(r.coverage.complete,true);assert.equal(r.contentPolicy,'data_only');assert.deepEqual(f.events.map(e=>e.sequence),[1,2]);assert.equal(r.content[0].sourceId,'commit-1')})
test('context result keeps existing snapshot and metadata contract',()=>{const f={nested:{n:1}},r=makeContextResult({source:'github',sourceId:'one',fields:f});f.nested.n=2;assert.equal(r.fields.nested.n,1);assert.equal(r.trust,'live');assert.equal(r.error,null)})
test('unavailable sources remain unavailable and permission stays closed',async()=>{const f=setup();f.value.results=[makeUnavailable({source:'github',reason:'offline'})];const r=await f.gateway.list(OWNER,'repo');assert.equal(r.state,'unavailable');assert.equal(r.coverage.complete,null);assert.equal(r.content,null);await assert.rejects(f.gateway.list({role:'manager'},'repo'),/permission_denied/)})
`
const MULTI_WORK_ORDER = { projectId: PROJECT, recipe: MULTI_RECIPE, version: 2,
  title: 'Context Pack structured metadata and provenance snapshots',
  goal: 'Implement a shared snapshotFields export in src/context/contextResult.js for valid object fields using structuredClone, with empty-object semantics for invalid fields. Reuse it in makeContextResult and src/context/toolGateway.js for row fields, preserving Date and undefined metadata. Deeply detach gateway coverage.provenance from source evidence while keeping absent provenance null and preserving all existing metadata, trust, coverage, audit and permissions. The gateway must import and use the shared helper, not duplicate it. Keep existing exports and behavior; no dependencies. Change both registered source files only; protected tests are immutable.',
  allowedFiles: [FILE, GATEWAY], protectedFiles: [MULTI_TEST], expectedTests: 10, effort: 'high',
  scope: 'current_committed_backend_source_offline_nodejs', appliedToLive: false,
  providers: ['codex', 'claude'], billing: 'subscriptions_no_api_fallback' }
function freeze (value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
const RECIPES = freeze({
  [RECIPE]: { workOrder: WORK_ORDER, tests: { [TEST]: TESTS } },
  [MULTI_RECIPE]: { workOrder: MULTI_WORK_ORDER, tests: { [MULTI_TEST]: MULTI_TESTS } }
})
function recipe (id = RECIPE) { if (!Object.hasOwn(RECIPES, id)) throw Error('invalid_request'); return RECIPES[id] }
// Only registered paths are reachable. Legacy one-file receipts retain their shape.
function sourceValues (id, value) {
  const names = recipe(id).workOrder.allowedFiles
  if (id === RECIPE && typeof value === 'string') return { [FILE]: value }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== names.slice().sort().join(',') || names.some(n => typeof value[n] !== 'string' || !value[n] || Buffer.byteLength(value[n]) > 100000)) throw Error('invalid_request')
  return value
}
module.exports = { PROJECT, RECIPE, FILE, TEST, TESTS, WORK_ORDER, MULTI_RECIPE, GATEWAY, MULTI_TEST, MULTI_TESTS, MULTI_WORK_ORDER, RECIPES, recipe, sourceValues }
