'use strict'
// Owner-run isolated launcher. Does not install services, change policy, restart
// production, source production .env, or touch any existing acceptance ledger.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net'),{spawn}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),runtime='C:\\Aroma\\local-brain-runtime'
const evidence='C:\\Users\\louis\\Documents\\Codex\\local-candidates\\local-brain-20261114'
const children=[]
const free=port=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(Error('isolated_port_in_use_'+port)));s.listen(port,'127.0.0.1',()=>s.close(resolve))})
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function ready(url,{fetchFn=fetch,waitFn=wait,attempts=60}={}){for(let i=0;i<attempts;i++){try{const r=await fetchFn(url,{signal:AbortSignal.timeout(1000),redirect:'error'});if(r.status===200)return}catch{}await waitFn(500)}throw Error('isolated_service_not_ready')}
async function main(){
  if(process.platform!=='win32')throw Error('native_windows_required')
  const tags=await(await fetch('http://127.0.0.1:11435/api/tags',{signal:AbortSignal.timeout(5000),redirect:'error'})).json()
  if(!tags.models?.some(m=>m.name==='qwen3.5:9b'&&m.digest==='56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90'))throw Error('reviewed_local_model_missing')
  await free(18092)
  const sourceHash=require('../../src/localBrain/buildIdentity').buildIdentity(root)
  const dataDir=path.join(runtime,'acceptance-'+new Date().toISOString().replace(/\D/g,''))
  fs.mkdirSync(dataDir,{recursive:true})
  const baseEnv={...process.env,NODE_PATH:'C:\\Aroma\\aroma-agent-backend\\node_modules',LOCAL_BUILD_SHA256:sourceHash}
  for(const key of Object.keys(baseEnv))if(/API_KEY|TOKEN|PASSWORD|DATABASE_URL|PGPASSWORD/.test(key))delete baseEnv[key]
  delete baseEnv.LOCAL_TOKENIZER_URL
  const node=spawn(process.execPath,[path.join(__dirname,'start.cjs')],{cwd:root,windowsHide:true,stdio:['ignore','inherit','inherit'],env:{...baseEnv,LOCAL_MODEL:'qwen3.5:9b',LOCAL_MODEL_CONTEXT:'65536',LOCAL_DATA_DIR:dataDir,LOCAL_MEMORY_SNAPSHOT:path.join(evidence,'memory-source-snapshot.json'),LOCAL_PASSWORD_FILE:path.join(runtime,'owner-password.txt'),LOCAL_APP_PORT:'18092',LOCAL_TEST_FIXTURES:'1'}})
  children.push(node);node.on('error',()=>{console.error('local_app_start_failed');shutdown()})
  await ready('http://127.0.0.1:18092/owner/login')
  const receipt={at:new Date().toISOString(),launcherPid:process.pid,appPid:node.pid,dataDir,url:'http://127.0.0.1:18092/local',productionChanged:false,sourceHash,model:'qwen3.5:9b',context:65536}
  fs.writeFileSync(path.join(evidence,'isolated-launch.json'),JSON.stringify(receipt,null,2))
  fs.appendFileSync(path.join(evidence,'isolated-launch-history.jsonl'),JSON.stringify(receipt)+'\n')
  console.log('LOCAL CANDIDATE READY: http://127.0.0.1:18092/local\nKeep this terminal open. Ctrl+C stops ONLY the child launched here. No model acceptance has run yet.')
}
function shutdown(){for(const child of children)if(!child.killed)child.kill();process.exitCode=1}
if(require.main===module){
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown)
  main().catch(e=>{console.error(/^[a-z_0-9]+$/.test(e.message)?e.message:'isolated_start_failed');shutdown()})
}
module.exports={ready}
