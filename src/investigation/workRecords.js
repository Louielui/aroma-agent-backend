'use strict'
const fs = require('node:fs'), path = require('node:path')
const { projectWorkRecord, selectWorkSample } = require('./workEvidence')
const FOLDERS = Object.freeze(['project-tasks', 'project-runs', 'adoptions', 'runs'])
const ID = /^[a-f0-9-]{36}\.json$/i
function pin (root) {
  if (fs.lstatSync(root).isSymbolicLink()) throw Error('redirected_root')
  // Pin the host-configured root once. Windows packaged-app storage can resolve
  // to a LocalCache directory without being a filesystem reparse point.
  return fs.realpathSync.native(root)
}
function readAt (root, name, max) {
  const file = path.resolve(root, name), canonical = fs.realpathSync.native(file)
  if (file.toLowerCase() !== canonical.toLowerCase() || fs.lstatSync(file).isSymbolicLink()) throw Error('redirected_record')
  const s=fs.statSync(file); if (!s.isFile() || s.size>max) throw Error('record_limit')
  return fs.readFileSync(file,'utf8')
}
function createWorkReader ({ workerRoot, repoRoot, activity = () => [], clock = () => new Date().toISOString() }) {
  let pending = null
  async function collect () {
    const retrievedAt=clock(); let root,repo
    try { root=pin(workerRoot);repo=pin(repoRoot) } catch (_) { return { state:'unavailable',records:[],workflows:[],coverage:[],retrievedAt,provesCharge:false } }
    const records=[],coverage=[]
    for (const folder of FOLDERS) {
      let names
      try { const dir=path.join(root,folder);if (fs.lstatSync(dir).isSymbolicLink() || fs.realpathSync.native(dir).toLowerCase()!==dir.toLowerCase()) throw Error('redirected_directory');names=fs.readdirSync(dir).filter(n=>ID.test(n)).sort() } catch(e) {coverage.push({kind:'worker/'+folder,state:e.code==='ENOENT'?'missing':'unavailable',scanned:0,failed:null,omitted:null});continue}
      let failed=0
      for(const name of names.slice(0,250)) try { const d=JSON.parse(readAt(root,path.join(folder,name),2*1024*1024));records.push({sourceId:name.slice(0,-5),...projectWorkRecord(d,{kind:'worker/'+folder,readSource:n=>readAt(repo,n,512*1024)})}) } catch(_){failed++}
      coverage.push({kind:'worker/'+folder,state:failed||names.length>250?'partial':'ok',scanned:Math.min(names.length,250),failed,omitted:Math.max(0,names.length-250)})
    }
    let workflows=[]
    try { workflows=activity().slice(0,5).map(r=>({role:['test_draft','development','review','adoption','fixture'].includes(r.role)?r.role:'unknown',state:['idle','occupied'].includes(r.state)?r.state:'unknown',model:typeof r.model==='string'?r.model.slice(0,100):null,effort:typeof r.effort==='string'?r.effort.slice(0,40):null,modelBasis:'host_workflow_default_not_per_job_selection',at:retrievedAt})) } catch (_) {}
    const selected=selectWorkSample(records)
    return {...selected,state:coverage.every(r=>r.state==='ok')&&!selected.omitted?'ok':'partial',coverage,scanned:coverage.reduce((n,r)=>n+r.scanned,0),workflows,retrievedAt,provesCharge:false,scope:'fixed_owner_worker_records',note:'Host-projected work metadata and live bridge workflow occupancy only. Occupied may include waiting for a restart; it is not a named scheduler execution witness. Model defaults do not establish per-job selection. Candidate tests and source comparisons do not establish the same failure fixed.'}
  }
  return {read:()=>{if(!pending)pending=collect().finally(()=>{pending=null});return pending}}
}
module.exports={createWorkReader,FOLDERS}
