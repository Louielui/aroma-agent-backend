'use strict'
const {ID}=require('../operating/runStore')
// Only an explicit current Owner command creates an inert request. Quoted
// history, sources and model output never choose work or approve execution.
function classify(message){
 if(typeof message!=='string'||message.length>12000)return null
 const s=message.trim(),continued=s.match(/^(?:請)?(?:接續|繼續|查看)(?:工作單|任務)\s*([a-f0-9-]{36})[。.!！]?$/i)||s.match(/^(?:continue|resume|view) task ([a-f0-9-]{36})[.!]?$/i)
 if(continued&&ID.test(continued[1]))return{op:'continue',id:continued[1]}
 if(require('../codeDiagnosis/chat').isReadonlyRequest(s))return null
 if(/^(?:請)?(?:用)?本機(?:模型)?(?:修正|修復|改碼|編程)[，,:：\s]+\S/u.test(s)||/^local Node repair:\s*\S/i.test(s))return{op:'request',goal:s,execution:'local'}
 if(/^(?:請)?(?:直接)?(?:派工給|派|交給)\s*Codex(?:[，,：:\s]|$)/iu.test(s)||/^ask Codex to /i.test(s))return{op:'request',goal:s}
 return null
}
function createChatTasks({bootCommit,env=process.env,request=input=>require('../../adapters/ControlledDispatchAdapter').projectRequest('task',input,env)}){
 return{async prepare(actor,input){
  if(actor?.id!=='owner'||actor.role!=='owner')throw Error('permission_denied')
  if(env.READ_ACCESS!=='on')throw Error('not_enabled')
  if(!input||Object.keys(input).sort().join(',')!=='message,requestId'||!ID.test(input.requestId||''))throw Error('invalid_request')
  const intent=classify(input.message);if(!intent)throw Error('invalid_request');if(intent.execution==='local'&&env.XIANGXIANG_LOCAL_CODING!=='on')throw Error('local_coding_disabled')
  const command={...intent,requestId:input.requestId,...(intent.op==='request'?{bootCommit}:{})}
  const v=await request(command)
  if(v.error)throw Error(v.error)
  if(v.run?.workflow!=='project_task'||!ID.test(v.run.id||''))throw Error('invalid_worker_result')
  const {requestKey}=require('./repositoryRequest')
  if(intent.op==='continue'?v.run.id!==intent.id:typeof v.run.input?.goal!=='string'||requestKey(v.run.input)!==requestKey(command)||!(v.run.requestId===input.requestId||v.run.requestIds?.includes(input.requestId)))throw Error('invalid_worker_result')
  return{run:v.run,nextAction:v.nextAction,reused:v.run.requestId!==input.requestId}
 }}
}
module.exports={classify,createChatTasks}
