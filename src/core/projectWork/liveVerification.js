'use strict'
// Closed component probe, not a test runner. It uses only disposable local
// values and the module already loaded by the backend. No caller code or paths.
const assert = require('node:assert/strict'), fs = require('node:fs'), crypto = require('node:crypto')
const { RECIPE, FILE } = require('./contract')
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const PROBE = 'context-fields-v1', SCOPE = 'loaded_context_fields_component_disposable_values'
const CHECKS = Object.freeze(['top_level', 'nested', 'arrays', 'return_mutation', 'separate_reads', 'invalid_fields', 'metadata', 'unavailable_shape'])
function checks (api) {
  const row = fields => api.makeContextResult({ source:'github', retrievedAt:'2026-10-03T00:00:00Z', fields })
  const bodies = [
    () => { const f={state:'open'}, r=row(f); f.state='closed'; assert.equal(r.fields.state,'open') },
    () => { const f={commit:{sha:'original'}}, r=row(f); f.commit.sha='changed'; assert.equal(r.fields.commit.sha,'original') },
    () => { const f={labels:['bug']}, r=row(f); f.labels.push('changed'); assert.deepEqual(r.fields.labels,['bug']) },
    () => { const f={item:{quantity:3}}, r=row(f); r.fields.item.quantity=9; assert.equal(f.item.quantity,3) },
    () => { const f={item:{quantity:3}}, a=row(f), b=row(f); a.fields.item.quantity=9; assert.equal(b.fields.item.quantity,3) },
    () => { for(const f of [null,undefined,7,'x',[]]) assert.deepEqual(row(f).fields,{}) },
    () => { const f={zero:0,no:false,empty:null}, r=row(f); assert.deepEqual(r.fields,f); assert.equal(r.source,'github'); assert.equal(r.trust,'live'); assert.equal(r.retrievedAt,'2026-10-03T00:00:00Z'); assert.equal(r.error,null); assert.equal(api.ENTITY_TYPES.COMMIT,'commit') },
    () => { const r=api.makeUnavailable({source:'github',reason:'offline',retrievedAt:'now'}); assert.equal(r.trust,'unavailable'); assert.equal(r.error,'offline'); assert.deepEqual(r.fields,{}) }
  ]
  return bodies.map((check,i) => { try { check(); return {id:CHECKS[i],passed:true} } catch (_) { return {id:CHECKS[i],passed:false} } })
}
// Fingerprint the actual fixed checks, not merely their labels.
const CHECKS_HASH = hash(checks.toString().replace(/\r\n/g,'\n'))
function createProbe ({ bootCommit, bootedAt, api, sourceHash }) {
  return () => {
    if (!/^[a-f0-9]{40}$/.test(bootCommit || '') || !Number.isFinite(Date.parse(bootedAt)) || !/^[a-f0-9]{64}$/.test(sourceHash || '')) throw Error('verification_unavailable')
    const results=checks(api), passed=results.filter(r=>r.passed).length
    return {version:1,engine:'loaded-component-probe-v1',probeId:PROBE,scope:SCOPE,checksHash:CHECKS_HASH,
      bootCommit,bootedAt,sourceHash,at:new Date().toISOString(),checks:results,total:CHECKS.length,passed,failed:CHECKS.length-passed}
  }
}
function createLoadedProbe (bootCommit, bootedAt) {
  const modulePath=require.resolve('../../context/contextResult'), api=require(modulePath)
  const sourceHash=hash(fs.readFileSync(modulePath,'utf8').replace(/\r\n/g,'\n'))
  return createProbe({bootCommit,bootedAt,api,sourceHash})
}
function valid (v) {
  return v?.version===1 && v.engine==='loaded-component-probe-v1' && v.probeId===PROBE && v.scope===SCOPE && v.checksHash===CHECKS_HASH &&
    /^[a-f0-9]{40}$/.test(v.bootCommit || '') && /^[a-f0-9]{64}$/.test(v.sourceHash || '') && Number.isFinite(Date.parse(v.at)) && Number.isFinite(Date.parse(v.bootedAt)) && Date.parse(v.at)>=Date.parse(v.bootedAt) &&
    v.total===CHECKS.length && Array.isArray(v.checks) && v.checks.length===CHECKS.length &&
    v.checks.every((c,i)=>c.id===CHECKS[i] && typeof c.passed==='boolean') &&
    v.passed===v.checks.filter(c=>c.passed).length && v.failed===v.total-v.passed
}
function project (v) {
  if(v?.state==='unavailable' && ['live_adapter_not_registered','live_verification_unavailable'].includes(v.reason))return {state:'unavailable',reason:v.reason}
  if (!valid(v) || !/^[a-f0-9-]{36}$/.test(v.workRunId || '')) return null
  // Drop error prose and any unregistered fields from stored receipts.
  return {...Object.fromEntries(['version','engine','probeId','scope','checksHash','bootCommit','bootedAt','sourceHash','at','workRunId','total','passed','failed'].map(k=>[k,v[k]])),checks:v.checks.map(c=>({id:c.id,passed:c.passed}))}
}
function createClient ({ token, request = async () => {
  const response=await fetch('http://127.0.0.1:8090/api/v1/project-work/verification/'+PROBE,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(3000)})
  if (!response.ok) throw Error('verification_unavailable')
  const body=await response.text(); if(body.length>8000)throw Error('verification_unavailable'); return JSON.parse(body)
} }) {
  return async ({recipe,bootCommit,sourceHash,workRunId}) => {
    if(recipe!==RECIPE)return {state:'unavailable',reason:'live_adapter_not_registered'}
    try {
      const v=await request()
      const age=Date.now()-Date.parse(v?.at)
      if(!valid(v) || !Number.isFinite(age) || age < -5000 || age > 300000 || v.bootCommit!==bootCommit || v.sourceHash!==sourceHash)throw Error('verification_unavailable')
      const receipt=project({...v,workRunId}); if(!receipt)throw Error('verification_unavailable')
      return receipt
    } catch (_) { return {state:'unavailable',reason:'live_verification_unavailable'} }
  }
}
function createRouter ({bootCommit,bootedAt,env=process.env,probe=createLoadedProbe(bootCommit,bootedAt)}={}) {
  const router=require('express').Router()
  router.get('/api/v1/project-work/verification/:probe', (req,res)=>{
    res.set('Cache-Control','no-store')
    if(env.READ_ACCESS!=='on')return res.status(503).json({error:'read_access_disabled'})
    if(req.params.probe!==PROBE || Object.keys(req.query).length)return res.status(400).json({error:'invalid_request'})
    try {res.json(probe())} catch (_) {res.status(503).json({error:'verification_unavailable'})}
  })
  return router
}
module.exports={PROBE,SCOPE,CHECKS_HASH,CHECKS,FILE,createProbe,createLoadedProbe,valid,project,createClient,createRouter}
