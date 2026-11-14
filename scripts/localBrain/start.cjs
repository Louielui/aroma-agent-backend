'use strict'
// Portable isolated host. Explicit paths only; never load production .env or data.
const fs=require('node:fs'),path=require('node:path')
const dataDir=process.env.LOCAL_DATA_DIR,source=process.env.LOCAL_MEMORY_SNAPSHOT
if(!dataDir||!path.isAbsolute(dataDir)||!source||!path.isAbsolute(source))throw Error('explicit_local_paths_required')
if(path.resolve(dataDir).toLowerCase().startsWith('c:\\aroma\\aroma-agent-backend'))throw Error('production_data_refused')
Object.assign(process.env,{LOCAL_BRAIN_ONLY:'1',LLM_PROVIDER:'local',CHAT_BACKEND:'local',LOCAL_APP_PORT:process.env.LOCAL_APP_PORT||'18090',LOCAL_MODEL_CONTEXT:process.env.LOCAL_MODEL_CONTEXT||'32768',AROMA_DATA_DIR:dataDir,READ_ACCESS:'on',XIANGXIANG_MEMORY:'on',A4_KNOWLEDGE_ROUTING:'on',GOAL_DECOMPOSER:'on',CONVERSATION_DEMO:'on',TURN_ROUTER:'on'})
// This process never inherits credentials or production background enablement.
for(const key of Object.keys(process.env))if(/API_KEY|HUB_TOKEN|BRIDGE_TOKEN|OWNER_PASSWORD|DATABASE_URL|PGPASSWORD/.test(key))delete process.env[key]
fs.mkdirSync(dataDir,{recursive:true})
const audit=e=>fs.appendFileSync(path.join(dataDir,'egress.jsonl'),JSON.stringify({...e,at:new Date().toISOString()})+'\n')
require('../../src/localBrain/isolation').install({audit,tokenizerPort:Number(new URL(process.env.LOCAL_TOKENIZER_URL||'http://127.0.0.1:11436').port)})
const passwordFile=process.env.LOCAL_PASSWORD_FILE
if(!passwordFile||!fs.existsSync(passwordFile))throw Error('isolated_owner_password_file_required')
const host=require('../../src/localBrain/server').createLocalApp({dataDir,sourceRows:JSON.parse(fs.readFileSync(source,'utf8')),ownerPassword:fs.readFileSync(passwordFile,'utf8').trim(),onEvent:e=>fs.appendFileSync(path.join(dataDir,'learning-events.jsonl'),JSON.stringify({...e,at:new Date().toISOString()})+'\n')})
const {app}=host
if(process.env.LOCAL_TEST_FIXTURES==='1') {
  process.env.CONTEXT_AROMA_SYSTEM='on'
  const {events}=require('../../src/adapters/LocalAdapter')
  app.locals.a4ReadDepsOverride={connector:require('../../src/localBrain/fixtures').createFixtureConnector({context:()=>events.getStore()})}
}
const port=Number(process.env.LOCAL_APP_PORT)
const server=app.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({state:'listening',address:'127.0.0.1',port,provider:'local',model:process.env.LOCAL_MODEL||'qwen3:8b',learning:!!host.learning,cloudFallback:false})))
let stopping=false
function stop(){if(stopping)return;stopping=true;server.close();host.learning?.runtime.stop();const timer=setInterval(()=>{try{host.close();clearInterval(timer);process.stdin.destroy()}catch(e){if(e.message!=='local_memory_busy'){clearInterval(timer);process.exitCode=1}}},100)}
// A closed parent pipe can only request graceful shutdown, never execute code.
process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{if(s.trim()==='stop')stop()});process.stdin.on('end',stop)
process.on('SIGINT',stop);process.on('SIGTERM',stop)
