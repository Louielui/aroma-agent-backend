'use strict'
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{validate,validateSource}=require('./contract'),{createReader,encode}=require('./nativeProtocol')
function createBroker({request,clientStatus}){
 return async input=>{
  if(input?.op==='client_status'&&Object.keys(input).join(',')==='op'&&clientStatus)return clientStatus()
  validate(input);if(['prepare','read'].includes(input.op)&&Object.hasOwn(input,'source'))validateSource(input.source,Date.now())
  return request(input)
 }
}
async function main(){
 const config=JSON.parse(fs.readFileSync(path.join(__dirname,'host-config.json'),'utf8'))
 if(process.argv.length<3||process.argv[2]!==config.extensionOrigin||!/^chrome-extension:\/\/[a-p]{32}\/$/.test(config.extensionOrigin))throw Error('extension_not_allowed')
 const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
 const token=cp.execFileSync(ps,['-NoProfile','-NonInteractive','-Command',"[Environment]::GetEnvironmentVariable('HUB_TOKEN','User')"],{encoding:'utf8',windowsHide:true,shell:false,timeout:5000}).trim()
 if(!token)throw Error('owner_service_unavailable')
 const request=lane=>async(body,signal)=>{
  const response=await fetch('http://127.0.0.1:8090/api/v1/'+lane,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)})
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>200000)throw Error('native_response_too_large')
  const result=JSON.parse(bytes.toString('utf8'));if(!response.ok)throw Error(typeof result.error==='string'?result.error:'browser_read_unavailable');return result
 }
 const broker=createBroker({request:request('browser-read'),clientStatus:async()=>{
  const state=await request('browser-client')({op:'status'})
  if(state.state!=='ready'||state.activeJobs!==0)return {state:state.state==='busy'?'busy':'unavailable'}
  return {...require('./clientUpdate.js').readInstallation({bootCommit:state.bootCommit}),bindings:state.bindings}
 }})
 const operator=require('./operatorBroker.cjs').createOperatorBroker({request:request('browser-operator'),executor:require('./nativeInput.cjs').createExecutor()})
 const output=value=>process.stdout.write(encode(value))
 // Requests run concurrently so cancellation can abort an in-flight read.
 let inFlight=0
 const reader=createReader(message=>{
  if(!message||Object.keys(message).sort().join(',')!=='body,id'||typeof message.id!=='string'||message.id.length>80||inFlight>=4){output({id:message?.id||null,error:'invalid_native_request'});return}
  inFlight++
  const handler=typeof message.body?.op==='string'&&message.body.op.startsWith('operator_')?operator:broker
  handler(message.body).then(result=>output({id:message.id,result}),error=>output({id:message.id,error:/^[a-z_]+$/.test(error.message)?error.message:'browser_read_unavailable'})).finally(()=>inFlight--)
 },()=>process.exit(3))
 process.stdin.on('data',reader);process.stdin.on('end',()=>process.exit(0))
}
if(require.main===module)main().catch(()=>{process.stderr.write('Imagine browser read host unavailable.\n');process.exitCode=3})
module.exports={createBroker}
