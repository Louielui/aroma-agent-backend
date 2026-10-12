'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto')
const {createProjectWork}=require('./service'),{NAMES}=require('../../workers/execution/browserEvidence')
const hash=b=>createHash('sha256').update(b).digest('hex'),owner={id:'owner',role:'owner'}
test('before and after previews read distinct verified receipts and refuse missing or tampered baseline evidence', t=>{
  const dirs=[]
  const receipt=byte=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'offline-preview-'));dirs.push(root);fs.mkdirSync(path.join(root,'output'))
    const raw=Buffer.from(JSON.stringify({type:'test-receipt',byte})),png=Buffer.alloc(1500,byte);fs.writeFileSync(path.join(root,'output/evidence.json'),raw)
    const browser=NAMES.map(name=>{fs.writeFileSync(path.join(root,'output',name),png);const [,locale,width]=name.match(/^browser-(zh|en)-(1280|390)\.png$/);return {name,locale,width:Number(width),height:900,failedReads:locale==='zh'&&width==='390',engine:'edge-headless-offline-v2',browserVersion:'Edg/154.0',pageHash:'a'.repeat(64),screenshotHash:hash(png),screenshotBytes:png.length,routes:['/demo'],checks:Object.fromEntries(['startup','labels','claudeDefault','providerIsolation','modelEfforts','catalogueFailureHandled','layout','keyboard','picker','chatScope','explicitConfirmation','noPageErrors','onlyFixtureRequests'].map(k=>[k,true]))}})
    return {workspace:root,evidenceHash:hash(raw),browser}
  }
  t.after(()=>dirs.forEach(d=>fs.rmSync(d,{recursive:true,force:true})))
  const row={result:{baseline:receipt(1),tests:receipt(2)}},flow=createProjectWork({store:{all:()=>[],get:()=>row}})
  assert.equal(Buffer.from(flow.browser(owner,'id',NAMES[0],'before').content,'base64')[0],1)
  assert.equal(Buffer.from(flow.browser(owner,'id',NAMES[0]).content,'base64')[0],2)
  assert.throws(()=>flow.browser(owner,'id',NAMES[0],'live'),/invalid_request/)
  assert.throws(()=>flow.browser({id:'manager',role:'manager'},'id',NAMES[0],'before'),/permission_denied/)
  fs.writeFileSync(path.join(row.result.baseline.workspace,'output',NAMES[0]),Buffer.alloc(1500,3))
  assert.throws(()=>flow.browser(owner,'id',NAMES[0],'before'),/invalid_sandbox_evidence/)
  delete row.result.baseline
  assert.throws(()=>flow.browser(owner,'id',NAMES[0],'before'),/invalid_sandbox_evidence/)
  assert.equal(Buffer.from(flow.browser(owner,'id',NAMES[0]).content,'base64')[0],2)
})
