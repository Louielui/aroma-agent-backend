'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const express = require('express')
const { createApp } = require('../app')
const { createDemoRouter } = require('../routes/demoRouter')
const { randomUUID } = require('node:crypto')
const fixture = { version: 1, repository: 'owner/repo', state: 'ok', checkedAt: '2026-10-01T18:00:00.000Z', retrievedAt: '2026-10-01T18:00:00.000Z', branch: 'main', remoteCommit: 'a'.repeat(40), cached: false, packs: [], modelCalls: 0,
  runtime: { deployedCommit: 'b'.repeat(40), bootCommit: 'c'.repeat(40), restartRequired: true }, counts: { commits: 3, pullRequests: 2, checks: 0, statuses: 0 }, tests: { state: 'not_published', sha: 'a'.repeat(40) } }
function post (server, url, body, { origin = 'http://127.0.0.1:8090', token } = {}) {
  return new Promise((resolve,reject) => {
    const headers = { host: '127.0.0.1:8090', origin, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }
    const request = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method: 'POST', headers }, response => {
      let value=''; response.on('data', chunk => { value += chunk }); response.on('end', () => resolve({ status: response.statusCode, value: JSON.parse(value) }))
    }); request.on('error',reject); request.end(JSON.stringify(body))
  })
}
test('live context HTTP is Owner-gated, page loads without source reads, and POST has fixed inputs', async t => {
  let reads=0
  const app=createApp({ ownerPassword:'fixture-owner',serviceToken:'fixture-service',runPersistence:false,proposalPersistence:false,workerDeps:{artifactStore:null,runner:null},
    liveContext: { capabilities:()=>[], read:async actor=>{assert.equal(actor.role,'owner'); reads++;return fixture}, activity:()=>[] } })
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r)); t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
  const base='http://127.0.0.1:'+server.address().port
  assert.equal((await fetch(base+'/live-context')).status,401)
  const page=await fetch(base+'/live-context',{headers:{authorization:'Bearer fixture-service'}})
  assert.equal(page.status,200); assert.match(await page.text(),/api\/v1\/live-context\/development/); assert.equal(reads,0)
  assert.equal((await post(server,'/api/v1/live-context/development',{})).status,401)
  assert.equal((await post(server,'/api/v1/live-context/development',{}, {token:'fixture-service',origin:'https://evil.test'})).status,403)
  assert.equal((await post(server,'/api/v1/live-context/development',{repo:'other/private'}, {token:'fixture-service'})).status,400)
  assert.equal(reads,0)
  const result=await post(server,'/api/v1/live-context/development',{}, {token:'fixture-service'})
  assert.equal(result.status,200); assert.equal(result.value.report.counts.pullRequests,2); assert.equal(reads,1)
})
test('explicit development chat returns measured source values and saves history with zero model calls',async t=>{
  let models=0, reads=0;const saved=[]
  const app=express();app.locals.conversationDemo=true;app.use(express.json());app.use(createDemoRouter({liveContext:{read:async()=>{reads++;return fixture}},
    conversationStore:{appendTurn:r=>saved.push(r)},getAdapterFn:()=>{models++;throw Error('model must not run')}}))
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
  const body={message:'香香，現在開發進度怎樣？',conversationId:'context-acceptance',workflowRequestId:randomUUID()}
  assert.equal((await post(server,'/api/v1/demo/intake',body,{origin:'https://evil.test'})).status,403);assert.equal(reads,0)
  const result=await post(server,'/api/v1/demo/intake',body)
  assert.equal(result.status,200);assert.equal(models,0);assert.equal(reads,1);assert.equal(saved.length,1)
  assert.equal(result.value.liveContext.remoteCommit,'a'.repeat(40));assert.match(result.value.reply,/bbbbbbb/)
  assert.match(result.value.reply,/尚未發布/);assert.match(result.value.reply,/\/live-context/)
  assert.equal((await post(server,'/api/v1/demo/intake',body)).status,200);assert.equal(saved.length,1);assert.equal(reads,1)
})
