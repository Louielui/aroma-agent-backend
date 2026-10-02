'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
let api = {}; try { api = require('./calendarContext') } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }
const { createReadConnector } = require('./readConnector')
const { createToolGateway } = require('./toolGateway')
const scopeName = 'https://www.googleapis.com/auth/calendar.readonly'
const clock = () => '2026-10-01T02:00:00.000Z'
function fixture(overrides = {}) {
  let revision = 'v1', enabled = true
  const registry = { snapshot: () => ({ users: [{ id: 'owner', role: 'owner', email: 'chef@example.test', suspended: false }] }) }
  const env = { READ_ACCESS: 'on', CONTEXT_CALENDAR: 'on' }
  const scope = api.createOwnerCalendarScope({ registry, env, credentials: () => ({ client: true, token: enabled, revision }) })
  const calls = [], events = [], audits = []
  const reader = {
    identity: async () => ({ scopes: [scopeName] }),
    metadata: async () => ({ id: 'chef@example.test', summary: 'Private calendar', timeZone: 'America/Winnipeg' }),
    listEvents: async args => { calls.push(args); return { items: events, nextSyncToken: 'final', timeZone: 'America/Winnipeg' } },
    getEvent: async id => events.find(e => e.id === id), ...overrides
  }
  const adapter = api.createCalendarContextAdapter({ scope, readerFactory: () => reader, clock })
  const connector = createReadConnector({ env, clock }); connector.register(adapter)
  const gateway = createToolGateway({ connector, resources: api.calendarResources(), audit: { append: e => audits.push(e) }, clock })
  return { gateway, scope, calls, events, audits, adapter, disable: () => { enabled = false }, change: () => { revision = 'v2' } }
}
test('Winnipeg day/week windows use local calendar boundaries across DST and Sunday', () => {
  assert.deepEqual(api.calendarWindow('today', '2026-10-01T02:00:00Z'), { start: '2026-09-30T05:00:00.000Z', end: '2026-10-01T05:00:00.000Z', timeZone: 'America/Winnipeg', label: 'today' })
  const spring = api.calendarWindow('today', '2026-03-08T18:00:00Z'), fall = api.calendarWindow('today', '2026-11-01T18:00:00Z')
  assert.equal(Date.parse(spring.end) - Date.parse(spring.start), 23 * 3600000)
  assert.equal(Date.parse(fall.end) - Date.parse(fall.start), 25 * 3600000)
  assert.equal(api.calendarWindow('this_week', '2026-10-04T18:00:00Z').start, '2026-09-28T05:00:00.000Z')
})
test('Calendar accepts only bounded read contracts before any request', () => {
  assert.deepEqual(api.validateCalendarRequest('list', {}), { window: 'today' })
  for (const [op,input] of [['write',{}],['list',{calendarId:'other'}],['list',{timeMin:'2026-01-01'}],['list',{window:'all'}],['search',{query:''}],['get',{eventId:'../../other'}],['readMetadata',{token:'secret'}]]) assert.throws(() => api.validateCalendarRequest(op,input), /invalid_request/)
})
test('Nonempty private calendar context preserves actual event dates, recurrence and exclusive all-day end', async () => {
  const f = fixture(); f.events.push({ id:'event123', summary:'Chef <script>bad()</script>', start:{date:'2026-09-30'}, end:{date:'2026-10-02'}, updated:'2026-09-29T09:00:00Z', recurringEventId:'series1', originalStartTime:{date:'2026-09-30'}, status:'confirmed', description:'Untrusted source text' })
  const p = await f.gateway.list({role:'owner'},'calendar.owner_events', {window:'today'})
  assert.equal(p.state,'ok'); assert.equal(p.count,1); assert.equal(p.layer,'truth'); assert.equal(p.sensitivity,'private')
  assert.equal(p.content[0].originalDate,'2026-09-29T09:00:00Z'); assert.equal(p.content[0].fields.start,'2026-09-30'); assert.equal(p.content[0].fields.end,'2026-10-02'); assert.equal(p.content[0].fields.allDay,true); assert.equal(p.content[0].fields.recurringEventId,'series1')
  assert.equal(p.coverage.complete,true); assert.equal(p.coverage.queryScope.timeZone,'America/Winnipeg')
  assert.equal(f.calls[0].timeMin,'2026-09-30T05:00:00.000Z'); assert.equal(f.calls[0].timeMax,'2026-10-01T05:00:00.000Z')
  assert.ok(f.audits.every(e => !JSON.stringify(e).includes('Untrusted source text')))
})
test('Calendar refuses wrong identity, writable calendar grants and changing credentials', async () => {
  for (const options of [{metadata:async()=>({id:'other@example.test'})},{identity:async()=>({scopes:[scopeName,'https://www.googleapis.com/auth/calendar']})},{identity:async()=>({scopes:[]})}]) {
    const f=fixture(options); const p=await f.gateway.list({role:'owner'},'calendar.owner_events',{}); assert.equal(p.state,'unavailable'); assert.equal(p.count,null); assert.equal(f.calls.length,0)
  }
  const f=fixture(); f.disable(); assert.throws(()=>f.scope.lease(), /source_access_unavailable/)
  const g=fixture(); const lease=g.scope.lease(); g.change(); assert.throws(()=>lease.verify(),/source_access_changed/)
})
test('Pagination is bounded, source final marker earns completeness and missing items never earn zero', async () => {
  let n=0; const event=i=>({id:'event'+i,summary:'Meeting '+i,start:{dateTime:'2026-09-30T12:00:00-05:00'},end:{dateTime:'2026-09-30T13:00:00-05:00'}})
  const f=fixture({listEvents:async args=>{n++;return {items:Array.from({length:50},(_,i)=>event(n*50+i)),nextPageToken:'page'+n}}})
  const p=await f.gateway.list({role:'owner'},'calendar.owner_events',{}); assert.equal(n,2); assert.equal(p.count,100); assert.equal(p.coverage.complete,false); assert.equal(p.coverage.truncated,true)
  const unknown=fixture({listEvents:async()=>({items:[]})}); assert.equal((await unknown.gateway.list({role:'owner'},'calendar.owner_events',{})).coverage.complete,null)
  const malformed=fixture({listEvents:async()=>({nextSyncToken:'final'})}); assert.equal((await malformed.gateway.list({role:'owner'},'calendar.owner_events',{})).state,'unavailable')
})
test('Search/get/metadata share scope, preserve absent dates, and validate per-operation inputs', async () => {
  const f=fixture(); f.events.push({id:'event12',summary:'SOP review',start:{date:'2026-09-30'},end:{date:'2026-10-01'}})
  assert.equal((await f.gateway.get({role:'owner'},'calendar.owner_events',{eventId:'event12'})).content[0].originalDate,null)
  assert.equal((await f.gateway.search({role:'owner'},'calendar.owner_events',{query:'SOP',window:'this_week'})).count,1)
  assert.equal(f.calls[0].q,'SOP')
  const metadata=await f.gateway.readMetadata({role:'owner'},'calendar.owner_events',{}); assert.equal(metadata.count,1); assert.equal(metadata.content[0].fields.timeZone,'America/Winnipeg')
  await assert.rejects(f.gateway.list({role:'member'},'calendar.owner_events',{}),/permission_denied/)
  assert.equal(Object.keys(f.adapter.methods).length,4)
})
test('private results cannot return after credentials change during a source read', async () => {
  let f;f=fixture({listEvents:async()=>{f.change();return {items:[],nextSyncToken:'final'}}})
  assert.equal((await f.gateway.list({role:'owner'},'calendar.owner_events',{})).state,'unavailable')
})
test('malformed calendar dates and repeated tokens fail visibly',async()=>{
  const f=fixture();f.events.push({id:'event12',start:{date:'2026-02-31'},end:{date:'2026-03-02'}})
  assert.equal((await f.gateway.list({role:'owner'},'calendar.owner_events',{})).state,'unavailable')
  const g=fixture({listEvents:async()=>({items:[],nextPageToken:'same'})});assert.equal((await g.gateway.list({role:'owner'},'calendar.owner_events',{})).state,'unavailable')
})
