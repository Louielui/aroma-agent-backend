'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const fixture=require('./independentFixture.cjs'),{safeCode}=require('./startIndependent.cjs')
const make=()=>fixture.createFixture(fs.mkdtempSync(path.join(os.tmpdir(),'r1-trust-')))
const close=o=>{const m=JSON.parse(fs.readFileSync(path.join(o.root,'.independent-fixture.json')));const receipt=fixture.checkpoint(o.root,o.manifestHash,m.id);o.hostEvidence=fixture.retainClose(o,receipt);return receipt}
test('trusted host pins initial identity and separately retained exact safe close',()=>{
 const o=make();fixture.qualify(o)
 const receipt=close(o);fixture.qualify({...o,resumeReceipt:receipt})
 const stale=structuredClone(receipt),next=close(o)
 assert.throws(()=>fixture.qualify({...o,resumeReceipt:stale}),/resume_refused/)
 fixture.qualify({...o,resumeReceipt:next})
})
test('forged, unsafe, cross-root, wrong-instance and untrusted receipts cannot attest themselves',()=>{
 const o=make(),receipt=close(o),other=make(),otherReceipt=close(other)
 for(const changed of [{...receipt,safeClosed:false},{...receipt,instanceId:otherReceipt.instanceId},{...receipt,root:other.root},{...receipt,files:{...receipt.files,'data/unknown.json':'0'.repeat(64)}},otherReceipt]){
  assert.throws(()=>fixture.qualify({...o,resumeReceipt:changed}),/resume_refused/)
 }
 assert.throws(()=>fixture.qualify({...o,resumeReceipt:receipt,hostEvidence:null}),/host_evidence_required/)
 fs.appendFileSync(o.hostEvidence.path,' ')
 assert.throws(()=>fixture.qualify({...o,resumeReceipt:receipt}),/host_evidence_required/)
})
test('immutable authorization, model, source and manifest pins cannot be replaced on resume',()=>{
 for(const name of ['data/company-access.json','config/model-selection.json','config/synthetic-source.json','.independent-fixture.json']){
  const o=make(),receipt=close(o);fs.appendFileSync(path.join(o.root,name),' ')
  assert.throws(()=>fixture.qualify({...o,resumeReceipt:receipt}),/fixture_changed|fixture_identity_required/)
 }
 const o=make(),receipt=close(o);fs.writeFileSync(path.join(o.root,'data/unknown.json'),'{}')
 assert.throws(()=>fixture.qualify({...o,resumeReceipt:receipt}),/fixture_changed/)
 assert.throws(()=>fixture.retainClose(o,{...receipt,files:fixture.inventory(o.root)}),/resume_refused/)
})
test('symlink and Windows junction escape are rejected with real disposable links',()=>{
 for(const type of process.platform==='win32'?['junction']:['dir']){
  const o=make(),elsewhere=fs.mkdtempSync(path.join(os.tmpdir(),'r1-link-'))
  fs.symlinkSync(elsewhere,path.join(o.root,'data/escape'),type)
  assert.throws(()=>fixture.qualify(o),/root_alias/)
 }
})
test('recovery marker takes precedence over changed runtime files and remains untouched',()=>{
 const o=make(),marker=path.join(o.root,'.independent-process.json');fs.writeFileSync(marker,'retained-crash-evidence');fs.writeFileSync(path.join(o.root,'data/aroma-truth.json'),'{}')
 assert.throws(()=>fixture.qualify(o),/EEXIST/);assert.equal(fs.readFileSync(marker,'utf8'),'retained-crash-evidence')
})
test('startup classification preserves safe causes and never prints arbitrary error/path text',()=>{
 for(const code of ['independent_authorization_invalid','independent_config_invalid','independent_dependencies_required','independent_process_required','independent_root_too_large','independent_storage_corrupt','independent_recovery_required','EEXIST'])assert.equal(safeCode(Error(code)),code)
 assert.equal(safeCode(new SyntaxError('private path secret')),'independent_storage_corrupt')
 assert.equal(safeCode(Object.assign(Error('private path secret'),{code:'EACCES'})),'independent_storage_unavailable')
 assert.equal(safeCode(Object.assign(Error('private dependency path'),{code:'MODULE_NOT_FOUND'})),'independent_dependencies_required')
 assert.equal(safeCode(Error('private path secret')),'independent_startup_unavailable')
})
