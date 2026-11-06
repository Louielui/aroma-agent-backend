'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{execFileSync}=require('node:child_process')
test('the existing launcher gives only its child the proven IANA zone; installed dateparser/tzlocal can initialize offline',()=>{
 let launched;const inherited={TZ:'Manitoba Standard Time',KEEP:'inherited',OPENAI_API_KEY:'fixture-secret'},proc={env:inherited,argv:[],exitCode:null}
 const sandbox={__dirname:__dirname,process:proc,console}
 sandbox.require=name=>name==='node:fs'?{readFileSync:file=>String(file).endsWith('local-config.json')?JSON.stringify({dbPassword:'offline-password'}):''}:name==='dotenv'?{parse:()=>({XIANGXIANG_MEMORY:'on',CODEX_CHAT_BRIDGE_TOKEN:'fixture',HINDSIGHT_TOKEN:'fixture'})}:name==='node:child_process'?{spawn:(command,args,options)=>{launched={command,args,options};return new EventEmitter()}}:require(name)
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'startHindsight.cjs'),'utf8'),sandbox)
 assert.equal(inherited.TZ,'Manitoba Standard Time');assert.equal(launched.options.env.TZ,'America/Winnipeg');assert.equal(launched.options.env.OPENAI_API_KEY,undefined);assert.equal(launched.options.env.KEEP,'inherited')
 const output=execFileSync('C:/Aroma/hindsight-runtime/Scripts/python.exe',['-B','-c','from tzlocal import get_localzone; import dateparser; print(get_localzone().key)'],{env:{...process.env,TZ:launched.options.env.TZ},encoding:'utf8',windowsHide:true,timeout:20000})
 assert.equal(output.trim(),'America/Winnipeg');assert.equal(launched.args[0],path.join(__dirname,'work_trace_runtime.py'))
})
