'use strict'
// Reporting metadata shared by the existing intake, task and receipt stores.
// No executor, scheduler, source access, dispatch or permission grant lives here.
const {createHash}=require('node:crypto')
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const KINDS=['read','action','recurring','answer','unknown']
const schema={type:'array',items:{type:'object',additionalProperties:false,required:['ownerQuote','capability','kind'],properties:{ownerQuote:{type:'string'},capability:{anyOf:[{type:'string',enum:[...require('../../governance/selfCapability').CAPABILITY_NAMES,...require('../../actions/understanding').SCHEMA.properties.capability.enum.filter(v=>v!=='none')]},{type:'null'}]},kind:{type:'string',enum:KINDS}}}}
function scope(){return hash({version:1,capabilities:require('../../governance/selfCapability').REGISTRY,actions:require('../../actions/understanding').SCHEMA.properties.capability.enum,targets:require('../../actions/contract').TARGETS})}
function capability(id){const own=require('../../governance/selfCapability').capabilityEntry(id);if(own)return own;return require('../../actions/understanding').SCHEMA.properties.capability.enum.includes(id)&&id!=='none'?{capability:id,implementation:'implemented',kind:'execution'}:null}
const clauses=s=>s.split(/\n+|[。!！;；，]+|,(?!\d{3}(?:\D|$))|(?<!\d)\.(?!\d)|\s+(?:and(?: then)?|then)\s+|(?=之後|然後|並且|以及)/iu).map(v=>v.trim()).filter(Boolean)
const constraint=s=>/^(?:不需要|不要|不可|禁止|唔好|不准|do not\b|don't\b|never\b|without\b)/iu.test(s)
// Only an entire closed prohibition can be excluded from mandatory outcomes.
// Unknown/compound negatives remain mandatory as well as retained constraints.
const pureConstraint=s=>/^(?:(?:不需要|不要|不可|禁止|唔好|不准)(?:下單|結帳|付款)|(?:do not|don't|never)\s+(?:checkout|check out|place (?:an?|the) order|pay))$/iu.test(s)
const recurring=s=>/(?:每天|每日|每週|每周|每月|定期|daily|every\s+(?:day|morning|week|month)|recurring|schedule)/iu.test(s)
function deriveStatus(g){const completed=g.outcomes.filter(o=>o.status==='COMPLETED_WITH_EVIDENCE').length;return completed===g.outcomes.length&&completed>0?'GOAL_COMPLETED':completed?'GOAL_PARTIAL':g.outcomes.some(o=>['UNAVAILABLE','BLOCKED'].includes(o.status))?'GOAL_BLOCKED':'GOAL_PENDING'}
function createGoal({objective,requestId}){
 if(typeof objective!=='string'||!objective.trim()||objective.length>20000||typeof requestId!=='string'||!requestId||requestId.length>150)throw Error('invalid_owner_goal')
 const parts=clauses(objective),scopeHash=scope(),goalId=hash({requestId,objective,scopeHash}),constraints=parts.filter(constraint),required=parts.filter(s=>!pureConstraint(s))
 // Excessively fragmented input remains one unresolved exact objective, never a truncated goal.
 const quotes=required.length&&required.length<=16?required:[objective]
 const g={version:1,goalId,requestId,originalObjective:objective,scopeVersion:1,scopeHash,grantsAuthority:false,recurring:recurring(objective),constraints,outcomes:quotes.map((ownerQuote,i)=>({id:'outcome-'+i,ownerQuote,mandatory:true,steps:[{id:'step-'+i,ownerQuote}],requiredCapabilities:[],authorizationRequirements:['unregistered_scope'],status:'UNAVAILABLE',completionEvidence:[],blockers:['capability_not_mapped'],limitations:[]})),status:'GOAL_BLOCKED'}
 return g
}
function refineGoal(goal,proposed){
 if(!validGoal(goal))throw Error('invalid_owner_goal')
 const g=structuredClone(goal)
 // A semantic plan can label an exact Owner clause; it can never remove one.
 const rows=Array.isArray(proposed)&&proposed.length<=16?proposed:[]
 for(const o of g.outcomes){
  const matches=rows.filter(p=>p&&Object.keys(p).sort().join(',')==='capability,kind,ownerQuote'&&p.ownerQuote===o.ownerQuote&&KINDS.includes(p.kind)),p=matches.length===1?matches[0]:null,entry=p&&capability(p.capability)
  if(!entry)continue
  o.requiredCapabilities=[entry.capability];o.steps[0].kind=p.kind
  o.authorizationRequirements=[entry.kind==='read'?'existing_source_authorization':'exact_task_action_approval']
  o.status=entry.implementation==='implemented'?'AUTHORIZATION_REQUIRED':'UNAVAILABLE'
  o.blockers=[entry.implementation==='implemented'?'execution_not_verified':'capability_not_implemented']
 }
 g.status=deriveStatus(g);return g
}
function applyEvidence(goal,evidence,verifyReceipt){
 if(!validGoal(goal))throw Error('invalid_owner_goal')
 const g=structuredClone(goal)
 if(g.scopeHash!==scope()||typeof verifyReceipt!=='function')return g
 for(const e of Array.isArray(evidence)?evidence:[]){
  const o=g.outcomes.find(o=>o.id===e?.outcomeId)
  if(!o||e.goalId!==g.goalId||e.scopeHash!==g.scopeHash||e.state!=='verified'||e.complete!==true||!o.requiredCapabilities.includes(e.capability)||typeof e.receiptId!=='string'||!e.receiptId||e.receiptId.length>150)continue
  let verified=false;try{verified=verifyReceipt(structuredClone(e),structuredClone(o),structuredClone(g))===true}catch{}
  if(!verified)continue
  o.completionEvidence=[{goalId:g.goalId,scopeHash:g.scopeHash,outcomeId:o.id,capability:e.capability,receiptId:e.receiptId,state:'verified',complete:true}];o.status='COMPLETED_WITH_EVIDENCE';o.blockers=[]
 }
 g.status=deriveStatus(g);return g
}
function observeReads(goal,observations){
 if(!validGoal(goal))throw Error('invalid_owner_goal')
 const g=structuredClone(goal)
 for(const o of g.outcomes){
  if(o.status==='COMPLETED_WITH_EVIDENCE'||o.requiredCapabilities.length!==1)continue
  const id=o.requiredCapabilities[0],entry=capability(id)
  if(entry?.kind!=='read')continue
  const source=id.replace(/\.read$/,''),rows=(observations?.perSource||[]).filter(r=>r?.source===source&&r.trust!=='not_asked')
  if(!rows.length)continue
  const failed=rows.some(r=>r.trust!=='live'),incomplete=(observations?.evidenceSets||[]).some(e=>e?.source===source&&e.completeness!=='complete')
  o.status=failed||incomplete?'BLOCKED':'AVAILABLE';o.blockers=[failed?'read_unavailable':incomplete?'incomplete_read_coverage':'outcome_not_verified'];o.limitations=['read_receipt_is_not_goal_completion']
 }
 g.status=deriveStatus(g);return g
}
function bindGatewayGoal(goal,run,parentGoal=null){
 if(!validGoal(goal))throw Error('invalid_owner_goal')
 const g=structuredClone(goal)
 const inverse=validGoal(parentGoal)&&parentGoal.outcomes.some(p=>p.executionBinding?.receiptId===run?.restoreOf&&p.executionBinding?.contextId===run?.context?.investigationId)
 if(run?.state!=='awaiting_approval'||(run.context?.investigationId!==g.requestId&&!inverse)||!require('../../actions/contract').TARGETS.some(t=>t.id===run.target?.id)||!['scheduler.pause','scheduler.resume'].includes(run.capability)||!/^[a-f0-9]{64}$/.test(run.hash||'')||typeof run.id!=='string'||inverse&&g.outcomes.length!==1)return g
 const matches=g.outcomes.filter(o=>singleGatewayObjective({originalObjective:o.ownerQuote},run,inverse))
 if(matches.length!==1)return g
 const o=matches[0]
 o.requiredCapabilities=[run.capability];o.authorizationRequirements=['exact_task_action_approval'];o.status='AUTHORIZATION_REQUIRED';o.blockers=['execution_not_verified']
 o.steps[0].kind='action';o.executionBinding={receiptId:run.id,proposalHash:run.hash,targetId:run.target.id,contextId:run.context.investigationId};g.status=deriveStatus(g);return g
}
function singleGatewayObjective(g,run,inverse){
 if(inverse)return require('../../actions/chat').parseContinuation(g.originalObjective)?.kind==='restore'
 const target=require('../../actions/contract').TARGETS.find(t=>t.id===run.target.id),escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),name='(?:'+[target.id,target.taskName].map(escape).join('|')+')',verb=run.capability==='scheduler.resume'?'(?:resume|enable)':'(?:pause|disable)',zh=run.capability==='scheduler.resume'?'(?:恢復|啟用)':'(?:暫停|停用)'
 const text=g.originalObjective.trim().replace(/[。.!！]$/,'').trim()
 return new RegExp('^(?:please\\s+)?'+verb+'\\s+(?:the\\s+)?'+name+'(?:\\s+(?:job|task|schedule))?$','i').test(text)||new RegExp('^(?:請|幫我)?'+zh+'\\s*'+name+'(?:排程)?$','i').test(text)
}
function applyGatewayEvidence(goal,run){
 if(!validGoal(goal))throw Error('invalid_owner_goal')
 const o=goal.outcomes.find(o=>o.executionBinding?.receiptId===run?.id)
 if(!o)return structuredClone(goal)
 const b=o.executionBinding,e={goalId:goal.goalId,scopeHash:goal.scopeHash,outcomeId:o.id,capability:run.capability,receiptId:run.id,state:'verified',complete:true}
 // The caller reads this run through the existing authenticated Action Gateway,
 // never from model prose or client-supplied receipts. A saved state alone is insufficient.
 return applyEvidence(goal,[e],()=>run.state==='verified'&&run.hash===b.proposalHash&&run.target?.id===b.targetId&&run.context?.investigationId===b.contextId&&run.after?.definitionHash===run.expected?.definitionHash&&/^[a-f0-9]{64}$/.test(run.after?.definitionHash||'')&&run.after?.enabled===(run.capability==='scheduler.resume')&&['Ready','Disabled'].includes(run.after?.runtime)&&run.timeline?.some(v=>v.phase==='verified'))
}
function validGoal(g){try{return validGoalInner(g)}catch{return false}}
function validGoalInner(g){
 if(!g||g.version!==1||g.scopeVersion!==1||g.grantsAuthority!==false||typeof g.originalObjective!=='string'||g.originalObjective.length>20000||typeof g.requestId!=='string'||typeof g.scopeHash!=='string'||!/^[a-f0-9]{64}$/.test(g.scopeHash)||g.goalId!==hash({requestId:g.requestId,objective:g.originalObjective,scopeHash:g.scopeHash})||!Array.isArray(g.outcomes)||!g.outcomes.length||g.outcomes.length>16||!Array.isArray(g.constraints)||g.constraints.some(v=>typeof v!=='string'||!g.originalObjective.includes(v)))return false
 if(g.recurring!==recurring(g.originalObjective)||JSON.stringify(g.constraints)!==JSON.stringify(clauses(g.originalObjective).filter(constraint)))return false
 const expected=createQuotes(g.originalObjective)
 if(g.outcomes.length!==expected.length)return false
 for(const [i,o]of g.outcomes.entries()){
  if(o.id!=='outcome-'+i||o.ownerQuote!==expected[i]||o.mandatory!==true||!Array.isArray(o.steps)||o.steps.length!==1||o.steps[0].ownerQuote!==o.ownerQuote||!Array.isArray(o.requiredCapabilities)||o.requiredCapabilities.length>1||!Array.isArray(o.authorizationRequirements)||!Array.isArray(o.blockers)||!Array.isArray(o.limitations)||!Array.isArray(o.completionEvidence)||!['AVAILABLE','UNAVAILABLE','AUTHORIZATION_REQUIRED','BLOCKED','COMPLETED_WITH_EVIDENCE'].includes(o.status))return false
  if(o.requiredCapabilities.some(id=>!capability(id)))return false
  if(o.executionBinding&&(!/^[a-f0-9]{64}$/.test(o.executionBinding.proposalHash||'')||!require('../../actions/contract').TARGETS.some(t=>t.id===o.executionBinding.targetId)||typeof o.executionBinding.receiptId!=='string'||typeof o.executionBinding.contextId!=='string'))return false
  if(o.status==='COMPLETED_WITH_EVIDENCE'&&(!o.completionEvidence.length||o.completionEvidence.some(e=>e.goalId!==g.goalId||e.scopeHash!==g.scopeHash||e.outcomeId!==o.id||e.state!=='verified'||e.complete!==true||!o.requiredCapabilities.includes(e.capability))))return false
 }
 return g.status===deriveStatus(g)
}
function createQuotes(objective){const required=clauses(objective).filter(s=>!pureConstraint(s));return required.length&&required.length<=16?required:[objective]}
function groundedOutcomeReply(result,goal){
 const build=require('../groundedReply').buildGroundedReply
 // These discriminants are produced by the host's persisted outcome branches,
 // never inferred from model mode/reply/offer or treated as execution evidence.
 if(result.demoOutcome==='execution_proposal'&&Array.isArray(result.proposals)){
  const proposal=result.proposals.length===1&&result.proposals[0]?.id?result.proposals[0]:null
  return build({type:'execution_proposal',proposalCreated:!!proposal,proposalId:proposal?.id,promoteError:result.promoteErrors?.[0]})
 }
 if(result.demoOutcome==='clarification'&&['no_actionable_task','multiple_tasks_narrow_to_one','not_a_commit_intent'].includes(result.clarificationReason))return build({type:'clarification',clarificationReason:result.clarificationReason})
 if(result.investigation?.readOnly===true)return require('../../investigation/decisionAdviceView').renderDecisionAdvice(result.investigation.decisionAdvice,{message:goal.originalObjective})?.text||''
 return ''
}
function attachResult(result,goal,{readReply='',hostReply=''}={}){if(!result||typeof result.reply!=='string'||!validGoal(goal))return result;const reply=[...new Set([hostReply,groundedOutcomeReply(result,goal),readReply,require('./ownerGoalView').renderGoal(goal)].filter(Boolean))].join('\n\n');return {...result,ownerGoal:structuredClone(goal),reply,replyForArchive:reply,judgment:'',reasons:[],offer:'',next_step:''}}
function projectTask(task){return validGoal(task?.ownerGoal)?{...task,goalStatus:task.ownerGoal.status}:task}
function shouldTrack(message){
 const text=String(message).trim(),intent=text.replace(/^(?:don't forget to|do not forget to|不要忘記|別忘記|唔好忘記)\s*/iu,''),router=require('../laneRouter')
 if(pureConstraint(text)||['question','capability_question','investigation_request','arrangement_request','general_knowledge'].includes(router.routeLane(intent).reason))return false
 const command=intent.replace(/^(?:(?:please|help me)\s+|(?:請|幫我|麻煩你?|我要|我想要?)\s*)/iu,'')
 const creation=/^(?:schedule\b|(?:create|add|set up)\s+(?:(?:a|an|the|new|daily|weekly|monthly|recurring|automatic|morning|purchasing|inventory|replenishment)\s+)*(?:schedule|scheduled task|background job|task|job|workflow|routine)\b)|^(?:新增|建立|設定|安排)(?:一[個項]|每天|每日|每週|每月|定期|循環|自動|早上|採購|訂貨|庫存|補貨|[0-9０-９]+(?:[:：][0-9０-９]+)?(?:點|時|分)?)*(?:排程|schedule\b|任務|工作|流程)/iu
 return router.isBusinessActionRequest(intent)||recurring(intent)&&creation.test(command)
}
function isTaskRequest(message){
 const text=String(message).trim(),router=require('../laneRouter')
 if(['question','capability_question','investigation_request','arrangement_request','general_knowledge'].includes(router.routeLane(text).reason))return false
 const primaryTask=/^(?:(?:please|help me)\s+|(?:請|幫我|麻煩你?)\s*)?(?:pause|resume|enable|disable|stop|cancel|delete|create|schedule|set up|run|restart)\b|^(?:請|幫我|麻煩你?)?(?:暫停|停用|恢復|啟用|停止|取消|刪除|新增|建立|設定)/iu.test(text)
 if(router.isReadRequest(text)&&!primaryTask)return false
 return clauses(text).some(s=>{
  const command=s.replace(/^(?:(?:please|help me)\s+|(?:請|幫我|麻煩你?)\s*)/iu,'')
  // An analytic object is not an external business effect. Examine clauses
  // independently so a real attached action still retains the full objective.
  if(/^(?:add\s+up\b|(?:create|make|build|generate|prepare|run)\s+(?:(?:a|an|the|new|daily|weekly|monthly)\s+)*(?:summary|report|analysis|comparison|overview|breakdown|table|chart|list|description)\b)|^(?:新增|建立|產生|製作|整理)(?:一[個份張]|每日|每天|每週|每月)*(?:摘要|報告|分析|比較|概覽|明細|表格|圖表|清單)/iu.test(command))return false
  if(shouldTrack(s))return true
  const scheduler=/^(?:pause|resume|enable|disable|stop|cancel|delete|restart|run)\s+(?:(?:both|all|the|that|this|these|previous|two)\s+)*(?:(?:scheduled?|background|automatic)\s+(?:tasks?|jobs?)|scheduler|Windows service|backend|bridge|AromaXiangXiang[\w-]*|ActionGatewayAcceptance|gateway-acceptance|errand-recall)\b|^(?:暫停|停用|恢復|啟用|停止|取消|刪除|執行|重新啟動)(?:這個|那個|所有|全部|兩個)?(?:排程|背景工作|自動工作|服務|後端|橋接器|AromaXiangXiang|ActionGatewayAcceptance)/iu.test(command)
  const cart=/^(?:add|put|place|move)\b.+\b(?:to|into|in)\s+(?:the\s+)?(?:Costco\s+)?(?:shopping\s+)?cart\b|^(?:放進|加入).*(?:購物車)/iu.test(command)
  return scheduler||cart
 })
}
// Conversation-owned reporting records only. Each request retains its own scope
// and evidence; indexing several goals never merges their execution authority.
function goalsFor(conversation){
 if(conversation?.ownerGoals!==undefined&&(!Array.isArray(conversation.ownerGoals)||conversation.ownerGoals.some(g=>!validGoal(g))))throw Error('owner_goal_history_unavailable')
 const found=new Map()
 for(const m of conversation?.messages||[])if(m?.role==='assistant'&&validGoal(m.ownerGoal))found.set(m.ownerGoal.goalId,m.ownerGoal)
 for(const g of conversation?.ownerGoals||[])if(validGoal(g))found.set(g.goalId,g)
 return [...found.values()]
}
function currentGoal(conversation){const all=goalsFor(conversation),active=all.find(g=>g.goalId===conversation?.activeOwnerGoalId);if(conversation?.activeOwnerGoalId&&!active)throw Error('owner_goal_history_unavailable');return active||all.at(-1)||null}
function withOutstanding(result,conversation){
 if(!validGoal(result?.ownerGoal)||typeof result.reply!=='string')return result
 const pending=goalsFor(conversation).filter(g=>g.goalId!==result.ownerGoal.goalId&&g.status!=='GOAL_COMPLETED')
 const envelope={...result,pendingOwnerGoals:structuredClone(pending),hasUnresolvedOwnerGoals:pending.length>0||result.ownerGoal.status!=='GOAL_COMPLETED'}
 if(!pending.length)return envelope
 const extra=require('./ownerGoalView').renderOutstanding(pending)
 return {...envelope,reply:result.reply+'\n\n'+extra,replyForArchive:(result.replyForArchive||result.reply)+'\n\n'+extra}
}
module.exports={schema,createGoal,refineGoal,applyEvidence,observeReads,bindGatewayGoal,applyGatewayEvidence,validGoal,attachResult,projectTask,shouldTrack,isTaskRequest,clauses,goalsFor,currentGoal,withOutstanding}
